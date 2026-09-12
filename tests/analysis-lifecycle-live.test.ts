import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { expect, it } from 'vitest';

// No AI calls. Exercise the real database locks and authenticated HTTP boundary
// using only users, scans, and objects created within this one test.
it.skipIf(process.env.RUN_LIVE_ANALYSIS_LIFECYCLE_TESTS !== '1')(
  'stops and expires only the intended analysis while preserving saved work and admission history',
  async () => {
    if (existsSync('.env.local')) process.loadEnvFile('.env.local');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    expect(url).toBe('https://wdenmhvhnzrkhhvnnuyo.supabase.co');
    const appUrl = process.env.PHOTO_TEST_APP_URL || 'http://localhost:3012';
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const visitor = createClient(url, key, { auth: { persistSession: false } });
    const suffix = randomUUID();
    const createdUsers: string[] = [];
    let imagePath = '';
    const must = async <T extends { data: unknown; error: unknown }>(
      promise: PromiseLike<T>,
    ): Promise<NonNullable<T['data']>> => {
      const result = await promise;
      expect(result.error, 'Isolated lifecycle fixture operation succeeds').toBeNull();
      return result.data as NonNullable<T['data']>;
    };
    const session = async (role: string) => {
      const email = `resourcedex-lifecycle-${role}-${suffix}@example.test`;
      const password = `L-${randomUUID()}-a9!`;
      const user = await must(
        admin.auth.admin.createUser({ email, password, email_confirm: true }),
      );
      createdUsers.push(user.user!.id);
      const jar = new Map<string, string>();
      const client = createServerClient(url, key, {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
        },
      });
      await must(client.auth.signInWithPassword({ email, password }));
      return {
        id: user.user!.id,
        client,
        cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      };
    };
    try {
      const owner = await session('owner');
      const other = await session('other');
      const scanId = randomUUID();
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=',
        'base64',
      );
      imagePath = `${owner.id}/${scanId}/saved.png`;
      await must(
        admin.storage.from('scan-images').upload(imagePath, png, { contentType: 'image/png' }),
      );
      const original = {
        candidate_id: 'prior:item',
        label: 'Prior identified item',
        category: 'hardware',
        bounds: null,
        localization_status: 'manual_unlocalized',
        localization_reason: null,
        visible_observations: [],
        unknowns: [],
        owner_questions: [],
        review_status: 'pending',
      };
      const reviewed = { ...original, label: 'Owner saved correction', review_status: 'corrected' };
      await must(
        admin.from('scans').insert({
          id: scanId,
          owner_id: owner.id,
          upload_operation_key: randomUUID(),
          status: 'completed',
          normalized_path: imagePath,
          original_path: imagePath,
          image_hash: createHash('sha256').update(png).digest('hex'),
          width: 1,
          height: 1,
          analysis_version: 1,
          candidates: [original],
        }),
      );
      await must(
        admin.from('scan_reviews').insert({
          scan_id: scanId,
          owner_id: owner.id,
          analysis_version: 1,
          candidates: [reviewed],
        }),
      );
      const call = async (
        path: string,
        body?: unknown,
        cookie = owner.cookie(),
        origin = appUrl,
      ) => {
        const response = await fetch(`${appUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        return { status: response.status, body: await response.json() };
      };
      const start = async (
        operationKey: string,
        deadline = new Date(Date.now() + 120_000).toISOString(),
      ) => {
        await must(
          admin
            .from('scans')
            .update({
              status: 'analyzing',
              analysis_operation_key: operationKey,
              analysis_started_at: new Date().toISOString(),
              analysis_deadline_at: deadline,
              analysis_error: null,
            })
            .eq('id', scanId)
            .eq('owner_id', owner.id),
        );
      };
      const reserve = (operationKey: string) =>
        admin.rpc('reserve_analysis', {
          p_owner: owner.id,
          p_scan: scanId,
          p_operation_key: operationKey,
          p_cost: 0.000001,
          p_daily_ceiling: 1000,
        });
      const cancel = (operationKey: string) =>
        call(`/api/scans/${scanId}/cancel`, { operationKey });
      const complete = (operationKey: string, attemptId: string) =>
        admin.rpc('complete_analysis', {
          p_owner: owner.id,
          p_scan: scanId,
          p_operation_key: operationKey,
          p_attempt: attemptId,
          p_result: { candidates: [original], limitReached: false },
          p_model: 'fixture-only',
          p_prompt: 'fixture-only',
          p_schema: 'fixture-only',
          p_tokens: {},
        });
      const state = () =>
        must(
          admin
            .from('scans')
            .select('status,analysis_operation_key,analysis_version,normalized_path,candidates')
            .eq('id', scanId)
            .single(),
        );
      const attempt = (operationKey: string) =>
        must(
          admin
            .from('analysis_attempts')
            .select('id,status,error_code,reserved_cost_usd')
            .eq('scan_id', scanId)
            .eq('operation_key', operationKey)
            .single(),
        );

      const first = randomUUID();
      await start(first);
      const firstAttempt = String(await must(reserve(first)));
      expect(
        (await call(`/api/scans/${scanId}/cancel`, { operationKey: first }, other.cookie())).status,
      ).toBe(404);
      expect((await call(`/api/scans/${scanId}/cancel`, { operationKey: first }, '')).status).toBe(
        401,
      );
      expect(
        (
          await call(
            `/api/scans/${scanId}/cancel`,
            { operationKey: first },
            owner.cookie(),
            'https://unrelated.example',
          )
        ).status,
      ).toBe(403);
      expect(
        (await call(`/api/scans/${scanId}/cancel`, { operationKey: first, ownerId: other.id }))
          .status,
      ).toBe(400);
      for (const client of [owner.client, visitor]) {
        expect(
          (
            await client.rpc('cancel_analysis', {
              p_owner: owner.id,
              p_scan: scanId,
              p_operation_key: first,
            })
          ).error?.code,
        ).toBe('42501');
        expect(
          (
            await client.rpc('fail_analysis', {
              p_owner: owner.id,
              p_scan: scanId,
              p_operation_key: first,
              p_code: 'timeout',
              p_message: 'Fixture-only',
            })
          ).error?.code,
        ).toBe('42501');
      }
      expect(
        await must(
          admin.rpc('cancel_analysis', {
            p_owner: other.id,
            p_scan: scanId,
            p_operation_key: first,
          }),
        ),
      ).toBe(false);
      const stopped = await cancel(first);
      expect(stopped.status).toBe(200);
      expect(stopped.body).toMatchObject({
        status: 'failed',
        cancelled: true,
        analysisVersion: 1,
        candidates: [reviewed],
      });
      expect(stopped.body.error).toContain('Identification stopped');
      expect(await attempt(first)).toMatchObject({
        status: 'failed',
        error_code: 'cancelled',
        reserved_cost_usd: 0.000001,
      });
      expect((await complete(first, firstAttempt)).error).toBeTruthy();
      expect((await state()).analysis_version).toBe(1);

      const second = randomUUID();
      await start(second);
      await must(reserve(second));
      expect((await cancel(first)).body).toMatchObject({ cancelled: false, status: 'analyzing' });
      expect(
        await must(
          admin.rpc('fail_analysis', {
            p_owner: owner.id,
            p_scan: scanId,
            p_operation_key: first,
            p_code: 'provider_unavailable',
            p_message: 'Old worker failed',
          }),
        ),
      ).toBe(false);
      expect((await state()).analysis_operation_key).toBe(second);
      expect((await cancel(second)).body.cancelled).toBe(true);
      expect((await cancel(second)).body.cancelled).toBe(false);
      expect((await attempt(second)).error_code).toBe('cancelled');

      const completed = randomUUID();
      await start(completed);
      const completedAttempt = String(await must(reserve(completed)));
      await must(complete(completed, completedAttempt));
      expect((await cancel(completed)).body).toMatchObject({
        cancelled: false,
        status: 'completed',
        analysisVersion: 2,
      });
      expect((await attempt(completed)).status).toBe('completed');

      const raced = randomUUID();
      await start(raced);
      const racedAttempt = String(await must(reserve(raced)));
      const [raceStop, raceComplete] = await Promise.all([
        cancel(raced),
        complete(raced, racedAttempt),
      ]);
      const afterRace = await state();
      expect(['completed', 'failed']).toContain(afterRace.status);
      expect((await attempt(raced)).status).toBe(afterRace.status);
      if (raceStop.body.cancelled) expect(raceComplete.error).toBeTruthy();
      else expect(raceComplete.error).toBeNull();

      const beforeAdmission = randomUUID();
      await start(beforeAdmission);
      expect((await cancel(beforeAdmission)).body.cancelled).toBe(true);
      expect((await reserve(beforeAdmission)).error).toBeTruthy();
      expect(
        (
          await must(
            admin
              .from('analysis_attempts')
              .select('id')
              .eq('scan_id', scanId)
              .eq('operation_key', beforeAdmission),
          )
        ).length,
      ).toBe(0);
      const admissionRace = randomUUID();
      await start(admissionRace);
      const [admitted, admissionStopped] = await Promise.all([
        reserve(admissionRace),
        cancel(admissionRace),
      ]);
      expect(admissionStopped.body.cancelled).toBe(true);
      expect((await state()).status).toBe('failed');
      const raceRows = await must(
        admin
          .from('analysis_attempts')
          .select('status,error_code')
          .eq('scan_id', scanId)
          .eq('operation_key', admissionRace),
      );
      if (admitted.error) expect(raceRows).toEqual([]);
      else expect(raceRows).toEqual([{ status: 'failed', error_code: 'cancelled' }]);

      const expired = randomUUID();
      await start(expired, new Date(Date.now() - 1000).toISOString());
      const expiredAttempt = await must(
        admin
          .from('analysis_attempts')
          .insert({
            owner_id: owner.id,
            scan_id: scanId,
            operation_key: expired,
            status: 'running',
            reserved_cost_usd: 0.000001,
          })
          .select('id')
          .single(),
      );
      const expiredResponse = await call(`/api/scans/${scanId}`);
      expect(expiredResponse.status).toBe(200);
      expect(expiredResponse.body.status).toBe('failed');
      expect(expiredResponse.body.error).toContain('took too long');
      expect((await attempt(expired)).error_code).toBe('timeout');
      expect((await complete(expired, expiredAttempt.id)).error).toBeTruthy();
      const legacyExpired = randomUUID();
      await start(legacyExpired, new Date(Date.now() - 1000).toISOString());
      await must(
        admin.from('analysis_attempts').insert({
          owner_id: owner.id,
          scan_id: scanId,
          operation_key: legacyExpired,
          status: 'failed',
          error_code: 'legacy_timeout',
          reserved_cost_usd: 0.000001,
          finished_at: new Date().toISOString(),
        }),
      );
      expect((await call(`/api/scans/${scanId}`)).body.status).toBe('failed');
      expect((await attempt(legacyExpired)).error_code).toBe('legacy_timeout');
      expect((await state()).normalized_path).toBe(imagePath);
      expect(
        (
          await must(
            admin
              .from('scan_reviews')
              .select('candidates')
              .eq('scan_id', scanId)
              .eq('analysis_version', 1)
              .single(),
          )
        ).candidates,
      ).toEqual([reviewed]);
      expect((await admin.storage.from('scan-images').download(imagePath)).error).toBeNull();
      expect(
        (
          await must(
            admin
              .from('analysis_attempts')
              .select('id')
              .eq('scan_id', scanId)
              .eq('status', 'running'),
          )
        ).length,
      ).toBe(0);
    } finally {
      for (const ownerId of createdUsers) {
        const remaining = await admin.auth.admin.getUserById(ownerId);
        if (remaining.error) continue;
        expect(remaining.data.user?.email).toContain(`-${suffix}@example.test`);
        await must(admin.rpc('begin_account_deletion', { p_owner: ownerId }));
        await must(admin.rpc('remove_account_records', { p_owner: ownerId }));
        if (imagePath.startsWith(`${ownerId}/`))
          await must(admin.storage.from('scan-images').remove([imagePath]));
        await must(admin.auth.admin.deleteUser(ownerId));
      }
    }
  },
  90_000,
);
