import { existsSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// What a test may reach (#266): this machine, and the special-use names of RFC 6761, which are never delegated, so no
// request to them can reach an outside server. Everything else is outside, example.com and private LAN ranges included.
const localNames = [/^localhost$/, /\.(localhost|test|example|invalid)$/];
const localAddresses = [/^127(\.\d{1,3}){3}$/, /^::1$/, /^::ffff:(127(\.\d{1,3}){3}|7f[0-9a-f]{2}:[0-9a-f]{1,4})$/, /^0\.0\.0\.0$/, /^::$/];

export const isLocalHost = host => {
  const name = String(host).toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  return [...localNames, ...localAddresses].some(pattern => pattern.test(name));
};

export const isLocalUrl = url => {
  const { protocol, hostname } = new URL(url);
  return !['http:', 'https:', 'ws:', 'wss:'].includes(protocol) || isLocalHost(hostname);
};

// A proxy nothing answers, which every local name bypasses: a browser launched behind it fails every outside request,
// WebSocket and redirect hop at the proxy, before any lookup.
export const nowhere = { server: 'http://127.0.0.1:9', bypass: 'localhost,*.localhost,*.test,*.example,*.invalid,127.0.0.0/8,[::1],0.0.0.0' };

// The URLs the browser guards stop to look at: every http and WebSocket address but the plainly local ones. A RegExp is
// matched inside the browser's driver, so local requests are never paused; a function would send every request, each
// of the app's own scripts included, to the test process first. It may take in a local address it cannot tell, which
// the handler then lets through; it never leaves out an outside one.
export const maybeOutside = /^(?:https?|wss?):\/\/(?!(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|[^/?#:@]*\.(?:localhost|test|example|invalid))(?::\d+)?(?:[/?#]|$))/i;

/**
 * A browser context (Playwright's, also under Vitest) reaches nothing outside: outside requests and WebSockets are
 * stopped, and `note` is told each host. A redirect from a local address to an outside one is followed by Chromium
 * without asking the route again, so that hop is named here and stopped by `nowhere`.
 * @param {import('@playwright/test').BrowserContext} context @param {(host: string) => void} note
 */
export function blockOutside(context, note) {
  const named = url => note(new URL(url).host);
  context.on('request', request => { if (request.redirectedFrom() && !isLocalUrl(request.url())) named(request.url()); });
  return Promise.all([
    context.route(maybeOutside, route => {
      if (isLocalUrl(route.request().url())) return route.fallback();
      named(route.request().url());
      return route.abort('blockedbyclient');
    }),
    context.routeWebSocket(maybeOutside, socket => {
      if (isLocalUrl(socket.url())) return void socket.connectToServer();
      named(socket.url());
      return socket.close();
    }),
  ]);
}

// Loaded before every test process (`npm test`, the Playwright and Vitest configs, the servers the browser suite starts):
// a connection to an outside host is refused before any lookup, and the host is named once on stderr. In a `node --test`
// file the refusal also fails the file at exit, so a request whose error was swallowed still turns the run red.
const installed = Symbol.for('gtmworks.offline');
// What NODE_OPTIONS held before the guard added itself, for the one process that must reach outside: the app build
// fetches its Google fonts (scripts/web.sh).
export const nodeOptionsBefore = process.env.NODE_OPTIONS ?? '';
if (!net.Socket.prototype.connect[installed]) {
  const connect = net.Socket.prototype.connect, refused = new Set();
  const target = args => {
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    if (first && typeof first === 'object') return first.path ? undefined : { host: first.host || 'localhost', port: first.port };
    if (typeof first === 'string' && !(Number(first) >= 0)) return undefined; // Node's own test for a pipe name
    return { host: typeof second === 'string' ? second : 'localhost', port: first };
  };
  net.Socket.prototype.connect = Object.assign(function (...args) {
    const to = target(args);
    if (!to || isLocalHost(to.host)) return connect.apply(this, args);
    const message = `offline test run: refused a connection to ${to.host}:${String(to.port).trim()} (tests/offline.mjs)`;
    if (!refused.has(to.host)) { refused.add(to.host); process.stderr.write(`${message}\n`); }
    process.nextTick(() => this.destroy(Object.assign(new Error(message), { code: 'ECONNREFUSED' })));
    return this;
  }, { [installed]: true });
  // Every node process a test starts inherits the guard, and under `node --test` each one that was refused fails at exit.
  // Every runner starts in the repository (Playwright loads this file as CommonJS, so it has no import.meta), and the
  // children get the absolute address, wherever they run.
  const self = resolve('tests/offline.mjs');
  if (existsSync(self) && !nodeOptionsBefore.includes(self)) process.env.NODE_OPTIONS = [nodeOptionsBefore, `--import=${pathToFileURL(self).href}`].filter(Boolean).join(' ');
  if (process.env.NODE_TEST_CONTEXT) process.on('exit', () => {
    if (!refused.size) return;
    process.exitCode = 1;
    process.stderr.write(`offline test run: this file tried to reach ${[...refused].join(', ')} (tests/offline.mjs)\n`);
  });
}
