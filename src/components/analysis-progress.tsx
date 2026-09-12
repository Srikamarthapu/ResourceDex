import Link from 'next/link';
import { Clock3, RefreshCw, Square } from 'lucide-react';
import type { AnalysisState } from '@/lib/scan-analysis';

const modelLabels: Record<string, string> = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'moonshotai/kimi-k3': 'Kimi K3',
};
const fallbackReasons = {
  rate_limit: 'hit a rate limit',
  timeout: 'timed out',
  unavailable: 'was unavailable',
  not_configured: 'was not configured',
};
const modelLabel = (model: string) => modelLabels[model] || model;

export function AnalysisProgress({
  state,
  elapsedSeconds,
  onStop,
  onCheck,
}: {
  state: AnalysisState;
  elapsedSeconds: number;
  onStop: () => void;
  onCheck: () => void;
}) {
  if (!state.active && !state.message && !state.progress) return null;
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const progress = state.progress;
  const model = progress ? modelLabel(progress.model) : null;
  const modelStatus = model
    ? state.active
      ? state.phase === 'stopping'
        ? `Stopping identification with ${model}`
        : progress?.phase === 'references'
          ? `${model} is checking references`
          : `Using ${model}`
      : state.outcome === 'completed'
        ? `Identification finished with ${model}`
        : state.outcome === 'stopped'
          ? `Stopped while using ${model}`
          : `Last model used: ${model}`
    : 'Starting…';
  return (
    <section className="analysis-progress" aria-label="Identification progress">
      <div>
        <h2>
          {state.active
            ? state.otherPhoto
              ? 'Another photo is being identified'
              : progress?.phase === 'references'
                ? 'Checking reuse references'
                : 'Identifying your photo'
            : 'Identification update'}
        </h2>
        {(state.active || progress) && (
          <p className="analysis-model" role="status">
            {modelStatus}
          </p>
        )}
        <p role="status">
          {state.message ||
            (!state.active
              ? state.outcome === 'completed'
                ? 'Review the suggested items before continuing.'
                : 'Your photo and saved review are unchanged. You can try again or add details yourself.'
              : state.otherPhoto
                ? 'Your current photo is saved here. Wait for the other photo, or stop its identification to continue.'
                : !state.confirmed
                  ? 'Starting identification. Your photo is saved privately. Stop becomes available as soon as the saved attempt starts.'
                  : 'Your photo is saved privately. Backup identification and reference checks can take up to about 3 minutes.')}
        </p>
        {progress && progress.fallbacks.length > 0 && (
          <ol className="analysis-fallbacks" aria-label="Model fallback history">
            {progress.fallbacks.slice(0, 2).map((fallback, index) => (
              <li key={`${fallback.from}:${fallback.to}:${index}`}>
                {modelLabel(fallback.from)} {fallbackReasons[fallback.reason]} → switched to{' '}
                {modelLabel(fallback.to)}.
              </li>
            ))}
          </ol>
        )}
        {state.active && (
          <p className="analysis-elapsed">
            <Clock3 size={14} aria-hidden="true" />
            <span aria-live="off">{elapsed} elapsed</span> · You can leave and return to this saved
            photo.
          </p>
        )}
      </div>
      <div className="share-buttons">
        {state.active && (
          <>
            <button
              className="button"
              onClick={onStop}
              disabled={
                state.phase === 'stopping' || !state.confirmed || !state.active.operationKey
              }
            >
              <Square size={13} />
              {state.phase === 'stopping' ? 'Stopping…' : 'Stop identification'}
            </button>
            <button
              className="button"
              onClick={onCheck}
              disabled={state.checking || state.phase === 'stopping'}
            >
              <RefreshCw size={14} />
              {state.checking ? 'Checking…' : 'Check status'}
            </button>
          </>
        )}
        {state.resultScanId && (
          <Link
            className="button"
            href={`/share?scan=${state.resultScanId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open result in new tab
          </Link>
        )}
      </div>
    </section>
  );
}
