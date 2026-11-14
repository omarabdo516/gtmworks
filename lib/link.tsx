'use client';
import { useI18n } from '@/lib/i18n-client';

import NextLink, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useState, type ComponentProps } from 'react';

const requests = new Set<{ path: string }>();
const started = new EventTarget();

function trackPageRequests() {
  const fetch = window.fetch;
  window.fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.get('RSC') !== '1') return fetch.call(window, input, init);
    const request = { path: new URL(input instanceof Request ? input.url : String(input), location.href).pathname };
    requests.add(request);
    started.dispatchEvent(new Event('start'));
    try {
      const response = await fetch.call(window, input, init);
      // Observe the whole page arriving without consuming or delaying the router's response.
      const done = () => { requests.delete(request); };
      void response.clone().text().then(done, done);
      return response;
    } catch (error) { requests.delete(request); throw error; }
  };
  return () => { window.fetch = fetch; requests.clear(); };
}

// The page a person is opening right now through one of these links (a click or Enter), until it has landed or the
// link stops waiting for it. Prefetches never count: only a link the person activated.
let opening: string | null = null;
/** The page whose navigation the person started and that has not landed yet, if any. */
export const pageBeingOpened = () => opening;

export function NavigationFeedback() {
  useLayoutEffect(trackPageRequests, []);
  // A page that landed is no longer being opened.
  const pathname = usePathname();
  useEffect(() => { opening = null; }, [pathname]);
  return null;
}

function Feedback({ href }: { href: string }) { const {t}=useI18n();
  const path = new URL(href, location.href).pathname;
  const [visible, setVisible] = useState(() => [...requests].some(request => request.path === path));
  useEffect(() => {
    const check = () => { if ([...requests].some(request => request.path === path)) setVisible(true); };
    started.addEventListener('start', check);
    check();
    return () => started.removeEventListener('start', check);
  }, [path]);
  return visible ? <>
    <span className="link-pending" hidden />
    {createPortal(<div className="navigation-progress" role="progressbar" aria-label={t('openingPage')} />, document.body)}
  </> : null;
}

function Pending({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  // The navigation this link started has settled (landed, or given up) once it stops waiting.
  useEffect(() => {
    if (!pending) return;
    const path = new URL(href, location.href).pathname;
    return () => { if (opening === path) opening = null; };
  }, [pending, href]);
  return pending ? <Feedback href={href} /> : null;
}

export default function Link({ children, ...props }: ComponentProps<typeof NextLink>) {
  const target = props.as || props.href;
  const href = typeof target === 'string' ? target : target.pathname || '';
  // A plain click or Enter (which the browser turns into a click) opens the page here; a modified click opens it
  // elsewhere and is not this page being opened.
  const onClick: ComponentProps<typeof NextLink>['onClick'] = event => {
    props.onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!props.target || props.target === '_self')) opening = new URL(href, location.href).pathname;
  };
  return <NextLink {...props} onClick={onClick} prefetch>{children}<Pending href={href} /></NextLink>;
}
