import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Credentials = { id: string; email: string; password: string };
type DemoFixture = {
  accounts: { owner: Credentials; requester: Credentials };
  resources: { containers: string };
};

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const fixturePath = 'tmp/demo-accounts.json';
const environmentReady =
  existsSync(fixturePath) &&
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );

let fixture: DemoFixture;
let admin: SupabaseClient;
let resourceId = '';
let resourceTitle = '';

/** Guarded operator setup clones only the known sample; all handoff actions use UI auth. */
test.beforeAll(async () => {
  if (!environmentReady) return;
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as DemoFixture;
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: source, error: sourceError } = await admin
    .from('resources')
    .select('*')
    .eq('id', fixture.resources.containers)
    .eq('owner_id', fixture.accounts.owner.id)
    .eq('is_sample', true)
    .single();
  if (sourceError || !source?.image_path)
    throw new Error('The known container sample with its approved image is required.');

  const id = randomUUID();
  resourceTitle = `${source.title} · UI test ${id.slice(0, 6)}`;
  const now = new Date().toISOString();
  const { error } = await admin.from('resources').insert({
    id,
    title: resourceTitle,
    owner_id: source.owner_id,
    category: source.category,
    quantity: source.quantity,
    unit: source.unit,
    lot_label: source.lot_label,
    condition: source.condition,
    working_status: source.working_status,
    material: source.material,
    dimensions: source.dimensions,
    area_id: source.area_id,
    image_path: source.image_path,
    image_alt: source.image_alt,
    description:
      'Sample resource for automated interface testing. No real inventory or physical pickup is offered.',
    is_sample: true,
    status: 'available',
    moderation_state: 'visible',
    revision: 1,
    scan_id: null,
    candidate_id: null,
    completed_at: null,
    owner_confirmed_at: now,
    published_at: now,
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`Sample fixture setup failed (${error.code}).`);
  resourceId = id;
});

test.afterAll(async () => {
  if (!resourceId || !admin) return;
  // Collection is terminal in the app. Remove only this isolated sample fixture;
  // the original listing and its shared image must remain untouched.
  const { data: ownedSample, error: readError } = await admin
    .from('resources')
    .select('id')
    .eq('id', resourceId)
    .eq('owner_id', fixture.accounts.owner.id)
    .eq('is_sample', true)
    .single();
  if (readError || !ownedSample)
    throw new Error('Cleanup refused: the isolated sample identity could not be verified.');
  const { error: requestsError } = await admin
    .from('requests')
    .delete()
    .eq('resource_id', resourceId);
  if (requestsError) throw new Error(`Test request cleanup failed (${requestsError.code}).`);
  const { error: resourceError } = await admin
    .from('resources')
    .delete()
    .eq('id', resourceId)
    .eq('owner_id', fixture.accounts.owner.id)
    .eq('is_sample', true);
  if (resourceError) throw new Error(`Test sample cleanup failed (${resourceError.code}).`);
});

async function signIn(page: Page, credentials: Credentials, next: string) {
  // Convert authentication errors to fixed text so reports cannot print fill values.
  try {
    await page.goto(`/account?next=${encodeURIComponent(next)}`);
    await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  } catch {
    throw new Error(
      'The standard sign-in flow did not reach its intended destination. Credentials are omitted.',
    );
  }
}

