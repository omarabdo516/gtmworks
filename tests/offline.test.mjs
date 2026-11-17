import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNothingRefused, isLocalHost, isLocalUrl, nowhere } from './offline.mjs';

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
      "  const error = await new Promise(done => new net.Socket().on('error', done).connect(' 443', '192.0.2.1'));",
      "  assert.equal(error.message, 'offline test run: refused a connection to 192.0.2.1:443 (tests/offline.mjs)');",
      '});',
    ].join('\n'));
    const env = { ...process.env, NODE_TEST_CONTEXT: undefined, GTMWORKS_OFFLINE_LOG: undefined, GTMWORKS_OFFLINE_LOG_OWNER: undefined };
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

const guard = pathToFileURL(resolve('tests/offline.mjs')).href;
// Each run here starts its own log, so what it refuses on purpose stays out of this run's.
const node = (args, options = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...options, env: { ...process.env, NODE_TEST_CONTEXT: undefined, GTMWORKS_OFFLINE_LOG: undefined, GTMWORKS_OFFLINE_LOG_OWNER: undefined, ...options.env } });

test('a server that swallows a refused outside request still fails the run\'s teardown, which names the host and the process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-log-')), log = join(dir, 'refused.log');
  try {
    const server = node(['--import', guard, '-e', "fetch('https://server.example.org/').catch(() => {})"], { env: { GTMWORKS_OFFLINE_LOG: log } });
    assert.equal(server.status, 0, 'a server is not stopped for it');
    assert.throws(() => assertNothingRefused(log), /tried to reach outside[\s\S]*server\.example\.org by /);
    assert.doesNotThrow(() => assertNothingRefused(join(dir, 'none.log')), 'a run that refused nothing passes');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every node process a test starts carries the guard once, from any folder and any checkout path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-path-')), spaced = join(dir, 'a checkout', 'tests');
  try {
    mkdirSync(spaced, { recursive: true });
    copyFileSync('tests/offline.mjs', join(spaced, 'offline.mjs'));
    const own = pathToFileURL(join(spaced, 'offline.mjs')).href;
    const nested = "console.log(require('node:child_process').execFileSync(process.execPath, ['-e', 'console.log(process.env.NODE_OPTIONS)'], { encoding: 'utf8' }).trim())";
    const child = node(['--import', own, '-e', nested], { cwd: dir, env: { NODE_OPTIONS: '' } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), `--import=${own}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a node test file fails when a process its test started swallowed a refusal, naming the host, and removes its log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-run-'));
  try {
    writeFileSync(join(dir, 'child.test.mjs'), [
      "import { test } from 'node:test';",
      "import { spawnSync } from 'node:child_process';",
      "test('starts a server that swallows an outside request', () => {",
      "  console.log('log at', process.env.GTMWORKS_OFFLINE_LOG);",
      "  spawnSync(process.execPath, ['-e', \"fetch('https://child-server.example.org/').catch(() => {})\"], { env: { ...process.env, NODE_TEST_CONTEXT: undefined } });",
      '});',
    ].join('\n'));
    const run = node(['--import', guard, '--test', '--test-reporter=spec', join(dir, 'child.test.mjs')]);
    const output = run.stdout + run.stderr;
    assert.match(output, /✔ starts a server that swallows an outside request/);
    assert.notEqual(run.status, 0, output);
    assert.match(output, /a process of this run tried to reach outside[\s\S]*child-server\.example\.org by /);
    const log = output.match(/log at (\S+)/)[1];
    assert.ok(!existsSync(dirname(log)), 'the run removed its log');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('under Vitest, whose bundled config holds the guard, every process it starts still gets the real guard file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-bundle-'));
  try {
    mkdirSync(join(dir, 'tests'));
    copyFileSync('tests/offline.mjs', join(dir, 'tests', 'offline.mjs'));
    mkdirSync(join(dir, 'node_modules', '.vite-temp'), { recursive: true });
    copyFileSync('tests/offline.mjs', join(dir, 'node_modules', '.vite-temp', 'vitest.config.mts.timestamp-1-abc.mjs'));
    const bundle = pathToFileURL(join(dir, 'node_modules', '.vite-temp', 'vitest.config.mts.timestamp-1-abc.mjs')).href;
    const child = node(['--import', bundle, '-e', "console.log(process.env.NODE_OPTIONS)"], { env: { NODE_OPTIONS: '' } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), `--import=${pathToFileURL(join(dir, 'tests', 'offline.mjs')).href}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a test\'s own npm does not ask the registry for a newer npm', () => {
  const child = node(['--import', guard, '-e', "console.log(require('node:child_process').execFileSync(process.execPath, ['-p', 'process.env.npm_config_update_notifier'], { encoding: 'utf8' }).trim())"], { env: { npm_config_update_notifier: undefined } });
  assert.equal(child.stdout.trim(), 'false', child.stderr);
});

test('the app build gets NODE_OPTIONS without the guard, also when it was inherited', () => {
  const read = node(['--input-type=module', '-e', `import { nodeOptionsBefore } from ${JSON.stringify(guard)}; console.log(JSON.stringify(nodeOptionsBefore));`],
    { env: { NODE_OPTIONS: `--max-old-space-size=4096 --import=${guard}` } });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout), '--max-old-space-size=4096');
  const dir = mkdtempSync(join(tmpdir(), 'offline-quoted-')), spaced = join(dir, 'a checkout', 'tests');
  try {
    mkdirSync(spaced, { recursive: true });
    copyFileSync('tests/offline.mjs', join(spaced, 'offline.mjs'));
    for (const inherited of ['--import "./tests/offline.mjs" --max-old-space-size=4096', `--import "${join(spaced, 'offline.mjs')}" --max-old-space-size=4096`]) {
      const quoted = node(['--input-type=module', '-e', `import { nodeOptionsBefore } from ${JSON.stringify(guard)}; console.log(JSON.stringify(nodeOptionsBefore));`], { env: { NODE_OPTIONS: inherited } });
      assert.equal(quoted.status, 0, quoted.stderr);
      assert.equal(JSON.parse(quoted.stdout), '--max-old-space-size=4096', inherited);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The proofs above load the guard themselves, so this pins that every runner still loads it.
// The compared screens and the small visual lane (#257, playwright.lane.config.ts, its own outside-request guard) are #257's.
test('every test runner loads the guard, and every browser spec but the compared screens uses the guarded test', () => {
  const read = path => readFileSync(path, 'utf8');
  assert.match(JSON.parse(read('package.json')).scripts.test, /^node --import \.\/tests\/offline\.mjs --test /);
  // CI and `./ci.sh fast` run the node tests through the fast runner (#258).
  assert.match(read('scripts/ci-fast.mjs'), /node --import \.\/tests\/offline\.mjs --test /);
  for (const config of ['playwright.config.ts', 'playwright.proxy.config.ts', 'vitest.config.mts']) assert.match(read(config), /from '\.\/tests\/offline\.mjs'|import '\.\/tests\/offline\.mjs'/, config);
  assert.match(read('vitest.config.mts'), /setupFiles: \['tests\/components\/offline-setup\.ts'\]/);
  assert.match(read('vitest.config.mts'), /proxy: nowhere/);
  for (const config of ['playwright.config.ts', 'playwright.proxy.config.ts']) assert.match(read(config), /globalTeardown: join\(__dirname, 'tests\/offline-teardown\.ts'\)/, config);
  assert.match(read('tests/fresh-seed.ts'), /from '\.\/offline-browser'/);
  const specs = globSync('tests/**/*.spec.ts').filter(path => !/^tests\/visual-lane[^/]*\.spec\.ts$/.test(path));
  assert.deepEqual(specs.filter(path => !/import \{[^}]*\btest\b[^}]*\} from '\.\.?\/(fresh-seed|offline-browser)'/.test(read(path))), []);
});
