import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// A browser shard starts with its browser ready and the suite runs in seven shards (#404, spec #401, #653): the browser comes
// from the cache the fast job keeps, and a miss installs Chromium alone, because the runner image already has its system
// packages and fonts. So no shard downloads a browser, a package or a font during a run, and a slow mirror cannot add
// ten minutes to a pull request. The seven shards pass --shard to ci.sh, which splits them by measured time (#653), each uploads its own artifacts, and one
// red shard leaves the others running. The browser job is read from the real workflow, and the check script from the
// real ci.sh.
const workflow = () => load(readFileSync('.github/workflows/ci.yml', 'utf8'));

// Every string a job holds: a system-package install hides in a step's script, its name or an action's input.
const texts = value => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(texts)
    : value && typeof value === 'object' ? Object.values(value).flatMap(texts) : [];

const pricey = /--with-deps|install-deps|\bapt(?:-get)?\b|ldd/;

test('the browser suite runs as seven shards, and a red shard leaves the others running', () => {
  const { integration } = workflow().jobs;
  assert.deepEqual(integration.strategy, { 'fail-fast': false, matrix: { shard: [1, 2, 3, 4, 5, 6, 7] } });
});

test('each shard runs its sixth of the browser suite', () => {
  const { integration } = workflow().jobs;
  const suite = integration.steps.find(step => step.name === 'integration');
  assert.equal(suite.run, './ci.sh integration --shard=${{ matrix.shard }}/7');
});

test('each shard uploads its own screenshots, report and server logs', () => {
  const { integration } = workflow().jobs;
  const uploads = integration.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(uploads.length >= 3);
  for (const upload of uploads) assert.match(upload.with.name, /-\$\{\{ matrix\.shard \}\}$/, upload.with.name);
});

test('the integration job installs no system package: no apt, no --with-deps', () => {
  const { integration } = workflow().jobs;
  for (const text of texts(integration)) assert.doesNotMatch(text, pricey, text);
});

test('the browser comes from the fast job\'s cache, keyed by its version and the runner image, installed alone on a miss', () => {
  const { fast, integration } = workflow().jobs;
  const browserCache = steps => steps.filter(step => step.uses?.startsWith('actions/cache/') && step.with?.path === '~/.cache/ms-playwright');
  const [fastRestore] = browserCache(fast.steps);
  assert.ok(fastRestore, 'the fast job keeps the browser cache');
  const restore = integration.steps.find(step => step.uses?.startsWith('actions/cache/restore@') && step.with.path === '~/.cache/ms-playwright');
  const save = integration.steps.find(step => step.uses?.startsWith('actions/cache/save@') && step.with.path === '~/.cache/ms-playwright');
  const version = integration.steps.find(step => step.id === 'browser-version');
  const install = integration.steps.find(step => /playwright install/.test(step.run ?? ''));
  assert.ok(restore && save && version && install, 'the browser is restored, installed and saved');
  // One cache entry for both jobs: a hit restores the same browser the fast job saved.
  assert.equal(restore.with.key, fastRestore.with.key);
  assert.equal(save.with.key, restore.with.key);
  assert.match(restore.with.key, /ms-playwright-/);
  // A new runner image downloads the browser again for itself, and the version is the one Playwright installs, so the
  // key names the browser a run gets.
  assert.match(version.run, /playwright-core\/package\.json/);
  assert.match(version.run, /\$ImageOS/);
  assert.match(version.run, /\$ImageVersion/);
  // A miss installs the browser alone: the image's own system packages and fonts serve every run alike.
  assert.equal(install.run, 'npx playwright install chromium');
  assert.match(install.if, /steps\.browser\.outputs\.cache-hit != 'true'/);
  assert.match(save.if, /steps\.browser\.outputs\.cache-hit != 'true'/);
  const suite = integration.steps.findIndex(step => step.name === 'integration');
  const index = step => integration.steps.indexOf(step);
  assert.ok(index(restore) < index(install) && index(install) < index(save) && index(save) < suite, 'saved before any test runs');
});

test('the dependencies come from the fast job\'s cache too, installed only on a miss', () => {
  const { fast, integration } = workflow().jobs;
  const modules = steps => steps.filter(step => step.uses?.startsWith('actions/cache/') && step.with?.path?.includes('node_modules'));
  const [fastRestore] = modules(fast.steps);
  const restore = integration.steps.find(step => step.uses?.startsWith('actions/cache/restore@') && step.with.path.includes('node_modules'));
  const save = integration.steps.find(step => step.uses?.startsWith('actions/cache/save@') && step.with.path.includes('node_modules'));
  assert.ok(fastRestore && restore && save, 'the dependencies are restored and saved');
  assert.equal(restore.with.key, fastRestore.with.key);
  assert.equal(save.with.key, restore.with.key);
  assert.equal(restore.with.path, fastRestore.with.path, 'the bundler cache is never restored');
  assert.equal(save.with.path, restore.with.path);
  assert.equal(integration.steps.find(step => step.run === 'npm ci').if, '${{ steps.modules.outputs.cache-hit != \'true\' }}');
  assert.match(save.if, /steps\.modules\.outputs\.cache-hit != 'true'/);
});

