import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import manifest from '../../knowledge/starter-corpus.json';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured =
  url === 'https://wdenmhvhnzrkhhvnnuyo.supabase.co' && Boolean(publicKey && secret);
const screenshotDirectory = process.env.QA_OUTPUT_DIR || 'output/qa';

test('private Kimi review displays canonical references and clears them after identity edits', async ({
  page,
}) => {
  test.skip(!configured, 'Requires the configured ResourceDex test project.');
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const visitor = createClient(url!, publicKey!, { auth: { persistSession: false } });
  const suffix = randomUUID();
  const password = `R-${randomUUID()}-z9!`;
  const email = `resourcedex-references-${suffix}@example.test`;
  let ownerId = '';
  let imagePath = '';
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const must = async <T extends { data: unknown; error: unknown }>(
    promise: PromiseLike<T>,
  ): Promise<T['data']> => {
    const result = await promise;
    expect(result.error, 'Isolated reference fixture operation succeeds').toBeNull();
    return result.data;
  };
  try {
    const created = await must(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: 'Reference test owner' },
      }),
    );
    ownerId = created.user!.id;
    const scanId = randomUUID();
    imagePath = `${ownerId}/${scanId}/reference-fixture.webp`;
    const bytes = readFileSync('public/images/samples/hardware.webp');
    const { width, height } = await sharp(bytes).metadata();
    await must(
      admin.storage.from('scan-images').upload(imagePath, bytes, { contentType: 'image/webp' }),
    );
    const entry = manifest.entries.find((source) => source.id === 'epa-reuse-hardware')!;
    // Use the real reviewed source and its canonical ingestion hash. No provider
    // call, invented citation, or user content is needed to exercise the UI.
    const contentHash = createHash('sha256')
      .update(
        `Source ID: ${entry.id}\nTitle: ${entry.title}\nPublisher: ${entry.publisher}\nCanonical source: ${entry.url}\nSection: ${entry.locator}\nReference guidance: ${entry.text}\nConditions and limitations: ${entry.applicability}\n`,
      )
      .digest('hex');
    const candidate = {
      candidate_id: `${suffix}:hardware`,
      label: 'Removable hardware',
      category: 'hardware',
      bounds: { x_min: 100, y_min: 100, x_max: 900, y_max: 900 },
      localization_status: 'localized',
      localization_reason: null,
      visible_observations: ['A collection of small loose hardware pieces.'],
      unknowns: ['Dimensions and condition need owner review.'],
      owner_questions: ['Which pieces are included?'],
      review_status: 'pending',
      reference_notes: [
        {
          text: entry.text,
          applicability: entry.applicability,
          source: {
            id: entry.id,
            title: entry.title,
            publisher: entry.publisher,
            url: entry.url,
            locator: entry.locator,
            contentHash,
            corpusVersion: manifest.version,
          },
        },
      ],
    };
    await must(
      admin.from('scans').insert({
        id: scanId,
        owner_id: ownerId,
        status: 'completed',
        upload_operation_key: randomUUID(),
        normalized_path: imagePath,
        original_path: imagePath,
        width,
        height,
        image_hash: createHash('sha256').update(bytes).digest('hex'),
        analysis_version: 1,
        candidates: [candidate],
        model: 'moonshotai/kimi-k3',
        token_usage: { provider: 'nvidia', grounding: { status: 'grounded' } },
      }),
    );
    const privateAccess = await visitor.from('scans').select('id').eq('id', scanId);
    expect(privateAccess.error?.code).toBe('42501');
    expect(privateAccess.data).toBeNull();
    try {
      await page.goto(`/account?next=${encodeURIComponent(`/share?scan=${scanId}`)}`);
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByLabel('Item 1 name', { exact: true })).toHaveValue(candidate.label);
    } catch {
      throw new Error('Disposable reference account sign-in failed; credentials omitted.');
    }
    await expect(
      page.getByText('Kimi K3 identified these items because Gemini was unavailable.', {
        exact: false,
      }),
    ).toBeVisible();
    const references = page.locator('details.reference-notes');
    await references.locator('summary').click();
    await expect(references.getByText(entry.text, { exact: true })).toBeVisible();
    await expect(references.getByRole('link')).toHaveAttribute('href', entry.url);
    await expect(
      references.getByText('Conditional reference notes from a small starter collection.', {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .locator('svg image')
      .first()
      .evaluate(async (element) => {
        const image = new Image();
        image.src = element.getAttribute('href')!;
        await image.decode();
      });
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, 'reference-notes-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 860 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: join(screenshotDirectory, 'reference-notes-320.png'),
      fullPage: true,
    });
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/scans/${scanId}/review` &&
        response.ok(),
    );
    await page.getByLabel('Item 1 name', { exact: true }).fill('Owner corrected item');
    await expect(references).toHaveCount(0);
    await saved;
    await page.reload();
    await expect(page.getByLabel('Item 1 name', { exact: true })).toHaveValue(
      'Owner corrected item',
    );
    await expect(page.locator('details.reference-notes')).toHaveCount(0);
    const review = await must(
      admin
        .from('scan_reviews')
        .select('candidates')
        .eq('scan_id', scanId)
        .eq('owner_id', ownerId)
        .single(),
    );
    expect(review).not.toBeNull();
    expect(review!.candidates[0].reference_notes).toBeUndefined();
    await must(
      admin
        .from('scans')
        .update({ token_usage: { provider: 'nvidia', grounding: { status: 'unavailable' } } })
        .eq('id', scanId)
        .eq('owner_id', ownerId),
    );
    await page.reload();
    await expect(
      page.getByText(
        'Item identification is ready, but the reuse reference lookup could not finish.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Item 1 name', { exact: true })).toHaveValue(
      'Owner corrected item',
    );
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (ownerId) {
      const remaining = await admin.auth.admin.getUserById(ownerId);
      if (!remaining.error) {
        expect(remaining.data.user?.email).toBe(email);
        await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
        await must(admin.rpc('remove_account_records', { p_owner: ownerId }));
        if (imagePath.startsWith(`${ownerId}/`))
          await must(admin.storage.from('scan-images').remove([imagePath]));
        await must(admin.auth.admin.deleteUser(ownerId));
      }
    }
  }
});
