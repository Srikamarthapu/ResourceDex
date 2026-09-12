import { ScanRequestError, type ActiveAnalysis, type ScanPreview } from './scan-client';

export interface AnalysisState {
  active: ActiveAnalysis | null;
  phase: 'idle' | 'running' | 'uncertain' | 'stopping';
  checking: boolean;
  confirmed: boolean;
  otherPhoto: boolean;
  message: string;
  resultScanId: string | null;
}

interface AnalysisTransport {
  analyze: (scan: ScanPreview, key: string, signal: AbortSignal) => Promise<ScanPreview>;
  get: (id: string, signal: AbortSignal) => Promise<ScanPreview>;
  cancel: (
    id: string,
    key: string,
    signal: AbortSignal,
  ) => Promise<ScanPreview & { cancelled: boolean }>;
}

const idleState = (): AnalysisState => ({
  active: null,
  phase: 'idle',
  checking: false,
  confirmed: false,
  otherPhoto: false,
  message: '',
  resultScanId: null,
});

/** Coordinates one server-owned attempt; aborting a browser request never implies cancellation. */
export class ScanAnalysisController {
  private state = idleState();
  private listeners = new Set<() => void>();
  private generation = 0;
  private source: ScanPreview | null = null;
  private post: AbortController | null = null;
  private statusRequest: AbortController | null = null;
  private cancelRequest: AbortController | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private observedRunning = false;
  private failureMessage = '';

  constructor(
    private transport: AnalysisTransport,
    private onSettled: (scan: ScanPreview) => void,
    private pollMs = 4_000,
  ) {}

