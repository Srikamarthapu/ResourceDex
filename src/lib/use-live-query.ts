'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './format';

/** Poll only visible pages; refresh on focus so availability never depends on a live socket. */
export function useLiveQuery<T>(load: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let pending = false;
    const fetchData = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await load();
        if (mounted) {
          setData(result);
          setError('');
        }
      } catch (failure) {
        if (mounted) setError(errorMessage(failure));
      } finally {
        pending = false;
        if (mounted) setLoading(false);
      }
    };
    void fetchData();
    const onFocus = () => {
      if (document.visibilityState === 'visible') void fetchData();
    };
    const interval = window.setInterval(onFocus, 10_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load, enabled, version]);
  return { data, error, loading: enabled && loading, refresh };
}