function requestCard(page: Page) {
  return page.locator('article.request-card').filter({
    has: page.getByRole('heading', { name: resourceTitle, exact: true }),
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage });
  mkdirSync('output/qa', { recursive: true });
  copyFileSync(path, resolve('output/qa', `${name}.png`));
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('two accounts request, arrange, agree and record a simulated sample collection', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    !environmentReady,
    'Requires the ignored demo fixture and configured test Supabase project.',
  );
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const requesterContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const visitorContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const owner = await ownerContext.newPage();
  const requester = await requesterContext.newPage();
  const visitor = await visitorContext.newPage();
  const runtimeErrors: string[] = [];
  let signedIn = false;
  for (const context of [ownerContext, requesterContext, visitorContext])
    context.setDefaultTimeout(20_000);
  for (const page of [owner, requester, visitor])
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

  try {
    await signIn(owner, fixture.accounts.owner, '/requests');
    await signIn(requester, fixture.accounts.requester, `/resources/${resourceId}`);
    signedIn = true;
    await expect(
      requester.getByRole('heading', { name: resourceTitle, exact: true }),
    ).toBeVisible();
    await expect(
      requester.getByText('No real item is offered for collection.', { exact: false }),
    ).toBeVisible();
    await requester.getByRole('button', { name: 'Request pickup', exact: true }).click();
    await requester
      .getByLabel('A note for the owner', { exact: false })
      .fill('Automated sample request. No real pickup is planned.');
    await requester
      .getByLabel('When could you pick it up?', { exact: true })
      .fill('Tomorrow during the test window.');
    await requester.getByRole('button', { name: 'Send pickup request', exact: true }).click();
    await expect(requester.getByText('Request sent.', { exact: false })).toBeVisible();

    await requester.goto('/requests');
    await requester.getByRole('button', { name: /^Outgoing/ }).click();
    await expect(requestCard(requester).locator('.request-state')).toHaveText('Pending');
    await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(requestCard(owner).locator('.request-state')).toHaveText('Pending');
    await requestCard(owner).getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(requestCard(owner).locator('.request-state')).toHaveText('Accepted');

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const meetingPlace = 'Demo meeting point — no actual pickup';
    await requestCard(owner).getByLabel('Meeting place', { exact: true }).fill(meetingPlace);
    await requestCard(owner).getByLabel('Window starts', { exact: true }).fill(`${tomorrow}T10:00`);
    await requestCard(owner).getByLabel('Window ends', { exact: true }).fill(`${tomorrow}T11:00`);
    await requestCard(owner).getByLabel('Pickup timezone', { exact: true }).fill('UTC');
    await requestCard(owner)
      .getByLabel('Pickup instructions', { exact: false })
      .fill('Simulation only. No physical collection is planned.');
    await requestCard(owner)
      .getByRole('button', { name: 'Save pickup proposal', exact: true })
      .click();
    await expect(
      requestCard(owner).getByText('Waiting for requester agreement', { exact: true }),
    ).toBeVisible();
    await capture(owner, testInfo, 'owner-proposed-pickup');

    await requester.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(requestCard(requester).getByText(meetingPlace, { exact: true })).toBeVisible();
    await visitor.goto(`/resources/${resourceId}`);
    await expect(visitor.getByRole('heading', { name: resourceTitle, exact: true })).toBeVisible();
    await expect(visitor.getByText(meetingPlace, { exact: true })).toHaveCount(0);
    await visitor.goto('/requests');
    await expect(
      visitor.getByRole('link', { name: 'Sign in to see requests', exact: true }),
    ).toBeVisible();
    await expect(visitor.getByText(meetingPlace, { exact: true })).toHaveCount(0);

    await requester.getByRole('button', { name: /^Outgoing/ }).click();
    await requestCard(requester)
      .getByRole('button', { name: 'Request a change', exact: true })
      .click();
    await requestCard(requester)
      .getByLabel('What needs to change?', { exact: true })
      .fill('Please move this test window one hour later.');
    await requestCard(requester)
      .getByRole('button', { name: 'Send change request', exact: true })
      .click();
    await expect(
      requestCard(requester).getByText('A change was requested', { exact: true }),
    ).toBeVisible();
    await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      requestCard(owner).getByText('Please move this test window one hour later.', { exact: true }),
    ).toBeVisible();
    await requestCard(owner)
      .getByRole('button', { name: 'Edit pickup details', exact: true })
      .click();
    await requestCard(owner).getByLabel('Window starts', { exact: true }).fill(`${tomorrow}T11:00`);
    await requestCard(owner).getByLabel('Window ends', { exact: true }).fill(`${tomorrow}T12:00`);
    await requestCard(owner)
      .getByRole('button', { name: 'Save pickup proposal', exact: true })
      .click();
    await expect(
      requestCard(owner).getByText('Waiting for requester agreement', { exact: true }),
    ).toBeVisible();
    await requester.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      requestCard(requester).getByText('Waiting for requester agreement', { exact: true }),
    ).toBeVisible();
    await requestCard(requester)
      .getByRole('button', { name: 'Agree to pickup', exact: true })
      .click();
    await expect(requestCard(requester).getByText('Pickup agreed', { exact: true })).toBeVisible();
    await capture(requester, testInfo, 'requester-agreed-pickup');

    let confirmation = '';
    owner.once('dialog', (dialog) => {
      confirmation = dialog.message();
      void dialog.accept();
    });
    await requestCard(owner)
      .getByRole('button', { name: 'Mark as collected', exact: true })
      .click();
    expect(confirmation).toContain('simulated collection');
    expect(confirmation).toContain('No physical handoff');
    await expect(requestCard(owner).locator('.request-state')).toHaveText('Collected');
    await requester.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(requestCard(requester).locator('.request-state')).toHaveText('Collected');
    await expect(
      requestCard(requester).getByText('Collection recorded by the owner.', { exact: true }),
    ).toBeVisible();
    await expect(requestCard(requester).locator('img.request-thumbnail')).toBeVisible();

    const { data: resource, error: resourceError } = await admin
      .from('resources')
      .select('status')
      .eq('id', resourceId)
      .single();
    expect(resourceError).toBeNull();
    expect(resource?.status).toBe('completed');
    const { data: requests, error: requestError } = await admin
      .from('requests')
      .select('status')
      .eq('resource_id', resourceId);
    expect(requestError).toBeNull();
    expect(requests).toEqual([{ status: 'fulfilled' }]);
    await requester.setViewportSize({ width: 320, height: 860 });
    await expect(requestCard(requester).locator('.request-state')).toBeVisible();
    const overflow = await requester.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await capture(requester, testInfo, 'requests-320-collected');
    await capture(requester, testInfo, 'requests-320-viewport', false);
    await requester.reload();
    await requester.getByRole('button', { name: /^Outgoing/ }).click();
    await expect(requestCard(requester).locator('.request-state')).toHaveText('Collected');
    await capture(owner, testInfo, 'owner-collected-history');
    await visitor.goto(`/resources/${resourceId}`);
    try {
      await expect(
        visitor.getByRole('heading', { name: 'This resource is unavailable', exact: true }),
      ).toBeVisible();
    } catch (error) {
      await capture(visitor, testInfo, 'visitor-completed-state');
      await testInfo.attach('visitor-completed-text', {
        body: await visitor.locator('main').innerText(),
        contentType: 'text/plain',
      });
      throw error;
    }
    expect(runtimeErrors).toEqual([]);
  } catch (error) {
    if (signedIn) {
      for (const [page, name] of [
        [owner, 'owner'],
        [requester, 'requester'],
        [visitor, 'visitor'],
      ] as const) {
        await capture(page, testInfo, `requests-${name}-failure`);
        await testInfo.attach(`requests-${name}-text`, {
          body: await page.locator('main').innerText(),
          contentType: 'text/plain',
        });
      }
    }
    throw error;
  } finally {
    await ownerContext.close();
    await requesterContext.close();
    await visitorContext.close();
  }
});