  setOnSettled = (callback: (scan: ScanPreview) => void) => {
    this.onSettled = callback;
  };

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<AnalysisState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private invalidate() {
    this.generation++;
    this.post?.abort();
    this.statusRequest?.abort();
    this.cancelRequest?.abort();
    this.post = this.statusRequest = this.cancelRequest = null;
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
  reset = () => {
    this.invalidate();
    this.source = null;
    this.observedRunning = false;
    this.failureMessage = '';
    this.state = idleState();
    this.listeners.forEach((listener) => listener());
  };
  private schedule() {
    if (this.poll) clearTimeout(this.poll);
    if (this.state.active && this.state.phase !== 'stopping')
      this.poll = setTimeout(() => {
        this.poll = null;
        void this.check();
      }, this.pollMs);
  }
  private adopt(active: ActiveAnalysis, confirmed = true) {
    this.invalidate();
    this.update({
      active,
      phase: 'running',
      checking: false,
      confirmed,
      otherPhoto: active.scanId !== this.source?.scanId,
      message: '',
      resultScanId: null,
    });
    this.schedule();
  }
  restore = (scan: ScanPreview) => {
    this.reset();
    this.source = scan;
    if (scan.status === 'analyzing') {
      this.observedRunning = true;
      this.adopt({
        scanId: scan.scanId,
        operationKey: scan.analysisOperationKey || '',
        startedAt: scan.analysisStartedAt || null,
        deadlineAt: scan.analysisDeadlineAt || null,
      });
      void this.check();
    }
  };
  start = (scan: ScanPreview, operationKey: string) => {
    if (this.state.active) return false;
    if (scan.status === 'analyzing') {
      this.restore(scan);
      return false;
    }
    this.source = scan;
    this.observedRunning = false;
    this.failureMessage = '';
    this.adopt(
      {
        scanId: scan.scanId,
        operationKey,
        startedAt: new Date().toISOString(),
        deadlineAt: null,
      },
      false,
    );
    const generation = this.generation;
    const controller = (this.post = new AbortController());
    void this.transport.analyze(scan, operationKey, controller.signal).then(
      (result) => {
        if (generation !== this.generation) return;
        this.post = null;
        this.receive({ ...scan, ...result });
      },
      (failure: unknown) => {
        if (generation !== this.generation) return;
        this.post = null;
        if (failure instanceof ScanRequestError && failure.activeAnalysis) {
          this.observedRunning = true;
          this.adopt(failure.activeAnalysis);
        } else {
          if (failure instanceof ScanRequestError) this.failureMessage = failure.message;
          this.update({
            phase: 'uncertain',
            message: 'Checking whether identification finished. Your photo is saved privately.',
          });
        }
        void this.check();
      },
    );
    void this.check();
    return true;
  };
  private receive(scan: ScanPreview, cancelled = false) {
    const active = this.state.active;
    if (!active || scan.scanId !== active.scanId) return;
    if (scan.status === 'analyzing') {
      this.observedRunning = true;
      const next: ActiveAnalysis = {
        scanId: scan.scanId,
        operationKey: scan.analysisOperationKey || active.operationKey,
        startedAt: scan.analysisStartedAt || active.startedAt,
        deadlineAt: scan.analysisDeadlineAt || active.deadlineAt,
      };
      if (next.operationKey !== active.operationKey) this.adopt(next);
      else {
        this.update({ active: next, confirmed: true, phase: 'running', message: '' });
        this.schedule();
      }
      return;
    }
    // A status poll can reach the server before the POST claims the attempt.
    if (
      this.post &&
      !this.observedRunning &&
      scan.analysisVersion <= (this.source?.analysisVersion || 0)
    ) {
      this.schedule();
      return;
    }
    // Only a fresh server terminal state unlocks retry/manual; uncertain requests keep their key.
    if (!['completed', 'failed', 'ready', 'reviewed'].includes(scan.status)) {
      this.update({ phase: 'uncertain', message: 'Checking the saved photo’s status.' });
      this.schedule();
      return;
    }
    const otherPhoto = scan.scanId !== this.source?.scanId;
    this.invalidate();
    this.update({
      active: null,
      phase: 'idle',
      checking: false,
      confirmed: false,
      message: cancelled
        ? 'Identification stopped. Your photo and saved review are unchanged.'
        : otherPhoto
          ? scan.status === 'completed'
            ? 'The other photo is ready to review. You can also identify this photo now.'
            : 'The other identification ended. You can identify this photo or add details yourself.'
          : scan.error ||
            (scan.status === 'completed' &&
            scan.analysisVersion > (this.source?.analysisVersion || 0)
              ? ''
              : this.failureMessage),
      resultScanId: otherPhoto && scan.status === 'completed' ? scan.scanId : null,
    });
    if (!otherPhoto) this.onSettled(scan);
  }
  check = async () => {
    const active = this.state.active;
    if (!active || this.statusRequest || this.state.phase === 'stopping') return;
    const generation = this.generation;
    const controller = (this.statusRequest = new AbortController());
    this.update({ checking: true });
    try {
      const result = await this.transport.get(active.scanId, controller.signal);
      if (generation === this.generation) this.receive(result);
    } catch {
      if (generation === this.generation)
        this.update({
          phase: 'uncertain',
          message:
            'Unable to check right now. Your photo is saved. We’ll keep checking when the connection returns.',
        });
    } finally {
      if (generation === this.generation) {
        this.statusRequest = null;
        this.update({ checking: false });
        this.schedule();
      }
    }
  };
  stop = async () => {
    const active = this.state.active;
    if (!active?.operationKey || !this.state.confirmed || this.state.phase === 'stopping') return;
    // Invalidate the old POST before stopping, so its late completion cannot win the UI race.
    this.invalidate();
    const generation = this.generation;
    const controller = (this.cancelRequest = new AbortController());
    this.update({ phase: 'stopping', checking: false, message: 'Stopping identification…' });
    try {
      const result = await this.transport.cancel(
        active.scanId,
        active.operationKey,
        controller.signal,
      );
      if (generation === this.generation) this.receive(result, result.cancelled);
    } catch {
      if (generation === this.generation) {
        this.update({
          phase: 'uncertain',
          message: 'Stop has not been confirmed yet. Checking the saved attempt.',
        });
        void this.check();
      }
    } finally {
      if (generation === this.generation) {
        this.cancelRequest = null;
        this.schedule();
      }
    }
  };
}
