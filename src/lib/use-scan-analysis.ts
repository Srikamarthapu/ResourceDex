'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { analyzeScan, cancelScanAnalysis, getScan, type ScanPreview } from './scan-client';
import { ScanAnalysisController } from './scan-analysis';

export function useScanAnalysis(onSettled: (scan: ScanPreview) => void) {
  const [controller] = useState(
    () =>
      new ScanAnalysisController(
        {
          analyze: analyzeScan,
          get: getScan,
          cancel: cancelScanAnalysis,
        },
        onSettled,
      ),
  );
  useEffect(() => controller.setOnSettled(onSettled), [controller, onSettled]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const activeKey = state.active?.operationKey;
  const hasActive = Boolean(state.active);
  useEffect(() => () => controller.reset(), [controller]);
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [activeKey, hasActive]);
  const started = state.active?.startedAt ? Date.parse(state.active.startedAt) : now;
  return {
    ...state,
    elapsedSeconds: Math.max(0, Math.floor((now - started) / 1_000)),
    start: controller.start,
    restore: controller.restore,
    stop: controller.stop,
    check: controller.check,
    reset: controller.reset,
    isActive: () => Boolean(controller.getSnapshot().active),
  };
}
