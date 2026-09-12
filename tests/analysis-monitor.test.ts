import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AnalysisError } from '../src/lib/ai/analysis-error';
import { runWhileAnalysisActive } from '../src/lib/ai/analysis-monitor';

function untilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
      once: true,
    });
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('active analysis monitor', () => {
  it('checks persisted state before dispatch and never invokes a stopped run', async () => {
    const isActive = vi.fn().mockResolvedValue(false);
    const run = vi.fn();
    await expect(
      runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(isActive).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed before dispatch when persisted state cannot be read', async () => {
    const isActive = vi.fn().mockRejectedValue(new Error('private-database-error'));
    const run = vi.fn();
    const error = await runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ code: 'provider_unavailable' });
    expect(String(error)).not.toContain('private-database');
    expect(run).not.toHaveBeenCalled();
  });

  it('aborts the provider when the saved operation is cancelled or replaced', async () => {
    const isActive = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const run = vi.fn(untilAborted);
    const result = runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(run.mock.calls[0][0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(isActive).toHaveBeenCalledTimes(2);
  });

  it('aborts with a safe availability error if a later database check fails', async () => {
    const isActive = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('private-database-error'));
    const run = vi.fn(untilAborted);
    const result = runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 });
    const captured = result.catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(100);
    const error = await captured;
    expect(error).toMatchObject({ code: 'provider_unavailable' });
    expect(String(error)).not.toContain('private-database');
    expect(run.mock.calls[0][0].aborted).toBe(true);
  });

  it('returns a completed result and stops background checks', async () => {
    const isActive = vi.fn().mockResolvedValue(true);
    const run = vi.fn().mockResolvedValue({ candidateCount: 3 });
    await expect(runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 })).resolves.toEqual({
      candidateCount: 3,
    });
    const checksAtCompletion = isActive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(isActive).toHaveBeenCalledTimes(checksAtCompletion);
    expect(run).toHaveBeenCalledOnce();
  });

  it('preserves provider errors and disposes the monitor', async () => {
    const isActive = vi.fn().mockResolvedValue(true);
    const failure = new AnalysisError('invalid_output', 'Invalid fixture result.');
    const run = vi.fn().mockRejectedValue(failure);
    await expect(runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 })).rejects.toBe(
      failure,
    );
    const checksAtCompletion = isActive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(isActive).toHaveBeenCalledTimes(checksAtCompletion);
  });

  it('rejects a late provider success even if the provider ignores cancellation', async () => {
    const isActive = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    let finish: (value: string) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const result = runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(100);
    finish('late fixture result');
    await assertion;
  });

  it('does not overlap slow checks, and aborts the pending check after completion', async () => {
    let checkSignal: AbortSignal | undefined;
    let finish: (value: string) => void = () => {};
    const isActive = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce((signal: AbortSignal) => {
        checkSignal = signal;
        return new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('check disposed')), {
            once: true,
          });
        });
      });
    const run = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const result = runWhileAnalysisActive(isActive, run, { pollIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(isActive).toHaveBeenCalledTimes(2);
    finish('completed fixture');
    await expect(result).resolves.toBe('completed fixture');
    expect(checkSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(isActive).toHaveBeenCalledTimes(2);
  });
});
