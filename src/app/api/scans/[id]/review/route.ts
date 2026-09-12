import { applyCandidateReview, candidateReviewSchema } from '@/lib/ai/review';
import {
  ownedScan,
  readJson,
  ScanError,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    const scan = await ownedScan((await params).id, context);
    const input = await readJson(request, candidateReviewSchema);
    if (
      scan.analysis_version !== input.analysisVersion ||
      !['completed', 'failed'].includes(scan.status)
    ) {
      throw new ScanError(
        409,
        'The analysis changed. Reload the saved review before editing.',
        'review_conflict',
      );
    }
    let candidates;
    try {
      candidates = applyCandidateReview(scan.candidates, input.candidates);
    } catch {
      throw new ScanError(
        400,
        'This review contains an item that does not belong to this analysis.',
        'invalid_candidate',
      );
    }
    const { data: revision, error } = await context.admin.rpc('save_scan_review', {
      p_owner: context.user.id,
      p_scan: scan.id,
      p_analysis_version: input.analysisVersion,
      p_expected_revision: input.expectedReviewVersion,
      p_candidates: candidates,
    });
    if (error?.code === '40001' || error?.message.toLowerCase().includes('conflict')) {
      throw new ScanError(
        409,
        'This review changed in another tab. Reload the saved review before editing.',
        'review_conflict',
      );
    }
    if (error || revision === null)
      throw new ScanError(
        503,
        'Your item review could not be saved. Keep this page open and retry.',
        'review_save_failed',
      );
    return scanJson({
      analysisVersion: input.analysisVersion,
      reviewVersion: Number(revision),
      candidates: candidates.filter((candidate) => candidate.review_status !== 'removed'),
    });
  } catch (error) {
    return scanErrorResponse(error);
  }
}
