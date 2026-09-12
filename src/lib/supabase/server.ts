import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './config';

export async function createServerSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; the proxy refreshes them.
        }
      },
    },
  });
}

/** For verified server workflows only. Never return this client or key to a browser. */
export function createAdminSupabaseClient() {
  const { url } = getSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Server storage and image analysis are not configured.');
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const createServerSupabase = createServerSupabaseClient;
export const createAdminSupabase = createAdminSupabaseClient;
