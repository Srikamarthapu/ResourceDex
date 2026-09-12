import 'server-only';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabase/config';

export class AccountDeletionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly started = false,
  ) {
    super(message);
  }
}

const retryMessage =
  'Deletion has started and your listings are hidden. Some cleanup is still pending. Try deleting again to finish; sign in again if your session has ended.';

/** Remove the full owner prefix, including uploads without image_assets records.
 * Always read page zero: deleting a page shifts the remaining results forward. */
export async function removeAccountPhotos(
  admin: SupabaseClient,
  ownerId: string,
  deadline: number,
) {
  for (const bucket of ['scan-images', 'listing-images']) {
    const storage = admin.storage.from(bucket);
    async function emptyFolder(prefix: string): Promise<void> {
      while (true) {
        if (Date.now() > deadline) throw new AccountDeletionError(503, retryMessage, true);
        const { data: entries, error } = await storage.list(prefix, {
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });
        if (error || !entries) throw new AccountDeletionError(503, retryMessage, true);
        if (entries.length === 0) return;
        const files = entries.filter((entry) => entry.id).map((entry) => `${prefix}/${entry.name}`);
        if (files.length) {
          const { error: removeError } = await storage.remove(files);
          if (removeError) throw new AccountDeletionError(503, retryMessage, true);
        }
        for (const folder of entries.filter((entry) => !entry.id)) {
          await emptyFolder(`${prefix}/${folder.name}`);
        }
      }
    }
    await emptyFolder(ownerId);
  }
}

/** The caller must pass the user returned by Auth.getUser, never request input. */
export async function deleteCurrentAccount(user: User, password: string, admin: SupabaseClient) {
  if (!user.email) throw new AccountDeletionError(400, 'Sign in with your email account first.');
  const { url, key } = getSupabaseConfig();
  // Reauthentication uses an isolated client, so it never replaces the browser's
  // account or persists the password/session in cookies, local storage, or logs.
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (error || !verified.session || verified.user?.id !== user.id) {
    if (verified.session) await verifier.auth.signOut({ scope: 'local' });
    throw new AccountDeletionError(
      403,
      'Your password could not be verified. Check it and try again.',
    );
  }

  let started = false;
  try {
    const { error: startError } = await admin.rpc('begin_account_deletion', { p_owner: user.id });
    if (startError)
      throw new AccountDeletionError(503, 'Account deletion is unavailable. Try again.');
    started = true;
    const { error: recordsError } = await admin.rpc('remove_account_records', { p_owner: user.id });
    if (recordsError) throw new AccountDeletionError(503, retryMessage, true);
    await removeAccountPhotos(admin, user.id, Date.now() + 45_000);
    const { error: signOutError } = await admin.auth.admin.signOut(
      verified.session.access_token,
      'global',
    );
    if (signOutError) throw new AccountDeletionError(503, retryMessage, true);
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new AccountDeletionError(503, retryMessage, true);
  } catch (failure) {
    if (failure instanceof AccountDeletionError) throw failure;
    throw new AccountDeletionError(
      503,
      started ? retryMessage : 'Account deletion is unavailable. Try again.',
      started,
    );
  } finally {
    // Revoke the extra reauthentication session even if cleanup could not start.
    // After a final Auth failure, signing in again can resume the marked deletion.
    await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
