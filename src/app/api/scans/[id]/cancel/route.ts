import { z } from 'zod';
import {
  operationKeySchema,
  ownedScan,
  readJson,
  safeScanResponse,
  ScanError,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export const runtime = 'nodejs';
const cancelSchema = z.object({ operationKey: operationKeySchema }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    const input = await readJson(request, cancelSchema);
    const scan = await ownedScan((await params).id, context);
    const { data: cancelled, error } = await context.admin.rpc('cancel_analysis', {
      p_owner: context.user.id,
      p_scan: scan.id,
      p_operation_key: input.operationKey,
    });
    if (error) throw new ScanError(503, 'Identification could not be stopped. Try again.');
    // A completion or replacement may win the row lock. Return that current
    // state rather than claiming it was stopped or canceling a different run.
    const current = await ownedScan(scan.id, context);
    return scanJson({
      ...(await safeScanResponse(current, context.admin)),
      cancelled: cancelled === true,
    });
  } catch (error) {
    return scanErrorResponse(error);
  }
}
