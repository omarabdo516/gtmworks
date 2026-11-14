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
const none = { database: 'false', integration: 'false', install: 'false' };
const all = { database: 'true', integration: 'true', install: 'true' };

test('design, docs and Markdown run no suite', () => {
  assert.deepEqual(areas('design/conversation.html', 'docs/testing.md', 'docs/api/openapi.yaml', 'README.md', 'AGENTS.md'), none);
});

test('app, component, library, worker and unit test changes run no long suite: static covers them on every PR', () => {
  assert.deepEqual(areas('app/page.tsx', 'components/shell/sidebar.tsx', 'lib/engine.mjs', 'worker/index.mjs', 'tests/unit.test.mjs', 'next.config.mjs', 'server.js'), none);
});

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
  'tests/frame.spec.ts', 'tests/proxy/production-shape.spec.ts', 'tests/sign-in.ts', 'tests/visual-screens.mjs',
  'tests/visual.spec.ts-snapshots/home-en-1440-linux.png', 'tests/lane.mjs', 'tests/fake-hermes.mjs', 'tests/fake-engine.mjs',
  'tests/touch-diagnostics.mjs', 'playwright.config.ts', 'playwright.proxy.config.ts', 'scripts/web.sh', 'scripts/local-db.sh',
  'scripts/proxy-stack.sh', 'scripts/ci-image.sh', 'scripts/playwright-journal-reporter.mjs', 'supabase/seed.sql',
  // The public-assets browser test reads every file under public/, Markdown included.
  'public/nested/README.md',
]) {
  test(`${path} runs the browser suite`, () => assert.equal(areas('app/page.tsx', path).integration, 'true'));
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
  for (const path of ['.github/workflows/ci.yml', 'ci.sh', 'scripts/ci-areas.mjs', 'scripts/ci-verdict.mjs', 'package.json', 'package-lock.json']) {
    assert.deepEqual(areas(path), all, path);
  }
});

test('on main every suite runs unless every file is a document', () => {
  assert.deepEqual(Object.fromEntries(run(['--main', 'app/page.tsx', 'README.md']).trim().split('\n').map(line => line.split('='))), all);
  assert.deepEqual(Object.fromEntries(run(['--main', 'docs/testing.md', 'design/a.html']).trim().split('\n').map(line => line.split('='))), none);
  assert.deepEqual(Object.fromEntries(run(['--main', 'public/README.md']).trim().split('\n').map(line => line.split('='))), all);
});

test('stdin accepts NUL-separated git paths without splitting spaces or newlines', () => {
  assert.equal(run([], 'app/a page.tsx\0docs/a\npage.md\0'), 'database=false\nintegration=false\ninstall=false\n');
  assert.equal(run([], 'app/a page.tsx\0Dockerfile\0'), 'database=false\nintegration=false\ninstall=true\n');
  assert.equal(run(['--main'], 'app/a page.tsx\0'), 'database=true\nintegration=true\ninstall=true\n');
});

test('an empty, malformed or unreadable list runs every suite', t => {
  for (const paths of [[], [''], ['docs/../app/page.tsx'], ['/docs/guide.md'], ['docs//guide.md']]) {
    assert.deepEqual(areas(...paths), all, JSON.stringify(paths));
  }
  assert.equal(run([], 'docs/guide.md\0\0'), 'database=true\nintegration=true\ninstall=true\n');
  const directory = openSync('.', 'r');
  t.after(() => closeSync(directory));
  const unreadable = spawnSync(process.execPath, [script], { encoding: 'utf8', stdio: [directory, 'pipe', 'pipe'] });
  assert.equal(unreadable.status, 0);
  assert.equal(unreadable.stdout, 'database=true\nintegration=true\ninstall=true\n');
});
