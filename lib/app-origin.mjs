// The one place the app learns its own address. Every absolute URL it hands out (a redirect, the link in a sign-in or
// invitation email) is built here from APP_ORIGIN, read each time. Request headers never build
// one: behind an HTTPS proxy they name the inside of the install, where the gateway always says http (issue #40).
function appOrigin(env = process.env) {
  return env.APP_ORIGIN || 'http://localhost:3000';
}

export function appUrl(path, env = process.env) {
  return new URL(path, appOrigin(env));
}

// A write sent from a page on another site: its Origin header names a host other than the one the request was sent to.
// This compares the two headers; it builds no URL. An Origin that is not a URL ("null") counts as another site.
export function crossSiteWrite(headers) {
  const origin = headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host !== headers.get('host'); }
  catch { return true; }
}

// The page of this same site a request was asked from (its Referer, when it names the host the request was sent to), as
// a path; null for none or another site's (#869: the Hermes dashboard's code asked for at the root belongs to the
// dashboard page that asked for it).
export function askedFromPath(headers) {
  try {
    const from = new URL(headers.get('referer') ?? '');
    return from.host === headers.get('host') ? from.pathname : null;
  } catch { return null; }
}

// A header that names an address, a site or the way a request came (the host, its origin, the page it came from, or
// any address a client or a proxy claims), which a request passed on to another server leaves behind (#869).
const addressHeaders = new Set(['host', 'origin', 'referer', 'forwarded', 'x-real-ip', 'sb-forwarded-for', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip', 'x-cluster-client-ip', 'fastly-client-ip']);
export const isAddressHeader = name => addressHeaders.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-forwarded-');
