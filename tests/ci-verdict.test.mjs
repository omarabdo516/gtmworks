import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// The required `check` (#69): a skipped install is allowed only on a pull request that changes no install file; a
// failed or cancelled stage is always red.
const script = resolve('scripts/ci-verdict.mjs');
const green = { EVENT_NAME: 'pull_request', CHANGES_RESULT: 'success', DOCS_ONLY: 'false', INSTALL_RELATED: 'true', STATIC_RESULT: 'success', INTEGRATION_RESULT: 'success', INSTALL_RESULT: 'success' };
const verdict = overrides => {
  const env = { PATH: process.env.PATH, ...green, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env }).status;
};

test('every stage green passes', () => {
  assert.equal(verdict({}), 0);
  assert.equal(verdict({ EVENT_NAME: 'push' }), 0);
});

test('a pull request that changes no install file passes with install skipped', () => {
  assert.equal(verdict({ INSTALL_RELATED: 'false', INSTALL_RESULT: 'skipped' }), 0);
});

test('a failed or cancelled install is red, even where it could have been skipped', () => {
  for (const result of ['failure', 'cancelled']) {
    assert.equal(verdict({ INSTALL_RELATED: 'false', INSTALL_RESULT: result }), 1, result);
    assert.equal(verdict({ INSTALL_RESULT: result }), 1, result);
  }
});

test('a skipped install is red when the change touches install files, on main, or when the classification is unknown', () => {
  assert.equal(verdict({ INSTALL_RESULT: 'skipped' }), 1);
  assert.equal(verdict({ EVENT_NAME: 'push', INSTALL_RELATED: 'false', INSTALL_RESULT: 'skipped' }), 1);
  assert.equal(verdict({ INSTALL_RELATED: '', INSTALL_RESULT: 'skipped' }), 1);
  assert.equal(verdict({ INSTALL_RELATED: undefined, INSTALL_RESULT: 'skipped' }), 1);
});

test('a document-only change passes only with both long stages skipped', () => {
  assert.equal(verdict({ DOCS_ONLY: 'true', INTEGRATION_RESULT: 'skipped', INSTALL_RESULT: 'skipped' }), 0);
  assert.equal(verdict({ DOCS_ONLY: 'true', INTEGRATION_RESULT: 'failure', INSTALL_RESULT: 'skipped' }), 1);
  assert.equal(verdict({ DOCS_ONLY: 'true', INTEGRATION_RESULT: 'skipped', INSTALL_RESULT: 'failure' }), 1);
});

test('classification, static and integration must succeed', () => {
  for (const key of ['CHANGES_RESULT', 'STATIC_RESULT', 'INTEGRATION_RESULT']) {
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(verdict({ [key]: result, INSTALL_RELATED: 'false', INSTALL_RESULT: 'skipped' }), 1, `${key}=${result}`);
  }
  assert.equal(verdict({ DOCS_ONLY: '' }), 1);
});

test('ci.yml runs install by the classification and judges check with this verdict', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const jobs = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs;
  const classify = jobs.changes.steps.find(step => step.id === 'classify');
  assert.match(classify.run, /install_related=true\n/);
  assert.match(classify.run, /install_related=\$\(node scripts\/install-related\.mjs < "\$RUNNER_TEMP\/changed-files"\)/);
  assert.equal(jobs.changes.outputs.install_related, '${{ steps.classify.outputs.install_related }}');
  assert.match(jobs.install.if, /github\.event_name != 'pull_request' \|\| needs\.changes\.outputs\.install_related != 'false'/);
  const step = jobs.check.steps.at(-1);
  assert.equal(step.run, 'node scripts/ci-verdict.mjs');
  assert.equal(jobs.check.if, '${{ always() }}');
  assert.deepEqual(jobs.check.needs, ['changes', 'static', 'integration', 'install']);
  for (const key of ['EVENT_NAME', 'CHANGES_RESULT', 'DOCS_ONLY', 'INSTALL_RELATED', 'STATIC_RESULT', 'INTEGRATION_RESULT', 'INSTALL_RESULT']) assert.ok(step.env[key], key);
});
