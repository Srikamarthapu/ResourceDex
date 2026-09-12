import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DETECTION_PROMPT_VERSION, DETECTION_SCHEMA_VERSION } from '@/lib/ai/detection';
import {
  AnalysisError,
  DETECTION_DEADLINE_MS,
  getGeminiConfig,
  identifyItems,
} from '@/lib/ai/gemini';
import {
  operationKeySchema,
  ownedScan,
  readJson,
  SCAN_BUCKET,
  ScanError,
  safeScanResponse,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const analyzeSchema = z
  .object({
    operationKey: operationKeySchema,
    imageHash: z.string().regex(/^[a-f0-9]{64}$/),
    consent: z.literal(true),
  })
  .strict();

function budgetConfiguration() {
  const maximumScanCost = Number(process.env.AI_SCAN_MAX_COST_USD);
  const dailyCeiling = Number(process.env.AI_DAILY_BUDGET_USD);
  if (
    ![maximumScanCost, dailyCeiling].every((value) => Number.isFinite(value) && value > 0) ||
    maximumScanCost > dailyCeiling
  ) {
    throw new AnalysisError(
      'not_configured',
      'Photo identification is awaiting its usage configuration. You can still add items yourself.',
    );
  }
  return { maximumScanCost, dailyCeiling };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    const input = await readJson(request, analyzeSchema);
    const scan = await ownedScan((await params).id, context);
    if (!scan.normalized_path || scan.image_hash !== input.imageHash)
      throw new ScanError(409, 'The photo changed. Reload its preview before identifying items.');
    // Replays return the persisted outcome, including terminal failure. A retry uses a new key.
    const { data: previous, error: replayError } = await context.admin
      .from('analysis_attempts')
      .select('id,status,output,image_hash,error_code')
      .eq('scan_id', scan.id)
      .eq('owner_id', context.user.id)
      .eq('operation_key', input.operationKey)
      .maybeSingle();
    if (replayError) throw new ScanError(503, 'Saved identification could not be read. Try again.');
    if (previous) {
      if (previous.image_hash && previous.image_hash !== input.imageHash)
        throw new ScanError(409, 'This operation key belongs to a different photo.');
      if (previous.output) {
        return scanJson(
          await safeScanResponse(
            {
              ...scan,
              status: 'completed',
              candidates: previous.output.candidates,
              analysis_version: previous.output.analysisVersion,
            },
            context.admin,
          ),
        );
      }
      if (
        previous.status === 'running' &&
        scan.analysis_deadline_at &&
        Date.parse(scan.analysis_deadline_at) <= Date.now()
      ) {
        await context.admin
          .from('analysis_attempts')
          .update({
            status: 'failed',
            error_code: 'timeout',
            finished_at: new Date().toISOString(),
          })
          .eq('id', previous.id)
          .eq('status', 'running');
        throw new ScanError(
          409,
          'That identification expired. Start a new attempt or add items yourself.',
          'timeout',
        );
      }
      if (previous.status === 'failed')
        throw new ScanError(
          409,
          'That identification attempt failed. Start a new attempt or add items yourself.',
          previous.error_code ?? 'analysis_failed',
        );
      return scanJson(
        await safeScanResponse(await ownedScan(scan.id, context), context.admin),
        202,
      );
    }
    getGeminiConfig();
    const budget = budgetConfiguration();
    const now = new Date();
    // Release only expired locks. A late provider response is still rejected by its operation key below.
    const { error: expiryError } = await context.admin
      .from('scans')
      .update({
        status: 'failed',
        analysis_error: 'Identification took too long. Retry or add the items yourself.',
      })
      .eq('owner_id', context.user.id)
      .eq('status', 'analyzing')
      .lt('analysis_deadline_at', now.toISOString());
    if (expiryError)
      throw new ScanError(503, 'Identification status could not be checked. Try again.');
    const { data: locked, error: lockError } = await context.admin
      .from('scans')
      .update({
        status: 'analyzing',
        analysis_operation_key: input.operationKey,
        analysis_started_at: now.toISOString(),
        analysis_deadline_at: new Date(now.getTime() + DETECTION_DEADLINE_MS + 5_000).toISOString(),
        analysis_error: null,
      })
      .eq('id', scan.id)
      .eq('owner_id', context.user.id)
      .neq('status', 'analyzing')
      .select('id,analysis_version')
      .maybeSingle();
    if (lockError || !locked)
      throw new ScanError(
        409,
        'An identification is already running. Wait for it to finish.',
        'analysis_running',
      );
    let attemptId: string | null = null;
    try {
      const { data: reservation, error: reserveError } = await context.admin.rpc(
        'reserve_analysis',
        {
          p_owner: context.user.id,
          p_scan: scan.id,
          p_operation_key: input.operationKey,
          p_cost: budget.maximumScanCost,
          p_daily_ceiling: budget.dailyCeiling,
        },
      );
      if (reserveError?.message.includes('Analysis usage limit reached'))
        throw new ScanError(
          429,
          'Photo identification has reached its current usage limit. You can still add items yourself.',
          'usage_limit',
        );
      if (reserveError || !reservation)
        throw new ScanError(
          503,
          'Identification could not start safely. Try again or add items yourself.',
        );
      attemptId = String(reservation);
      const { error: provenanceError } = await context.admin
        .from('analysis_attempts')
        .update({
          image_hash: input.imageHash,
          model: getGeminiConfig().model,
          prompt_version: DETECTION_PROMPT_VERSION,
          schema_version: DETECTION_SCHEMA_VERSION,
        })
        .eq('id', attemptId);
      if (provenanceError)
        throw new ScanError(503, 'Identification could not start safely. Try again.');
      const { data: file, error: downloadError } = await context.admin.storage
        .from(SCAN_BUCKET)
        .download(scan.normalized_path);
      if (downloadError || !file)
        throw new ScanError(503, 'The saved photo could not be opened. Try again.');
      const bytes = Buffer.from(await file.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== input.imageHash)
        throw new ScanError(
          409,
          'The stored photo changed. Upload it again before identifying items.',
        );
      const result = await identifyItems(bytes, attemptId);
      const durableResult = {
        scanId: scan.id,
        status: 'completed',
        width: scan.width,
        height: scan.height,
        imageHash: scan.image_hash,
        imagePath: scan.normalized_path,
        analysisVersion: locked.analysis_version + 1,
        candidates: result.candidates,
        limitReached: result.limitReached,
        error: null,
      };
      const { error: commitError } = await context.admin.rpc('complete_analysis', {
        p_owner: context.user.id,
        p_scan: scan.id,
        p_operation_key: input.operationKey,
        p_attempt: attemptId,
        p_result: durableResult,
        p_model: result.model,
        p_prompt: DETECTION_PROMPT_VERSION,
        p_schema: DETECTION_SCHEMA_VERSION,
        p_tokens: result.tokenUsage,
      });
      if (commitError)
        throw new ScanError(
          409,
          'This identification expired or was replaced. Reload the saved review.',
          'stale_analysis',
        );
      return scanJson(await safeScanResponse(await ownedScan(scan.id, context), context.admin));
    } catch (error) {
      const message =
        error instanceof AnalysisError || error instanceof ScanError
          ? error.message
          : 'Identification is unavailable. Retry or add the items yourself.';
      const code =
        error instanceof AnalysisError || error instanceof ScanError
          ? error.code
          : 'provider_unavailable';
      await context.admin
        .from('scans')
        .update({ status: 'failed', analysis_error: message })
        .eq('id', scan.id)
        .eq('status', 'analyzing')
        .eq('analysis_operation_key', input.operationKey);
      if (attemptId)
        await context.admin
          .from('analysis_attempts')
          .update({
            status: 'failed',
            error_code: code,
            finished_at: new Date().toISOString(),
          })
          .eq('id', attemptId)
          .neq('status', 'completed');
      throw error;
    }
  } catch (error) {
    return scanErrorResponse(error);
  }
}
