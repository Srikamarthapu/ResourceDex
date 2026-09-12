/** Real Auth, Storage and PostgREST checks. Local by default; --hosted
 * explicitly selects only the configured ResourceDex project. Test-owned records
 * and ephemeral accounts are cleaned up, and no credentials are printed. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const hosted = process.argv.includes('--hosted');
const config = hosted ? {
  API_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
} : JSON.parse(readFileSync(process.argv[2] ?? '/tmp/resourcedex-local-status.json', 'utf8'));
if (hosted) assert.equal(config.API_URL, 'https://wdenmhvhnzrkhhvnnuyo.supabase.co');
else assert.match(config.API_URL, /^http:\/\/(127\.0\.0\.1|localhost):56321$/);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const visitor = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
const suffix = randomUUID();
const clients = [];
const userIds = [];
const createdResources = [];
const imagePaths = [];
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const must = async (promise) => { const result = await promise; assert.equal(result.error, null, result.error?.message); return result.data; };
const row = (value) => Array.isArray(value) ? value[0] : value;
try {
  for (const role of ['owner', 'requester', 'unrelated']) {
    const email = `resourcedex-${role}-${suffix}@example.test`;
    const password = `A-${randomUUID()}-z9!`;
    const user = await must(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Test ${role}` } }));
    userIds.push(user.user.id);
    const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email, password }));
    clients.push(client);
  }
  const [owner, requester, unrelated] = clients;
  const operationKey = randomUUID();
  const scan = await must(admin.from('scans').insert({ owner_id: userIds[0], status: 'analyzing', upload_operation_key: randomUUID(), analysis_operation_key: operationKey, analysis_deadline_at: new Date(Date.now() + 30_000).toISOString() }).select().single());
  const analysisArgs = { p_owner: userIds[0], p_scan: scan.id, p_operation_key: operationKey, p_cost: 0.05, p_daily_ceiling: 5 };
  ok(Boolean((await owner.rpc('reserve_analysis', analysisArgs)).error), 'browser cannot reserve privileged AI budget');
  const attempt = await must(admin.rpc('reserve_analysis', analysisArgs));
  ok((await must(admin.rpc('reserve_analysis', analysisArgs))) === attempt, 'AI reservation retry idempotent');
  await must(admin.rpc('complete_analysis', { p_owner: userIds[0], p_scan: scan.id, p_operation_key: operationKey, p_attempt: attempt, p_result: { candidates: [], limitReached: false }, p_model: 'test', p_prompt: 'test', p_schema: 'test', p_tokens: {} }));
  const completedScan = await must(owner.from('scans').select('*').eq('id', scan.id).single());
  ok(completedScan.status === 'completed' && completedScan.analysis_version === 1, 'atomic AI completion increments version');
  ok(Boolean((await owner.from('analysis_attempts').select('*')).error), 'raw AI attempts inaccessible to browser');
  ok((await must(unrelated.from('scans').select('*').eq('id', scan.id))).length === 0, 'private analysis inaccessible to unrelated user');
  const reviewArgs = { p_owner: userIds[0], p_scan: scan.id, p_analysis_version: 1, p_expected_revision: 0, p_candidates: [] };
  ok(Boolean((await owner.rpc('save_scan_review', reviewArgs)).error), 'browser cannot write review through privileged RPC');
  ok((await must(admin.rpc('save_scan_review', reviewArgs))) === 1, 'first private review is persisted at revision one');
  const staleReview = await admin.rpc('save_scan_review', reviewArgs);
  ok(Boolean(staleReview.error?.message.includes('conflict')), `stale private review cannot overwrite a saved review: ${staleReview.error?.code ?? 'no error'} ${staleReview.error?.message ?? ''}`);
  ok((await must(admin.rpc('save_scan_review', { ...reviewArgs, p_expected_revision: 1 }))) === 2, 'current private review increments revision');
  ok((await must(owner.from('scan_reviews').select('*').eq('scan_id', scan.id))).length === 1, 'owner can reload persisted review');
  ok((await must(unrelated.from('scan_reviews').select('*').eq('scan_id', scan.id))).length === 0, 'unrelated account cannot read private review');
  ok(Boolean((await admin.rpc('save_scan_review', { ...reviewArgs, p_owner: userIds[2], p_expected_revision: 2 })).error), 'review command rejects a mismatched scan owner');
  await must(admin.from('scans').update({ analysis_version: 2 }).eq('id', scan.id));
  ok(Boolean((await admin.rpc('save_scan_review', { ...reviewArgs, p_expected_revision: 2 })).error?.message.includes('conflict')), 'new analysis invalidates writes to the older review');
  ok((await must(owner.from('scan_reviews').select('*').eq('scan_id', scan.id))).length === 1, 'older private review snapshot survives reanalysis');

  const imagePath = `${userIds[0]}/${randomUUID()}/listing.jpg`;
  imagePaths.push(imagePath);
  // A tiny real PNG is sufficient to exercise Storage policy and readiness, not image normalization.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64');
  await must(admin.storage.from('listing-images').upload(imagePath, png, { contentType: 'image/png' }));
  await must(admin.from('image_assets').insert({ owner_id: userIds[0], storage_path: imagePath, kind: 'listing', mime_type: 'image/png', width: 1, height: 1 }));
  const input = { title: 'Test wood offcuts', category: 'wood', description: 'A clearly marked test lot of wood offcuts.', quantity: 3, unit: 'pieces', lot_label: null, condition: 'used', working_status: 'not_applicable', material: '   ', dimensions: '', area_id: 'campus', image_path: imagePath, image_alt: 'A test material photo' };
  let draft = row(await must(owner.rpc('save_resource', { input })));
  createdResources.push(draft.id);
  await must(admin.from('resources').update({ is_sample: true }).eq('id', draft.id));
  ok(draft.status === 'draft', 'save returns private draft');
  ok(draft.material === 'Unknown', 'blank material is stored as an explicit unknown');
  ok((await must(visitor.from('resources').select('*').eq('id', draft.id))).length === 0, 'visitor cannot read private draft');
  ok((await must(unrelated.from('resources').select('*').eq('id', draft.id))).length === 0, 'unrelated cannot read private draft');
  ok(Boolean((await owner.from('resources').update({ status: 'available' }).eq('id', draft.id)).error), 'direct state write denied');
  ok(Boolean((await unrelated.rpc('save_resource', { input: { ...input, title: 'Stolen photo' } })).error), 'foreign image attachment denied');
  const previewRevision = draft.revision;
  draft = row(await must(owner.rpc('save_resource', { input: { ...input, title: 'Wood offcuts updated in another tab' }, resource_id: draft.id, expected_revision: draft.revision })));
  ok(Boolean((await owner.rpc('publish_resources', { resource_ids: [draft.id], operation_key: randomUUID(), expected_revisions: { [draft.id]: previewRevision } })).error), 'publication rejects a preview made stale by another saved edit');
  const publicationKey = randomUUID();
  const published = await must(owner.rpc('publish_resources', { resource_ids: [draft.id], operation_key: publicationKey, expected_revisions: { [draft.id]: draft.revision } }));
  const retry = await must(owner.rpc('publish_resources', { resource_ids: [draft.id], operation_key: publicationKey, expected_revisions: { [draft.id]: draft.revision } }));
  ok(JSON.stringify(published) === JSON.stringify(retry), 'publication retry idempotent');
  ok((await must(visitor.from('resources').select('*').eq('id', draft.id))).length === 1, 'visitor sees publication');
  ok((await must(requester.from('resources').select('*').eq('id', draft.id))).length === 1, 'second account sees publication');
  ok((await must(visitor.from('resources').select('id').textSearch('search_document', 'wood', { type: 'websearch', config: 'english' }).eq('id', draft.id))).length === 1, 'indexed keyword search finds published material');
  ok(Boolean((await owner.rpc('create_request', { resource_id: draft.id, note: '', proposed_window: '', operation_key: randomUUID() })).error), 'self request denied');
  const requestArgs = { resource_id: draft.id, note: 'I can collect', proposed_window: 'Tomorrow', operation_key: randomUUID() };
  const request = row(await must(requester.rpc('create_request', requestArgs)));
  ok(row(await must(requester.rpc('create_request', requestArgs))).id === request.id, 'request retry idempotent');
  ok(Boolean((await requester.rpc('create_request', { ...requestArgs, operation_key: randomUUID() })).error), 'duplicate active request denied');
  const otherRequest = row(await must(unrelated.rpc('create_request', { ...requestArgs, operation_key: randomUUID() })));
  const accepted = await Promise.all([
    owner.rpc('transition_request', { request_id: request.id, action: 'accept' }),
    owner.rpc('transition_request', { request_id: otherRequest.id, action: 'accept' }),
  ]);
  ok(accepted.filter(r => !r.error).length === 1, 'concurrent acceptance produces exactly one success');
  const winningRequest = row(accepted.find(r => !r.error).data);
  const winningClient = winningRequest.requester_id === userIds[1] ? requester : unrelated;
  const losingClient = winningClient === requester ? unrelated : requester;
  const pickupInput = { meeting_place: 'Private test meeting point', starts_at: '2026-09-14T18:00:00Z', ends_at: '2026-09-14T19:00:00Z', timezone: 'America/Los_Angeles', instructions: 'Test instructions' };
  const pickup = row(await must(owner.rpc('save_pickup', { request_id: winningRequest.id, input: pickupInput, expected_revision: 0 })));
  ok((await must(losingClient.from('pickup_arrangements').select('*').eq('request_id', winningRequest.id))).length === 0, 'unrelated pickup read denied');
  await must(winningClient.rpc('respond_pickup', { request_id: winningRequest.id, expected_revision: pickup.revision, action: 'agree' }));
  const revised = row(await must(owner.rpc('save_pickup', { request_id: winningRequest.id, input: { ...pickupInput, instructions: 'Revised instructions' }, expected_revision: pickup.revision })));
  ok(revised.revision === pickup.revision + 1 && revised.agreed_revision === null, 'owner pickup revision clears agreement');
  ok(Boolean((await owner.rpc('save_pickup', { request_id: winningRequest.id, input: pickupInput, expected_revision: pickup.revision })).error), 'stale owner pickup update denied');
  ok(Boolean((await winningClient.rpc('respond_pickup', { request_id: winningRequest.id, expected_revision: pickup.revision, action: 'agree' })).error), 'stale pickup agreement denied');
  await must(winningClient.rpc('transition_request', { request_id: winningRequest.id, action: 'cancel' }));
  ok((await must(winningClient.from('pickup_arrangements').select('*').eq('request_id', winningRequest.id))).length === 0, 'canceled requester loses pickup access');
  const afterCancel = row(await must(visitor.from('resources').select('*').eq('id', draft.id)));
  ok(afterCancel.status === 'available', 'cancel releases reservation');
  const pending = row(await must(requester.rpc('create_request', { ...requestArgs, operation_key: randomUUID() })));
  const edited = row(await must(owner.rpc('save_resource', { input: { ...input, title: 'Updated wood offcuts' }, resource_id: draft.id, expected_revision: afterCancel.revision })));
  ok(edited.revision === afterCancel.revision + 1 && edited.owner_confirmed_at !== null, 'reviewed public edit increments revision and records confirmation');
  ok(row(await must(requester.from('requests').select('*').eq('id', pending.id))).status === 'canceled', 'edit cancels pending requests');
  const finalRequest = row(await must(requester.rpc('create_request', { ...requestArgs, operation_key: randomUUID() })));
  await must(owner.rpc('transition_request', { request_id: finalRequest.id, action: 'accept' }));
  await must(owner.rpc('save_pickup', { request_id: finalRequest.id, input: pickupInput, expected_revision: 0 }));
  await must(owner.rpc('transition_request', { request_id: finalRequest.id, action: 'complete' }));
  ok((await must(visitor.from('resources').select('*').eq('id', draft.id))).length === 0, 'completed hidden from visitor');
  ok((await must(unrelated.from('resources').select('*').eq('id', draft.id))).length === 0, 'completed hidden from unrelated account');
  ok((await must(requester.from('resources').select('*').eq('id', draft.id))).length === 1, 'completed visible to fulfilled requester');
  ok(!(await requester.storage.from('listing-images').createSignedUrl(imagePath, 300)).error, 'fulfilled requester can sign approved image');
  ok(Boolean((await visitor.storage.from('listing-images').createSignedUrl(imagePath, 300)).error), 'visitor cannot sign completed image');
  console.log(`PASS: ${checks} real ${hosted ? 'hosted' : 'local'} Auth/Storage/RLS/workflow checks`);
} finally {
  // Test-owned IDs only. Never truncate a shared table or delete real users.
  for (const id of createdResources) {
    await admin.from('requests').delete().eq('resource_id', id);
    await admin.from('resources').delete().eq('id', id);
  }
  if (imagePaths.length) await admin.storage.from('listing-images').remove(imagePaths);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}
