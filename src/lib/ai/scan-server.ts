import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabase, createServerSupabase } from '../supabase/server';
import { readAnalysisProgress } from './analysis-progress';
import { AnalysisError } from './analysis-error';
import { currentReferenceNotes } from './reference-retrieval';
import { ImageValidationError } from '../images/normalize';
import type { DetectionCandidate } from './detection';
import { hasValidRequestOrigin } from './request-origin';

export const SCAN_BUCKET = 'scan-images';
export const LISTING_BUCKET = 'listing-images';
export const operationKeySchema = z.string().uuid();

export class ScanError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'scan_error',
  ) {
    super(message);
  }
}

export type ScanRecord = {
  id: string;
  owner_id: string;
  status: 'uploading' | 'ready' | 'analyzing' | 'completed' | 'failed';
  original_path: string;
  normalized_path: string | null;
  width: number | null;
  height: number | null;
  image_hash: string | null;
  analysis_version: number;
  candidates: DetectionCandidate[];
  analysis_error: string | null;
  analysis_operation_key: string | null;
  analysis_deadline_at: string | null;
  analysis_started_at: string | null;
  analysis_progress?: unknown;
  limit_reached: boolean;
  model: string | null;
  token_usage?: { grounding?: { status?: string } } | null;
  upload_metadata: { fileName: string; mimeType: string; size: number };
};

export async function verifiedScanContext(request?: Request) {
  if (request && request.method !== 'GET') {
    if (!hasValidRequestOrigin(request))
      throw new ScanError(403, 'This request could not be verified.');
  }
  const client = await createServerSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new ScanError(401, 'Sign in to share a photo.', 'authentication_required');
  if (!data.user.email_confirmed_at)
    throw new ScanError(403, 'Verify your email before sharing a photo.', 'verification_required');
  return { user: data.user, admin: createAdminSupabase() };
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 16_384) throw new ScanError(413, 'The request is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text) > 16_384) throw new ScanError(413, 'The request is too large.');
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new ScanError(400, 'Check the supplied fields and try again.', 'invalid_input');
  }
}

export async function ownedScan(
  id: string,
  context: Awaited<ReturnType<typeof verifiedScanContext>>,
) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ScanError(404, 'This private photo is unavailable.');
  const { data, error } = await context.admin
    .from('scans')
    .select('*')
    .eq('id', id)
    .eq('owner_id', context.user.id)
    .maybeSingle();
  if (error) throw new ScanError(503, 'Your saved photo could not be loaded. Try again.');
  if (!data) throw new ScanError(404, 'This private photo is unavailable.');
  return data as ScanRecord;
}

export async function safeScanResponse(
  scan: ScanRecord,
  admin: ReturnType<typeof createAdminSupabase>,
) {
  let imageUrl: string | null = null;
  let candidates: DetectionCandidate[] = scan.candidates ?? [];
  let reviewVersion = 0;
  if (scan.analysis_version > 0) {
    const { data: review, error } = await admin
      .from('scan_reviews')
      .select('revision,candidates')
      .eq('scan_id', scan.id)
      .eq('owner_id', scan.owner_id)
      .eq('analysis_version', scan.analysis_version)
      .maybeSingle();
    if (error) throw new ScanError(503, 'Your saved item review could not be loaded. Try again.');
    if (review) {
      candidates = review.candidates as DetectionCandidate[];
      reviewVersion = review.revision;
    }
  }
  if (scan.normalized_path) {
    const { data, error } = await admin.storage
      .from(SCAN_BUCKET)
      .createSignedUrl(scan.normalized_path, 300);
    if (error) throw new ScanError(503, 'Your private preview could not be loaded. Try again.');
    imageUrl = data.signedUrl;
  }
  const groundingStatus = scan.token_usage?.grounding?.status;
  const referenceStatus =
    groundingStatus === 'grounded' ||
    groundingStatus === 'no_evidence' ||
    groundingStatus === 'unavailable'
      ? groundingStatus
      : null;
  return {
    scanId: scan.id,
    status: scan.status,
    width: scan.width,
    height: scan.height,
    imageHash: scan.image_hash,
    imageUrl,
    imagePath: scan.normalized_path,
    analysisVersion: scan.analysis_version,
    analysisOperationKey: scan.analysis_operation_key,
    analysisStartedAt: scan.analysis_started_at,
    analysisDeadlineAt: scan.analysis_deadline_at,
    reviewVersion,
    candidates: candidates
      .filter((candidate) => candidate.review_status !== 'removed')
      .map((candidate) => ({
        ...candidate,
        reference_notes: currentReferenceNotes(candidate.reference_notes),
      })),
    analysisModel: scan.model,
    analysisProgress: readAnalysisProgress(scan.analysis_progress),
    referenceStatus,
    limitReached: scan.limit_reached,
    error: scan.analysis_error,
  };
}

export function scanJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export function scanErrorResponse(error: unknown) {
  if (error instanceof ScanError)
    return scanJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof ImageValidationError)
    return scanJson({ error: error.message, code: 'invalid_image' }, 400);
  if (error instanceof AnalysisError)
    return scanJson({ error: error.message, code: error.code, manualEntryAvailable: true }, 503);
  return scanJson(
    {
      error: 'This step is unavailable right now. Your saved work is unchanged. Try again.',
      code: 'service_unavailable',
    },
    503,
  );
}
