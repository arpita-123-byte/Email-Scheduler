'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load (or after the key changes) — drives skeletons. */
  loading: boolean;
  /** True while any request is in flight, including background refreshes. */
  refreshing: boolean;
}

/**
 * Fetches `fn` whenever `key` changes and re-fetches every `intervalMs`
 * (while the tab is visible), so the tables update live as the worker sends.
 */
export function usePolledQuery<T>(fn: () => Promise<T>, key: string, intervalMs = 5000) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true, refreshing: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const requestId = useRef(0);

  const run = useCallback(async (isInitial: boolean) => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: isInitial ? true : s.loading, refreshing: true }));
    try {
      const data = await fnRef.current();
      if (id === requestId.current) setState({ data, error: null, loading: false, refreshing: false });
    } catch (err) {
      if (id === requestId.current)
        setState((s) => ({ ...s, error: (err as Error).message, loading: false, refreshing: false }));
    }
  }, []);

  useEffect(() => {
    void run(true);
    if (!intervalMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [key, intervalMs, run]);

  const refetch = useCallback(() => run(false), [run]);
  return { ...state, refetch };
}
