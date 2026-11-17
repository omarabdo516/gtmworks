import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

// The first CI job decides which suites a change needs (#76, as Hermes `detect` and T3 Code `Changes` do): each suite
// runs only when the files it covers changed; main runs every suite unless the change is documents only.
const script = resolve('scripts/ci-areas.mjs');
const run = (args, input = '') => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', input });
const areas = (...paths) => Object.fromEntries(run(paths).trim().split('\n').map(line => line.split('=')));
const none = { components: 'false', database: 'false', integration: 'false', install: 'false', lane: 'false', proof: 'false' };
const all = { components: 'true', database: 'true', integration: 'true', install: 'true', lane: 'true', proof: 'true' };

test('design, docs and Markdown run no suite', () => {
  assert.deepEqual(areas('design/conversation.html', 'docs/testing.md', 'docs/api/openapi.yaml', 'README.md', 'AGENTS.md'), none);
});

test('unit test and brand file changes run no long suite: static covers them on every PR', () => {
  // No screen reads brand/ (the wordmark is text in app/; the favicons are not imported).
  assert.deepEqual(areas('tests/unit.test.mjs', 'tests/hermes.test.mjs', 'brand/wordmark.png', 'brand/README.md'), none);
});

// Screens alone (#213): the component tests prove how they behave, and from the whole-app browser suite only the
// compared screens run (integration=visual), so an unintended change to an approved screen is still caught before
// merge. A component test alone runs only the component tests. None of them runs the database or the install.
const screens = {
  'app/page.tsx': { components: 'true', database: 'false', integration: 'visual', install: 'false', lane: 'true', proof: 'false' },
  'app/globals.css': { components: 'true', database: 'false', integration: 'visual', install: 'false', lane: 'true', proof: 'false' },
  'components/shell/sidebar.tsx': { components: 'true', database: 'false', integration: 'visual', install: 'false', lane: 'true', proof: 'false' },
  'lib/messages/en.json': { components: 'true', database: 'false', integration: 'visual', install: 'false', lane: 'true', proof: 'false' },
  'tests/visual-screens/home.json': { components: 'false', database: 'false', integration: 'visual', install: 'false', lane: 'false', proof: 'false' },
  'tests/visual.spec.ts-snapshots/home-en-1440-linux.png': { components: 'false', database: 'false', integration: 'visual', install: 'false', lane: 'false', proof: 'false' },
  'tests/components/message-box.test.tsx': { components: 'true', database: 'false', integration: 'false', install: 'false', lane: 'false', proof: 'false' },
};
for (const [path, expected] of Object.entries(screens)) {
  test(`${path} alone runs no journey, database or install`, () => assert.deepEqual(areas(path), expected));
}

test('screens together run the component tests and the compared screens only', () => {
  assert.deepEqual(areas(...Object.keys(screens)), { components: 'true', database: 'false', integration: 'visual', install: 'false', lane: 'true', proof: 'false' });
});

test('a screen together with a file of the journeys\' area runs the whole browser suite', () => {
  for (const path of ['tests/frame.spec.ts', 'app/api/health/route.ts', 'lib/engine.mjs']) {
    assert.equal(areas('app/page.tsx', 'lib/messages/en.json', path).integration, 'true', path);
  }
});

// The request layer and server code under app/ (route handlers and server actions, where the server checks
// permissions) run the whole browser suite: its journeys drive them and no component test does. They need no install.
for (const [path, components] of [
  ['middleware.ts', 'false'], ['instrumentation.ts', 'false'], ['postcss.config.mjs', 'true'],
  ['app/api/health/route.ts', 'true'], ['app/sign-in/actions.ts', 'true'],
]) {
  test(`${path} runs the whole browser suite and neither the database nor the install`, () => {
    assert.deepEqual(areas(path), { components, database: 'false', integration: 'true', install: 'false', lane: path === 'postcss.config.mjs' ? 'true' : 'false', proof: 'false' });
  });
}

// Screens tested as components (#81): a screen, a component, the library they import, or a component test runs them,
// and so do the compared widths and languages, the reference and the stylesheet build the motion test reads (#127).
for (const path of [
  'app/conversation-composer.tsx', 'components/company-agent-face.tsx', 'lib/messages/en.json', 'tests/components/message-box.test.tsx', 'vitest.config.mts',
  'tests/visual-screens.mjs', 'design-reference/index.html', 'postcss.config.mjs',
]) {
  test(`${path} runs the component tests`, () => assert.equal(areas(path).components, 'true'));
}
// The motion table and its reader feed the motion component test, and no browser spec (#127).
for (const path of ['tests/motion-table.mjs', 'tests/motion-css.mjs']) {
  test(`${path} runs the component tests and no other long suite`, () => assert.deepEqual(areas(path), { ...none, components: 'true' }));
}
for (const path of ['worker/index.mjs', 'supabase/seed.sql', 'tests/frame.spec.ts', 'tests/unit.test.mjs', 'server.js']) {
  test(`${path} does not run the component tests`, () => assert.equal(areas(path).components, 'false'));
}

