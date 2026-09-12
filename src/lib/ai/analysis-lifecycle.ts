import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScanError } from './scan-server';

export const ANALYSIS_TIMEOUT_MESSAGE =
  'Identification took too long. Retry or add the items yourself.';

export type AnalysisFailure = {
  ownerId: string;
  scanId: string;
  operationKey: string;
  code: string;
  message: string;
  expiredOnly?: boolean;
};

/** Atomically terminalize only this active operation; a newer run always wins. */
export async function failAnalysis(
  admin: SupabaseClient,
  input: AnalysisFailure,
): Promise<boolean> {
  const { data, error } = await admin.rpc('fail_analysis', {
    p_owner: input.ownerId,
    p_scan: input.scanId,
    p_operation_key: input.operationKey,
    p_code: input.code,
    p_message: input.message,
    p_expired_only: input.expiredOnly ?? false,
  });
  if (error) throw new ScanError(503, 'Identification status could not be updated. Try again.');
  return data === true;
}

/** Release expired owner runs without a separate, racy attempt update. */
export async function expireOwnerAnalyses(admin: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await admin
    .from('scans')
    .select('id,analysis_operation_key')
    .eq('owner_id', ownerId)
    .eq('status', 'analyzing')
    .lt('analysis_deadline_at', new Date().toISOString());
  if (error) throw new ScanError(503, 'Identification status could not be checked. Try again.');
  for (const scan of data ?? []) {
    if (!scan.analysis_operation_key) continue;
    await failAnalysis(admin, {
      ownerId,
      scanId: scan.id,
      operationKey: scan.analysis_operation_key,
      code: 'timeout',
      message: ANALYSIS_TIMEOUT_MESSAGE,
      expiredOnly: true,
    });
  }
}
