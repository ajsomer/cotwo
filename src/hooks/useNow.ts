'use client';

import { useEffect, useState } from 'react';

/** Current time, re-evaluated every `intervalMs` (default 30s) so
 *  time-derived display state doesn't go stale on a long-open tab. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
}
