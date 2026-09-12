import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Explicit opt-in: contacts NVIDIA with a licensed fixture, never user inventory.
describe.skipIf(process.env.RUN_LIVE_NVIDIA_TESTS !== '1')(
  'live NVIDIA K3 capability smoke',
  () => {
    it('returns the same validated item contract for the licensed sample tools photo', async () => {
      loadEnvFile('.env.local');
      const { normalizeImage } = await import('../src/lib/images/normalize');
      const { identifyItemsWithNvidia, NVIDIA_VISION_DEADLINE_MS } =
        await import('../src/lib/ai/nvidia');
      const { AnalysisError } = await import('../src/lib/ai/analysis-error');
      const image = await normalizeImage(await readFile('public/images/samples/tools.webp'));
      const timeoutMs = Math.min(
        120_000,
        Math.max(1_000, Number(process.env.NVIDIA_SMOKE_TIMEOUT_MS) || NVIDIA_VISION_DEADLINE_MS),
      );
      const started = Date.now();
      await mkdir('output/qa', { recursive: true });
      try {
        const result = await identifyItemsWithNvidia(image.bytes, randomUUID(), timeoutMs);
        expect(result.candidates.length).toBeGreaterThan(0);
        expect(result.candidates.length).toBeLessThanOrEqual(12);
        expect(result.candidates.every((candidate) => candidate.review_status === 'pending')).toBe(
          true,
        );
        await writeFile(
          'output/qa/nvidia-smoke.json',
          JSON.stringify(
            {
              status: 'passed',
              candidateCount: result.candidates.length,
              localizedCount: result.candidates.filter((candidate) => candidate.bounds !== null)
                .length,
              durationMs: Date.now() - started,
              tokenUsage: result.tokenUsage,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        const code = error instanceof AnalysisError ? error.code : 'assertion_failed';
        const providerStatus = error instanceof AnalysisError ? error.providerStatus : undefined;
        await writeFile(
          'output/qa/nvidia-smoke.json',
          JSON.stringify(
            {
              status: 'failed',
              code,
              providerStatus,
              durationMs: Date.now() - started,
            },
            null,
            2,
          ),
        );
        throw new Error(
          `Live NVIDIA validation failed (${code}${providerStatus ? `, HTTP ${providerStatus}` : ''}).`,
        );
      }
    }, 130_000);
  },
);

// Separate opt-in diagnostic: use only after the bounded vision check times out.
describe.skipIf(process.env.RUN_LIVE_NVIDIA_TEXT_TESTS !== '1')(
  'live NVIDIA K3 text diagnostic',
  () => {
    it('checks whether a tiny request reaches the configured model', async () => {
      loadEnvFile('.env.local');
      const { generateNvidiaJson } = await import('../src/lib/ai/nvidia');
      const { AnalysisError } = await import('../src/lib/ai/analysis-error');
      const started = Date.now();
      await mkdir('output/qa', { recursive: true });
      try {
        const result = await generateNvidiaJson(
          'Return {"ok":true}.',
          {
            type: 'object',
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
            additionalProperties: false,
          },
          { timeoutMs: 20_000 },
        );
        expect(JSON.parse(result.text)).toEqual({ ok: true });
        await writeFile(
          'output/qa/nvidia-text-smoke.json',
          JSON.stringify(
            {
              status: 'passed',
              durationMs: Date.now() - started,
              tokenUsage: result.tokenUsage,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        const code = error instanceof AnalysisError ? error.code : 'assertion_failed';
        const providerStatus = error instanceof AnalysisError ? error.providerStatus : undefined;
        await writeFile(
          'output/qa/nvidia-text-smoke.json',
          JSON.stringify(
            {
              status: 'failed',
              code,
              providerStatus,
              durationMs: Date.now() - started,
            },
            null,
            2,
          ),
        );
        throw new Error(
          `Live NVIDIA text diagnostic failed (${code}${providerStatus ? `, HTTP ${providerStatus}` : ''}).`,
        );
      }
    }, 25_000);
  },
);
