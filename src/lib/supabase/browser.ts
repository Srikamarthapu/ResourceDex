'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig } from './config';

export { isSupabaseConfigured } from './config';

export function createBrowserSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  return createBrowserClient(url, key);
}

export const createBrowserSupabase = createBrowserSupabaseClient;
