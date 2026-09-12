import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generate, ground } = vi.hoisted(() => ({ generate: vi.fn(), ground: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  },
}));
vi.mock('../src/lib/ai/reference-grounding', () => ({ groundCandidateReferences: ground }));

import { getIdentificationConfig, identifyPhoto, shouldUseBackup } from '../src/lib/ai/identify';
import { AnalysisError } from '../src/lib/ai/analysis-error';
import { NVIDIA_MODEL } from '../src/lib/ai/nvidia';

const fetchMock = vi.fn<typeof fetch>();
const candidate = {
  candidate_key: 'pliers',
  label: 'Hand pliers',
  category: 'tools',
  box_2d: [100, 200, 700, 800],
  visible_observations: ['Metal jaws and dark handles.'],
  unknowns: ['Working condition'],
  owner_questions: ['Do the jaws open and close?'],
};

function nvidiaResult(content: unknown, promptTokens = 100) {
  return Response.json({
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify(content),
          reasoning_content: 'private-reasoning-fixture',
        },
      },
    ],
    usage: { prompt_tokens: promptTokens, completion_tokens: 50, total_tokens: promptTokens + 50 },
  });
}

beforeEach(() => {
  generate.mockReset();
  ground.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_API_KEY', 'google-unit-fixture');
  vi.stubEnv('GEMINI_MODEL', 'gemini-unit-fixture');
  vi.stubEnv('GEMINI_FALLBACK_MODEL', 'gemini-fallback-fixture');
  vi.stubEnv('NVIDIA_API_KEY', 'nvidia-unit-fixture');
  vi.stubEnv('NVIDIA_MODEL', NVIDIA_MODEL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('consented photo identification fallback', () => {
  it('falls back after Gemini 429, then passes retrieval context through the NIM generator and records provenance', async () => {
    generate.mockRejectedValue({ status: 429, message: 'private-google-error-fixture' });
    fetchMock
      .mockResolvedValueOnce(nvidiaResult({ candidates: [candidate] }))
      .mockResolvedValueOnce(nvidiaResult({ references: [] }, 200));
    ground.mockImplementation(async (candidates, generateGrounding) => {
      const generated = await generateGrounding('Retrieved reference guidance fixture', {
        type: 'object',
      });
      expect(generated.text).toBe('{"references":[]}');
      return {
        candidates,
        status: 'grounded',
        corpusVersion: 'test-corpus-v1',
        retrievalVersion: 'test-retrieval-v1',
        sourceIds: ['hand-tool-inspection'],
        tokenUsage: generated.tokenUsage,
      };
    });
    const result = await identifyPhoto(Buffer.from('image fixture'), 'test-run', true);
    expect(result).toMatchObject({
      candidates: [
        {
          candidate_id: 'test-run:pliers',
          label: 'Hand pliers',
          bounds: { x_min: 200, y_min: 100, x_max: 800, y_max: 700 },
        },
      ],
      model: NVIDIA_MODEL,
      tokenUsage: {
        provider: 'nvidia',
        fallback: { from: 'google', reason: 'provider_unavailable', status: 429 },
        vision: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        grounding: {
          status: 'grounded',
          corpusVersion: 'test-corpus-v1',
          retrievalVersion: 'test-retrieval-v1',
          sourceIds: ['hand-tool-inspection'],
          usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(generate.mock.calls.map(([request]) => request.model)).toEqual([
      'gemini-unit-fixture',
      'gemini-fallback-fixture',
    ]);
    expect(ground).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const groundingPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(groundingPayload.messages[0].content).toHaveLength(1);
    expect(groundingPayload.messages[0].content[0].text).toContain(
      'Retrieved reference guidance fixture',
    );
  });

  it('keeps old Google-only consent from sending the image to NVIDIA', async () => {
    generate.mockRejectedValue({ status: 429 });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', false)).rejects.toMatchObject({
      code: 'provider_unavailable',
      providerStatus: 429,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ground).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('uses the second Gemini model with Google-only consent and reports the transition', async () => {
    generate.mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce({
      text: JSON.stringify({ candidates: [candidate] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { totalTokenCount: 123 },
    });
    const progress = vi.fn().mockResolvedValue(undefined);
    const result = await identifyPhoto(
      Buffer.from('fixture'),
      'test-run',
      false,
      undefined,
      progress,
    );
    expect(result).toMatchObject({
      model: 'gemini-fallback-fixture',
      tokenUsage: {
        provider: 'google',
        fallbacks: [
          { from: 'gemini-unit-fixture', to: 'gemini-fallback-fixture', reason: 'rate_limit' },
        ],
        failures: [{ model: 'gemini-unit-fixture', code: 'provider_unavailable', status: 429 }],
      },
    });
    expect(progress.mock.calls.map(([value]) => value.model)).toEqual([
      'gemini-unit-fixture',
      'gemini-fallback-fixture',
    ]);
    expect(generate.mock.calls[0][0].contents).toEqual(generate.mock.calls[1][0].contents);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ground).not.toHaveBeenCalled();
  });

  it('records both Google failures and reports Kimi vision then references in order', async () => {
    generate.mockRejectedValueOnce({ status: 429 }).mockRejectedValueOnce({ status: 503 });
    fetchMock.mockResolvedValueOnce(nvidiaResult({ candidates: [candidate] }));
    ground.mockImplementation(async (candidates) => ({
      candidates,
      status: 'no_evidence',
      sourceIds: [],
    }));
    const progress = vi.fn().mockResolvedValue(undefined);
    const result = await identifyPhoto(
      Buffer.from('fixture'),
      'test-run',
      true,
      undefined,
      progress,
    );
    const expectedFallbacks = [
      { from: 'gemini-unit-fixture', to: 'gemini-fallback-fixture', reason: 'rate_limit' },
      { from: 'gemini-fallback-fixture', to: NVIDIA_MODEL, reason: 'unavailable' },
    ];
    expect(progress.mock.calls.map(([value]) => [value.model, value.phase])).toEqual([
      ['gemini-unit-fixture', 'identifying'],
      ['gemini-fallback-fixture', 'identifying'],
      [NVIDIA_MODEL, 'identifying'],
      [NVIDIA_MODEL, 'references'],
    ]);
    expect(result.tokenUsage).toMatchObject({
      fallbacks: expectedFallbacks,
      failures: [
        { model: 'gemini-unit-fixture', code: 'provider_unavailable', status: 429 },
        { model: 'gemini-fallback-fixture', code: 'provider_unavailable', status: 503 },
      ],
    });
    expect(progress.mock.calls[3][0].fallbacks).toEqual(expectedFallbacks);
  });

  it.each([401, 403])(
    'does not pass a second Gemini authentication error (%s) to Kimi',
    async (status) => {
      generate.mockRejectedValueOnce({ status: 429 }).mockRejectedValueOnce({ status });
      await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).rejects.toMatchObject({
        code: 'provider_unavailable',
        providerStatus: status,
      });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not pass refused second-Gemini output to Kimi', async () => {
    generate.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({
      text: '{"candidates":[]}',
      candidates: [{ finishReason: 'SAFETY' }],
    });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).rejects.toMatchObject({
      code: 'invalid_output',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never turns a progress persistence failure into another model dispatch', async () => {
    generate.mockRejectedValueOnce({ status: 429 });
    const failure = new AnalysisError('provider_unavailable', 'Progress persistence failed');
    failure.providerStatus = 503;
    const progress = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(
      identifyPhoto(Buffer.from('fixture'), 'test-run', true, undefined, progress),
    ).rejects.toBe(failure);
    expect(generate).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not swallow reference-phase progress failures as successful unavailable grounding', async () => {
    generate.mockRejectedValue({ status: 503 });
    fetchMock.mockResolvedValueOnce(nvidiaResult({ candidates: [candidate] }));
    const failure = new Error('Reference progress persistence failed');
    const progress = vi
      .fn()
      .mockResolvedValue(undefined)
      .mockImplementation(async ({ phase }) => {
        if (phase === 'references') throw failure;
      });
    await expect(
      identifyPhoto(Buffer.from('fixture'), 'test-run', true, undefined, progress),
    ).rejects.toBe(failure);
    expect(ground).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not replace a Gemini authentication error with another provider', async () => {
    generate.mockRejectedValue({ status: 401 });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).rejects.toMatchObject({
      code: 'provider_unavailable',
      providerStatus: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fall back on a refused or invalid Gemini result', async () => {
    generate.mockResolvedValue({ text: 'not JSON', candidates: [{ finishReason: 'STOP' }] });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).rejects.toMatchObject({
      code: 'invalid_output',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns successful Gemini detection without invoking NVIDIA or grounding', async () => {
    generate.mockResolvedValue({
      text: JSON.stringify({ candidates: [candidate] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { totalTokenCount: 123 },
    });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).resolves.toMatchObject({
      candidates: [{ candidate_id: 'test-run:pliers' }],
      model: 'gemini-unit-fixture',
      tokenUsage: { provider: 'google', vision: { totalTokenCount: 123 } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ground).not.toHaveBeenCalled();
  });

  it('preserves the primary failure when the fallback key is absent', async () => {
    vi.stubEnv('NVIDIA_API_KEY', '');
    generate.mockRejectedValue({ status: 429 });
    await expect(identifyPhoto(Buffer.from('fixture'), 'test-run', true)).rejects.toMatchObject({
      code: 'provider_unavailable',
      providerStatus: 429,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires fallback consent before configuring NVIDIA as the available provider', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => getIdentificationConfig(false)).toThrow(AnalysisError);
    expect(getIdentificationConfig(true)).toMatchObject({ model: NVIDIA_MODEL });
  });

  it.each([undefined, 429, 500, 503])(
    'permits transient provider status %s to use the backup',
    (status) => {
      const error = new AnalysisError('provider_unavailable', 'Fixture');
      error.providerStatus = status;
      expect(shouldUseBackup(error)).toBe(true);
    },
  );

  it('never routes unrelated application errors to another AI provider', () => {
    expect(shouldUseBackup(new Error('Fixture'))).toBe(false);
    expect(shouldUseBackup(new AnalysisError('invalid_output', 'Fixture'))).toBe(false);
  });
});
