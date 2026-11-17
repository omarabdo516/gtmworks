import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isLocalHost, isLocalUrl } from './offline.mjs';

// A test run reaches nothing outside this machine (#266): `npm test` loads tests/offline.mjs before every file, so a
// connection to an outside host is refused and named, and a file that swallowed the refusal still fails.
const provider = ['api', 'openai', 'com'].join('.');

test('this machine and the never-delegated special-use names are local; every other host is outside', () => {
  const local = ['localhost', 'LOCALHOST', 'app.localhost', 'app.gtmworks.test', 'auth.provider.test', 'www.example', 'nowhere.invalid',
    '127.0.0.1', '127.255.255.254', '::1', '[::1]', '::ffff:127.0.0.1', '[::ffff:7f00:1]', '0.0.0.0', '::', 'localhost.'];
  const outside = ['example.com', 'outside.example.org', '10.0.0.1', '192.168.1.10', '172.16.0.1', '8.8.8.8', provider,
    'test', 'localhost.com', 'mytest', 'example', '128.0.0.1', '::2', '::ffff:10.0.0.1'];
  assert.deepEqual(local.filter(host => !isLocalHost(host)), []);
  assert.deepEqual(outside.filter(isLocalHost), []);
  assert.ok(isLocalUrl('http://127.0.0.1:3000/sign-in') && isLocalUrl('https://app.gtmworks.test/') && isLocalUrl('ws://localhost:5173/'));
  assert.ok(isLocalUrl('data:image/png;base64,AAAA') && isLocalUrl('blob:http://127.0.0.1/x') && isLocalUrl('about:blank'));
  assert.ok(!isLocalUrl('https://outside.example.org/probe.png') && !isLocalUrl(`wss://${provider}/`));
});

test('a server on 127.0.0.1 and on localhost still answers under the guard', async () => {
  const server = createServer((_, response) => response.end('here'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const { port } = server.address();
    for (const host of ['127.0.0.1', 'localhost']) assert.equal(await (await fetch(`http://${host}:${port}/`)).text(), 'here', host);
  } finally { server.close(); }
});

test('a file that swallows a refused outside request fails, and the run names the host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-'));
  try {
    writeFileSync(join(dir, 'swallow.test.mjs'), [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('swallows an outside request', async () => { await fetch('https://outside.example.org/').catch(() => {}); });",
      "test('the refusal names the host and reads as refused', async () => {",
      "  const error = await fetch('https://outside.example.org/').then(() => undefined, error => error.cause);",
      "  assert.equal(error?.code, 'ECONNREFUSED');",
      "  assert.equal(error.message, 'offline test run: refused a connection to outside.example.org:443 (tests/offline.mjs)');",
      '});',
    ].join('\n'));
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('tests/offline.mjs')).href, '--test', '--test-reporter=spec', join(dir, 'swallow.test.mjs')], { encoding: 'utf8', env });
    const output = run.stdout + run.stderr;
    assert.notEqual(run.status, 0, output);
    assert.match(output, /refused a connection to outside\.example\.org:443/);
    assert.match(output, /✔ the refusal names the host and reads as refused/);
    assert.match(output, /✔ swallows an outside request/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
