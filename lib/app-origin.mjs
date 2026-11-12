// The one place the app learns its own address. Every absolute URL it hands out (a redirect, the link in a sign-in or
// invitation email, a card link in a webhook) is built here from APP_ORIGIN, read each time. Request headers never build
// one: behind an HTTPS proxy they name the inside of the install, where the gateway always says http (issue #40).
export function appOrigin(env = process.env) {
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
