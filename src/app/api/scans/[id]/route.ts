import {
  ownedScan,
  safeScanResponse,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';
import { ANALYSIS_TIMEOUT_MESSAGE, failAnalysis } from '@/lib/ai/analysis-lifecycle';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    let scan = await ownedScan((await params).id, context);
    if (
      scan.status === 'analyzing' &&
      scan.analysis_operation_key &&
      scan.analysis_deadline_at &&
      Date.parse(scan.analysis_deadline_at) <= Date.now()
    ) {
      await failAnalysis(context.admin, {
        ownerId: context.user.id,
        scanId: scan.id,
        operationKey: scan.analysis_operation_key,
        code: 'timeout',
        message: ANALYSIS_TIMEOUT_MESSAGE,
        expiredOnly: true,
      });
      scan = await ownedScan(scan.id, context);
    }
    return scanJson(await safeScanResponse(scan, context.admin));
  } catch (error) {
    return scanErrorResponse(error);
  }
}
