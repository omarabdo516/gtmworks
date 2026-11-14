'use client';
import { useI18n } from '@/lib/i18n-client';

import NextLink, { useLinkStatus } from 'next/link';
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

/** The pages whose data the browser is fetching right now (a navigation or a refresh on its way). */
export const pendingPagePaths = () => [...requests].map(request => request.path);

export function NavigationFeedback() {
  useLayoutEffect(trackPageRequests, []);
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
  return pending ? <Feedback href={href} /> : null;
}

export default function Link({ children, ...props }: ComponentProps<typeof NextLink>) {
  const target = props.as || props.href;
  const href = typeof target === 'string' ? target : target.pathname || '';
  return <NextLink {...props} prefetch>{children}<Pending href={href} /></NextLink>;
}
