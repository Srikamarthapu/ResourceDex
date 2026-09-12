import 'server-only';
import { AnalysisError, throwIfAnalysisCancelled } from './analysis-error';
import { DETECTION_DEADLINE_MS, getGeminiConfig, getGeminiModels, identifyItems } from './gemini';
import type { AnalysisProgress } from './analysis-progress';
import {
  generateNvidiaJson,
  getNvidiaConfig,
  identifyItemsWithNvidia,
  NVIDIA_VISION_DEADLINE_MS,
} from './nvidia';
import { groundCandidateReferences } from './reference-grounding';

// One admission reservation covers the bounded vision chain and its
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

export async function identifyPhoto(
  bytes: Buffer,
  runId: string,
  allowNvidia: boolean,
  signal?: AbortSignal,
  onProgress?: (progress: AnalysisProgress) => Promise<void>,
) {
  throwIfAnalysisCancelled(signal);
  const deadline = Date.now() + IDENTIFICATION_DEADLINE_MS;
  const fallbacks: AnalysisProgress['fallbacks'] = [];
  const failures: { model: string; code: AnalysisError['code']; status: number | null }[] = [];
  let lastFailure: AnalysisError | undefined;
  let lastModel: string | undefined;

  function remainingTime(maximum: number) {
    const remaining = Math.min(maximum, deadline - Date.now());
    if (remaining <= 0)
      throw new AnalysisError(
        'timeout',
        'Identification took too long. Retry or add items yourself.',
      );
    return remaining;
  }
  function transition(model: string) {
    if (!lastFailure || !lastModel) return;
    fallbacks.push({
      from: lastModel,
      to: model,
      reason:
        lastFailure.providerStatus === 429
          ? 'rate_limit'
          : lastFailure.code === 'timeout' || lastFailure.code === 'not_configured'
            ? lastFailure.code
            : 'unavailable',
    });
  }
  function recordFailure(model: string, error: unknown) {
    throwIfAnalysisCancelled(signal);
    // Authentication failures and refused/invalid output stop the whole chain.
    if (!shouldUseBackup(error)) throw error;
    lastFailure = error as AnalysisError;
    lastModel = model;
    failures.push({ model, code: lastFailure.code, status: lastFailure.providerStatus ?? null });
  }
  async function progress(model: string, phase: AnalysisProgress['phase']) {
    throwIfAnalysisCancelled(signal);
    await onProgress?.({ model, phase, fallbacks: [...fallbacks] });
    throwIfAnalysisCancelled(signal);
  }

  for (const model of getGeminiModels()) {
    transition(model);
    try {
      getGeminiConfig(model);
    } catch (error) {
      recordFailure(model, error);
      continue;
    }
    // Status persistence is outside the provider catch. Its failure must never
    // be interpreted as permission to dispatch another model.
    await progress(model, 'identifying');
    const timeoutMs = remainingTime(DETECTION_DEADLINE_MS);
    try {
      const result = await identifyItems(bytes, runId, signal, model, timeoutMs);
      throwIfAnalysisCancelled(signal);
      return {
        ...result,
        tokenUsage: { provider: 'google', vision: result.tokenUsage, fallbacks, failures },
      };
    } catch (error) {
      recordFailure(model, error);
    }
  }
  // Both Gemini models stay within the original Google consent. NVIDIA remains
  // conditional on the explicit cross-provider photo consent and a configured key.
  if (!allowNvidia || !process.env.NVIDIA_API_KEY) throw lastFailure;
  const { model: nvidiaModel } = getNvidiaConfig();
  transition(nvidiaModel);
  await progress(nvidiaModel, 'identifying');
  const result = await identifyItemsWithNvidia(
    bytes,
    runId,
    remainingTime(NVIDIA_VISION_DEADLINE_MS),
    signal,
  );
  throwIfAnalysisCancelled(signal);
  await progress(nvidiaModel, 'references');
  const grounding = await groundCandidateReferences(result.candidates, (prompt, schema) => {
    return generateNvidiaJson(prompt, schema, { timeoutMs: remainingTime(45_000), signal });
  });
  throwIfAnalysisCancelled(signal);
  return {
    ...result,
    candidates: grounding.candidates,
    tokenUsage: {
      provider: 'nvidia',
      fallback: {
        from: 'google',
        reason: lastFailure?.code,
        status: lastFailure?.providerStatus ?? null,
      },
      fallbacks,
      failures,
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
