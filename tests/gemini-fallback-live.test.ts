import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

it.skipIf(process.env.RUN_LIVE_GEMINI_FALLBACK_TESTS !== '1')(
  'verifies Gemini 3.8 image input and structured output using the licensed sample',
  async () => {
    loadEnvFile('.env.local');
    const { normalizeImage } = await import('../src/lib/images/normalize');
    const { GEMINI_FALLBACK_MODEL, identifyItems } = await import('../src/lib/ai/gemini');
    const image = await normalizeImage(await readFile('public/images/samples/tools.webp'));
    const started = Date.now();
    let result;
    try {
      result = await identifyItems(image.bytes, randomUUID(), undefined, GEMINI_FALLBACK_MODEL);
    } catch (error) {
      const { AnalysisError } = await import('../src/lib/ai/analysis-error');
      const evidence = {
        testedAt: new Date().toISOString(),
        model: GEMINI_FALLBACK_MODEL,
        status: 'failed',
        durationMs: Date.now() - started,
        code: error instanceof AnalysisError ? error.code : 'unknown',
        providerStatus: error instanceof AnalysisError ? (error.providerStatus ?? null) : null,
      };
      await mkdir('output/qa', { recursive: true });
      await writeFile('output/qa/gemini-3.8-smoke.json', JSON.stringify(evidence, null, 2));
      console.info(JSON.stringify(evidence));
      throw error;
    }
    expect(result.model).toBe('gemini-3.8-flash');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(12);
    expect(result.candidates.every((candidate) => candidate.review_status === 'pending')).toBe(
      true,
    );
    const evidence = {
      testedAt: new Date().toISOString(),
      model: result.model,
      status: 'passed',
      durationMs: Date.now() - started,
      candidateCount: result.candidates.length,
      localizedCount: result.candidates.filter((candidate) => candidate.bounds).length,
      tokenUsage: result.tokenUsage,
      input: 'Licensed sample tools photograph; see docs/photo-credits.md.',
    };
    await mkdir('output/qa', { recursive: true });
    await writeFile('output/qa/gemini-3.8-smoke.json', JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify(evidence));
  },
  45_000,
);
