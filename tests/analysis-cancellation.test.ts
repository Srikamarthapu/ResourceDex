import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  },
}));

import { identifyPhoto } from '../src/lib/ai/identify';
import { DETECTION_DEADLINE_MS, identifyItems } from '../src/lib/ai/gemini';
import { generateNvidiaJson, identifyItemsWithNvidia, NVIDIA_MODEL } from '../src/lib/ai/nvidia';

const fetchMock = vi.fn<typeof fetch>();
const image = Buffer.from('image fixture');
const candidate = {
  candidate_key: 'pliers',
  label: 'Hand pliers',
  category: 'tools',
  box_2d: [100, 200, 700, 800],
  visible_observations: ['Metal jaws and dark handles.'],
  unknowns: ['Working condition'],
  owner_questions: ['Do the jaws open and close?'],
};
const googleSuccess = {
  text: '{"candidates":[]}',
  candidates: [{ finishReason: 'STOP' }],
};
function nvidiaSuccess(candidates: unknown[] = []) {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates }) } }],
  });
}

beforeEach(() => {
  generate.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_API_KEY', 'google-unit-fixture');
  vi.stubEnv('GEMINI_MODEL', 'gemini-unit-fixture');
  vi.stubEnv('NVIDIA_API_KEY', 'nvidia-unit-fixture');
  vi.stubEnv('NVIDIA_MODEL', NVIDIA_MODEL);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('photo identification cancellation', () => {
  it('never contacts either provider when the operation was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(identifyPhoto(image, 'test-run', true, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(identifyItems(image, 'test-run', controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(
      generateNvidiaJson('Prompt', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(generate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels Gemini without interpreting the abort as a reason to invoke NVIDIA', async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    generate.mockImplementation(
      ({ config }) =>
        new Promise((_resolve, reject) => {
          providerSignal = config.abortSignal;
          config.abortSignal.addEventListener('abort', () => reject(new Error('provider-abort')), {
            once: true,
          });
        }),
    );
    const result = identifyPhoto(image, 'test-run', true, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await assertion;
    expect(providerSignal?.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a late successful Gemini result when the provider ignores cancellation', async () => {
    const controller = new AbortController();
    let finish: (value: typeof googleSuccess) => void = () => {};
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = identifyPhoto(image, 'test-run', true, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    finish(googleSuccess);
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not poll or resubmit a pending NVIDIA request after cancellation', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      Response.json({ requestId: 'e9f6bf61-b4db-4f4a-aa26-a34681b3d575' }, { status: 202 }),
    );
    const result = generateNvidiaJson('Prompt', {}, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a late successful NVIDIA response when fetch ignores cancellation', async () => {
    const controller = new AbortController();
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = identifyItemsWithNvidia(image, 'test-run', 1000, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    finish(nvidiaSuccess());
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves cancellation through reference grounding instead of returning a successful photo result', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    const controller = new AbortController();
    let ready: () => void = () => {};
    const groundingStarted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    generate.mockRejectedValue({ status: 429 });
    fetchMock.mockResolvedValueOnce(nvidiaSuccess([candidate])).mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('grounding-abort')), {
            once: true,
          });
          ready();
        }),
    );
    const result = identifyPhoto(image, 'test-run', true, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await groundingStarted;
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a provider deadline as timeout and still permits the consented backup', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    generate.mockImplementation(
      ({ config }) =>
        new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener(
            'abort',
            () => reject(new Error('provider-timeout')),
            { once: true },
          );
        }),
    );
    fetchMock.mockResolvedValue(nvidiaSuccess());
    const result = identifyPhoto(image, 'test-run', true, controller.signal);
    const assertion = expect(result).resolves.toMatchObject({
      model: NVIDIA_MODEL,
      candidates: [],
      tokenUsage: { fallback: { from: 'google', reason: 'timeout' } },
    });
    await vi.advanceTimersByTimeAsync(DETECTION_DEADLINE_MS);
    await assertion;
    expect(controller.signal.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps an NVIDIA deadline distinct from a user cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('provider-timeout')), {
            once: true,
          });
        }),
    );
    const result = generateNvidiaJson('Prompt', {}, { signal: controller.signal, timeoutMs: 100 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(controller.signal.aborted).toBe(false);
  });
});
