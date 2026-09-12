import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { generateNvidiaJson, identifyItemsWithNvidia, NVIDIA_MODEL } from '../src/lib/ai/nvidia';

const fetchMock = vi.fn<typeof fetch>();
const requestId = '04a4bea2-5766-4509-9c79-6790549e46c5';
const candidate = {
  candidate_key: 'pliers',
  label: 'Hand pliers',
  category: 'tools',
  box_2d: [100, 200, 700, 800],
  visible_observations: ['Metal jaws and dark handles.'],
  unknowns: ['Working condition'],
  owner_questions: ['Do the jaws open and close?'],
};

function completion(content = JSON.stringify({ candidates: [candidate] }), finishReason = 'stop') {
  return {
    model: NVIDIA_MODEL,
    choices: [
      {
        finish_reason: finishReason,
        message: { content, reasoning_content: 'private-reasoning-fixture' },
      },
    ],
    usage: {
      prompt_tokens: 123,
      completion_tokens: 321,
      total_tokens: 444,
      private_provider_metadata: 'private-usage-fixture',
    },
    private_provider_metadata: 'private-response-fixture',
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NVIDIA_API_KEY', ' unit-test-placeholder ');
  vi.stubEnv('NVIDIA_MODEL', NVIDIA_MODEL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NVIDIA K3 vision adapter', () => {
  it('sends the normalized image to the fixed K3 endpoint and retains only validated fields', async () => {
    fetchMock.mockResolvedValue(Response.json(completion()));
    const result = await identifyItemsWithNvidia(Buffer.from('image fixture'), 'test-run');
    expect(result).toMatchObject({
      candidates: [
        {
          candidate_id: 'test-run:pliers',
          bounds: { x_min: 200, y_min: 100, x_max: 800, y_max: 700 },
          review_status: 'pending',
        },
      ],
      model: NVIDIA_MODEL,
      tokenUsage: { prompt_tokens: 123, completion_tokens: 321, total_tokens: 444 },
    });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(request).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer unit-test-placeholder' },
    });
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      model: NVIDIA_MODEL,
      stream: false,
      reasoning_effort: 'low',
      temperature: 1,
    });
    expect(payload.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${Buffer.from('image fixture').toString('base64')}`,
      },
    });
    expect(payload.messages[0].content[0].text).toContain('box_2d');
    expect(payload.tools).toBeUndefined();
  });

  it.each([401, 429, 503])(
    'returns safe status %i without reading or returning the provider error body',
    async (status) => {
      const response = new Response('private-error-body-fixture', { status });
      const bodyReader = vi.spyOn(response, 'text');
      fetchMock.mockResolvedValue(response);
      const error = await identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run').catch(
        (failure: unknown) => failure,
      );
      expect(error).toMatchObject({ code: 'provider_unavailable', providerStatus: status });
      expect(String(error)).not.toContain('private-error');
      expect(bodyReader).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('does not expose network error details', async () => {
    fetchMock.mockRejectedValue(new Error('private-network-error-fixture'));
    const error = await generateNvidiaJson('Prompt', {}).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'provider_unavailable' });
    expect(String(error)).not.toContain('private-network');
  });

  it('aborts an in-flight call at its deadline without retrying inference', async () => {
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted-private-fixture')),
            { once: true },
          );
        }),
    );
    await expect(generateNvidiaJson('Prompt', {}, { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    completion('not JSON'),
    completion(JSON.stringify({ candidates: [candidate] }), 'length'),
    { choices: [] },
    { choices: [{ finish_reason: 'stop', message: { content: null } }] },
    completion(JSON.stringify({ candidates: [{ ...candidate, category: 'unsupported' }] })),
  ])('rejects malformed or incomplete final content', async (response) => {
    fetchMock.mockResolvedValue(Response.json(response));
    await expect(identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject(
      { code: 'invalid_output' },
    );
  });

  it('classifies malformed response envelopes as invalid output without retaining the body', async () => {
    fetchMock.mockResolvedValue(new Response('private-malformed-envelope-fixture'));
    const error = await identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run').catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ code: 'invalid_output' });
    expect(String(error)).not.toContain('private-malformed');
  });

  it('accepts a single JSON code fence without extracting JSON from unrelated prose', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(completion('```json\n{"candidates":[]}\n```')));
    await expect(
      identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run'),
    ).resolves.toMatchObject({ candidates: [] });
    fetchMock.mockResolvedValueOnce(
      Response.json(completion('Here is my result: {"candidates":[]}')),
    );
    await expect(identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject(
      { code: 'invalid_output' },
    );
  });

  it('polls the same accepted request without resubmitting the image or following arbitrary URLs', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ requestId, url: 'https://untrusted.invalid/poll' }, { status: 202 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            requestId: 'e066e1e4-6aa5-4a30-91a2-15d57f057142',
            url: 'https://untrusted.invalid/retry',
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(Response.json(completion()));
    await expect(
      identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run'),
    ).resolves.toMatchObject({ model: NVIDIA_MODEL });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://integrate.api.nvidia.com/v1/chat/completions',
      `https://integrate.api.nvidia.com/v1/status/${requestId}`,
      `https://integrate.api.nvidia.com/v1/status/${requestId}`,
    ]);
    expect(fetchMock.mock.calls.slice(1).every(([, request]) => request?.body === undefined)).toBe(
      true,
    );
  });

  it('accepts the NVIDIA request-id header and rejects malformed polling identifiers', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'nvcf-reqid': requestId } }),
      )
      .mockResolvedValueOnce(Response.json(completion()));
    await expect(
      identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run'),
    ).resolves.toMatchObject({ model: NVIDIA_MODEL });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ requestId: '../../private-fixture' }, { status: 202 }),
      );
    await expect(identifyItemsWithNvidia(Buffer.from('fixture'), 'test-run')).rejects.toMatchObject(
      { code: 'provider_unavailable' },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts while polling without submitting a second inference', async () => {
    fetchMock.mockResolvedValue(Response.json({ requestId }, { status: 202 }));
    await expect(generateNvidiaJson('Prompt', {}, { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['', NVIDIA_MODEL],
    ['fixture', 'moonshotai/kimi-k2.5'],
  ])('fails closed for missing keys or another model', async (key, model) => {
    vi.stubEnv('NVIDIA_API_KEY', key);
    vi.stubEnv('NVIDIA_MODEL', model);
    await expect(generateNvidiaJson('Prompt', {})).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
