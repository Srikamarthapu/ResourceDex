import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Explicit opt-in only: this contacts Google and can incur the configured cost.
describe.skipIf(process.env.RUN_LIVE_AI_TESTS !== '1')('live Gemini capability smoke', () => {
  it('identifies the licensed sample tools photograph with the actual production adapter', async () => {
    loadEnvFile('.env.local');
    const { normalizeImage } = await import('../src/lib/images/normalize');
    const { identifyItems } = await import('../src/lib/ai/gemini');
    const { DETECTION_PROMPT_VERSION, DETECTION_SCHEMA_VERSION } =
      await import('../src/lib/ai/detection');
    const image = await normalizeImage(await readFile('public/images/samples/tools.webp'));
    const started = Date.now();
    const result = await identifyItems(image.bytes, randomUUID());
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(12);
    expect(result.candidates.every((candidate) => candidate.review_status === 'pending')).toBe(
      true,
    );
    await mkdir('output/qa', { recursive: true });
    await writeFile(
      'output/qa/gemini-smoke.json',
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          input: 'Licensed sample tools photograph; not user inventory. See docs/photo-credits.md.',
          promptVersion: DETECTION_PROMPT_VERSION,
          schemaVersion: DETECTION_SCHEMA_VERSION,
          durationMs: Date.now() - started,
          imageHash: image.hash,
          ...result,
          limitation:
            'One capability smoke test does not establish detection precision, recall, or IoU release gates.',
        },
        null,
        2,
      ),
    );
  }, 45_000);
});
