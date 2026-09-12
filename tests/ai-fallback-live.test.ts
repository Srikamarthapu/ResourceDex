import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import corpus from '../knowledge/starter-corpus.json';

vi.mock('server-only', () => ({}));

// The Google failure exists only in this opt-in test. NVIDIA vision and reference
// generation use the real production orchestration with the licensed fixture.
describe.skipIf(process.env.RUN_LIVE_NVIDIA_FALLBACK_TESTS !== '1')(
  'live NVIDIA fallback with retrieval',
  () => {
    it('recovers from a Gemini rate limit and grounds the detected items in actual corpus entries', async () => {
      loadEnvFile('.env.local');
      const gemini = await import('../src/lib/ai/gemini');
      const { identifyPhoto } = await import('../src/lib/ai/identify');
      const { AnalysisError } = await import('../src/lib/ai/analysis-error');
      const { normalizeImage } = await import('../src/lib/images/normalize');
      const { NVIDIA_MODEL } = await import('../src/lib/ai/nvidia');
      const image = await normalizeImage(await readFile('public/images/samples/tools.webp'));
      const failure = new AnalysisError('provider_unavailable', 'Simulated test rate limit.');
      failure.providerStatus = 429;
      const primary = vi.spyOn(gemini, 'identifyItems').mockRejectedValue(failure);
      const originalFetch = globalThis.fetch;
      const providerCalls: { elapsedMs: number; httpStatus: number | null }[] = [];
      const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
        const callStarted = Date.now();
        const metadata = { elapsedMs: 0, httpStatus: null as number | null };
        providerCalls.push(metadata);
        try {
          const response = await originalFetch(...args);
          metadata.httpStatus = response.status;
          return response;
        } finally {
          metadata.elapsedMs = Date.now() - callStarted;
        }
      });
      const started = Date.now();
      let metadata: Record<string, unknown> = {};
      await mkdir('output/qa', { recursive: true });
      try {
        const result = await identifyPhoto(image.bytes, randomUUID(), true);
        const usage = result.tokenUsage;
        metadata = {
          candidateCount: result.candidates.length,
          localizedCount: result.candidates.filter((candidate) => candidate.bounds !== null).length,
          tokenUsage: usage,
        };
        expect(primary).toHaveBeenCalledOnce();
        expect(result.model).toBe(NVIDIA_MODEL);
        expect(result.candidates.length).toBeGreaterThan(0);
        expect(result.candidates.length).toBeLessThanOrEqual(12);
        expect(result.candidates.every((candidate) => candidate.review_status === 'pending')).toBe(
          true,
        );
        if (!usage.grounding) throw new Error('Fallback metadata is missing.');
        expect(usage.provider).toBe('nvidia');
        expect(usage.fallback).toMatchObject({ from: 'google', status: 429 });
        expect(usage.grounding.status).toBe('grounded');
        expect(usage.grounding.corpusVersion).toBe(corpus.version);
        expect(usage.grounding.sourceIds.length).toBeGreaterThan(0);
        for (const sourceId of usage.grounding.sourceIds) {
          expect(corpus.entries.some((entry) => entry.id === sourceId)).toBe(true);
        }
        const notes = result.candidates.flatMap((candidate) => candidate.reference_notes ?? []);
        expect(notes.length).toBeGreaterThan(0);
        for (const note of notes) {
          const entry = corpus.entries.find((source) => source.id === note.source.id);
          expect(entry).toBeDefined();
          expect(note.text).toBe(entry?.text);
          expect(note.source.url).toBe(entry?.url);
        }
        await writeFile(
          'output/qa/nvidia-fallback-smoke.json',
          JSON.stringify(
            {
              status: 'passed',
              durationMs: Date.now() - started,
              ...metadata,
              providerCalls,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        const code = error instanceof AnalysisError ? error.code : 'assertion_failed';
        const providerStatus = error instanceof AnalysisError ? error.providerStatus : undefined;
        await writeFile(
          'output/qa/nvidia-fallback-smoke.json',
          JSON.stringify(
            {
              status: 'failed',
              code,
              providerStatus,
              durationMs: Date.now() - started,
              ...metadata,
              providerCalls,
            },
            null,
            2,
          ),
        );
        throw new Error(
          `Live fallback validation failed (${code}${providerStatus ? `, HTTP ${providerStatus}` : ''}).`,
        );
      } finally {
        primary.mockRestore();
        provider.mockRestore();
      }
    }, 185_000);
  },
);
