import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DETECTION_PROMPT_VERSION, DETECTION_SCHEMA_VERSION } from '@/lib/ai/detection';
import { AnalysisError, throwIfAnalysisCancelled } from '@/lib/ai/analysis-error';
import { readAnalysisProgress } from '@/lib/ai/analysis-progress';
import {
  ANALYSIS_TIMEOUT_MESSAGE,
  expireOwnerAnalyses,
  failAnalysis,
} from '@/lib/ai/analysis-lifecycle';
import { runWhileAnalysisActive } from '@/lib/ai/analysis-monitor';
import {
  getIdentificationConfig,
  identifyPhoto,
  IDENTIFICATION_DEADLINE_MS,
} from '@/lib/ai/identify';
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
export const maxDuration = 180;

const analyzeSchema = z
  .object({
    operationKey: operationKeySchema,
    imageHash: z.string().regex(/^[a-f0-9]{64}$/),
    consent: z.literal(true),
    providerConsent: z.literal('google-nvidia-v1').optional(),
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
    await expireOwnerAnalyses(context.admin, context.user.id);
    const scan = await ownedScan((await params).id, context);
    if (!scan.normalized_path || scan.image_hash !== input.imageHash)
      throw new ScanError(409, 'The photo changed. Reload its preview before identifying items.');
    const normalizedPath = scan.normalized_path;
    // Replays return the persisted outcome, including terminal failure. A retry uses a new key.
    const { data: previous, error: replayError } = await context.admin
      .from('analysis_attempts')
      .select('id,status,output,image_hash,error_code,model,token_usage')
      .eq('scan_id', scan.id)
      .eq('owner_id', context.user.id)
      .eq('operation_key', input.operationKey)
      .maybeSingle();
    if (replayError) throw new ScanError(503, 'Saved identification could not be read. Try again.');
    if (previous) {
      if (previous.image_hash && previous.image_hash !== input.imageHash)
        throw new ScanError(409, 'This operation key belongs to a different photo.');
      if (previous.output) {
        if (scan.analysis_operation_key !== input.operationKey)
          return scanJson(
            await safeScanResponse(scan, context.admin),
            scan.status === 'analyzing' ? 202 : 200,
          );
        return scanJson(
          await safeScanResponse(
            {
              ...scan,
              status: 'completed',
              analysis_error: null,
              limit_reached: previous.output.limitReached,
              candidates: previous.output.candidates,
              analysis_version: previous.output.analysisVersion,
              model: previous.model,
              token_usage: previous.token_usage,
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
        await failAnalysis(context.admin, {
          ownerId: context.user.id,
          scanId: scan.id,
          operationKey: input.operationKey,
          code: 'timeout',
          message: ANALYSIS_TIMEOUT_MESSAGE,
          expiredOnly: true,
        });
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
    // Stop may win before reservation creates an attempt row. Reusing that key
    // must not reopen the cancelled operation; deliberate retries use a new key.
    if (scan.status === 'failed' && scan.analysis_operation_key === input.operationKey)
      throw new ScanError(
        409,
        scan.analysis_error || 'That attempt ended. Start a new attempt or add items yourself.',
        'stale_analysis',
      );
    const allowNvidia = input.providerConsent === 'google-nvidia-v1';
    const provider = getIdentificationConfig(allowNvidia);
    const budget = budgetConfiguration();
    const now = new Date();
    // Claim exactly the snapshot we inspected. A delayed duplicate must not
    // reclaim a stopped, completed, or replaced operation.
    let claim = context.admin
      .from('scans')
      .update({
        status: 'analyzing',
        analysis_operation_key: input.operationKey,
        analysis_started_at: now.toISOString(),
        analysis_deadline_at: new Date(
          now.getTime() + IDENTIFICATION_DEADLINE_MS + 5_000,
        ).toISOString(),
        analysis_error: null,
        analysis_progress: null,
      })
      .eq('id', scan.id)
      .eq('owner_id', context.user.id)
      .neq('status', 'analyzing')
      .eq('status', scan.status)
      .eq('analysis_version', scan.analysis_version);
    claim =
      scan.analysis_operation_key === null
        ? claim.is('analysis_operation_key', null)
        : claim.eq('analysis_operation_key', scan.analysis_operation_key);
    const { data: locked, error: lockError } = await claim
      .select('id,analysis_version')
      .maybeSingle();
    if (lockError || !locked) {
      const { data: active, error: activeError } = await context.admin
        .from('scans')
        .select(
          'id,analysis_operation_key,analysis_started_at,analysis_deadline_at,analysis_progress',
        )
        .eq('owner_id', context.user.id)
        .eq('status', 'analyzing')
        .maybeSingle();
      if (activeError || !active?.analysis_operation_key)
        throw new ScanError(503, 'Identification status changed. Check its status and try again.');
      return scanJson(
        {
          error:
            active.id === scan.id
              ? 'This photo is already being identified. You can check its status or stop it.'
              : 'Another photo is being identified. You can check its status or stop it before trying this photo.',
          code: 'analysis_running',
          activeAnalysis: {
            scanId: active.id,
            operationKey: active.analysis_operation_key,
            startedAt: active.analysis_started_at,
            deadlineAt: active.analysis_deadline_at,
            progress: readAnalysisProgress(active.analysis_progress),
          },
        },
        409,
      );
    }
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
      const attemptId = String(reservation);
      const { error: provenanceError } = await context.admin
        .from('analysis_attempts')
        .update({
          image_hash: input.imageHash,
          model: provider.model,
          prompt_version: DETECTION_PROMPT_VERSION,
          schema_version: DETECTION_SCHEMA_VERSION,
        })
        .eq('id', attemptId);
      if (provenanceError)
        throw new ScanError(503, 'Identification could not start safely. Try again.');
      const result = await runWhileAnalysisActive(
        async (signal) => {
          const { data: active, error } = await context.admin
            .from('scans')
            .select('id')
            .eq('id', scan.id)
            .eq('owner_id', context.user.id)
            .eq('status', 'analyzing')
            .eq('analysis_operation_key', input.operationKey)
            .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(5_000)]))
            .maybeSingle();
          if (error) throw error;
          return Boolean(active);
        },
        async (signal) => {
          const { data: file, error: downloadError } = await context.admin.storage
            .from(SCAN_BUCKET)
            .download(normalizedPath);
          if (downloadError || !file)
            throw new ScanError(503, 'The saved photo could not be opened. Try again.');
          const bytes = Buffer.from(await file.arrayBuffer());
          if (createHash('sha256').update(bytes).digest('hex') !== input.imageHash)
            throw new ScanError(
              409,
              'The stored photo changed. Upload it again before identifying items.',
            );
          return identifyPhoto(bytes, attemptId, allowNvidia, signal, async (progress) => {
            throwIfAnalysisCancelled(signal);
            const { data: updated, error } = await context.admin
              .from('scans')
              .update({ analysis_progress: progress })
              .eq('id', scan.id)
              .eq('owner_id', context.user.id)
              .eq('status', 'analyzing')
              .eq('analysis_operation_key', input.operationKey)
              .select('id')
              .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(5_000)]))
              .maybeSingle();
            throwIfAnalysisCancelled(signal);
            if (error)
              throw new ScanError(
                503,
                'The current identification status could not be saved. Try again.',
              );
            if (!updated)
              throw new AnalysisError('cancelled', 'Identification stopped or was replaced.');
          });
        },
      );
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
      await failAnalysis(context.admin, {
        ownerId: context.user.id,
        scanId: scan.id,
        operationKey: input.operationKey,
        code,
        message,
      });
      throw error;
    }
  } catch (error) {
    return scanErrorResponse(error);
  }
}
