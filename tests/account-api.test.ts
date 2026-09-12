import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  deleteCurrentAccount: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/account-deletion', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteCurrentAccount: mocks.deleteCurrentAccount,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  }),
  createAdminSupabaseClient: () => ({ admin: true }),
}));
import { DELETE } from '@/app/api/account/route';

function request(body: unknown, origin = 'https://resourcedex.vercel.app') {
  return new Request('https://resourcedex.vercel.app/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'current-user' } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.deleteCurrentAccount.mockResolvedValue(undefined);
});

it('requires same-origin requests and typed confirmation', async () => {
  expect(
    (
      await DELETE(
        request({ password: 'password', confirmation: 'DELETE' }, 'https://unrelated.example'),
      )
    ).status,
  ).toBe(403);
  expect((await DELETE(request({ password: 'password', confirmation: 'delete' }))).status).toBe(
    400,
  );
  expect(mocks.deleteCurrentAccount).not.toHaveBeenCalled();
});

it('rejects an account ID supplied by the client', async () => {
  expect(
    (
      await DELETE(
        request({ password: 'password', confirmation: 'DELETE', userId: 'someone-else' }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.deleteCurrentAccount).not.toHaveBeenCalled();
});

it('requires a live Auth user and does not rely on cookie claims', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'session expired' } });
  expect((await DELETE(request({ password: 'password', confirmation: 'DELETE' }))).status).toBe(
    401,
  );
  expect(mocks.deleteCurrentAccount).not.toHaveBeenCalled();
});

it('deletes only the verified current account and clears its local session', async () => {
  const response = await DELETE(request({ password: 'password', confirmation: 'DELETE' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.deleteCurrentAccount).toHaveBeenCalledWith({ id: 'current-user' }, 'password', {
    admin: true,
  });
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
