import type { SupabaseClient } from '@supabase/supabase-js';
import { throwDataError } from './resources';

/** Delete exactly the displayed selection; the database rechecks ownership and status. */
export async function deleteResourceDrafts(client: SupabaseClient, ids: string[]): Promise<void> {
  const { error } = await client.rpc('delete_resource_drafts', { resource_ids: ids });
  throwDataError(error);
}
