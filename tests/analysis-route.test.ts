import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifiedScanContext: vi.fn(),
  ownedScan: vi.fn(),
  safeScanResponse: vi.fn(),
  identifyPhoto: vi.fn(),
  getIdentificationConfig: vi.fn(),
  expireOwnerAnalyses: vi.fn(),
  failAnalysis: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/scan-server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifiedScanContext: mocks.verifiedScanContext,
  ownedScan: mocks.ownedScan,
  safeScanResponse: mocks.safeScanResponse,
}));
vi.mock('@/lib/ai/identify', () => ({
  IDENTIFICATION_DEADLINE_MS: 165_000,
  identifyPhoto: mocks.identifyPhoto,
  getIdentificationConfig: mocks.getIdentificationConfig,
}));
vi.mock('@/lib/ai/analysis-lifecycle', () => ({
  ANALYSIS_TIMEOUT_MESSAGE: 'Identification timed out.',
  expireOwnerAnalyses: mocks.expireOwnerAnalyses,
  failAnalysis: mocks.failAnalysis,
}));

import { POST } from '@/app/api/scans/[id]/analyze/route';

type Row = Record<string, unknown>;
const scanId = '00000000-0000-4000-8000-000000000001';
const operationKey = '00000000-0000-4000-8000-000000000002';
const newerKey = '00000000-0000-4000-8000-000000000003';
const imageBytes = Buffer.from('isolated-image-fixture');
const imageHash = createHash('sha256').update(imageBytes).digest('hex');
let storedScan: Row;
let previous: Row | null;
let afterReplayRead: (() => void) | undefined;
let committedClaims: number;
let rpc: ReturnType<typeof vi.fn>;

// Evaluate the query's predicates against the current row at UPDATE time. This
// lets a concurrent Stop land after the route read, without a real provider call.
class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private patch: Row | null = null;
  constructor(private table: string) {}
  select() {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }
  neq(key: string, value: unknown) {
    this.filters.push((row) => row[key] !== value);
    return this;
  }
  is(key: string, value: unknown) {
    return this.eq(key, value);
  }
  abortSignal() {
    return this;
  }
  async maybeSingle() {
    if (this.table === 'analysis_attempts') {
      const result = previous;
      afterReplayRead?.();
      afterReplayRead = undefined;
      return { data: result, error: null };
    }
    if (!this.filters.every((matches) => matches(storedScan))) return { data: null, error: null };
    if (this.patch) {
      storedScan = { ...storedScan, ...this.patch };
      committedClaims++;
    }
    return { data: { ...storedScan }, error: null };
  }
}

