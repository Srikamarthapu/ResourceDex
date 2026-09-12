import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { detectionJsonSchema, detectionPrompt, parseDetections } from './detection';

export const DETECTION_DEADLINE_MS = 30_000;

export class AnalysisError extends Error {
  providerStatus?: number;
  constructor(
    public readonly code: 'not_configured' | 'timeout' | 'provider_unavailable' | 'invalid_output',
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new AnalysisError(
      'not_configured',
      'Photo identification is not configured yet. You can still add items yourself.',
    );
  }
  return { apiKey, model };
}

export async function identifyItems(bytes: Buffer, runId: string) {
  const { apiKey, model } = getGeminiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECTION_DEADLINE_MS);
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: bytes.toString('base64'),
                mimeType: 'image/jpeg',
              },
            },
            { text: detectionPrompt },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: detectionJsonSchema,
        temperature: 0.2,
        maxOutputTokens: 6000,
        abortSignal: controller.signal,
        httpOptions: {
          timeout: DETECTION_DEADLINE_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });
    if (controller.signal.aborted)
      throw new AnalysisError(
        'timeout',
        'Identification took too long. Retry or add the items yourself.',
      );
    if (!response.text || response.candidates?.[0]?.finishReason !== 'STOP') {
      throw new AnalysisError(
        'invalid_output',
        "We couldn't identify these items. Retry or add them yourself.",
      );
    }
    try {
      return {
        ...parseDetections(response.text, runId),
        model,
        tokenUsage: response.usageMetadata ?? {},
      };
    } catch {
      throw new AnalysisError(
        'invalid_output',
        "We couldn't identify these items. Retry or add them yourself.",
      );
    }
  } catch (error) {
    if (error instanceof AnalysisError) throw error;
    if (controller.signal.aborted)
      throw new AnalysisError(
        'timeout',
        'Identification took too long. Retry or add the items yourself.',
      );
    const failure = new AnalysisError(
      'provider_unavailable',
      'Identification is unavailable right now. Retry or add the items yourself.',
    );
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number')
      failure.providerStatus = error.status;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
