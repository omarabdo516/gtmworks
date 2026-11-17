import net from 'node:net';

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

// Loaded before every test process (`npm test`, the Playwright and Vitest configs, the servers the browser suite starts):
// a connection to an outside host is refused before any lookup, and the host is named once on stderr. In a `node --test`
// file the refusal also fails the file at exit, so a request whose error was swallowed still turns the run red.
const installed = Symbol.for('gtmworks.offline');
if (!net.Socket.prototype.connect[installed]) {
  const connect = net.Socket.prototype.connect, refused = new Set();
  const target = args => {
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    if (first && typeof first === 'object') return first.path ? undefined : { host: first.host || 'localhost', port: first.port };
    if (typeof first === 'string' && !/^\d+$/.test(first)) return undefined;
    return { host: typeof second === 'string' ? second : 'localhost', port: first };
  };
  net.Socket.prototype.connect = Object.assign(function (...args) {
    const to = target(args);
    if (!to || isLocalHost(to.host)) return connect.apply(this, args);
    const message = `offline test run: refused a connection to ${to.host}:${to.port} (tests/offline.mjs)`;
    if (!refused.has(to.host)) { refused.add(to.host); process.stderr.write(`${message}\n`); }
    process.nextTick(() => this.destroy(Object.assign(new Error(message), { code: 'ECONNREFUSED' })));
    return this;
  }, { [installed]: true });
  if (process.env.NODE_TEST_CONTEXT) process.on('exit', () => {
    if (!refused.size) return;
    process.exitCode = 1;
    process.stderr.write(`offline test run: this file tried to reach ${[...refused].join(', ')} (tests/offline.mjs)\n`);
  });
}
