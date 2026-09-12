import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickupArrangement, ResourceRequest } from '@/lib/types';
import { throwDataError, unwrapRow } from './resources';

export type PickupInput = Pick<
  PickupArrangement,
  'meeting_place' | 'starts_at' | 'ends_at' | 'timezone' | 'instructions'
>;
interface PickupRow extends Omit<PickupArrangement, 'agreement_status' | 'change_note'> {
  agreed_revision: number | null;
  agreed_at: string | null;
  change_request_note: string | null;
}
function mapPickup(row: PickupRow): PickupArrangement {
  return {
    ...row,
    agreement_status:
      row.agreed_revision === row.revision
        ? 'agreed'
        : row.change_request_note
          ? 'change_requested'
          : 'proposed',
    change_note: row.change_request_note,
  };
}

/** RLS returns only the signed-in requester's outgoing or owner's incoming rows. */
export async function listRequests(client: SupabaseClient): Promise<ResourceRequest[]> {
  const { data, error } = await client
    .from('requests')
    .select('*')
    .order('created_at', { ascending: false });
  throwDataError(error);
  return (data ?? []) as ResourceRequest[];
}

export async function createRequest(
  client: SupabaseClient,
  resourceId: string,
  note: string,
  proposedWindow: string,
  operationKey: string,
): Promise<ResourceRequest> {
  const { data, error } = await client.rpc('create_request', {
    resource_id: resourceId,
    note,
    proposed_window: proposedWindow,
    operation_key: operationKey,
  });
  throwDataError(error);
  return unwrapRow<ResourceRequest>(data);
}

export async function transitionRequest(
  client: SupabaseClient,
  id: string,
  action: 'accept' | 'decline' | 'cancel' | 'complete',
  reason = '',
): Promise<ResourceRequest> {
  const { data, error } = await client.rpc('transition_request', {
    request_id: id,
    action,
    reason,
  });
  throwDataError(error);
  return unwrapRow<ResourceRequest>(data);
}

export async function getPickupArrangement(
  client: SupabaseClient,
  requestId: string,
): Promise<PickupArrangement | null> {
  const { data, error } = await client
    .from('pickup_arrangements')
    .select('*')
    .eq('request_id', requestId)
    .maybeSingle();
  throwDataError(error);
  return data ? mapPickup(data as PickupRow) : null;
}

export async function savePickupArrangement(
  client: SupabaseClient,
  requestId: string,
  input: PickupInput,
  expectedRevision: number,
): Promise<PickupArrangement> {
  const { data, error } = await client.rpc('save_pickup', {
    request_id: requestId,
    input,
    expected_revision: expectedRevision,
  });
  throwDataError(error);
  return mapPickup(unwrapRow<PickupRow>(data));
}

export async function respondToPickup(
  client: SupabaseClient,
  requestId: string,
  revision: number,
  action: 'agree' | 'request_change',
  note = '',
): Promise<PickupArrangement> {
  const { data, error } = await client.rpc('respond_pickup', {
    request_id: requestId,
    expected_revision: revision,
    action,
    note,
  });
  throwDataError(error);
  return mapPickup(unwrapRow<PickupRow>(data));
}

export async function reportResource(
  client: SupabaseClient,
  resourceId: string,
  reason: 'unsafe' | 'prohibited' | 'misleading' | 'other',
  note = '',
): Promise<string> {
  const { data, error } = await client.rpc('report_resource', {
    resource_id: resourceId,
    reason,
    note,
  });
  throwDataError(error);
  return data as string;
}
