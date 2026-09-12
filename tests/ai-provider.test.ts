import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  },
}));

import { DETECTION_DEADLINE_MS, getGeminiModels, identifyItems } from '../src/lib/ai/gemini';

beforeEach(() => {
  generate.mockReset();
  vi.stubEnv('GEMINI_API_KEY', 'unit-test-placeholder');
  vi.stubEnv('GEMINI_MODEL', 'configured-test-model');
  vi.stubEnv('GEMINI_FALLBACK_MODEL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('the bounded provider adapter', () => {
  it('defaults to the requested 3.5 then 3.8 chain and avoids duplicate configured models', () => {
    vi.stubEnv('GEMINI_MODEL', '');
    expect(getGeminiModels()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    expect(getGeminiModels()).toEqual(['gemini-3.8-flash']);
  });
  it('uses a model override with the remaining time budget and unchanged schema', async () => {
    generate.mockResolvedValue({
      text: '{"candidates":[]}',
      candidates: [{ finishReason: 'STOP' }],
    });
    expect(
      await identifyItems(Buffer.from('fixture'), 'test-run', undefined, 'gemini-3.8-flash', 8000),
    ).toMatchObject({ model: 'gemini-3.8-flash' });
    expect(generate.mock.calls[0][0]).toMatchObject({
      model: 'gemini-3.8-flash',
      config: { httpOptions: { timeout: 8000 } },
    });
  });
  it('uses the configured model, strict JSON, a deadline and no SDK retries', async () => {
    generate.mockResolvedValue({
      text: '{"candidates":[]}',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { totalTokenCount: 42 },
    });
    expect(await identifyItems(Buffer.from('image fixture'), 'test-run')).toMatchObject({
      candidates: [],
      model: 'configured-test-model',
      tokenUsage: { totalTokenCount: 42 },
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0].config).toMatchObject({
      responseMimeType: 'application/json',
      maxOutputTokens: 6000,
      httpOptions: {
        timeout: DETECTION_DEADLINE_MS,
        retryOptions: { attempts: 1 },
      },
    });
    expect(generate.mock.calls[0][0].config.tools).toBeUndefined();
  });
  it('fails before contacting Google when configuration is absent', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(identifyItems(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    { text: 'not json', candidates: [{ finishReason: 'STOP' }] },
    { text: '{"candidates":[]}', candidates: [{ finishReason: 'SAFETY' }] },
    { text: '{"candidates":[]}', candidates: [{ finishReason: 'MAX_TOKENS' }] },
  ])('rejects malformed, refused or truncated results', async (response) => {
    generate.mockResolvedValue(response);
    await expect(identifyItems(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject({
      code: 'invalid_output',
    });
  });
  it('does not expose provider error messages or silently retry', async () => {
    generate.mockRejectedValue({
      status: 503,
      message: 'provider-private-debug-value',
    });
    await expect(identifyItems(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject({
      code: 'provider_unavailable',
      providerStatus: 503,
    });
    expect(generate).toHaveBeenCalledOnce();
  });
  it('aborts at the configured deadline and preserves a manual fallback', async () => {
    vi.useFakeTimers();
    generate.mockImplementation(
      ({ config }) =>
        new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const result = identifyItems(Buffer.from('fixture'), 'test-run');
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(DETECTION_DEADLINE_MS);
    await assertion;
  });
});
