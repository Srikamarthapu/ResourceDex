import {
  ownedScan,
  safeScanResponse,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    let scan = await ownedScan((await params).id, context);
    if (
      scan.status === 'analyzing' &&
      scan.analysis_deadline_at &&
      Date.parse(scan.analysis_deadline_at) <= Date.now()
    ) {
      await context.admin
        .from('scans')
        .update({
          status: 'failed',
          analysis_error: 'Identification took too long. Retry or add the items yourself.',
        })
        .eq('id', scan.id)
        .eq('status', 'analyzing')
        .eq('analysis_operation_key', scan.analysis_operation_key);
      await context.admin
        .from('analysis_attempts')
        .update({
          status: 'failed',
          error_code: 'timeout',
          finished_at: new Date().toISOString(),
        })
        .eq('scan_id', scan.id)
        .eq('operation_key', scan.analysis_operation_key)
        .eq('status', 'running');
      scan = await ownedScan(scan.id, context);
    }
    return scanJson(await safeScanResponse(scan, context.admin));
  } catch (error) {
    return scanErrorResponse(error);
  }
}
