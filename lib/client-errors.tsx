'use client';

let sent = 0; const seen = new Set<string>();
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

// Sends what went wrong in this browser to the server's log: the message, the stack and where, never what was typed.
// The same message is sent once, and at most ten per page load.
export function reportClientError(source: string, error: unknown, extra: { stage?: string; digest?: string } = {}) {
  try {
    const known = error as { message?: unknown; stack?: unknown; status?: unknown; code?: unknown } | null;
    const message = (typeof error === 'string' ? error : text(known?.message)) || 'Unknown error';
    const key = `${source}:${message}`; if (seen.has(key) || sent >= 10) return; seen.add(key); sent++;
    const body = JSON.stringify({ source, message, stack: text(known?.stack), status: text(known?.status), code: text(known?.code), path: location.pathname, ...extra });
    void fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* Reporting must never become a second error. */ }
}

// The listeners are attached when this module first runs in the browser, not in an effect: effects wait for hydration,
// which comes after the page load event, so an error thrown in the first moments of a page would be lost.
const attachedKey = '__gtmworksClientErrorListeners';
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>)[attachedKey]) {
  (window as unknown as Record<string, unknown>)[attachedKey] = true;
  window.addEventListener('error', (event: ErrorEvent) => reportClientError('page', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportClientError('promise', event.reason));
}

export function ClientErrorReporter() {
  return null;
}
