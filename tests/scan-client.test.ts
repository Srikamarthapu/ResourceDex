import { afterEach, expect, it, vi } from 'vitest';
import {
  analyzeScan,
  cancelScanAnalysis,
  getScan,
  ScanRequestError,
  type ScanPreview,
} from '../src/lib/scan-client';

afterEach(() => vi.unstubAllGlobals());

it('treats202 as running and forwards an explicit provider consent and operation key', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ scanId: 'photo' }), { status: 202 }));
  vi.stubGlobal('fetch', fetcher);
  const result = await analyzeScan(
    { scanId: 'photo', imageHash: 'hash' } as ScanPreview,
    'attempt',
  );
  expect(result.status).toBe('analyzing');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    operationKey: 'attempt',
    providerConsent: 'google-nvidia-v1',
  });
});

it('preserves structured conflict metadata for the other running photo', async () => {
  const activeAnalysis = {
    scanId: 'older',
    operationKey: 'old-key',
    startedAt: null,
    deadlineAt: null,
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Already running', code: 'analysis_running', activeAnalysis }),
          { status: 409 },
        ),
      ),
  );
  const failure = await analyzeScan({ scanId: 'photo' } as ScanPreview, 'attempt').catch(
    (error) => error,
  );
  expect(failure).toBeInstanceOf(ScanRequestError);
  expect(failure).toMatchObject({ status: 409, code: 'analysis_running', activeAnalysis });
});

it('cancels only the supplied attempt and connects external abort to fetch', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await cancelScanAnalysis('photo', 'expected-key');
  expect(fetcher.mock.calls[0][0]).toBe('/api/scans/photo/cancel');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ operationKey: 'expected-key' });
  const abort = new AbortController();
  abort.abort();
  fetcher.mockResolvedValueOnce(new Response('{}'));
  await getScan('photo', abort.signal);
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
});

it('makes non-JSON gateway errors recoverable without leaking gateway markup', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('<html>upstream timeout</html>', { status: 504 })),
  );
  await expect(getScan('photo')).rejects.toMatchObject({
    status: 504,
    message: 'This step could not finish. Please try again.',
  });
});
