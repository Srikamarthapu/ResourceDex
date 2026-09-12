'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectionCandidate } from './ai/detection';
import { createSaveQueue } from './data/save-queue';
import { errorMessage } from './format';
import { saveScanReview, type ScanPreview } from './scan-client';

export type ReviewCandidate = DetectionCandidate & { selected: boolean };

/** Persist owner corrections separately from the original model response. */
export function useScanReview() {
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'failed'>('saved');
  const [error, setError] = useState('');
  const latest = useRef<ReviewCandidate[]>([]);
  const stored = useRef('[]');
  const context = useRef<{ scanId: string; analysisVersion: number; reviewVersion: number } | null>(
    null,
  );
  const queue = useRef(createSaveQueue());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restore = useCallback((scan: ScanPreview | null) => {
    const rows = (scan?.candidates ?? [])
      .filter((item) => item.review_status !== 'removed')
      .map((item) => ({ ...item, selected: item.selected ?? true }));
    context.current = scan
      ? {
          scanId: scan.scanId,
          analysisVersion: scan.analysisVersion,
          reviewVersion: scan.reviewVersion ?? 0,
        }
      : null;
    latest.current = rows;
    stored.current = JSON.stringify(rows);
    setCandidates(rows);
    setStatus('saved');
    setError('');
  }, []);

  const change = useCallback((update: (rows: ReviewCandidate[]) => ReviewCandidate[]) => {
    latest.current = update(latest.current);
    setCandidates(latest.current);
    setStatus('unsaved');
    setError('');
  }, []);

  const save = useCallback(() => {
    const target = context.current;
    return queue.current.run(async (): Promise<ReviewCandidate[]> => {
      try {
        if (!mounted.current || context.current !== target)
          throw new Error('This item review is no longer active.');
        if (!target) return latest.current;
        while (JSON.stringify(latest.current) !== stored.current) {
          if (!mounted.current || context.current !== target)
            throw new Error('This item review is no longer active.');
          const snapshot = latest.current;
          const serialized = JSON.stringify(snapshot);
          setStatus('saving');
          const saved = await saveScanReview(target, snapshot);
          if (!mounted.current || context.current !== target)
            throw new Error('This item review is no longer active.');
          target.reviewVersion = saved.reviewVersion;
          stored.current = serialized;
        }
        setStatus('saved');
        setError('');
        // Callers must use this saved snapshot, not an earlier React render.
        return latest.current;
      } catch (failure) {
        if (mounted.current && context.current === target) {
          setStatus('failed');
          setError(errorMessage(failure));
        }
        throw failure;
      }
    });
  }, []);

  useEffect(() => {
    if (status !== 'unsaved') return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [candidates, status, save]);

  useEffect(() => {
    const dirty = () => JSON.stringify(latest.current) !== stored.current;
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const leave = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a');
      if (!link || link.target === '_blank' || !dirty()) return;
      if (
        !window.confirm(
          'Your item corrections are not saved yet. Leave and discard them? Choose Cancel to stay and retry saving.',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', leave, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', leave, true);
    };
  }, []);

  return { candidates, change, restore, save, status, error };
}
