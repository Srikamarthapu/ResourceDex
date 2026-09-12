import 'server-only';
import { AnalysisError, throwIfAnalysisCancelled } from './analysis-error';

/** Observe the durable operation, so Stop also reaches workers on other instances.
 * A browser disconnect is deliberately not cancellation: its result remains recoverable.
 */
export async function runWhileAnalysisActive<T>(
  isActive: (signal: AbortSignal) => Promise<boolean>,
  run: (signal: AbortSignal) => Promise<T>,
  { pollIntervalMs = 2_500 }: { pollIntervalMs?: number } = {},
): Promise<T> {
  const provider = new AbortController();
  const polling = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    try {
      if (!(await isActive(polling.signal))) {
        provider.abort(
          new AnalysisError(
            'cancelled',
            'Identification stopped. You can retry or add items yourself.',
          ),
        );
      }
    } catch {
      if (!polling.signal.aborted) {
        provider.abort(
          new AnalysisError(
            'provider_unavailable',
            'Identification status could not be verified. Check its status before trying again.',
          ),
        );
      }
    }
  }
  async function poll() {
    await check();
    if (!provider.signal.aborted && !polling.signal.aborted)
      timer = setTimeout(poll, pollIntervalMs);
  }
  try {
    await check();
    throwIfAnalysisCancelled(provider.signal);
    timer = setTimeout(poll, pollIntervalMs);
    const result = await run(provider.signal);
    throwIfAnalysisCancelled(provider.signal);
    return result;
  } finally {
    clearTimeout(timer);
    polling.abort();
  }
}
