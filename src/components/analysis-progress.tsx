import Link from 'next/link';
import { Clock3, RefreshCw, Square } from 'lucide-react';
import type { AnalysisState } from '@/lib/scan-analysis';

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
  if (!state.active && !state.message) return null;
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  return (
    <section className="analysis-progress" aria-label="Identification progress">
      <div>
        <h2>
          {state.active
            ? state.otherPhoto
              ? 'Another photo is being identified'
              : 'Identifying your photo'
            : 'Identification update'}
        </h2>
        <p role="status">
          {state.message ||
            (state.otherPhoto
              ? 'Your current photo is saved here. Wait for the other photo, or stop its identification to continue.'
              : !state.confirmed
                ? 'Starting identification. Your photo is saved privately. Stop becomes available as soon as the saved attempt starts.'
                : 'Your photo is saved privately. Backup identification and reference checks can take up to about 3 minutes.')}
        </p>
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
