import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// A pull request runs the install job only when it changes a file the install exercises (#69).
const script = resolve('scripts/install-related.mjs');
const classify = (...paths) => execFileSync(process.execPath, [script, ...paths], { encoding: 'utf8', input: '' });

test('app, component, browser test and docs changes skip the install job', () => {
  assert.equal(classify('app/page.tsx', 'components/shell/sidebar.tsx', 'tests/frame.spec.ts', 'docs/testing.md', 'README.md'), 'false\n');
});

for (const path of [
  'Dockerfile', '.dockerignore', 'docker-compose.install.yml', '.env.install.example', '.env.production.example',
  'scripts/install.sh', 'scripts/get.sh', 'scripts/install-db.sql', 'scripts/check-install-proxy.mjs', 'scripts/check-hermes-keys.py',
  'scripts/release-assets.mjs', 'scripts/check-rls.sql', 'scripts/verify-db.mjs', 'scripts/forged-identity.mjs',
  'scripts/local-default-privileges.sql', 'scripts/install-related.mjs',
  'supabase/migrations/20260101000000_x.sql', 'supabase/config.toml',
  'lib/engine.mjs', 'worker/index.mjs', 'package.json', 'package-lock.json', 'next.config.mjs', 'server.js',
  'playwright.install.config.ts', 'tests/install/rate-limit.install.ts',
  '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/release-tag.yml',
]) {
  test(`${path} runs the install job`, () => {
    assert.equal(classify('app/page.tsx', path), 'true\n');
  });
}

test('stdin accepts NUL-separated git paths', () => {
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8', input: 'app/a page.tsx\0Dockerfile\0' }), 'true\n');
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8', input: 'app/a page.tsx\0app/b.tsx\0' }), 'false\n');
});

test('an empty, malformed or unreadable list runs the install job', () => {
  for (const paths of [[], [''], ['app/../Dockerfile'], ['/app/page.tsx'], ['app//page.tsx']]) {
    assert.equal(classify(...paths), 'true\n', JSON.stringify(paths));
  }
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8', input: 'app/page.tsx\0\0' }), 'true\n');
});
