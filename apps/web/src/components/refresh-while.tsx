'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const EVERY_MS = 3000;
/** Stops eventually, e.g. when the worker is down, so an open tab does not poll forever. */
const GIVE_UP_MS = 10 * 60_000;

/**
 * Re-renders the page's server components every few seconds while `active`, so state the
 * worker changes in the background (a file being checked) shows up without a reload.
 */
export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - started > GIVE_UP_MS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
