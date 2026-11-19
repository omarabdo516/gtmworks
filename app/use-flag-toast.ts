'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ShellIconName } from '@/components/shell-icon';
import { toast } from './toast';

// A notice a page comes back with (#169): the address names what happened, the page says it once, and then the flag
// leaves the address so a reload does not say it again. A flag names a record or an answer, never its text, so an email or
// an Agent's name is never in a link that is copied, mailed or left in a history.
//
// Next's router is told the clean address too: a redirect still being committed when the page arrives would otherwise put
// the flag back on the next move of the page, and the toast would be raised again on a reload.
export function useFlagToast(flags: string[], message: string | null, icon?: ShellIconName) {
 const router = useRouter();
 const names = flags.join(',');
 useEffect(() => {
  if (message === null) return;
  toast(message, icon ? { icon } : undefined);
  const url = new URL(location.href);
  for (const name of names.split(',')) url.searchParams.delete(name);
  const clean = `${url.pathname}${url.search}${url.hash}`;
  history.replaceState(history.state, '', clean);
  router.replace(clean, { scroll: false });
 }, [names, message, icon, router]);
}
