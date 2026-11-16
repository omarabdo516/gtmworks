import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mapRules, startRelay } from '../scripts/browser-netns.mjs';
import { launchOptionsFor } from './lane.mjs';

// On Omar's PC the browser runs in a network namespace of its own and reaches the job's addresses only through this
// relay (#241). Whether the namespace keeps net::ERR_NETWORK_CHANGED out is proven on the PC itself (PR for #241).

const listen = (server, ...at) => new Promise(done => server.listen(...at, () => done(server)));

// One SOCKS5 CONNECT to `host`:`port` as Chromium sends it (a domain name), then `payload`; resolves with the reply
// code and what came back.
function socks(path, host, port, payload) {
 return new Promise((done, fail) => {
  const socket = connect(path);
  let received = Buffer.alloc(0);
  socket.on('error', fail);
  socket.on('data', chunk => {
   received = Buffer.concat([received, chunk]);
   if (received.length === 2) {
    const name = Buffer.from(host);
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255]), payload]));
   }
  });
  socket.on('end', () => done({ code: received[3], body: received.subarray(12).toString() }));
  socket.write(Buffer.from([5, 1, 0]));
 });
}

test('the relay connects where the browser\'s own MAP rule says and carries bytes both ways', async t => {
 const dir = mkdtempSync(join(tmpdir(), 'netns-test-'));
 const upstream = await listen(createServer(client => client.once('data', data => client.end(`echo ${data}`))), 0, '127.0.0.1');
 const relay = await startRelay(join(dir, 'socks'), mapRules(['--no-sandbox', '--host-resolver-rules=MAP app.gtmworks.test 127.0.0.1']));
 t.after(() => { relay.close(); upstream.close(); rmSync(dir, { recursive: true, force: true }); });
 const { port } = upstream.address();
 assert.deepEqual(await socks(join(dir, 'socks'), 'APP.gtmworks.test', port, Buffer.from('hello')), { code: 0, body: 'echo hello' });
 assert.deepEqual(await socks(join(dir, 'socks'), '127.0.0.1', port, Buffer.from('again')), { code: 0, body: 'echo again' });
 // A refused connection is answered as one, so the browser reports it instead of waiting.
 const closed = await listen(createServer(), 0, '127.0.0.1');
 const free = closed.address().port;
 await new Promise(done => closed.close(done));
 assert.equal((await socks(join(dir, 'socks'), '127.0.0.1', free, Buffer.alloc(0))).code, 5);
});

test('only MAP rules the relay can apply are accepted', () => {
 assert.deepEqual([...mapRules(['--host-resolver-rules=MAP a.test 127.0.0.1, MAP b.test ::1'])], [['a.test', '127.0.0.1'], ['b.test', '::1']]);
 assert.throws(() => mapRules(['--host-resolver-rules=MAP *.test 127.0.0.1']), /unsupported/);
 assert.throws(() => mapRules(['--host-resolver-rules=EXCLUDE a.test']), /unsupported/);
});

test('the browser runs in its own network namespace on the self-hosted runner only', t => {
 const saved = { ...process.env };
 t.after(() => { process.env = saved; });
 const args = ['--host-resolver-rules=MAP app.gtmworks.test 127.0.0.1'];
 delete process.env.GTMWORKS_BROWSER_NETNS;
 process.env.RUNNER_ENVIRONMENT = 'github-hosted';
 assert.deepEqual(launchOptionsFor(args), { args });
 process.env.RUNNER_ENVIRONMENT = 'self-hosted';
 process.env.GTMWORKS_BROWSER_EXECUTABLE = '/browser';
 assert.deepEqual(launchOptionsFor(args), { args, executablePath: resolve('scripts/browser-netns.mjs') });
});
