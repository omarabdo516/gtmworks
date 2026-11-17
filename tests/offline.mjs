import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// What a test may reach (#266): this machine, and the special-use names of RFC 6761, which are never delegated, so no
// request to them can reach an outside server. Everything else is outside, example.com and private LAN ranges included.
// The node guard, both browser guards and the browsers' proxy bypass all read this one table.
const local = { names: ['localhost'], suffixes: ['.localhost', '.test', '.example', '.invalid'], addresses: ['127.0.0.1', '::1', '0.0.0.0', '::'], loopback: '127.0.0.0/8' };
const loopbackV4 = /^(?:::ffff:)?127(?:\.\d{1,3}){3}$|^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/;

export const isLocalHost = host => {
  const name = String(host).toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  return local.names.includes(name) || local.suffixes.some(suffix => name.endsWith(suffix)) || local.addresses.includes(name) || loopbackV4.test(name);
};

export const isLocalUrl = url => {
  const { protocol, hostname } = new URL(url);
  return !['http:', 'https:', 'ws:', 'wss:'].includes(protocol) || isLocalHost(hostname);
};

// A proxy nothing answers, which every local name bypasses: a browser launched behind it fails every outside request,
// WebSocket and redirect hop at the proxy, before any lookup, and keeps its cache and headers as they are, which a route
// would not. A context's `page.request` takes the proxy too, and Playwright matches its bypass by name suffix only, so
// each entry is in the form both read (`.test`, not `*.test`) and 127.0.0.1 is named beside the range Chromium reads.
export const nowhere = { server: 'http://127.0.0.1:9', bypass: [...local.names, ...local.suffixes, ...local.addresses.map(address => (address.includes(':') ? `[${address}]` : address)), local.loopback].join(',') };

/**
 * Names each outside address a browser context behind `nowhere` tried, a WebSocket, a redirect hop and a call of its
 * `page.request` included. That API client emits no request event, follows redirects itself and reaches the proxy on
 * this machine; an outside call of it always fails at the proxy, and its error lists each address it asked for,
 * resolved against the context's base address, so the hosts are read from there.
 * @param {import('@playwright/test').BrowserContext} context @param {(host: string) => void} note
 */
export function watchOutside(context, note) {
  const seen = url => { if (!isLocalUrl(url)) note(new URL(url).host); };
  const watchPage = page => page.on('websocket', socket => seen(socket.url()));
  context.on('request', request => seen(request.url()));
  context.on('page', watchPage);
  context.pages().forEach(watchPage);
  // `get`, `post` and the others go through `fetch`.
  const api = context.request, call = api.fetch.bind(api);
  api.fetch = (...args) => call(...args).catch(error => {
    new Set([...String(error?.message).matchAll(/→ [A-Z]+ ([a-z][a-z0-9+.-]*:\/\/\S+)/g)].map(([, url]) => url)).forEach(seen);
    throw error;
  });
}

// This file, found from its own call site: it loads as ES module and, from a Playwright config, as CommonJS, which has no
// import.meta.
const ownUrl = (() => {
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) => sites;
  const file = new Error().stack[0].getFileName();
  Error.prepareStackTrace = prepare;
  return file.startsWith('file:') ? file : pathToFileURL(file).href;
})();
const ownImport = new RegExp(`\\s*--import[= ]${ownUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');

// What NODE_OPTIONS holds without the guard, for the one process that must reach outside: the app build fetches its
// Google fonts (scripts/web.sh).
export const nodeOptionsBefore = (process.env.NODE_OPTIONS ?? '').replace(ownImport, '').trim();

// Every refusal of a run, by any process the run started (a server or worker that swallowed its error included), is
// written to one file; the run's teardown fails naming each (below). A run without one makes its own.
const logKey = 'GTMWORKS_OFFLINE_LOG';
export const freshLog = () => { process.env[logKey] = join(mkdtempSync(join(tmpdir(), 'gtmworks-offline-')), 'refused.log'); };
export function assertNothingRefused(log = process.env[logKey]) {
  let lines = [];
  try { lines = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* nothing was refused */ }
  if (lines.length) throw new Error(`offline test run: a process of this run tried to reach outside (tests/offline.mjs):\n${lines.join('\n')}`);
}

// Loaded before every test process (`npm test`, the Playwright and Vitest configs, and through NODE_OPTIONS every node
// process they start): a connection to an outside host is refused before any lookup and named on stderr and in the
// run's log. In a `node --test` file the refusal also fails the file at exit, so a swallowed request still turns it red.
const installed = Symbol.for('gtmworks.offline');
if (!net.Socket.prototype.connect[installed]) {
  const connect = net.Socket.prototype.connect, refused = new Set();
  const target = args => {
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    if (first && typeof first === 'object') return first.path ? undefined : { host: first.host || 'localhost', port: first.port };
    if (typeof first === 'string' && !(Number(first) >= 0)) return undefined; // Node's own test for a pipe name
    return { host: typeof second === 'string' ? second : 'localhost', port: first };
  };
  if (!process.env[logKey]) freshLog();
  net.Socket.prototype.connect = Object.assign(function (...args) {
    const to = target(args);
    if (!to || isLocalHost(to.host)) return connect.apply(this, args);
    const message = `offline test run: refused a connection to ${to.host}:${String(to.port).trim()} (tests/offline.mjs)`;
    if (!refused.has(to.host)) {
      refused.add(to.host);
      process.stderr.write(`${message}\n`);
      try { appendFileSync(process.env[logKey], `${to.host} by ${process.argv.slice(1).join(' ')}\n`); } catch { /* the run's log is gone; stderr has it */ }
    }
    process.nextTick(() => this.destroy(Object.assign(new Error(message), { code: 'ECONNREFUSED' })));
    return this;
  }, { [installed]: true });
  process.env.NODE_OPTIONS = [nodeOptionsBefore, `--import=${ownUrl}`].filter(Boolean).join(' ');
  if (process.env.NODE_TEST_CONTEXT) process.on('exit', () => {
    if (!refused.size) return;
    process.exitCode = 1;
    process.stderr.write(`offline test run: this file tried to reach ${[...refused].join(', ')} (tests/offline.mjs)\n`);
  });
}
