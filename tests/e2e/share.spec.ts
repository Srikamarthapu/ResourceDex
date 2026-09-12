import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

type Credentials = { id: string; email: string; password: string };
type Fixture = { accounts: { owner: Credentials; requester: Credentials } };

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const fixturePath = 'tmp/demo-accounts.json';
const configured =
  existsSync(fixturePath) &&
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );

let cleanupFixture: (() => Promise<void>) | null = null;

// A separate hook gets a teardown budget even when an interaction times out.
test.afterEach(async () => {
  try {
    await cleanupFixture?.();
  } finally {
    cleanupFixture = null;
  }
});

async function signIn(page: Page, credentials: Credentials, next: string) {
  try {
    await page.goto(`/account?next=${encodeURIComponent(next)}`);
    await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${next}$`));
  } catch {
    throw new Error('Standard account sign-in failed. Credentials are omitted.');
  }
}

async function capture(page: Page, info: TestInfo, name: string, fullPage = true) {
  const path = info.outputPath(`${name}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage });
  mkdirSync('output/qa', { recursive: true });
  copyFileSync(path, resolve('output/qa', `${name}.png`));
  await info.attach(name, { path, contentType: 'image/png' });
}

test('manual sharing and requests work without crypto.randomUUID', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !configured,
    'Requires the ignored demo accounts and configured test Supabase project.',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const otherContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const appUrl = new URL(baseURL!);
  const exactInsecureOrigin = appUrl.protocol === 'http:' && appUrl.hostname === '0.0.0.0';
  // Older browsers and HTTP LAN origins may expose secure random bytes but no UUID helper.
  // At the reported 0.0.0.0 origin, verify native behavior without changing crypto.
  // On localhost/HTTPS, simulate the missing method before every app script and reload.
  if (!exactInsecureOrigin) {
    for (const context of [ownerContext, otherContext]) {
      await context.addInitScript(() => {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          configurable: true,
          value: undefined,
        });
      });
    }
  }
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();
  ownerContext.setDefaultTimeout(20_000);
  otherContext.setDefaultTimeout(20_000);
  const runtimeErrors: string[] = [];
  for (const page of [owner, other])
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const unique = randomUUID().slice(0, 8);
  const title = `Sample glass jar UI test ${unique}`;
  const description =
    'Sample resource for automated interface testing. No real inventory or physical pickup is offered. Photo credit: Kier in Sight Archives / Unsplash.';
  let resourceId = '';
  let scanId = '';
  let signedIn = false;
  cleanupFixture = async () => {
    if (scanId) {
      const { data: scan, error: scanError } = await admin
        .from('scans')
        .select('id,original_path,normalized_path')
        .eq('id', scanId)
        .eq('owner_id', fixture.accounts.owner.id)
        .single();
      if (scanError || !scan)
        throw new Error('Cleanup refused: isolated scan owner could not be verified.');
      const { data: assets, error: assetError } = await admin
        .from('image_assets')
        .select('storage_path')
        .eq('scan_id', scanId)
        .eq('owner_id', fixture.accounts.owner.id);
      if (assetError) throw new Error('Isolated image cleanup could not read asset records.');
      const prefix = `${fixture.accounts.owner.id}/${scanId}/`;
      const listingPaths = (assets || []).map((asset) => asset.storage_path);
      const scanPaths = [scan.original_path, scan.normalized_path].filter((path): path is string =>
        Boolean(path),
      );
      if ([...listingPaths, ...scanPaths].some((path) => !path.startsWith(prefix)))
        throw new Error('Cleanup refused an image outside the isolated scan prefix.');
      if (resourceId) {
        const { data: listing, error: listingError } = await admin
          .from('resources')
          .select('id')
          .eq('id', resourceId)
          .eq('scan_id', scanId)
          .eq('owner_id', fixture.accounts.owner.id)
          .single();
        if (listingError || !listing)
          throw new Error('Cleanup refused: isolated listing owner could not be verified.');
        const { error: requestError } = await admin
          .from('requests')
          .delete()
          .eq('resource_id', listing.id);
        if (requestError) throw new Error('Isolated pickup request cleanup failed.');
        const { error } = await admin
          .from('resources')
          .delete()
          .eq('id', resourceId)
          .eq('scan_id', scanId)
          .eq('owner_id', fixture.accounts.owner.id);
        if (error) throw new Error('Isolated listing cleanup failed.');
      }
      for (const [bucket, paths] of [
        ['listing-images', listingPaths],
        ['scan-images', scanPaths],
      ] as const) {
        if (paths.length) {
          const { error } = await admin.storage.from(bucket).remove(paths);
          if (error) throw new Error('Isolated image object cleanup failed.');
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
      if (deleteAssetsError || deleteScanError)
        throw new Error('Isolated scan record cleanup failed.');
    }
  };
  // Track only this UI-created scan ID, never auth bodies or request headers.
  owner.on('response', async (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/scans' &&
      response.ok()
    ) {
      const result = await response.json().catch(() => null);
      if (typeof result?.scanId === 'string') scanId = result.scanId;
    }
  });
  try {
    await signIn(owner, fixture.accounts.owner, '/share');
    await signIn(other, fixture.accounts.requester, '/');
    signedIn = true;
    for (const page of [owner, other]) {
      const capabilities = await page.evaluate(() => ({
        secureContext: globalThis.isSecureContext,
        uuid: typeof globalThis.crypto.randomUUID,
        randomBytes: typeof globalThis.crypto.getRandomValues,
      }));
      expect(capabilities).toMatchObject({ uuid: 'undefined', randomBytes: 'function' });
      if (exactInsecureOrigin) expect(capabilities.secureContext).toBe(false);
    }
    await owner
      .getByLabel('Choose a resource photo', { exact: true })
      .setInputFiles('public/images/samples/containers.webp');
    await expect(owner.getByRole('button', { name: 'Identify items', exact: true })).toBeDisabled();
    await owner.getByRole('button', { name: 'Add details myself', exact: true }).click();
    await expect(owner.getByLabel('Resource title', { exact: true })).toBeVisible();
    resourceId = new URL(owner.url()).searchParams.get('draft') || '';
    expect(resourceId).toMatch(/^[0-9a-f-]{36}$/);

    const { data: draft, error: draftError } = await admin
      .from('resources')
      .select('id,scan_id,status')
      .eq('id', resourceId)
      .eq('owner_id', fixture.accounts.owner.id)
      .single();
    expect(draftError).toBeNull();
    expect(draft?.status).toBe('draft');
    scanId = draft!.scan_id;
    // Explicit operator fixture labeling is the only non-UI resource mutation.
    // Content, private saves, review and publication all run through the app.
    const { error: labelError } = await admin
      .from('resources')
      .update({ is_sample: true })
      .eq('id', resourceId)
      .eq('owner_id', fixture.accounts.owner.id)
      .eq('status', 'draft');
    expect(labelError).toBeNull();
    await owner.getByLabel('Resource title', { exact: true }).fill(title);
    await owner.getByLabel('Category', { exact: true }).selectOption('containers');
    await owner.getByLabel('What’s included?', { exact: true }).fill(description);
    await owner
      .getByLabel('Are you sharing pieces or one lot?', { exact: true })
      .selectOption('pieces');
    await owner.getByLabel('Quantity', { exact: true }).fill('1');
    await owner.getByLabel('Unit', { exact: true }).fill('jar');
    await owner.getByLabel('Condition, per owner', { exact: true }).selectOption('unknown');
    await owner.getByLabel('Material', { exact: false }).fill('Glass');
    await owner.getByLabel('Public pickup area', { exact: true }).selectOption({ index: 1 });
    await owner
      .getByLabel('Photo description', { exact: true })
      .fill('A glass jar with a lid on a textured surface.');
    await expect(owner.locator('.save-status')).toHaveText('Saved');
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('resources')
          .select('title,image_alt')
          .eq('id', resourceId)
          .single();
        return data;
      })
      .toEqual({ title, image_alt: 'A glass jar with a lid on a textured surface.' });

    await other.goto(`/resources/${resourceId}`);
    await expect(
      other.getByRole('heading', { name: 'This resource is unavailable', exact: true }),
    ).toBeVisible();
    await owner.reload();
    await expect(owner.getByLabel('Resource title', { exact: true })).toHaveValue(title);
    await expect(owner.getByLabel('What’s included?', { exact: true })).toHaveValue(description);
    await expect(owner.getByLabel('Photo description', { exact: true })).toHaveValue(
      'A glass jar with a lid on a textured surface.',
    );
    await capture(owner, info, 'share-restored-private-draft');
    await owner.setViewportSize({ width: 320, height: 860 });
    expect(
      await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await capture(owner, info, 'share-editor-320');
    await capture(owner, info, 'share-editor-320-viewport', false);
    await owner.setViewportSize({ width: 1280, height: 900 });
    await owner.getByRole('button', { name: 'Review before publishing', exact: true }).click();
    await expect(
      owner.getByRole('button', { name: 'Publish 1 resource', exact: true }),
    ).toBeDisabled();
    await capture(owner, info, 'share-publication-review');
    await owner.getByRole('checkbox', { name: /I reviewed every resource/ }).check();
    await owner.getByRole('button', { name: 'Publish 1 resource', exact: true }).click();
    await expect(owner.getByText('1 resource is published.', { exact: false })).toBeVisible();
    await other.goto('/');
    await other.locator('#resource-search').fill(unique);
    await other.getByRole('button', { name: 'Search resources', exact: true }).click();
    await expect(other.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await other.getByRole('heading', { name: title, exact: true }).click();
    await expect(other).toHaveURL(new RegExp(`/resources/${resourceId}$`));
    await expect(other.getByText(description, { exact: true })).toBeVisible();
    await expect(
      other.getByText('No real item is offered for collection.', { exact: false }),
    ).toBeVisible();
    await capture(other, info, 'share-second-account-discovery');
    await other.setViewportSize({ width: 320, height: 860 });
    expect(
      await other.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await capture(other, info, 'share-second-account-detail-320');
    await capture(other, info, 'share-second-account-detail-320-viewport', false);
    await other.setViewportSize({ width: 1280, height: 900 });
    await other.getByRole('button', { name: 'Request pickup', exact: true }).click();
    await other
      .getByLabel('A note for the owner', { exact: false })
      .fill('Automated browser compatibility check. No real pickup is planned.');
    await other
      .getByLabel('When could you pick it up?', { exact: true })
      .fill('A simulated test window only.');
    await other.getByRole('button', { name: 'Send pickup request', exact: true }).click();
    await expect(other.getByText('Request sent.', { exact: false })).toBeVisible();
    const { data: requests, error: requestError } = await admin
      .from('requests')
      .select('status,requester_id')
      .eq('resource_id', resourceId);
    expect(requestError).toBeNull();
    expect(requests).toEqual([{ status: 'pending', requester_id: fixture.accounts.requester.id }]);
    await owner.goto('/requests');
    const incoming = owner.locator('article.request-card').filter({
      has: owner.getByRole('heading', { name: title, exact: true }),
    });
    await expect(incoming.locator('.request-state')).toHaveText('Pending');
    await capture(owner, info, 'uuid-fallback-incoming-request');
    expect(runtimeErrors).toEqual([]);
  } catch (error) {
    if (signedIn) {
      await capture(owner, info, 'share-owner-failure');
      await capture(other, info, 'share-other-failure');
      await info.attach('share-owner-text', {
        body: await owner.locator('main').innerText(),
        contentType: 'text/plain',
      });
      await info.attach('share-other-text', {
        body: await other.locator('main').innerText(),
        contentType: 'text/plain',
      });
    }
    throw error;
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});
