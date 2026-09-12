import { z } from 'zod';
import { hasValidRequestOrigin } from '@/lib/ai/request-origin';
import { AccountDeletionError, deleteCurrentAccount } from '@/lib/account-deletion';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const deletionSchema = z
  .object({ password: z.string().min(1).max(128), confirmation: z.literal('DELETE') })
  .strict();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function DELETE(request: Request) {
  try {
    if (!hasValidRequestOrigin(request)) {
      throw new AccountDeletionError(403, 'This request could not be verified.');
    }
    if (!request.headers.get('content-type')?.includes('application/json')) {
      throw new AccountDeletionError(400, 'Check the confirmation fields and try again.');
    }
    if (Number(request.headers.get('content-length') ?? 0) > 2048) {
      throw new AccountDeletionError(413, 'The request is too large.');
    }
    const body = await request.text();
    if (Buffer.byteLength(body) > 2048)
      throw new AccountDeletionError(413, 'The request is too large.');
    let input: z.infer<typeof deletionSchema>;
    try {
      input = deletionSchema.parse(JSON.parse(body));
    } catch {
      throw new AccountDeletionError(400, 'Enter your password and type DELETE to confirm.');
    }
    const client = await createServerSupabaseClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      throw new AccountDeletionError(401, 'Sign in before deleting your account.');
    await deleteCurrentAccount(data.user, input.password, createAdminSupabaseClient());
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return json({ deleted: true });
  } catch (failure) {
    if (failure instanceof AccountDeletionError) {
      return json({ error: failure.message, deletionStarted: failure.started }, failure.status);
    }
    return json({ error: 'Account deletion is unavailable. Try again.' }, 503);
  }
}
