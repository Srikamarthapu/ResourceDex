import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ url: 'https://example.supabase.co', key: 'public-example' }),
}));

import { deleteCurrentAccount, removeAccountPhotos } from '@/lib/account-deletion';

const ownerId = 'a0000000-0000-4000-8000-000000000001';
const otherId = 'b0000000-0000-4000-8000-000000000002';
const user = { id: ownerId, email: 'deletion-test@example.invalid' } as User;

function fakeAdmin() {
  const objects = new Map<string, Set<string>>([
    ['scan-images', new Set<string>()],
    ['listing-images', new Set<string>()],
  ]);
  const events: string[] = [];
  const list = vi.fn(
    async (bucket: string, prefix: string, options: { limit: number; offset: number }) => {
      expect(options.offset).toBe(0);
      const entries = new Map<string, { name: string; id: string | null }>();
      for (const path of objects.get(bucket)!) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const relative = path.slice(prefix.length + 1);
        const name = relative.split('/')[0];
        entries.set(name, { name, id: relative.includes('/') ? null : path });
      }
      return {
        data: [...entries.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, options.limit),
        error: null,
      };
    },
  );
  const remove = vi.fn(async (bucket: string, paths: string[]) => {
    events.push(`remove:${bucket}`);
    for (const path of paths) objects.get(bucket)!.delete(path);
    return { error: null };
  });
  const rpc = vi.fn(async (name: string) => {
    events.push(name);
    return { error: null as { message: string } | null };
  });
  const signOut = vi.fn(async () => {
    events.push('global-signout');
    return { error: null };
  });
  const deleteUser = vi.fn(async () => {
    events.push('delete-user');
    return { error: null };
  });
  const client = {
    rpc,
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string, options: { limit: number; offset: number }) =>
          list(bucket, prefix, options),
        remove: (paths: string[]) => remove(bucket, paths),
      }),
    },
    auth: { admin: { signOut, deleteUser } },
  } as unknown as SupabaseClient;
  return { client, objects, events, list, remove, rpc, signOut, deleteUser };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({
    data: { user, session: { access_token: 'disposable-test-session' } },
    error: null,
  });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('account deletion', () => {
  it('rejects a wrong password without mutating account data', async () => {
    const admin = fakeAdmin();
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'bad password' } });
    await expect(deleteCurrentAccount(user, 'wrong', admin.client)).rejects.toMatchObject({
      status: 403,
      started: false,
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('binds reauthentication to the current verified user, never another account', async () => {
    const admin = fakeAdmin();
    auth.signInWithPassword.mockResolvedValue({
      data: { user: { ...user, id: otherId }, session: { access_token: 'other-session' } },
      error: null,
    });
    await expect(deleteCurrentAccount(user, 'password', admin.client)).rejects.toMatchObject({
      status: 403,
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('purges nested and orphan photos across pages without touching another owner', async () => {
    const admin = fakeAdmin();
    for (let index = 0; index < 215; index++)
      admin.objects.get('scan-images')!.add(`${ownerId}/scan/${index}.jpg`);
    admin.objects.get('listing-images')!.add(`${ownerId}/orphan.jpg`);
    admin.objects.get('scan-images')!.add(`${otherId}/scan/keep.jpg`);
    await deleteCurrentAccount(user, 'password', admin.client);
    expect([...admin.objects.get('scan-images')!]).toEqual([`${otherId}/scan/keep.jpg`]);
    expect(admin.objects.get('listing-images')!.size).toBe(0);
    expect(admin.events.slice(0, 2)).toEqual(['begin_account_deletion', 'remove_account_records']);
    expect(admin.events.slice(-2)).toEqual(['global-signout', 'delete-user']);
    expect(admin.rpc).toHaveBeenCalledWith('begin_account_deletion', { p_owner: ownerId });
    expect(admin.deleteUser).toHaveBeenCalledWith(ownerId);
  });

  it('does not delete the Auth account when photo cleanup fails and can resume safely', async () => {
    const admin = fakeAdmin();
    admin.objects.get('scan-images')!.add(`${ownerId}/scan/photo.jpg`);
    admin.objects.get('listing-images')!.add(`${ownerId}/scan/listing.jpg`);
    admin.remove
      .mockImplementationOnce(async (bucket, paths) => {
        for (const path of paths) admin.objects.get(bucket)!.delete(path);
        return { error: null };
      })
      .mockImplementationOnce(async () => ({ error: { message: 'Storage unavailable' } }) as never);
    await expect(deleteCurrentAccount(user, 'password', admin.client)).rejects.toMatchObject({
      status: 503,
      started: true,
    });
    expect(admin.deleteUser).not.toHaveBeenCalled();
    expect(admin.signOut).not.toHaveBeenCalled();
    await deleteCurrentAccount(user, 'password', admin.client);
    expect(admin.deleteUser).toHaveBeenCalledOnce();
    expect(admin.objects.get('listing-images')!.size).toBe(0);
  });

  it('stops when record cleanup fails and preserves a retryable deletion state', async () => {
    const admin = fakeAdmin();
    admin.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'temporary conflict' } });
    await expect(deleteCurrentAccount(user, 'password', admin.client)).rejects.toMatchObject({
      started: true,
    });
    expect(admin.list).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('bounds large cleanup jobs so another request can continue the remaining work', async () => {
    const admin = fakeAdmin();
    await expect(removeAccountPhotos(admin.client, ownerId, Date.now() - 1)).rejects.toMatchObject({
      started: true,
      status: 503,
    });
    expect(admin.list).not.toHaveBeenCalled();
  });
});
