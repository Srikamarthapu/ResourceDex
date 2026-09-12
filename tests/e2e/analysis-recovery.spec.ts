import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import sharp from 'sharp';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured =
  url === 'https://wdenmhvhnzrkhhvnnuyo.supabase.co' && Boolean(publicKey && secret);
const screenshotDirectory = process.env.QA_OUTPUT_DIR || 'output/qa';

test('another active photo can be stopped without losing the current photo, and saved runs recover on reload', async ({
  page,
}) => {
  test.skip(!configured, 'Requires the configured ResourceDex test project.');
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID();
  const email = `resourcedex-recovery-${suffix}@example.test`;
  const password = `R-${randomUUID()}-a9!`;
  let ownerId = '';
  const scanPaths: string[] = [];
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const must = async <T extends { data: unknown; error: unknown }>(
    promise: PromiseLike<T>,
  ): Promise<NonNullable<T['data']>> => {
    const result = await promise;
    expect(result.error, 'Isolated recovery fixture operation succeeds').toBeNull();
    return result.data as NonNullable<T['data']>;
  };
  try {
    ownerId = (
      await must(
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: 'Recovery test owner' },
        }),
      )
    ).user!.id;
    const scans = [];
    for (const name of ['tools', 'containers']) {
      const id = randomUUID();
      const bytes = readFileSync(`public/images/samples/${name}.webp`);
      const { width, height } = await sharp(bytes).metadata();
      const path = `${ownerId}/${id}/saved.webp`;
      scanPaths.push(path);
      await must(
        admin.storage.from('scan-images').upload(path, bytes, { contentType: 'image/webp' }),
      );
      await must(
        admin.from('scans').insert({
          id,
          owner_id: ownerId,
          upload_operation_key: randomUUID(),
          status: 'ready',
          normalized_path: path,
          original_path: path,
          width,
          height,
          image_hash: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      scans.push({ id, path });
    }
    const [otherPhoto, currentPhoto] = scans;
    const activeKey = randomUUID();
    const startedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 150_000).toISOString();
    await must(
      admin
        .from('scans')
        .update({
          status: 'analyzing',
          analysis_operation_key: activeKey,
          analysis_started_at: startedAt,
          analysis_deadline_at: deadlineAt,
        })
        .eq('id', otherPhoto.id)
        .eq('owner_id', ownerId),
    );
    await must(
      admin.from('analysis_attempts').insert({
        owner_id: ownerId,
        scan_id: otherPhoto.id,
        operation_key: activeKey,
        status: 'running',
        reserved_cost_usd: 0.000001,
      }),
    );
    try {
      await page.goto(`/account?next=${encodeURIComponent(`/share?scan=${currentPhoto.id}`)}`);
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Identify items', exact: true })).toBeVisible();
    } catch {
      throw new Error('Disposable recovery account sign-in failed; credentials omitted.');
    }
    await page.getByRole('checkbox', { name: /Send this photo to Google Gemini/ }).check();
    const conflict = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/scans/${currentPhoto.id}/analyze` &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Identify items', exact: true }).click();
    const response = await conflict;
    expect(response.status()).toBe(409);
    const activeAnalysis = (await response.json()).activeAnalysis;
    expect(activeAnalysis).toMatchObject({
      scanId: otherPhoto.id,
      operationKey: activeKey,
    });
    expect(Date.parse(activeAnalysis.startedAt)).toBe(Date.parse(startedAt));
    expect(Date.parse(activeAnalysis.deadlineAt)).toBe(Date.parse(deadlineAt));
    await expect(
      page.getByRole('heading', { name: 'Another photo is being identified', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add details myself', exact: true }),
    ).toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`scan=${currentPhoto.id}$`));
    await expect(page.locator('.upload-preview img')).toHaveAttribute(
      'src',
      new RegExp(currentPhoto.id),
    );
    await page.locator('.upload-preview img').evaluate(async (element) => {
      await (element as HTMLImageElement).decode();
    });
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, 'analysis-recovery-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 860 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: join(screenshotDirectory, 'analysis-recovery-320.png'),
      fullPage: true,
    });
    const stopped = page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === `/api/scans/${otherPhoto.id}/cancel` && result.ok(),
    );
    await page.getByRole('button', { name: 'Stop identification', exact: true }).click();
    expect((await (await stopped).json()).cancelled).toBe(true);
    await expect(
      page.getByText('Identification stopped. Your photo and saved review are unchanged.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add details myself', exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Identify items', exact: true })).toBeEnabled();
    await expect(page.locator('.upload-preview img')).toHaveAttribute(
      'src',
      new RegExp(currentPhoto.id),
    );
    expect(
      (await must(admin.from('scans').select('status').eq('id', otherPhoto.id).single())).status,
    ).toBe('failed');
    expect(
      await must(
        admin
          .from('analysis_attempts')
          .select('status,error_code')
          .eq('scan_id', otherPhoto.id)
          .eq('operation_key', activeKey)
          .single(),
      ),
    ).toMatchObject({ status: 'failed', error_code: 'cancelled' });
    expect(
      (await must(admin.from('scans').select('status').eq('id', currentPhoto.id).single())).status,
    ).toBe('ready');
    await page.getByRole('button', { name: 'Add details myself', exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toBeVisible();
    const createdDraft = new URL(page.url()).searchParams.get('draft');
    expect(createdDraft).toBeTruthy();
    expect(
      (
        await must(
          admin
            .from('resources')
            .select('scan_id')
            .eq('id', createdDraft!)
            .eq('owner_id', ownerId)
            .single(),
        )
      ).scan_id,
    ).toBe(currentPhoto.id);

    // A page reload restores the existing operation rather than starting a
    // duplicate provider call. Completion is seeded, never requested from AI.
    const restoredKey = randomUUID();
    await must(
      admin
        .from('scans')
        .update({
          status: 'analyzing',
          analysis_operation_key: restoredKey,
          analysis_started_at: new Date().toISOString(),
          analysis_deadline_at: new Date(Date.now() + 150_000).toISOString(),
          analysis_error: null,
        })
        .eq('id', otherPhoto.id)
        .eq('owner_id', ownerId),
    );
    const restoredAttempt = await must(
      admin
        .from('analysis_attempts')
        .insert({
          owner_id: ownerId,
          scan_id: otherPhoto.id,
          operation_key: restoredKey,
          status: 'running',
          reserved_cost_usd: 0.000001,
        })
        .select('id')
        .single(),
    );
    let unexpectedAnalyze = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/scans/${otherPhoto.id}/analyze`
      )
        unexpectedAnalyze++;
    });
    await page.goto(`/share?scan=${otherPhoto.id}`);
    await expect(
      page.getByRole('heading', { name: 'Identifying your photo', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Stop identification', exact: true }),
    ).toBeVisible();
    const candidate = {
      candidate_id: `${restoredAttempt.id}:tool`,
      label: 'Recovered test tool',
      category: 'tools',
      bounds: { x_min: 100, y_min: 100, x_max: 900, y_max: 900 },
      localization_status: 'localized',
      localization_reason: null,
      visible_observations: ['Isolated recovery test fixture.'],
      unknowns: ['Owner review required.'],
      owner_questions: [],
      review_status: 'pending',
    };
    await must(
      admin.rpc('complete_analysis', {
        p_owner: ownerId,
        p_scan: otherPhoto.id,
        p_operation_key: restoredKey,
        p_attempt: restoredAttempt.id,
        p_result: { candidates: [candidate], limitReached: false },
        p_model: 'fixture-only',
        p_prompt: 'fixture-only',
        p_schema: 'fixture-only',
        p_tokens: {},
      }),
    );
    const check = page.getByRole('button', { name: 'Check status', exact: true });
    if (await check.isVisible()) await check.click();
    await expect(page.getByLabel('Item 1 name', { exact: true })).toHaveValue(
      'Recovered test tool',
    );
    await expect(
      page.getByRole('button', { name: 'Stop identification', exact: true }),
    ).toHaveCount(0);
    expect(unexpectedAnalyze).toBe(0);
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (ownerId) {
      const remaining = await admin.auth.admin.getUserById(ownerId);
      if (!remaining.error) {
        expect(remaining.data.user?.email).toBe(email);
        const assets = await must(
          admin
            .from('image_assets')
            .select('storage_path')
            .eq('owner_id', ownerId)
            .eq('kind', 'listing'),
        );
        const listingPaths = assets.map((asset) => asset.storage_path);
        expect(
          [...listingPaths, ...scanPaths].every((path) => path.startsWith(`${ownerId}/`)),
        ).toBe(true);
        await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
        await must(admin.rpc('remove_account_records', { p_owner: ownerId }));
        if (listingPaths.length)
          await must(admin.storage.from('listing-images').remove(listingPaths));
        if (scanPaths.length) await must(admin.storage.from('scan-images').remove(scanPaths));
        await must(admin.auth.admin.deleteUser(ownerId));
      }
    }
  }
});
