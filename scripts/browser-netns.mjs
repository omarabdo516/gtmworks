#!/usr/bin/env node
// Chromium in a network namespace of its own (#241). On Omar's PC every WSL2 distro shares one network namespace, and
// each container another job starts there adds a bridge address or a veth. Chromium closes its HTTP/2 sessions on such a
// change and fails the requests in flight with net::ERR_NETWORK_CHANGED. In a namespace of its own the browser sees only
// its loopback, which never changes. Playwright starts this file as the browser (tests/lane.mjs, launchOptionsFor):
//   1. here, in the job's namespace: a SOCKS5 relay on a Unix socket, which a file system path carries across namespaces,
//      connecting to the address the browser asks for (with the browser's own --host-resolver-rules MAP lines applied);
//   2. `unshare` a user and network namespace, bring its loopback up, and listen there on 127.0.0.1 for the browser;
//   3. the real browser, sent through that listener for every address, loopback included (<-loopback>).
// The CDP pipe (fds 3 and 4) and stdio pass straight through, so Playwright drives the browser as before.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** `MAP <host> <address>` rules from Chromium arguments, as a Map from host name to address. */
export function mapRules(args) {
 const rules = new Map();
 for (const arg of args) {
  const value = arg.match(/^--host-resolver-rules=(.*)$/)?.[1];
  for (const rule of value?.split(',') ?? []) {
   const [verb, host, address, ...rest] = rule.trim().split(/\s+/);
   if (verb !== 'MAP' || !host || !address || rest.length || host.includes('*')) throw new Error(`browser-netns: unsupported host resolver rule "${rule.trim()}"`);
   rules.set(host.toLowerCase(), address);
  }
 }
 return rules;
}

// One SOCKS5 CONNECT (RFC 1928, no authentication): the greeting, then the request, then bytes both ways.
function relay(client, rules) {
 let buffer = Buffer.alloc(0);
 let stage = 'greeting';
 const fail = code => { client.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])); };
 const onData = chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  if (stage === 'greeting') {
   if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
   if (buffer[0] !== 5 || !buffer.subarray(2, 2 + buffer[1]).includes(0)) return client.end(Buffer.from([5, 0xff]));
   buffer = buffer.subarray(2 + buffer[1]);
   client.write(Buffer.from([5, 0]));
   stage = 'request';
  }
  if (stage !== 'request' || buffer.length < 5) return;
  const type = buffer[3];
  const length = { 1: 4, 3: 1 + buffer[4], 4: 16 }[type];
  if (buffer[0] !== 5 || buffer[1] !== 1 || !length) return fail(7);
  if (buffer.length < 4 + length + 2) return;
  const raw = buffer.subarray(4, 4 + length);
  const asked = type === 1 ? [...raw].join('.') : type === 3 ? raw.subarray(1).toString('latin1') : raw.toString('hex').match(/.{4}/g).join(':');
  const port = buffer.readUInt16BE(4 + length);
  const rest = buffer.subarray(4 + length + 2);
  stage = 'open';
  client.off('data', onData);
  const host = rules.get(asked.toLowerCase()) ?? asked;
  const upstream = connect({ host, port, family: isIP(host) || undefined });
  let opened = false;
  upstream.once('connect', () => {
   opened = true;
   client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
   if (rest.length) upstream.write(rest);
   client.pipe(upstream).pipe(client);
  });
  upstream.once('error', error => (!opened ? fail(error.code === 'ECONNREFUSED' ? 5 : 4) : client.destroy()));
  client.once('close', () => upstream.destroy());
  client.once('error', () => upstream.destroy());
 };
 client.on('data', onData);
 client.on('error', () => {});
}

/** The SOCKS5 relay the namespaced browser reaches through `path`; it resolves once it listens. */
export function startRelay(path, rules) {
 const server = createServer(client => relay(client, rules));
 return new Promise((resolve, reject) => server.once('error', reject).listen(path, () => resolve(server)));
}

// Signals Playwright sends the process it started reach the browser; its exit is this process's exit.
function follow(child, done) {
 for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
 child.once('exit', (code, signal) => { done?.(); process.exitCode = code ?? (signal ? 128 : 1); process.exit(); });
}
const passThrough = ['inherit', 'inherit', 'inherit', 3, 4];

async function outside(browser, args) {
 if (!browser) throw new Error('browser-netns: GTMWORKS_BROWSER_EXECUTABLE names no browser');
 if (args.some(arg => arg.startsWith('--proxy-server'))) throw new Error('browser-netns: the browser already has a proxy');
 const dir = mkdtempSync(join(tmpdir(), 'netns-'));
 const socket = join(dir, 'socks');
 const server = await startRelay(socket, mapRules(args));
 const child = spawn('unshare', ['--user', '--map-root-user', '--net', '--', process.execPath, fileURLToPath(import.meta.url), '--inside', socket, browser, ...args], { stdio: passThrough });
 follow(child, () => { server.close(); rmSync(dir, { recursive: true, force: true }); });
}

async function inside(socket, browser, args) {
 execFileSync('ip', ['link', 'set', 'lo', 'up']);
 const listener = createServer(local => {
  const remote = connect(socket);
  for (const end of [local, remote]) end.on('error', () => { local.destroy(); remote.destroy(); });
  local.pipe(remote).pipe(local);
 });
 await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
 const proxy = [`--proxy-server=socks5://127.0.0.1:${listener.address().port}`, '--proxy-bypass-list=<-loopback>'];
 follow(spawn(browser, [...args, ...proxy], { stdio: passThrough }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [first, ...rest] = process.argv.slice(2);
 const run = first === '--inside' ? inside(rest[0], rest[1], rest.slice(2)) : outside(process.env.GTMWORKS_BROWSER_EXECUTABLE, process.argv.slice(2));
 run.catch(error => { console.error(error.message); process.exit(1); });
}