// The library, the worker and the server the image runs keep their install trigger (#69): only the install drives them
// against the real bundled Hermes (conversation, Agent, company profiles); the browser suite uses fake engines.
for (const path of ['lib/engine.mjs', 'lib/i18n/messages.en.json', 'worker/index.mjs', 'next.config.mjs', 'server.js']) {
  test(`${path} runs the browser suite and the install`, () => {
    assert.deepEqual(areas(path), { components: /^lib\//.test(path) ? 'true' : 'false', database: 'false', integration: 'true', install: 'true', lane: 'false', proof: 'false' });
  });
}

for (const path of [
  'supabase/migrations/20260101000000_x.sql', 'supabase/tests/foundation.sql', 'supabase/config.toml',
  'scripts/check-rls.sql', 'scripts/verify-db.mjs', 'scripts/local-default-privileges.sql',
  'tests/db.sh', 'tests/first-run-migration.mjs', 'tests/bootstrap-db.mjs', 'tests/hosted-default-privileges.mjs',
  'tests/agent-role-backfill.mjs', 'tests/sql-statements.mjs',
  // tests/bootstrap-db.mjs runs this file's SQL against the real constraints and triggers.
  'scripts/bootstrap-owner.mjs',
]) {
  test(`${path} runs the database tests`, () => assert.equal(areas('app/page.tsx', path).database, 'true'));
}

for (const path of [
  'tests/frame.spec.ts', 'tests/proxy/production-shape.spec.ts', 'tests/visual.spec.ts', 'tests/sign-in.ts', 'tests/visual-screens.mjs',
  'tests/lane.mjs', 'tests/fake-hermes.mjs', 'tests/fake-engine.mjs',
  'playwright.config.ts', 'playwright.proxy.config.ts', 'scripts/web.sh', 'scripts/local-db.sh',
  'scripts/proxy-stack.sh', 'scripts/ci-image.sh', 'supabase/seed.sql',
  // The first-run and screen specs import its reset helpers; every browser lane is built from the migrations, the
  // stack configuration and the local default privileges (scripts/local-db.sh).
  'scripts/first-run-db.mjs', 'scripts/local-default-privileges.sql', 'supabase/migrations/20260101000000_x.sql', 'supabase/config.toml',
  // The integration job builds the image and the proxy suite runs inside it (scripts/proxy-stack.sh).
  'Dockerfile', '.dockerignore',
  // The public-assets browser test reads every file under public/, Markdown included.
  'public/nested/README.md',
]) {
  test(`${path} runs the browser suite`, () => assert.equal(areas('docs/testing.md', path).integration, 'true'));
}

for (const path of [
  'Dockerfile', '.dockerignore', 'docker-compose.install.yml', '.env.install.example', 'scripts/install.sh', 'scripts/get.sh',
  'scripts/install-db.sql', 'scripts/check-install-proxy.mjs', 'scripts/check-hermes-keys.py', 'scripts/release-assets.mjs',
  'scripts/check-rls.sql', 'scripts/verify-db.mjs', 'scripts/forged-identity.mjs', 'supabase/migrations/20260101000000_x.sql',
  'playwright.install.config.ts', 'tests/install/rate-limit.install.ts', '.github/workflows/release.yml',
]) {
  test(`${path} runs the install suite`, () => assert.equal(areas('app/page.tsx', path).install, 'true'));
}

test('the install browser check is not a browser suite file, and a browser spec is not an install file', () => {
  assert.equal(areas('tests/install/rate-limit.install.ts').integration, 'false');
  assert.equal(areas('tests/frame.spec.ts').install, 'false');
});

test('the CI definition itself and the dependencies run every suite', () => {
  for (const path of ['.github/workflows/ci.yml', 'ci.sh', 'scripts/ci-areas.mjs', 'scripts/ci-verdict.mjs', 'scripts/ci-runner.mjs', 'package.json', 'package-lock.json']) {
    assert.deepEqual(areas(path), all, path);
  }
});

test('on main every suite runs unless every file is a document', () => {
  assert.deepEqual(Object.fromEntries(run(['--main', 'app/page.tsx', 'README.md']).trim().split('\n').map(line => line.split('='))), all);
  assert.deepEqual(Object.fromEntries(run(['--main', 'docs/testing.md', 'design/a.html']).trim().split('\n').map(line => line.split('='))), none);
  assert.deepEqual(Object.fromEntries(run(['--main', 'public/README.md']).trim().split('\n').map(line => line.split('='))), all);
});

test('stdin accepts NUL-separated git paths without splitting spaces or newlines', () => {
  assert.equal(run([], 'docs/a page.md\0docs/a\npage.md\0'), 'components=false\ndatabase=false\nintegration=false\ninstall=false\nlane=false\nproof=false\n');
  assert.equal(run([], 'docs/a page.md\0docker-compose.install.yml\0'), 'components=false\ndatabase=false\nintegration=false\ninstall=true\nlane=false\nproof=false\n');
  assert.equal(run(['--main'], 'app/a page.tsx\0'), 'components=true\ndatabase=true\nintegration=true\ninstall=true\nlane=true\nproof=true\n');
});

test('an empty, malformed or unreadable list runs every suite', t => {
  for (const paths of [[], [''], ['docs/../app/page.tsx'], ['/docs/guide.md'], ['docs//guide.md']]) {
    assert.deepEqual(areas(...paths), all, JSON.stringify(paths));
  }
  assert.equal(run([], 'docs/guide.md\0\0'), 'components=true\ndatabase=true\nintegration=true\ninstall=true\nlane=true\nproof=true\n');
  const directory = openSync('.', 'r');
  t.after(() => closeSync(directory));
  const unreadable = spawnSync(process.execPath, [script], { encoding: 'utf8', stdio: [directory, 'pipe', 'pipe'] });
  assert.equal(unreadable.status, 0);
  assert.equal(unreadable.stdout, 'components=true\ndatabase=true\nintegration=true\ninstall=true\nlane=true\nproof=true\n');
});

// The visual lane (#257) is drawn from what a screen looks like: the app's pages and styles, the components, the
// catalogues, the lane's own files and the stylesheet build. Server code, documents and unit tests do not change a
// picture. Its proof, the same bytes on every runner three times over, runs when the renderer, the lane's config, the
// guards or the CI definition change, and on main.
for (const path of [
  'app/page.tsx', 'app/c/[company]/home/page.tsx', 'app/globals.css', 'components/shell/sidebar.tsx', 'components/paperclip/fonts/InterVariable.woff2',
  'lib/i18n-client.tsx', 'lib/messages/ar.json', 'postcss.config.mjs', 'tests/visual-lane/screens.json', 'tests/visual-lane/images/home-ar-390-dark.png',
  'tests/visual-lane.mjs', 'tests/visual-lane-guards.spec.ts', 'tests/visual-lane-screens.spec.ts', 'tests/visual-lane-390.spec.ts',
]) {
  test(`${path} runs the visual lane`, () => assert.equal(areas('docs/testing.md', path).lane, 'true'));
}
for (const path of [
  'app/api/health/route.ts', 'app/sign-in/actions.ts', 'lib/engine.mjs', 'worker/index.mjs', 'supabase/seed.sql', 'docs/testing.md', 'README.md',
  'tests/unit.test.mjs', 'tests/visual-lane.test.mjs', 'tests/frame.spec.ts', 'tests/visual-screens/home.json',
]) {
  test(`${path} does not run the visual lane`, () => assert.equal(areas(path).lane, 'false'));
}
for (const path of ['tests/visual-lane/renderer', 'playwright.lane.config.ts', 'tests/visual-lane-guards.ts', 'ci.sh']) {
  test(`${path} runs the visual lane and its proof`, () => assert.deepEqual([areas(path).lane, areas(path).proof], ['true', 'true']));
}
test('a screen or the lane\'s list alone does not run the proof', () => {
  assert.equal(areas('app/page.tsx', 'components/shell/sidebar.tsx', 'tests/visual-lane/screens.json').proof, 'false');
});
// The lane's own files need no journeys: they run in the lane job alone.
for (const path of ['playwright.lane.config.ts', 'tests/visual-lane-guards.ts', 'tests/visual-lane-guards.spec.ts', 'tests/visual-lane.mjs']) {
  test(`${path} does not run the whole browser suite`, () => assert.equal(areas(path).integration, 'false'));
}
