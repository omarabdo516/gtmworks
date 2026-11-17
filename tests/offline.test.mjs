import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isLocalHost, isLocalUrl, maybeOutside, nowhere } from './offline.mjs';

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

test('the browsers stop every outside address to look at it, and leave the lanes\' own addresses alone', () => {
  const outside = ['https://outside.example.org/probe.png', 'http://example.com/', 'wss://socket.example.org/live', `https://${provider}/v1`,
    'http://10.0.0.1:3000/', 'http://localhost.com/', 'http://app.test.evil.com/', 'http://localhost@outside.example.org/', 'HTTPS://OUTSIDE.EXAMPLE.ORG/'];
  const local = ['http://127.0.0.1:3000/sign-in', 'http://localhost:5173/@vite/client', 'ws://localhost:5173/', 'https://app.gtmworks.test/',
    'http://127.0.0.1:54621/rest/v1/cards?select=*', 'https://auth.provider.test/codex/device', 'http://[::1]:3000/'];
  assert.deepEqual(outside.filter(url => !maybeOutside.test(url)), []);
  assert.deepEqual(local.filter(url => maybeOutside.test(url)), []);
  assert.deepEqual([...outside, ...local].filter(url => !isLocalUrl(url) && !maybeOutside.test(url)), [], 'every outside address is stopped');
});

// Playwright's own rule for a context's API requests (playwright-core's shouldBypassProxy): a name suffix match.
const bypassed = url => nowhere.bypass.split(',').map(rule => (rule.startsWith('.') ? rule : `.${rule}`)).some(rule => `.${new URL(url).hostname}`.endsWith(rule));

test('a test\'s API requests to the lanes skip the browser\'s dead proxy, and outside ones do not', () => {
  const lanes = ['http://127.0.0.1:3001/api/hermes-connections', 'http://127.0.0.1:64024/api/v1/messages', 'http://localhost:3000/', 'https://app.gtmworks.test/c/rs-learning', 'http://[::1]:3000/'];
  assert.deepEqual(lanes.filter(url => !bypassed(url)), []);
  assert.deepEqual(['https://outside.example.org/', 'http://example.com/', `https://${provider}/`].filter(bypassed), []);
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
      "import net from 'node:net';",
      "import { spawnSync } from 'node:child_process';",
      "test('swallows an outside request', async () => { await fetch('https://outside.example.org/').catch(() => {}); });",
      "test('the refusal names the host and reads as refused', async () => {",
      "  const error = await fetch('https://outside.example.org/').then(() => undefined, error => error.cause);",
      "  assert.equal(error?.code, 'ECONNREFUSED');",
      "  assert.equal(error.message, 'offline test run: refused a connection to outside.example.org:443 (tests/offline.mjs)');",
      '});',
      "test('a process the test starts refuses too, and fails', () => {",
      "  const child = spawnSync(process.execPath, ['-e', \"fetch('https://child.example.org/').catch(error => console.log(error.cause.message))\"], { encoding: 'utf8' });",
      "  assert.equal(child.stdout.trim(), 'offline test run: refused a connection to child.example.org:443 (tests/offline.mjs)');",
      "  assert.equal(child.status, 1);",
      '});',
      "test('a port written as a padded string is still a port', async () => {",
      "  const error = await new Promise(done => new net.Socket().on('error', done).connect(' 443', '8.8.8.8'));",
      "  assert.equal(error.message, 'offline test run: refused a connection to 8.8.8.8:443 (tests/offline.mjs)');",
      '});',
    ].join('\n'));
    const env = { ...process.env, NODE_TEST_CONTEXT: undefined };
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('tests/offline.mjs')).href, '--test', '--test-reporter=spec', join(dir, 'swallow.test.mjs')], { encoding: 'utf8', env });
    const output = run.stdout + run.stderr;
    assert.notEqual(run.status, 0, output);
    assert.match(output, /refused a connection to outside\.example\.org:443/);
    assert.match(output, /✔ the refusal names the host and reads as refused/);
    assert.match(output, /✔ swallows an outside request/);
    assert.match(output, /✔ a port written as a padded string is still a port/);
    assert.match(output, /✔ a process the test starts refuses too, and fails/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The proofs above load the guard themselves, so this pins that every runner still loads it.
// The compared screens and the small visual lane (#257, playwright.lane.config.ts, its own outside-request guard) are #257's.
test('every test runner loads the guard, and every browser spec but the compared screens uses the guarded test', () => {
  const read = path => readFileSync(path, 'utf8');
  assert.match(JSON.parse(read('package.json')).scripts.test, /^node --import \.\/tests\/offline\.mjs --test /);
  assert.match(read('ci.sh'), /node --import \.\/tests\/offline\.mjs --test /);
  for (const config of ['playwright.config.ts', 'playwright.proxy.config.ts', 'vitest.config.mts']) assert.match(read(config), /from '\.\/tests\/offline\.mjs'|import '\.\/tests\/offline\.mjs'/, config);
  assert.match(read('vitest.config.mts'), /setupFiles: \['tests\/components\/offline-setup\.ts'\]/);
  assert.match(read('tests/fresh-seed.ts'), /from '\.\/offline-browser'/);
  const specs = globSync('tests/**/*.spec.ts').filter(path => path !== 'tests/visual.spec.ts' && !/^tests\/visual-lane[^/]*\.spec\.ts$/.test(path));
  assert.deepEqual(specs.filter(path => !/import \{[^}]*\btest\b[^}]*\} from '\.\.?\/(fresh-seed|offline-browser)'/.test(read(path))), []);
});
