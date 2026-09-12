import 'server-only';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AnalysisError } from './analysis-error';
import { detectionJsonSchema, detectionPrompt, parseDetections } from './detection';

const apiOrigin = 'https://integrate.api.nvidia.com';
export const NVIDIA_MODEL = 'moonshotai/kimi-k3';
export const NVIDIA_VISION_DEADLINE_MS = 120_000;

export function getNvidiaConfig() {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const model = process.env.NVIDIA_MODEL || NVIDIA_MODEL;
  if (!apiKey || model !== NVIDIA_MODEL)
    throw new AnalysisError('not_configured', 'The backup identifier is not configured.');
  return { apiKey, model };
}

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      completion_tokens: z.number().nonnegative().optional(),
      total_tokens: z.number().nonnegative().optional(),
    })
    .optional(),
});

/** Strip only a single JSON code fence; never extract a guessed object from prose. */
export function jsonAnswer(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
    .trim();
}

/** K3's documented API has no enforced JSON-schema mode. The final content is
 * validated by the caller; reasoning_content is neither used nor persisted. */
export async function generateNvidiaJson(
  prompt: string,
  jsonSchema: unknown,
  { image, timeoutMs = NVIDIA_VISION_DEADLINE_MS }: { image?: Buffer; timeoutMs?: number } = {},
) {
  const { apiKey, model } = getNvidiaConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  try {
    let response = await fetch(`${apiOrigin}/v1/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        reasoning_effort: 'low',
        temperature: 1,
        max_tokens: image ? 12_000 : 4_000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${prompt}\nReturn one JSON object matching this schema, without markdown:\n${JSON.stringify(jsonSchema)}`,
              },
              ...(image
                ? [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
    });
    // Some hosted NIM requests finish asynchronously. Poll the same request;
    // never resubmit an inference or follow a provider-supplied arbitrary URL.
    let requestId: string | null = null;
    while (response.status === 202) {
      const pending = await response.json().catch(() => ({}));
      requestId ||= response.headers.get('nvcf-reqid') || pending.requestId;
      if (!z.string().uuid().safeParse(requestId).success)
        throw new AnalysisError(
          'provider_unavailable',
          'The backup identifier could not finish. Try again.',
        );
      await delay(1000, undefined, { signal: controller.signal });
      response = await fetch(`${apiOrigin}/v1/status/${requestId}`, {
        headers,
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      const failure = new AnalysisError(
        'provider_unavailable',
        'Both identifiers are unavailable right now. Try again or add items yourself.',
      );
      failure.providerStatus = response.status;
      throw failure;
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 500_000)
      throw new AnalysisError(
        'invalid_output',
        'The backup identifier returned an incomplete result. Try again or add items yourself.',
      );
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AnalysisError(
        'invalid_output',
        'The backup identifier returned an incomplete result. Try again or add items yourself.',
      );
    }
    const parsed = completionSchema.safeParse(payload);
    if (
      !parsed.success ||
      parsed.data.choices[0].finish_reason !== 'stop' ||
      !parsed.data.choices[0].message.content
    )
      throw new AnalysisError(
        'invalid_output',
        'The backup identifier returned an incomplete result. Try again or add items yourself.',
      );
    return {
      text: jsonAnswer(parsed.data.choices[0].message.content),
      model,
      tokenUsage: parsed.data.usage ?? {},
    };
  } catch (error) {
    if (error instanceof AnalysisError) throw error;
    if (controller.signal.aborted)
      throw new AnalysisError(
        'timeout',
        'The backup identifier took too long. Retry or add items yourself.',
      );
    throw new AnalysisError(
      'provider_unavailable',
      'The backup identifier is unavailable. Retry or add items yourself.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function identifyItemsWithNvidia(bytes: Buffer, runId: string, timeoutMs?: number) {
  const result = await generateNvidiaJson(detectionPrompt, detectionJsonSchema, {
    image: bytes,
    timeoutMs,
  });
  try {
    return {
      ...parseDetections(result.text, runId),
      model: result.model,
      tokenUsage: result.tokenUsage,
    };
  } catch {
    throw new AnalysisError(
      'invalid_output',
      'The backup identifier returned an incomplete result. Retry or add items yourself.',
    );
  }
}
