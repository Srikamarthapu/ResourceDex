import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured =
  url === 'https://wdenmhvhnzrkhhvnnuyo.supabase.co' && Boolean(publicKey && secret);

test('owners can delete one or all drafts without resurrection or deleting other resources', async ({
  page,
}) => {
  test.skip(!configured, 'Requires the configured ResourceDex test project.');
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const owner = createClient(url!, publicKey!, { auth: { persistSession: false } });
  const visitor = createClient(url!, publicKey!, { auth: { persistSession: false } });
  const suffix = randomUUID();
  const password = `D-${randomUUID()}-z9!`;
  const createdUsers: string[] = [];
  const runtimeErrors: string[] = [];
  const scanId = randomUUID();
  let imagePath = '';
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const must = async <T extends { data: unknown; error: unknown }>(
    promise: PromiseLike<T>,
  ): Promise<T['data']> => {
    const result = await promise;
    expect(result.error, 'Isolated draft fixture operation succeeds').toBeNull();
    return result.data;
  };
  try {
    for (const role of ['owner', 'other']) {
      const result = await must(
        admin.auth.admin.createUser({
          email: `resourcedex-drafts-${role}-${suffix}@example.test`,
          password,
          email_confirm: true,
          user_metadata: { display_name: `Draft test ${role}` },
        }),
      );
      createdUsers.push(result.user!.id);
    }
    const [ownerId, otherId] = createdUsers;
    const email = `resourcedex-drafts-owner-${suffix}@example.test`;
    await must(owner.auth.signInWithPassword({ email, password }));
    await must(
      admin.from('scans').insert({
        id: scanId,
        owner_id: ownerId,
        upload_operation_key: randomUUID(),
        status: 'completed',
      }),
    );
    imagePath = `${ownerId}/${scanId}/shared.png`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=',
      'base64',
    );
    await must(
      admin.storage.from('listing-images').upload(imagePath, png, { contentType: 'image/png' }),
    );
    await must(
      admin.from('image_assets').insert({
        owner_id: ownerId,
        scan_id: scanId,
        storage_path: imagePath,
        kind: 'listing',
        mime_type: 'image/png',
        width: 1,
        height: 1,
      }),
    );
    const drafts = await must(
      admin
        .from('resources')
        .insert(
          ['A', 'B', 'C', 'D'].map((letter) => ({
            owner_id: ownerId,
            scan_id: scanId,
            candidate_id: `${suffix}:${letter}`,
            title: `Disposable draft ${letter}`,
            image_path: imagePath,
            is_sample: true,
          })),
        )
        .select('id,title,candidate_id'),
    );
    const draft = (letter: string) =>
      drafts!.find((row) => row.title === `Disposable draft ${letter}`)!;
    const protectedRows = await must(
      admin
        .from('resources')
        .insert([
          {
            owner_id: otherId,
            title: 'Other account draft',
            status: 'draft',
            moderation_state: 'visible',
            is_sample: true,
          },
          {
            owner_id: ownerId,
            title: 'Published test resource',
            status: 'available',
            published_at: new Date().toISOString(),
            moderation_state: 'hidden',
            image_path: imagePath,
            scan_id: scanId,
            is_sample: true,
          },
          {
            owner_id: ownerId,
            title: 'Reserved test resource',
            status: 'reserved',
            moderation_state: 'hidden',
            is_sample: true,
          },
          {
            owner_id: ownerId,
            title: 'Previously published test draft',
            status: 'draft',
            moderation_state: 'visible',
            published_at: new Date().toISOString(),
            is_sample: true,
          },
        ])
        .select('id,title'),
    );
    for (const row of protectedRows!) {
      expect(
        (await owner.rpc('delete_resource_drafts', { resource_ids: [draft('A').id, row.id] }))
          .error,
      ).toBeTruthy();
      expect(
        (await must(admin.from('resources').select('id').eq('id', draft('A').id)))!.length,
      ).toBe(1);
    }
    expect(
      (await visitor.rpc('delete_resource_drafts', { resource_ids: [draft('A').id] })).error,
    ).toBeTruthy();
    // The artificially previously-published draft is only a guard fixture, not
    // something a real UI command can create. Remove it before testing Delete all.
    const previous = protectedRows!.find((row) => row.title === 'Previously published test draft')!;
    await must(admin.from('resources').delete().eq('id', previous.id).eq('owner_id', ownerId));

    try {
      await page.goto('/account?next=/my-resources');
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/my-resources$/);
    } catch {
      throw new Error('Disposable draft account sign-in failed; credentials omitted.');
    }
    const deleteA = page.getByRole('button', {
      name: 'Delete draft: Disposable draft A',
      exact: true,
    });
    await expect(deleteA).toBeVisible();
    mkdirSync('output/qa', { recursive: true });
    await page.screenshot({ path: 'output/qa/draft-deletion-desktop.png', fullPage: true });
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Delete this saved draft?');
      return dialog.dismiss();
    });
    await deleteA.click();
    await expect(deleteA).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await deleteA.click();
    await expect(deleteA).toHaveCount(0);
    await expect(
      page.getByText('Draft deleted. You can start again with a new photo.', { exact: true }),
    ).toBeVisible();
    expect((await must(admin.from('resources').select('id').eq('id', draft('A').id)))!.length).toBe(
      0,
    );
    const saveInput = (letter: string) => ({
      title: `Stale draft ${letter}`,
      scan_id: scanId,
      candidate_id: draft(letter).candidate_id,
      image_path: imagePath,
    });
    expect(
      (
        await owner.rpc('save_resource', {
          input: saveInput('A'),
          resource_id: draft('A').id,
          expected_revision: 1,
        })
      ).error,
    ).toBeTruthy();
    expect((await owner.rpc('save_resource', { input: saveInput('A') })).error?.message).toContain(
      'This draft was deleted',
    );
    await must(owner.rpc('delete_resource_drafts', { resource_ids: [draft('A').id] }));

    // A duplicate creation in flight either fails uniqueness first or observes
    // the deletion marker. Neither schedule may bring the removed item back.
    const [deleted, staleSave] = await Promise.all([
      owner.rpc('delete_resource_drafts', { resource_ids: [draft('B').id] }),
      owner.rpc('save_resource', { input: saveInput('B') }),
    ]);
    expect(deleted.error).toBeNull();
    expect(staleSave.error).toBeTruthy();
    expect(
      (await must(
        admin
          .from('resources')
          .select('id')
          .eq('scan_id', scanId)
          .eq('candidate_id', draft('B').candidate_id),
      ))!.length,
    ).toBe(0);

    await page.reload();
    await page.getByRole('tab', { name: 'Drafts (2)', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Delete all drafts', exact: true }),
    ).toBeVisible();
    mkdirSync('output/qa', { recursive: true });
    await page.setViewportSize({ width: 320, height: 860 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'output/qa/draft-deletion-320.png', fullPage: true });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete all drafts', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'No unfinished ideas', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Drafts (0)', exact: true })).toBeVisible();

    for (const row of protectedRows!.filter((row) => row.id !== previous.id))
      expect((await must(admin.from('resources').select('id').eq('id', row.id)))!.length).toBe(1);
    expect((await must(admin.from('scans').select('id').eq('id', scanId)))!.length).toBe(1);
    expect(
      (await must(admin.from('image_assets').select('id').eq('storage_path', imagePath)))!.length,
    ).toBe(1);
    expect((await admin.storage.from('listing-images').download(imagePath)).error).toBeNull();
    const fresh = await must(
      owner.rpc('save_resource', {
        input: { ...saveInput('A'), candidate_id: `${suffix}:fresh`, title: 'Fresh retry draft' },
      }),
    );
    expect(fresh).toBeTruthy();
    expect(runtimeErrors).toEqual([]);
  } finally {
    // Only Auth users created above can enter cleanup, even after a failed test.
    for (const ownerId of createdUsers) {
      const remaining = await admin.auth.admin.getUserById(ownerId);
      if (remaining.error) continue;
      expect(remaining.data.user?.email).toContain(`-${suffix}@example.test`);
      await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
      await must(admin.rpc('remove_account_records', { p_owner: ownerId }));
      if (imagePath.startsWith(`${ownerId}/`))
        await must(admin.storage.from('listing-images').remove([imagePath]));
      await must(admin.auth.admin.deleteUser(ownerId));
    }
  }
});
