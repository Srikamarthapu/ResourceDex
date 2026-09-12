import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { describe, expect, it } from 'vitest';

// Opt-in integration test. Creates and cleans up only its own private test data.
describe.skipIf(process.env.RUN_LIVE_PHOTO_API_TESTS !== '1')(
  'live authenticated photo API',
  () => {
    it('stores, normalizes, identifies and crops a private photo without exposing it to another user', async () => {
      loadEnvFile('.env.local');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
      const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
      const appUrl = process.env.PHOTO_TEST_APP_URL ?? 'http://localhost:3012';
      const admin = createClient(url, secret, {
        auth: { persistSession: false },
      });
      const ids: string[] = [];
      const paths: Record<string, string[]> = {
        'scan-images': [],
        'listing-images': [],
      };
      const createSession = async () => {
        const email = `photo-smoke-${randomUUID()}@resourcedex.test`;
        const password = `${randomUUID()}!a9`;
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (created.error || !created.data.user)
          throw new Error('Could not prepare a verified test account.');
        ids.push(created.data.user.id);
        const jar = new Map<string, string>();
        const client = createServerClient(url, key, {
          cookies: {
            getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
            setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
          },
        });
        const signedIn = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (signedIn.error) throw new Error('Test sign-in failed.');
        return {
          client,
          cookie: () => Array.from(jar, ([name, value]) => `${name}=${value}`).join('; '),
        };
      };
      try {
        const owner = await createSession();
        const other = await createSession();
        const call = async (path: string, body?: unknown, cookie = owner.cookie()) => {
          const response = await fetch(`${appUrl}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: appUrl,
              Cookie: cookie,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(40_000),
          });
          const payload = await response.json();
          return { status: response.status, payload };
        };
        const file = await readFile('public/images/samples/tools.webp');
        const created = await call('/api/scans', {
          fileName: 'licensed-tools-smoke.webp',
          mimeType: 'image/webp',
          size: file.byteLength,
          operationKey: randomUUID(),
        });
        expect(created.status, created.payload.error).toBe(200);
        const { scanId, upload } = created.payload;
        paths['scan-images'].push(upload.path);
        const stored = await owner.client.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, new Blob([file], { type: 'image/webp' }), {
            contentType: 'image/webp',
          });
        expect(stored.error).toBeNull();
        const prepared = await call(`/api/scans/${scanId}/prepare`, {});
        expect(prepared.status, prepared.payload.error).toBe(200);
        expect(prepared.payload.status).toBe('ready');
        paths['scan-images'].push(prepared.payload.imagePath);
        expect((await call(`/api/scans/${scanId}`, undefined, other.cookie())).status).toBe(404);
        expect((await call(`/api/scans/${scanId}`, undefined, '')).status).toBe(401);
        const analysisKey = randomUUID();
        const analysis = await call(`/api/scans/${scanId}/analyze`, {
          imageHash: prepared.payload.imageHash,
          operationKey: analysisKey,
          consent: true,
        });
        expect(analysis.status, analysis.payload.error).toBe(200);
        expect(analysis.payload.status).toBe('completed');
        expect(analysis.payload.candidates.length).toBeGreaterThan(0);
        const replay = await call(`/api/scans/${scanId}/analyze`, {
          imageHash: prepared.payload.imageHash,
          operationKey: analysisKey,
          consent: true,
        });
        expect(replay.status).toBe(200);
        expect(replay.payload.candidates).toEqual(analysis.payload.candidates);
        const crop = { x_min: 0, y_min: 200, x_max: 600, y_max: 900 };
        const derivative = await call(`/api/scans/${scanId}/image`, {
          operationKey: randomUUID(),
          crop,
        });
        expect(derivative.status, derivative.payload.error).toBe(200);
        paths['listing-images'].push(derivative.payload.imagePath);
        expect(derivative.payload.width).toBeLessThan(prepared.payload.width);
        const privateAttempt = await other.client.storage
          .from('listing-images')
          .createSignedUrl(derivative.payload.imagePath, 60);
        expect(privateAttempt.error).not.toBeNull();
        const saved = await call(`/api/scans/${scanId}`);
        expect(saved.payload.candidates).toEqual(analysis.payload.candidates);
        expect(saved.payload.reviewVersion).toBe(0);
        const first = saved.payload.candidates[0];
        const manualId = `manual:${randomUUID()}`;
        const reviewBody = {
          analysisVersion: saved.payload.analysisVersion,
          expectedReviewVersion: 0,
          candidates: [
            {
              candidateId: first.candidate_id,
              label: 'Owner-reviewed tool',
              category: first.category,
              selected: false,
            },
            {
              candidateId: manualId,
              label: 'Manually added test item',
              category: 'other',
              selected: true,
            },
          ],
        };
        const review = await call(`/api/scans/${scanId}/review`, reviewBody);
        expect(review.status, review.payload.error).toBe(200);
        expect(review.payload.reviewVersion).toBe(1);
        expect(review.payload.candidates).toHaveLength(2);
        const restored = await call(`/api/scans/${scanId}`);
        expect(restored.payload.reviewVersion).toBe(1);
        expect(restored.payload.candidates).toEqual(review.payload.candidates);
        expect(restored.payload.candidates[0]).toMatchObject({
          label: 'Owner-reviewed tool',
          selected: false,
          bounds: first.bounds,
          visible_observations: first.visible_observations,
        });
        expect(restored.payload.candidates[1]).toMatchObject({
          candidate_id: manualId,
          selected: true,
          bounds: null,
          source: 'manual',
          visible_observations: [],
        });
        expect((await call(`/api/scans/${scanId}/review`, reviewBody)).status).toBe(409);
        expect((await call(`/api/scans/${scanId}/review`, reviewBody, other.cookie())).status).toBe(
          404,
        );
        const reviewedReplay = await call(`/api/scans/${scanId}/analyze`, {
          imageHash: prepared.payload.imageHash,
          operationKey: analysisKey,
          consent: true,
        });
        expect(reviewedReplay.status).toBe(200);
        expect(reviewedReplay.payload.candidates).toEqual(restored.payload.candidates);
        await mkdir('output/qa', { recursive: true });
        await writeFile(
          'output/qa/photo-pipeline-smoke.json',
          JSON.stringify(
            {
              testedAt: new Date().toISOString(),
              appUrl,
              scanId,
              analysisVersion: saved.payload.analysisVersion,
              candidateCount: saved.payload.candidates.length,
              imageHash: prepared.payload.imageHash,
              checks: [
                'verified owner private signed upload',
                'actual image normalization',
                'unrelated scan read denied',
                'visitor scan read denied',
                'live Gemini persisted result',
                'idempotent analysis replay',
                'owner-approved private derivative',
                'unrelated derivative read denied',
                'refresh restores analysis',
                'versioned owner corrections and selections restored',
                'manual additions restored without invented visual evidence',
                'stale review revision rejected',
                'unrelated review write denied',
                'analysis replay preserves saved review',
              ],
              cleanup:
                'The test removes its own private Storage objects and Auth users in finally. No resource is published.',
              limitation:
                'Single licensed sample photo; not a detection accuracy evaluation or public sharing demonstration.',
            },
            null,
            2,
          ),
        );
      } finally {
        for (const [bucket, ownedPaths] of Object.entries(paths))
          if (ownedPaths.length) await admin.storage.from(bucket).remove(ownedPaths);
        for (const id of ids) await admin.auth.admin.deleteUser(id);
      }
    }, 120_000);
  },
);
