export class AnalysisError extends Error {
  providerStatus?: number;
  constructor(
    public readonly code:
      | 'not_configured'
      | 'timeout'
      | 'provider_unavailable'
      | 'invalid_output'
      | 'cancelled',
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

/** Cancellation is terminal for this attempt and must never trigger a fallback. */
export function throwIfAnalysisCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof AnalysisError) throw signal.reason;
  throw new AnalysisError(
    'cancelled',
    'Identification stopped. You can retry or add items yourself.',
  );
}
