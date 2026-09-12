import 'server-only';
import { AnalysisError } from './analysis-error';
import { getGeminiConfig, identifyItems } from './gemini';
import {
  generateNvidiaJson,
  getNvidiaConfig,
  identifyItemsWithNvidia,
  NVIDIA_VISION_DEADLINE_MS,
} from './nvidia';
import { groundCandidateReferences } from './reference-grounding';

// One admission reservation covers primary vision, fallback vision, and its
// optional reference pass. Leave time for persistence before the route expires.
export const IDENTIFICATION_DEADLINE_MS = 165_000;

export function getIdentificationConfig(allowNvidia: boolean) {
  try {
    return getGeminiConfig();
  } catch (error) {
    if (!allowNvidia) throw error;
    return getNvidiaConfig();
  }
}

export function shouldUseBackup(error: unknown): boolean {
  if (!(error instanceof AnalysisError)) return false;
  return (
    error.code === 'timeout' ||
    error.code === 'not_configured' ||
    (error.code === 'provider_unavailable' &&
      (error.providerStatus === undefined ||
        error.providerStatus === 429 ||
        error.providerStatus >= 500))
  );
}

export async function identifyPhoto(bytes: Buffer, runId: string, allowNvidia: boolean) {
  const deadline = Date.now() + IDENTIFICATION_DEADLINE_MS;
  let primaryFailure: AnalysisError;
  try {
    const result = await identifyItems(bytes, runId);
    return { ...result, tokenUsage: { provider: 'google', vision: result.tokenUsage } };
  } catch (error) {
    // Do not send an image to another provider on an old Google-only consent,
    // a refused/invalid result, or a provider authentication error.
    if (!allowNvidia || !shouldUseBackup(error) || !process.env.NVIDIA_API_KEY) throw error;
    primaryFailure = error as AnalysisError;
  }
  const result = await identifyItemsWithNvidia(
    bytes,
    runId,
    Math.min(NVIDIA_VISION_DEADLINE_MS, deadline - Date.now()),
  );
  const grounding = await groundCandidateReferences(result.candidates, (prompt, schema) => {
    const remaining = Math.min(45_000, deadline - Date.now());
    if (remaining <= 0) throw new AnalysisError('timeout', 'Reference lookup took too long.');
    return generateNvidiaJson(prompt, schema, { timeoutMs: remaining });
  });
  return {
    ...result,
    candidates: grounding.candidates,
    tokenUsage: {
      provider: 'nvidia',
      fallback: {
        from: 'google',
        reason: primaryFailure.code,
        status: primaryFailure.providerStatus ?? null,
      },
      vision: result.tokenUsage,
      grounding: {
        status: grounding.status,
        corpusVersion: grounding.corpusVersion,
        retrievalVersion: grounding.retrievalVersion,
        sourceIds: grounding.sourceIds,
        usage: grounding.tokenUsage ?? {},
      },
    },
  };
}
