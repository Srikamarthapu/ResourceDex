'use client';

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/browser';

type AppContextValue = { user: User | null; authLoading: boolean; configured: boolean };
const AppContext = createContext<AppContextValue>({
  user: null,
  authLoading: true,
  configured: false,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(configured);
  useEffect(() => {
    if (!configured) return;
    const client = createBrowserSupabaseClient();
    let authVersion = 0;
    let active = true;
    const initialVersion = authVersion;
    client.auth.getUser().then(({ data }) => {
      if (active && initialVersion === authVersion) {
        setUser(data.user);
        setAuthLoading(false);
      }
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      authVersion += 1;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured]);
  return (
    <AppContext.Provider value={{ user, authLoading, configured }}>
      <Fragment key={user?.id ?? 'visitor'}>{children}</Fragment>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
