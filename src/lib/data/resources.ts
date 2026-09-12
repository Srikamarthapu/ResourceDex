import type { SupabaseClient } from '@supabase/supabase-js';
import type { Area, Category, Profile, Resource } from '@/lib/types';

export interface ResourceFilters {
  search?: string;
  category?: Category | '';
  areaId?: string;
  page?: number;
  pageSize?: number;
  includeReserved?: boolean;
}

export type ResourceSaveInput = Pick<
  Resource,
  | 'title'
  | 'category'
  | 'description'
  | 'quantity'
  | 'unit'
  | 'lot_label'
  | 'condition'
  | 'working_status'
  | 'material'
  | 'dimensions'
  | 'area_id'
  | 'image_path'
  | 'image_alt'
> & { scan_id?: string | null; candidate_id?: string | null };

/** PostgREST may encode a composite function result as a one-row array. */
export function unwrapRow<T>(data: T | T[]): T {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) throw new Error('The server returned no result. Refresh and try again.');
  return value;
}

export function throwDataError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (/JWT|refresh_token|not authenticated/i.test(error.message)) {
    throw new Error('Your session expired. Sign in again to continue.');
  }
  if (/fetch failed|Failed to fetch|NetworkError/i.test(error.message)) {
    throw new Error('Could not reach ResourceDex. Check your connection and try again.');
  }
  const validationMessages: Record<string, string> = {
    '23514': 'Check the required fields and allowed lengths, then try again.',
    '23503':
      'A selected photo, pickup area or resource is no longer available. Refresh and try again.',
    '23505': 'This item was already saved or requested. Refresh to see its current state.',
    '22P02': 'A supplied value is invalid. Check the form and try again.',
  };
  throw new Error((error.code && validationMessages[error.code]) || error.message);
}

export async function listResources(
  client: SupabaseClient,
  filters: ResourceFilters = {},
): Promise<Resource[]> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 24, 1), 100);
  const page = Math.max(filters.page ?? 0, 0);
  let query = client
    .from('resources')
    .select('*')
    .in('status', filters.includeReserved === true ? ['available', 'reserved'] : ['available'])
    .eq('moderation_state', 'visible')
    .order('status', { ascending: true })
    .order('published_at', { ascending: false })
    .order('id', { ascending: true });
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.areaId) query = query.eq('area_id', filters.areaId);
  const search = filters.search?.trim().slice(0, 100);
  if (search)
    query = query.textSearch('search_document', search, { type: 'websearch', config: 'english' });
  const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
  throwDataError(error);
  return (data ?? []) as Resource[];
}

export async function getResource(client: SupabaseClient, id: string): Promise<Resource | null> {
  const { data, error } = await client.from('resources').select('*').eq('id', id).maybeSingle();
  throwDataError(error);
  return data as Resource | null;
}

export async function listMyResources(client: SupabaseClient): Promise<Resource[]> {
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  throwDataError(authError);
  if (!user) throw new Error('Sign in to see your resources.');
  const { data, error } = await client
    .from('resources')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true });
  throwDataError(error);
  return (data ?? []) as Resource[];
}

export async function saveResource(
  client: SupabaseClient,
  input: ResourceSaveInput,
  id?: string,
  expectedRevision?: number,
): Promise<Resource> {
  const { data, error } = await client.rpc('save_resource', {
    input,
    resource_id: id ?? null,
    expected_revision: expectedRevision ?? null,
  });
  // A prior scan-candidate save may have committed before a connection failed.
  // Recover its durable draft without overwriting any subsequent owner edits.
  if (error?.code === '23505' && !id && input.scan_id && input.candidate_id) {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      const existing = await client
        .from('resources')
        .select('*')
        .eq('owner_id', user.id)
        .eq('scan_id', input.scan_id)
        .eq('candidate_id', input.candidate_id)
        .eq('status', 'draft')
        .maybeSingle();
      if (!existing.error && existing.data) return existing.data as Resource;
    }
  }
  throwDataError(error);
  return unwrapRow<Resource>(data);
}

/** Keep the operation key across retries until the publication result is known. */
export async function publishResources(
  client: SupabaseClient,
  ids: string[],
  operationKey: string,
  expectedRevisions: Record<string, number>,
): Promise<string[]> {
  const { data, error } = await client.rpc('publish_resources', {
    resource_ids: ids,
    operation_key: operationKey,
    expected_revisions: expectedRevisions,
  });
  throwDataError(error);
  return (data as { resource_ids: string[] }).resource_ids;
}

export async function withdrawResource(client: SupabaseClient, id: string): Promise<Resource> {
  const { data, error } = await client.rpc('withdraw_resource', { resource_id: id });
  throwDataError(error);
  return unwrapRow<Resource>(data);
}

export async function listAreas(client: SupabaseClient): Promise<Area[]> {
  const { data, error } = await client.from('areas').select('*').eq('active', true).order('label');
  throwDataError(error);
  return (data ?? []) as Area[];
}

export async function getProfiles(client: SupabaseClient, ids: string[]): Promise<Profile[]> {
  if (!ids.length) return [];
  const { data, error } = await client
    .from('profiles')
    .select('id,display_name')
    .in('id', [...new Set(ids)]);
  throwDataError(error);
  return (data ?? []) as Profile[];
}

/** Storage RLS rechecks current listing visibility before each short-lived URL. */
export async function getResourceImageUrl(
  client: SupabaseClient,
  resource: Pick<Resource, 'image_path'>,
): Promise<string | null> {
  if (!resource.image_path) return null;
  const { data, error } = await client.storage
    .from('listing-images')
    .createSignedUrl(resource.image_path, 300);
  if (error) return null;
  return data.signedUrl;
}