test('ci.sh installs no system package for the CI integration run, and the visual lane keeps its browser', () => {
  const text = readFileSync('ci.sh', 'utf8');
  const arm = name => {
    const start = text.indexOf(`\n ${name})`);
    assert.ok(start >= 0, `ci.sh has a ${name} arm`);
    const end = text.indexOf('\n  ;;', start);
    assert.ok(end > start, `the ${name} arm ends`);
    return text.slice(start, end);
  };
  // The workflow restores the browser above, so the CI run must not reach for a package mirror: the arm calls no helper
  // that would install one.
  assert.doesNotMatch(arm('integration'), /install_chromium|--with-deps|\bapt(?:-get)?\b/);
  // The visual lane on main still installs the browser with its system packages (#257, #359).
  assert.match(text, /npx --yes "playwright@\$version" install --with-deps chromium/);
  assert.match(arm('visual'), /install_chromium/);
});

// #359: the browser installs beside start_lane's npm ci, not in series after the lane, and is waited for only before
// the navigation budgets. It runs the locked Playwright from outside the checkout, so it never reads the node_modules
// npm ci is rewriting.
test('ci.sh visual installs Chromium beside the lane and waits for it before the budgets (#359)', () => {
  const text = readFileSync('ci.sh', 'utf8');
  const start = text.indexOf('\n visual)');
  const visual = text.slice(start, text.indexOf('\n  ;;', start));
  const at = pattern => { const index = visual.search(pattern); assert.ok(index >= 0, `the visual arm has ${pattern}`); return index; };
  assert.ok(at(/install_chromium/) < at(/\n  start_lane\n/), 'the install starts before the lane');
  assert.ok(at(/lane_test/) < at(/chromium_installed/), 'the lane does not wait for the browser');
  assert.ok(at(/chromium_installed/) < at(/--project=measured/), 'the budgets wait for the browser');
  const helper = text.slice(text.indexOf('install_chromium() {'), text.indexOf('\n}\n', text.indexOf('install_chromium() {')));
  assert.match(helper, /packages\['node_modules\/playwright'\]\.version/, 'the locked Playwright, not whatever npx finds');
  assert.match(helper, /cd "\$\(mktemp -d\)"/, 'run outside the checkout npm ci is writing');
  assert.match(helper, /&\n\s+chromium=\$!/, 'in the background');
});

// #421: the chat's open time (project `alone`, #346) runs in a job of its own with a machine to itself, on the pull
// request too. The browser shards leave the project empty (`GTMWORKS_HOSTED_ELSEWHERE`), so none of them runs the test,
// and the job runs the one command of the repo.
test('the chat-open job runs the chat test with a machine to itself, and no shard runs it (#421)', () => {
  const { jobs } = workflow();
  const chatOpen = jobs['chat-open'];
  assert.ok(chatOpen, 'the workflow has a chat-open job');
  assert.deepEqual(chatOpen.needs, ['changes']);
  assert.equal(chatOpen.if, "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.integration != 'false') }}");
  assert.equal(chatOpen.steps.find(step => step.name === 'chat open').run, './ci.sh chat-open');
  // The `alone` project is empty where the shards run, as the measured budgets already are.
  const config = readFileSync('playwright.config.ts', 'utf8');
  assert.match(config, /\{ name: 'alone', testMatch: hostedElsewhere \? \/\^\$\/ : 'chat-steps\.spec\.ts', workers: 1 \}/);
  const ci = readFileSync('ci.sh', 'utf8');
  assert.match(ci, /GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=\$lanes GTMWORKS_HOSTED_ELSEWHERE=true npm run test:e2e/);
  const start = ci.indexOf('\n chat-open)');
  assert.ok(start >= 0, 'ci.sh has a chat-open arm');
  const arm = ci.slice(start, ci.indexOf('\n  ;;', start));
  assert.match(arm, /GTMWORKS_TEST_LANES=1 npx playwright test --project=alone --no-deps/);
  assert.match(arm, /LANE=0 bash scripts\/web\.sh build/);
  assert.match(arm, /GTMWORKS_WEB_PREBUILT=true/);
});
