/** Seed clearly marked examples in the explicitly selected ResourceDex project.
 * Run: node --env-file=.env.local scripts/seed-demo.mjs
 * Credentials are written to ignored tmp/demo-accounts.json, never stdout.
 * Reruns reuse only the IDs recorded in that file; no table is truncated.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const expectedUrl = 'https://wdenmhvhnzrkhhvnnuyo.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url !== expectedUrl || !publicKey || !secret)
  throw new Error('This seed requires the selected ResourceDex project and server key.');
const admin = createClient(url, secret, { auth: { persistSession: false } });
const credentialsPath = resolve('tmp/demo-accounts.json');
const must = async (promise) => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
};
const one = (data) => (Array.isArray(data) ? data[0] : data);
await mkdir(resolve('tmp'), { recursive: true });
let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = { project_url: url, accounts: {}, resources: {} };
}
if (credentials.project_url !== url)
  throw new Error('Existing demo credentials belong to a different project.');
const persist = () =>
  writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
for (const role of ['owner', 'requester']) {
  if (credentials.accounts[role]) continue;
  const email = `resourcedex-demo-${role}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `RDx-${randomUUID()}-A7!`;
  const { user } = await must(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: role === 'owner' ? 'ResourceDex sample owner' : 'ResourceDex demo requester',
      },
    }),
  );
  credentials.accounts[role] = { id: user.id, email, password };
  await persist();
}
const owner = createClient(url, publicKey, { auth: { persistSession: false } });
await must(owner.auth.signInWithPassword(credentials.accounts.owner));
const examples = [
  {
    category: 'wood',
    title: 'Rough-sawn boards',
    alt: 'Sample photo of rough-sawn wooden boards stacked with their cut edges visible.',
    width: 1000,
    height: 667,
    area: 'northside',
  },
  {
    category: 'tools',
    title: 'Hand tools for a workshop',
    alt: 'Sample black-and-white photo of a hammer, screwdriver and two pairs of pliers on a board.',
    width: 1000,
    height: 667,
    area: 'campus',
  },
  {
    category: 'hardware',
    title: 'Mixed bolts & threaded fittings',
    alt: 'Sample close-up photo of assorted bolts and threaded metal fittings.',
    width: 1000,
    height: 667,
    area: 'downtown',
  },
  {
    category: 'metal',
    title: 'Metal bar stock',
    alt: 'Sample photo of round and hexagonal metal bars stacked on workshop shelves.',
    width: 800,
    height: 1000,
    area: 'westside',
  },
  {
    category: 'containers',
    title: 'Glass jar with a screw lid',
    alt: 'Sample photo of a clear glass jar with a dark screw-on lid on a wooden surface.',
    width: 900,
    height: 900,
    area: 'eastside',
  },
  {
    category: 'craft',
    title: 'Mottled yarn for small projects',
    alt: 'Sample close-up photo of a ball of mottled grey and white yarn.',
    width: 1000,
    height: 1510,
    area: 'campus',
  },
];
for (const example of examples) {
  const ownerId = credentials.accounts.owner.id;
  const existingId = credentials.resources[example.category];
  if (existingId) {
    const existing = await must(
      admin.from('resources').select('id,owner_id,status,revision').eq('id', existingId).single(),
    );
    if (existing.owner_id !== ownerId) throw new Error('Recorded sample owner does not match.');
    await must(
      admin
        .from('resources')
        .update({ is_sample: true })
        .eq('id', existingId)
        .eq('owner_id', ownerId),
    );
    if (existing.status === 'draft') {
      await must(
        owner.rpc('publish_resources', {
          resource_ids: [existingId],
          operation_key: `sample-publish-${existingId}`,
          expected_revisions: { [existingId]: existing.revision },
        }),
      );
    }
    continue;
  }
  const imagePath = `${ownerId}/sample-catalog/${example.category}.webp`;
  const bytes = await readFile(resolve(`public/images/samples/${example.category}.webp`));
  const uploaded = await admin.storage
    .from('listing-images')
    .upload(imagePath, bytes, { contentType: 'image/webp', upsert: false });
  if (uploaded.error && !/already exists|Duplicate/i.test(uploaded.error.message))
    throw new Error(uploaded.error.message);
  await must(
    admin
      .from('image_assets')
      .upsert(
        {
          owner_id: ownerId,
          storage_path: imagePath,
          kind: 'listing',
          status: 'ready',
          mime_type: 'image/webp',
          width: example.width,
          height: example.height,
          content_hash: createHash('sha256').update(bytes).digest('hex'),
        },
        { onConflict: 'storage_path' },
      ),
  );
  const resource = one(
    await must(
      owner.rpc('save_resource', {
        input: {
          title: example.title,
          category: example.category,
          description:
            'Sample listing for exploring ResourceDex. This photograph illustrates a possible resource; these materials are not available for a real pickup. Quantity, composition, dimensions and condition have not been verified. Photo credit is recorded in the project documentation.',
          quantity: null,
          unit: 'lot',
          lot_label: 'Illustrative whole lot',
          condition: 'unknown',
          working_status: example.category === 'tools' ? 'not_tested' : 'not_applicable',
          material: 'Unknown',
          dimensions: '',
          area_id: example.area,
          image_path: imagePath,
          image_alt: example.alt,
        },
      }),
    ),
  );
  credentials.resources[example.category] = resource.id;
  await persist();
  await must(
    admin
      .from('resources')
      .update({ is_sample: true })
      .eq('id', resource.id)
      .eq('owner_id', ownerId),
  );
  await must(
    owner.rpc('publish_resources', {
      resource_ids: [resource.id],
      operation_key: `sample-publish-${resource.id}`,
      expected_revisions: { [resource.id]: resource.revision },
    }),
  );
}
console.log(
  `Prepared ${Object.keys(credentials.resources).length} labeled samples and 2 distinct demo accounts. Credentials: tmp/demo-accounts.json (ignored).`,
);
