import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

type Credentials = { id: string; email: string; password: string };
type Fixture = { accounts: { owner: Credentials } };

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const fixturePath = 'tmp/demo-accounts.json';
const configured =
  existsSync(fixturePath) &&
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.GEMINI_API_KEY &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );

async function signIn(page: Page, credentials: Credentials) {
  try {
    await page.goto('/account?next=%2Fshare');
    await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/share$/);
  } catch {
    throw new Error('Standard account sign-in failed. Credentials are omitted.');
  }
}

async function capture(page: Page, info: TestInfo, name: string) {
  // Never capture a credentials screen, including an unexpected auth redirect.
  if (new URL(page.url()).pathname !== '/share') return;
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  mkdirSync('output/qa', { recursive: true });
  copyFileSync(path, resolve('output/qa', `${name}.png`));
  await info.attach(name, { path, contentType: 'image/png' });
}

async function photoDimensions(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  return image.evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
  }));
}

let cleanupAfterTest: (() => Promise<void>) | undefined;

test.afterEach(async () => {
  const cleanup = cleanupAfterTest;
  cleanupAfterTest = undefined;
  await cleanup?.();
});

test('real photo review saves selected item crops and editable pickup area defaults', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !configured,
    'Requires ignored demo accounts and the configured Gemini/Supabase project.',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  context.setDefaultTimeout(20_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const unique = randomUUID().slice(0, 8);
  const correctedTitle = `Sample reviewed tool ${unique}`;
  const manualTitle = `Sample manual item ${unique}`;
  let scanId = '';
  let signedIn = false;
  page.on('response', async (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/scans' &&
      response.ok()
    ) {
      const result = await response.json().catch(() => null);
      if (typeof result?.scanId === 'string') scanId = result.scanId;
    }
  });

  cleanupAfterTest = async () => {
    await context.close();
    if (scanId) {
      const { data: scan, error: scanError } = await admin
        .from('scans')
        .select('id,original_path,normalized_path')
        .eq('id', scanId)
        .eq('owner_id', fixture.accounts.owner.id)
        .single();
      if (scanError || !scan)
        throw new Error('Cleanup refused: isolated scan owner could not be verified.');
      const { data: drafts, error: draftError } = await admin
        .from('resources')
        .select('id,status')
        .eq('scan_id', scanId)
        .eq('owner_id', fixture.accounts.owner.id);
      const { data: assets, error: assetError } = await admin
        .from('image_assets')
        .select('storage_path')
        .eq('scan_id', scanId)
        .eq('owner_id', fixture.accounts.owner.id);
      if (draftError || assetError || drafts?.some((draft) => draft.status !== 'draft'))
        throw new Error('Cleanup refused: isolated private records could not be verified.');
      const prefix = `${fixture.accounts.owner.id}/${scanId}/`;
      const listingPaths = (assets || []).map((asset) => asset.storage_path);
      const scanPaths = [scan.original_path, scan.normalized_path].filter((path): path is string =>
        Boolean(path),
      );
      if ([...listingPaths, ...scanPaths].some((path) => !path.startsWith(prefix)))
        throw new Error('Cleanup refused an image outside the isolated scan prefix.');
      const { error: deleteDraftsError } = await admin
        .from('resources')
        .delete()
        .eq('scan_id', scanId)
        .eq('owner_id', fixture.accounts.owner.id)
        .eq('status', 'draft');
      if (deleteDraftsError) throw new Error('Isolated draft cleanup failed.');
      for (const [bucket, paths] of [
        ['listing-images', listingPaths],
        ['scan-images', scanPaths],
      ] as const) {
        if (paths.length) {
          const { error: storageError } = await admin.storage.from(bucket).remove(paths);
          if (storageError) throw new Error('Isolated image object cleanup failed.');
        }
      }
      const { error: deleteAssetsError } = await admin
        .from('image_assets')
        .delete()
        .eq('scan_id', scanId)
        .eq('owner_id', fixture.accounts.owner.id);
      const { error: deleteScanError } = await admin
        .from('scans')
        .delete()
        .eq('id', scanId)
        .eq('owner_id', fixture.accounts.owner.id);
      if (deleteAssetsError || deleteScanError) throw new Error('Isolated scan cleanup failed.');
    }
  };

  try {
    await signIn(page, fixture.accounts.owner);
    signedIn = true;
    await page
      .getByLabel('Choose a resource photo', { exact: true })
      .setInputFiles('public/images/samples/tools.webp');
    await expect(page.getByRole('button', { name: 'Identify items', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: /Send this photo to Google Gemini/ }).check();
    await page.getByRole('button', { name: 'Identify items', exact: true }).click();
    const candidates = page.locator('.candidate');
    await expect(candidates.first()).toBeVisible({ timeout: 50_000 });
    const originalCount = await candidates.count();
    // The reviewed fixture contains four tools. This test needs three suggestions
    // to exercise correction, deselection and removal independently.
    expect(originalCount).toBeGreaterThanOrEqual(3);
    expect(originalCount).toBeLessThanOrEqual(12);
    expect(scanId).toMatch(/^[0-9a-f-]{36}$/);

    // A detected tool gets its own close-up, while the complete image remains available.
    const detectedCloseUp = page.getByRole('img', { name: /^Item 1: / });
    await expect(detectedCloseUp).toBeVisible();
    await expect(detectedCloseUp).toHaveJSProperty('tagName', 'svg');
    const reviewCrop = (await detectedCloseUp.getAttribute('viewBox'))!.split(' ').map(Number);
    const originalSize = {
      width: Number(await detectedCloseUp.locator('image').getAttribute('width')),
      height: Number(await detectedCloseUp.locator('image').getAttribute('height')),
    };
    expect(reviewCrop).toHaveLength(4);
    expect(reviewCrop[2] * reviewCrop[3]).toBeLessThan(originalSize.width * originalSize.height);
    await page.getByText('See full photo and all items', { exact: true }).click();
    await expect(
      page.getByRole('img', { name: 'Your materials with numbered review boxes', exact: true }),
    ).toBeVisible();
    await page.getByText('See full photo and all items', { exact: true }).click();

    await candidates.first().getByRole('textbox').fill(correctedTitle);
    await candidates.first().getByRole('combobox').selectOption('craft');
    for (let index = 1; index < originalCount; index++)
      await candidates.nth(index).getByRole('checkbox').uncheck();
    const deselectedTitle = await candidates.nth(1).getByRole('textbox').inputValue();
    const removedTitle = await candidates.last().getByRole('textbox').inputValue();
    await candidates
      .last()
      .getByRole('button', { name: /^Remove / })
      .click();
    await expect(candidates).toHaveCount(originalCount - 1);
    await page.getByRole('button', { name: 'Add an item myself', exact: true }).click();
    await candidates.last().getByRole('textbox').fill(manualTitle);
    await candidates.last().getByRole('combobox').selectOption('containers');
    await expect(candidates.last().getByRole('checkbox')).toBeChecked();
    await candidates.last().getByRole('textbox').focus();
    const manualPreview = page.getByRole('img', {
      name: `Item ${originalCount}: ${manualTitle}`,
      exact: true,
    });
    await expect(manualPreview).toHaveJSProperty('tagName', 'IMG');
    expect(await photoDimensions(manualPreview)).toEqual(originalSize);
    await expect(page.getByRole('status')).toContainText('Item review saved privately');
    await expect(
      page.getByRole('button', { name: 'Continue with 2 items', exact: true }),
    ).toBeEnabled();

    await page.reload();
    await expect(candidates).toHaveCount(originalCount);
    await expect(candidates.first().getByRole('textbox')).toHaveValue(correctedTitle);
    await expect(candidates.first().getByRole('combobox')).toHaveValue('craft');
    await expect(candidates.first().getByRole('checkbox')).toBeChecked();
    await expect(candidates.nth(1).getByRole('textbox')).toHaveValue(deselectedTitle);
    await expect(candidates.nth(1).getByRole('checkbox')).not.toBeChecked();
    await expect(candidates.last().getByRole('textbox')).toHaveValue(manualTitle);
    await expect(candidates.last().getByRole('combobox')).toHaveValue('containers');
    await expect(candidates.last().getByRole('checkbox')).toBeChecked();
    const restoredLabels = await candidates
      .getByRole('textbox')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(restoredLabels).not.toContain(removedTitle);
    await expect(
      page.getByRole('button', { name: 'Continue with 2 items', exact: true }),
    ).toBeEnabled();
    await capture(page, info, 'scan-review-restored');

    await page.getByRole('button', { name: 'Continue with 2 items', exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(correctedTitle);
    await expect(page.getByLabel('Category', { exact: true })).toHaveValue('craft');
    const createdIds = new URL(page.url()).searchParams.get('draft')?.split(',') || [];
    expect(createdIds).toHaveLength(2);
    const { data: drafts, error } = await admin
      .from('resources')
      .select('id,title,category,status,candidate_id,image_path')
      .eq('scan_id', scanId)
      .eq('owner_id', fixture.accounts.owner.id);
    expect(error).toBeNull();
    expect(drafts).toHaveLength(2);
    expect(drafts?.map((draft) => draft.id).sort()).toEqual(createdIds.sort());
    expect(drafts?.map(({ title, category, status }) => ({ title, category, status }))).toEqual(
      expect.arrayContaining([
        { title: correctedTitle, category: 'craft', status: 'draft' },
        { title: manualTitle, category: 'containers', status: 'draft' },
      ]),
    );
    expect(drafts?.find((draft) => draft.title === manualTitle)?.candidate_id).toMatch(/^manual:/);

    const { data: assets, error: assetError } = await admin
      .from('image_assets')
      .select('storage_path,width,height')
      .eq('scan_id', scanId)
      .eq('owner_id', fixture.accounts.owner.id)
      .eq('kind', 'listing');
    expect(assetError).toBeNull();
    const detectedDraft = drafts!.find((draft) => draft.title === correctedTitle)!;
    const manualDraft = drafts!.find((draft) => draft.title === manualTitle)!;
    const detectedAsset = assets!.find((asset) => asset.storage_path === detectedDraft.image_path)!;
    const manualAsset = assets!.find((asset) => asset.storage_path === manualDraft.image_path)!;
    const croppedSize = { width: detectedAsset.width, height: detectedAsset.height };
    expect(croppedSize).toEqual({ width: reviewCrop[2], height: reviewCrop[3] });
    expect({ width: manualAsset.width, height: manualAsset.height }).toEqual(originalSize);
    expect(detectedDraft.image_path).not.toEqual(manualDraft.image_path);
    expect(await photoDimensions(page.locator('.editor-preview .card-image img'))).toEqual(
      croppedSize,
    );
    const croppedPreview = page.locator('.editor-preview .card-image img');
    await expect(croppedPreview).toHaveCSS('object-fit', 'contain');
    await croppedPreview.hover();
    await expect(croppedPreview).toHaveCSS('transform', 'none');

    const area = page.getByLabel('Public pickup area', { exact: true });
    const areaOptions = await area
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
      );
    expect(areaOptions.length).toBeGreaterThanOrEqual(3);
    await area.selectOption(areaOptions[0]);
    await page
      .getByLabel('What’s included?', { exact: true })
      .fill('A reviewed sample tool for an automated demo check.');
    const itemTabs = page.getByLabel('Selected item drafts', { exact: true });
    await itemTabs.getByRole('button', { name: `2. ${manualTitle}`, exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(manualTitle);
    await expect(area).toHaveValue(areaOptions[0]);
    expect(await photoDimensions(page.locator('.editor-preview .card-image img'))).toEqual(
      originalSize,
    );
    await area.selectOption(areaOptions[1]);
    await page
      .getByLabel('What’s included?', { exact: true })
      .fill('An added sample item for an automated demo check.');
    await itemTabs.getByRole('button', { name: `1. ${correctedTitle}`, exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(correctedTitle);
    await expect(area).toHaveValue(areaOptions[0]);
    await area.selectOption(areaOptions[2]);
    await itemTabs.getByRole('button', { name: `2. ${manualTitle}`, exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(manualTitle);
    await expect(area).toHaveValue(areaOptions[1]);

    await page.reload();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(correctedTitle);
    await expect(area).toHaveValue(areaOptions[2]);
    await itemTabs.getByRole('button', { name: `2. ${manualTitle}`, exact: true }).click();
    await expect(page.getByLabel('Resource title', { exact: true })).toHaveValue(manualTitle);
    await expect(area).toHaveValue(areaOptions[1]);
    await page.getByRole('button', { name: 'Review before publishing', exact: true }).click();
    await expect(page.locator('.publication-card')).toHaveCount(2);
    expect(
      await photoDimensions(page.locator('.publication-card').nth(0).locator('.card-image img')),
    ).toEqual(croppedSize);
    await expect(page.locator('.publication-card').nth(0).locator('.card-image img')).toHaveCSS(
      'object-fit',
      'contain',
    );
    expect(
      await photoDimensions(page.locator('.publication-card').nth(1).locator('.card-image img')),
    ).toEqual(originalSize);
    await capture(page, info, 'scan-review-selected-private-drafts');
    expect(runtimeErrors).toEqual([]);
    mkdirSync('output/qa', { recursive: true });
    writeFileSync(
      'output/qa/scan-review-ui.json',
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          appUrl: baseURL,
          originalCandidateCount: originalCount,
          createdDraftCount: 2,
          checks: [
            'explicit Google consent before real image identification',
            'owner name and category corrections saved',
            'deselected and removed suggestions stay excluded after reload',
            'manual addition survives reload',
            'only two selected items create private drafts with corrected fields',
            'detected item close-up and saved derivative match the selected box',
            'manual item without bounds retains the full image',
            'first pickup area fills the other item automatically',
            'individual pickup area override survives first-item changes and reload',
            'publication preview uses the separate cropped and full-photo derivatives',
            'no browser runtime errors',
          ],
          cleanup:
            'Only this scan, its private drafts and image derivatives are removed. Nothing is published.',
          limitation:
            'Single licensed photo UI regression; not a held-out detection accuracy evaluation.',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (signedIn) await capture(page, info, 'scan-review-failure');
    throw error;
  }
});
