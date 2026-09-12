import { describe, expect, it } from 'vitest';
import { createSaveQueue } from '../src/lib/data/save-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('draft save serialization', () => {
  it('uses the committed revision when autosave and review are queued together', async () => {
    const queue = createSaveQueue();
    const firstWrite = deferred<void>();
    const writes: number[] = [];
    let revision = 1;
    let stored = 'old';
    let edited = 'first edit';
    const save = () =>
      queue.run(async () => {
        const snapshot = edited;
        if (snapshot === stored) return revision;
        writes.push(revision);
        if (writes.length === 1) await firstWrite.promise;
        revision += 1;
        stored = snapshot;
        return revision;
      });
    const auto = save();
    await Promise.resolve();
    edited = 'edited while autosave was in flight';
    const manual = save();
    const review = save();
    expect(writes).toEqual([1]);
    firstWrite.resolve();
    expect(await Promise.all([auto, manual, review])).toEqual([2, 3, 3]);
    expect(writes).toEqual([1, 2]);
    expect(stored).toBe(edited);
  });

  it('allows a later explicit retry after a failed write', async () => {
    const queue = createSaveQueue();
    await expect(
      queue.run(async () => {
        throw new Error('Connection lost');
      }),
    ).rejects.toThrow('Connection lost');
    await expect(queue.run(async () => 'committed')).resolves.toBe('committed');
  });
});
