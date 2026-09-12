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

test('account deletion confirms identity, removes data and photos, and closes stale uploads', async ({
  page,
}) => {
  test.skip(!configured, 'Requires the configured ResourceDex test project.');
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const visitor = createClient(url!, publicKey!, { auth: { persistSession: false } });
  const staleClient = createClient(url!, publicKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID();
  const password = `A-${randomUUID()}-z9!`;
  const createdUsers: string[] = [];
  const paths: { bucket: string; path: string }[] = [];
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=',
    'base64',
  );
  const must = async <T extends { data: unknown; error: unknown }>(
    promise: PromiseLike<T>,
  ): Promise<T['data']> => {
    const result = await promise;
    expect(result.error, 'Isolated fixture operation succeeds').toBeNull();
    return result.data;
  };
  try {
    for (const role of ['departing', 'remaining']) {
      const result = await must(
        admin.auth.admin.createUser({
          email: `resourcedex-deletion-${role}-${suffix}@example.test`,
          password,
          email_confirm: true,
          user_metadata: { display_name: `Deletion test ${role}` },
        }),
      );
      createdUsers.push(result.user!.id);
    }
    const [ownerId, otherId] = createdUsers;
    const email = `resourcedex-deletion-departing-${suffix}@example.test`;
    await must(staleClient.auth.signInWithPassword({ email, password }));
    const scanId = randomUUID();
    for (const bucket of ['scan-images', 'listing-images']) {
      for (const file of ['known.png', 'orphan.png']) {
        const path = `${ownerId}/${scanId}/${file}`;
        await must(admin.storage.from(bucket).upload(path, png, { contentType: 'image/png' }));
        paths.push({ bucket, path });
      }
    }
    const scan = await must(
      admin
        .from('scans')
        .insert({
          id: scanId,
          owner_id: ownerId,
          status: 'completed',
          upload_operation_key: randomUUID(),
          analysis_version: 1,
        })
        .select()
        .single(),
    );
    await must(
      admin
        .from('scan_reviews')
        .insert({ scan_id: scan.id, owner_id: ownerId, analysis_version: 1, candidates: [] }),
    );
    await must(
      admin.from('analysis_attempts').insert({
        scan_id: scan.id,
        owner_id: ownerId,
        operation_key: randomUUID(),
        status: 'completed',
      }),
    );
    await must(
      admin.from('image_assets').insert({
        owner_id: ownerId,
        scan_id: scan.id,
        storage_path: `${ownerId}/${scanId}/known.png`,
        kind: 'listing',
        mime_type: 'image/png',
        width: 1,
        height: 1,
      }),
    );
    const resources = await must(
      admin
        .from('resources')
        .insert([
          {
            owner_id: ownerId,
            scan_id: scan.id,
            title: `Deletion test owned ${suffix}`,
            status: 'reserved',
            area_id: 'campus',
            is_sample: true,
          },
          {
            owner_id: otherId,
            title: `Deletion test preserved ${suffix}`,
            status: 'reserved',
            area_id: 'campus',
            is_sample: true,
          },
        ])
        .select('id,owner_id'),
    );
    const ownResource = resources!.find((resource) => resource.owner_id === ownerId)!.id;
    const otherResource = resources!.find((resource) => resource.owner_id === otherId)!.id;
    const requests = await must(
      admin
        .from('requests')
        .insert([
          {
            resource_id: ownResource,
            requester_id: otherId,
            resource_revision: 1,
            status: 'accepted',
          },
          {
            resource_id: otherResource,
            requester_id: ownerId,
            resource_revision: 1,
            status: 'accepted',
          },
        ])
        .select('id'),
    );
    await must(
      admin.from('pickup_arrangements').insert(
        requests!.map(({ id }) => ({
          request_id: id,
          meeting_place: 'Isolated test meeting place',
          starts_at: '2027-01-01T12:00:00Z',
          ends_at: '2027-01-01T13:00:00Z',
          timezone: 'UTC',
        })),
      ),
    );
    await must(
      admin.from('reports').insert([
        { reporter_id: otherId, resource_id: ownResource, reason: 'other' },
        { reporter_id: ownerId, resource_id: otherResource, reason: 'other' },
      ]),
    );
    const latePath = `${ownerId}/${scanId}/late.png`;
    const signedUpload = await must(
      admin.storage.from('scan-images').createSignedUploadUrl(latePath),
    );

    try {
      await page.goto('/account?next=/account');
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
    } catch {
      throw new Error('Disposable deletion account sign-in failed; credentials omitted.');
    }
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Permanently delete account', exact: true }),
    ).toBeDisabled();
    mkdirSync('output/qa', { recursive: true });
    await page.screenshot({ path: 'output/qa/account-deletion-confirmation.png', fullPage: true });
    await page.getByLabel('Confirm your password').fill('deliberately-wrong-password');
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
    await expect(
      page.getByText('Your password could not be verified. Check it and try again.'),
    ).toBeVisible();
    expect((await must(admin.from('resources').select('id').eq('id', ownResource)))!.length).toBe(
      1,
    );

    // Simulate a interrupted cleanup: the marker must hide listings immediately,
    // and an already-issued upload token must not recreate content during retries.
    await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
    expect((await must(visitor.from('resources').select('id').eq('id', ownResource)))!.length).toBe(
      0,
    );
    expect(
      (
        await staleClient.storage
          .from('scan-images')
          .uploadToSignedUrl(latePath, signedUpload!.token, png, { contentType: 'image/png' })
      ).error,
    ).toBeTruthy();
    expect(
      (await admin.from('scans').insert({ owner_id: ownerId, upload_operation_key: randomUUID() }))
        .error,
    ).toBeTruthy();

    await page.getByLabel('Confirm your password').fill(password);
    await page.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
    await expect(page).toHaveURL(/\/account\?deleted=1$/);
    await expect(
      page.getByText('Your account and its ResourceDex data have been deleted.'),
    ).toBeVisible();
    expect((await admin.auth.admin.getUserById(ownerId)).error).toBeTruthy();
    for (const table of [
      'resources',
      'scans',
      'image_assets',
      'scan_reviews',
      'analysis_attempts',
    ]) {
      expect(
        (await must(admin.from(table).select('owner_id').eq('owner_id', ownerId)))!.length,
        table,
      ).toBe(0);
    }
    expect((await must(admin.from('profiles').select('id').eq('id', ownerId)))!.length).toBe(0);
    expect(
      (await must(
        admin
          .from('requests')
          .select('id')
          .in(
            'id',
            requests!.map(({ id }) => id),
          ),
      ))!.length,
    ).toBe(0);
    expect(
      (await must(
        admin
          .from('pickup_arrangements')
          .select('request_id')
          .in(
            'request_id',
            requests!.map(({ id }) => id),
          ),
      ))!.length,
    ).toBe(0);
    expect(
      (await must(admin.from('resources').select('status').eq('id', otherResource).single()))!
        .status,
    ).toBe('available');
    expect((await must(admin.from('profiles').select('id').eq('id', otherId)))!.length).toBe(1);
    for (const bucket of ['scan-images', 'listing-images']) {
      expect((await must(admin.storage.from(bucket).list(ownerId)))!.length).toBe(0);
    }
    expect(
      (
        await staleClient.storage
          .from('scan-images')
          .uploadToSignedUrl(latePath, signedUpload!.token, png, { contentType: 'image/png' })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await staleClient.rpc('create_request', {
          resource_id: otherResource,
          note: '',
          proposed_window: '',
          operation_key: randomUUID(),
        })
      ).error,
    ).toBeTruthy();
    expect(runtimeErrors).toEqual([]);
  } finally {
    // The IDs come only from Auth.createUser above. No existing pilot account is
    // eligible for teardown, including when assertions or browser actions fail.
    for (const ownerId of createdUsers) {
      const remaining = await admin.auth.admin.getUserById(ownerId);
      if (remaining.error) continue;
      expect(remaining.data.user?.email).toContain(`-${suffix}@example.test`);
      await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
      await must(admin.rpc('remove_account_records', { p_owner: ownerId }));
      for (const bucket of ['scan-images', 'listing-images']) {
        const ownedPaths = paths
          .filter((entry) => entry.bucket === bucket && entry.path.startsWith(`${ownerId}/`))
          .map((entry) => entry.path);
        if (ownedPaths.length) await must(admin.storage.from(bucket).remove(ownedPaths));
      }
      await must(admin.auth.admin.deleteUser(ownerId));
    }
  }
});