function analyze() {
  return POST(
    new Request(`https://resourcedex.vercel.app/api/scans/${scanId}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://resourcedex.vercel.app',
      },
      body: JSON.stringify({
        operationKey,
        imageHash,
        consent: true,
        providerConsent: 'google-nvidia-v1',
      }),
    }),
    { params: Promise.resolve({ id: scanId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AI_SCAN_MAX_COST_USD', '0.001');
  vi.stubEnv('AI_DAILY_BUDGET_USD', '1');
  storedScan = {
    id: scanId,
    owner_id: 'fixture-owner',
    status: 'ready',
    normalized_path: 'fixture/private-photo.jpg',
    image_hash: imageHash,
    analysis_version: 0,
    analysis_operation_key: null,
    analysis_deadline_at: null,
    analysis_started_at: null,
    analysis_error: null,
    candidates: [],
  };
  previous = null;
  afterReplayRead = undefined;
  committedClaims = 0;
  // Fail closed if a regression unexpectedly reaches admission. No storage or
  // network adapter exists in this fixture, and the provider stays mocked.
  rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Fixture admission denied' } });
  mocks.verifiedScanContext.mockResolvedValue({
    user: { id: 'fixture-owner' },
    admin: { from: (table: string) => new Query(table), rpc },
  });
  mocks.ownedScan.mockImplementation(async () => ({ ...storedScan }));
  mocks.safeScanResponse.mockImplementation(async (scan: Row) => ({
    scanId: scan.id,
    status: scan.status,
    analysisVersion: scan.analysis_version,
    analysisOperationKey: scan.analysis_operation_key,
    candidates: scan.candidates,
    error: scan.analysis_error,
  }));
  mocks.getIdentificationConfig.mockReturnValue({ model: 'fixture-model' });
  mocks.expireOwnerAnalyses.mockResolvedValue(undefined);
  mocks.failAnalysis.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

it('does not restart a cancelled same-key operation that stopped before admission', async () => {
  storedScan.status = 'failed';
  storedScan.analysis_operation_key = operationKey;
  storedScan.analysis_error = 'Identification stopped.';
  const response = await analyze();
  expect(response.status).toBe(409);
  expect(storedScan.status).toBe('failed');
  expect(committedClaims).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
  expect(mocks.identifyPhoto).not.toHaveBeenCalled();
});

it('does not let a stalled duplicate POST reclaim the photo after Stop', async () => {
  afterReplayRead = () => {
    storedScan = {
      ...storedScan,
      status: 'failed',
      analysis_operation_key: operationKey,
      analysis_error: 'Identification stopped.',
    };
  };
  const response = await analyze();
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(storedScan.status).toBe('failed');
  expect(storedScan.analysis_operation_key).toBe(operationKey);
  expect(committedClaims).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
  expect(mocks.identifyPhoto).not.toHaveBeenCalled();
});

it('does not replace a newer completed review using an older request snapshot', async () => {
  storedScan.status = 'completed';
  storedScan.analysis_version = 1;
  afterReplayRead = () => {
    storedScan = {
      ...storedScan,
      status: 'completed',
      analysis_operation_key: newerKey,
      analysis_version: 2,
      candidates: [{ candidate_id: 'newer:item' }],
    };
  };
  await analyze();
  expect(storedScan.status).toBe('completed');
  expect(storedScan.analysis_operation_key).toBe(newerKey);
  expect(storedScan.analysis_version).toBe(2);
  expect(committedClaims).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});

it('reports the current running operation when an older completed request is replayed', async () => {
  storedScan.status = 'analyzing';
  storedScan.analysis_operation_key = newerKey;
  storedScan.analysis_version = 2;
  storedScan.candidates = [{ candidate_id: 'current:item' }];
  previous = {
    status: 'completed',
    image_hash: imageHash,
    output: { candidates: [{ candidate_id: 'older:item' }], analysisVersion: 1 },
  };
  const response = await analyze();
  expect(await response.json()).toMatchObject({
    status: 'analyzing',
    analysisOperationKey: newerKey,
    analysisVersion: 2,
    candidates: [{ candidate_id: 'current:item' }],
  });
  expect(committedClaims).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});

it('keeps a replay of the active operation idempotent', async () => {
  storedScan.status = 'analyzing';
  storedScan.analysis_operation_key = operationKey;
  storedScan.analysis_deadline_at = new Date(Date.now() + 60_000).toISOString();
  previous = { status: 'running', image_hash: imageHash };
  const response = await analyze();
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    status: 'analyzing',
    analysisOperationKey: operationKey,
  });
  expect(committedClaims).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});

function permitFixtureAnalysis() {
  rpc.mockImplementation(async (name: string) => {
    if (name === 'reserve_analysis') return { data: operationKey, error: null };
    if (name === 'complete_analysis') storedScan.status = 'completed';
    return { data: true, error: null };
  });
  mocks.verifiedScanContext.mockResolvedValue({
    user: { id: 'fixture-owner' },
    admin: {
      from: (table: string) => new Query(table),
      rpc,
      storage: {
        from: () => ({ download: async () => ({ data: new Blob([imageBytes]), error: null }) }),
      },
    },
  });
}

it('persists the dispatched model before returning its completed result', async () => {
  permitFixtureAnalysis();
  const progress = {
    model: 'gemini-3.8-flash',
    phase: 'identifying',
    fallbacks: [{ from: 'gemini-3.5-flash', to: 'gemini-3.8-flash', reason: 'rate_limit' }],
  };
  mocks.identifyPhoto.mockImplementation(async (_bytes, _runId, _consent, _signal, onProgress) => {
    await onProgress(progress);
    expect(storedScan.analysis_progress).toEqual(progress);
    return { candidates: [], limitReached: false, model: progress.model, tokenUsage: {} };
  });
  expect((await analyze()).status).toBe(200);
  expect(storedScan.status).toBe('completed');
  expect(storedScan.analysis_progress).toEqual(progress);
});

it('rejects a late model progress update after the run was stopped or replaced', async () => {
  permitFixtureAnalysis();
  const currentProgress = { model: 'gemini-3.5-flash', phase: 'identifying', fallbacks: [] };
  mocks.identifyPhoto.mockImplementation(async (_bytes, _runId, _consent, _signal, onProgress) => {
    storedScan.analysis_operation_key = newerKey;
    storedScan.analysis_progress = currentProgress;
    await onProgress({ model: 'moonshotai/kimi-k3', phase: 'references', fallbacks: [] });
    throw new Error('Late progress must have been rejected.');
  });
  const response = await analyze();
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('cancelled');
  expect(storedScan.analysis_operation_key).toBe(newerKey);
  expect(storedScan.analysis_progress).toEqual(currentProgress);
  expect(rpc.mock.calls.some(([name]) => name === 'complete_analysis')).toBe(false);
});
