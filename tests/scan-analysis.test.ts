import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanAnalysisController } from '../src/lib/scan-analysis';
import { ScanRequestError, type ScanPreview } from '../src/lib/scan-client';

const photo: ScanPreview = {
  scanId: 'current-photo',
  status: 'ready',
  imageUrl: '/private/current.jpg',
  imageHash: 'hash',
  width: 900,
  height: 600,
  analysisVersion: 0,
  reviewVersion: 0,
  candidates: [],
  limitReached: false,
};
const running = (key = 'attempt-a', patch: Partial<ScanPreview> = {}): ScanPreview => ({
  ...photo,
  status: 'analyzing',
  analysisOperationKey: key,
  analysisStartedAt: new Date().toISOString(),
  ...patch,
});
const completed = (patch: Partial<ScanPreview> = {}): ScanPreview => ({
  ...photo,
  status: 'completed',
  analysisVersion: 1,
  ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const controllers: ScanAnalysisController[] = [];
function setup() {
  const pending = deferred<ScanPreview>();
  const transport = {
    analyze: vi
      .fn<(scan: ScanPreview, key: string, signal: AbortSignal) => Promise<ScanPreview>>()
      .mockImplementation(() => pending.promise),
    get: vi
      .fn<(id: string, signal: AbortSignal) => Promise<ScanPreview>>()
      .mockResolvedValue(running()),
    cancel: vi
      .fn<
        (
          id: string,
          key: string,
          signal: AbortSignal,
        ) => Promise<ScanPreview & { cancelled: boolean }>
      >()
      .mockResolvedValue({
        ...photo,
        status: 'failed',
        cancelled: true,
      }),
  };
  const settled = vi.fn();
  const controller = new ScanAnalysisController(transport, settled, 4_000);
  controllers.push(controller);
  return { controller, transport, settled, pending };
}
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.reset());
  vi.useRealTimers();
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('server-owned identification lifecycle', () => {
  it('keeps an accepted202 attempt active and blocks another start until status is terminal', async () => {
    const { controller, pending, transport, settled } = setup();
    controller.start(photo, 'attempt-a');
    pending.resolve(running());
    await flush();
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-a');
    expect(controller.start(photo, 'duplicate')).toBe(false);
    expect(transport.analyze).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
    transport.get.mockResolvedValueOnce(completed());
    await controller.check();
    expect(controller.getSnapshot().active).toBeNull();
    expect(settled).toHaveBeenCalledWith(completed());
  });

  it('restores and polls a running attempt after reload without submitting another paid request', async () => {
    vi.useFakeTimers();
    const { controller, transport, settled } = setup();
    controller.restore(running());
    await flush();
    expect(transport.analyze).not.toHaveBeenCalled();
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-a');
    transport.get.mockResolvedValueOnce(completed());
    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().active).toBeNull();
  });

  it('stops the exact operation, aborts its transport and ignores late completion even after retry', async () => {
    const { controller, transport, pending, settled } = setup();
    controller.start(photo, 'attempt-a');
    const signal = transport.analyze.mock.calls[0][2];
    await flush();
    await controller.stop();
    expect(signal.aborted).toBe(true);
    expect(transport.cancel.mock.calls[0].slice(0, 2)).toEqual([photo.scanId, 'attempt-a']);
    expect(controller.getSnapshot().message).toContain('Identification stopped');
    expect(settled.mock.calls[0][0].status).toBe('failed');
    const retry = deferred<ScanPreview>();
    transport.analyze.mockReturnValueOnce(retry.promise);
    transport.get.mockResolvedValueOnce(running('attempt-b'));
    controller.start({ ...photo, status: 'failed' }, 'attempt-b');
    pending.resolve(completed());
    await flush();
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-b');
    expect(settled).toHaveBeenCalledTimes(1);
    retry.resolve(completed());
    await flush();
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('handles another photo’s409 without replacing the current photo, and stops only the blocking run', async () => {
    const { controller, transport, pending, settled } = setup();
    const other = {
      scanId: 'older-photo',
      operationKey: 'older-attempt',
      startedAt: null,
      deadlineAt: null,
    };
    transport.get.mockResolvedValue(
      running(other.operationKey, { scanId: other.scanId, imageUrl: '/private/older.jpg' }),
    );
    controller.start(photo, 'attempt-a');
    pending.reject(
      new ScanRequestError('Another photo is being identified', 409, 'analysis_running', other),
    );
    await flush();
    expect(controller.getSnapshot().otherPhoto).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    transport.cancel.mockResolvedValueOnce({
      ...photo,
      scanId: other.scanId,
      status: 'failed',
      cancelled: true,
    });
    await controller.stop();
    expect(transport.cancel.mock.calls[0].slice(0, 2)).toEqual([other.scanId, other.operationKey]);
    expect(controller.getSnapshot().active).toBeNull();
    expect(settled).not.toHaveBeenCalled();
    expect(controller.start(photo, 'new-attempt')).toBe(true);
  });

  it('offers the other completed photo as a separate result without changing current review', async () => {
    const { controller, transport, pending, settled } = setup();
    transport.get.mockImplementation(async (id) =>
      id === 'older-photo' ? completed({ scanId: id }) : running(),
    );
    controller.start(photo, 'attempt-a');
    pending.reject(
      new ScanRequestError('Already running', 409, 'analysis_running', {
        scanId: 'older-photo',
        operationKey: 'older-attempt',
        startedAt: null,
        deadlineAt: null,
      }),
    );
    await flush();
    expect(controller.getSnapshot().resultScanId).toBe('older-photo');
    expect(settled).not.toHaveBeenCalled();
  });

  it('retains the operation through lost connections and recovers from fresh server state', async () => {
    const { controller, transport, pending, settled } = setup();
    transport.get.mockRejectedValue(new TypeError('offline'));
    controller.start(photo, 'attempt-a');
    pending.reject(new TypeError('connection lost'));
    await flush();
    expect(controller.getSnapshot().phase).toBe('uncertain');
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-a');
    expect(controller.start(photo, 'duplicate')).toBe(false);
    transport.get.mockResolvedValueOnce(completed());
    await controller.check();
    expect(settled).toHaveBeenCalledOnce();
  });

  it('adopts a replacement attempt returned by stale cancellation without canceling it', async () => {
    const { controller, transport, pending, settled } = setup();
    controller.start(photo, 'attempt-a');
    await flush();
    transport.cancel.mockResolvedValueOnce({ ...running('attempt-b'), cancelled: false });
    await controller.stop();
    pending.resolve(completed());
    await flush();
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-b');
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('does not mistake a previous completed review for a newly submitted attempt', async () => {
    const { controller, transport, settled } = setup();
    const old = completed();
    transport.get.mockResolvedValue(old);
    controller.start(old, 'attempt-b');
    await flush();
    expect(controller.getSnapshot().active?.operationKey).toBe('attempt-b');
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps Stop disabled until the server confirms the submitted operation has started', async () => {
    const { controller, transport } = setup();
    transport.get.mockResolvedValueOnce(photo);
    controller.start(photo, 'attempt-a');
    await flush();
    expect(controller.getSnapshot().confirmed).toBe(false);
    await controller.stop();
    expect(transport.cancel).not.toHaveBeenCalled();
    expect(transport.analyze.mock.calls[0][2].aborted).toBe(false);
    await controller.check();
    expect(controller.getSnapshot().confirmed).toBe(true);
    await controller.stop();
    expect(transport.cancel).toHaveBeenCalledOnce();
  });

  it('retains a useful server rejection after confirming that no attempt started', async () => {
    const { controller, transport, pending } = setup();
    transport.get.mockResolvedValue(photo);
    controller.start(photo, 'attempt-a');
    pending.reject(
      new ScanRequestError('Today’s identification limit has been reached.', 429, 'usage_limit'),
    );
    await flush();
    await controller.check();
    expect(controller.getSnapshot().active).toBeNull();
    expect(controller.getSnapshot().message).toContain('identification limit');
  });

  it('keeps the rejection visible when an older completed review survives a refused retry', async () => {
    const { controller, transport, pending, settled } = setup();
    const old = completed();
    transport.get.mockResolvedValue(old);
    controller.start(old, 'new-attempt');
    pending.reject(
      new ScanRequestError('Today’s identification limit has been reached.', 429, 'usage_limit'),
    );
    await flush();
    await controller.check();
    expect(controller.getSnapshot().active).toBeNull();
    expect(controller.getSnapshot().message).toContain('identification limit');
    expect(settled).toHaveBeenCalledWith(old);
  });

  it('ignores pending status and analysis results after leaving the screen', async () => {
    const { controller, transport, pending, settled } = setup();
    const status = deferred<ScanPreview>();
    transport.get.mockReturnValueOnce(status.promise);
    controller.start(photo, 'attempt-a');
    void controller.check();
    controller.reset();
    status.resolve(completed());
    pending.resolve(completed());
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(controller.getSnapshot().active).toBeNull();
    expect(transport.analyze.mock.calls[0][2].aborted).toBe(true);
  });
});
