import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// The required `check` (#69): a skipped install is allowed only on a pull request that changes no install file; a
// failed or cancelled stage is always red. Both integration jobs (#74) must pass, or both be skipped on a document change.
const script = resolve('scripts/ci-verdict.mjs');
const green = { EVENT_NAME: 'pull_request', CHANGES_RESULT: 'success', DOCS_ONLY: 'false', INSTALL_RELATED: 'true', STATIC_RESULT: 'success', INTEGRATION_RESULT: 'success', INTEGRATION_2_RESULT: 'success', INSTALL_RESULT: 'success' };
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

test('a document-only change passes only with every long stage skipped', () => {
  const skipped = { DOCS_ONLY: 'true', INTEGRATION_RESULT: 'skipped', INTEGRATION_2_RESULT: 'skipped', INSTALL_RESULT: 'skipped' };
  assert.equal(verdict(skipped), 0);
  for (const key of ['INTEGRATION_RESULT', 'INTEGRATION_2_RESULT', 'INSTALL_RESULT']) {
    for (const result of ['failure', 'cancelled', 'success']) assert.equal(verdict({ ...skipped, [key]: result }), 1, `${key}=${result}`);
  }
});

test('classification, static and both integration jobs must succeed', () => {
  for (const key of ['CHANGES_RESULT', 'STATIC_RESULT', 'INTEGRATION_RESULT', 'INTEGRATION_2_RESULT']) {
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
  assert.deepEqual(jobs.check.needs, ['changes', 'static', 'integration', 'integration-2', 'install']);
  for (const key of ['EVENT_NAME', 'CHANGES_RESULT', 'DOCS_ONLY', 'INSTALL_RELATED', 'STATIC_RESULT', 'INTEGRATION_RESULT', 'INTEGRATION_2_RESULT', 'INSTALL_RESULT']) assert.ok(step.env[key], key);
  assert.equal(step.env.INTEGRATION_2_RESULT, '${{ needs.integration-2.result }}');
});

test('ci.yml splits the browser suite across two integration jobs on standard runners, and reads both reports', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const jobs = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs;
  const [first, second] = [jobs.integration, jobs['integration-2']];
  assert.equal(second.if, first.if);
  assert.deepEqual(second.needs, first.needs);
  for (const job of [first, second]) assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(first.env.GTMWORKS_BROWSER_JOB, '1');
  assert.equal(second.env.GTMWORKS_BROWSER_JOB, '2');
  assert.ok(second.steps.some(step => step.run === './ci.sh integration-2'));
  const uploads = job => job.steps.filter(step => step.uses?.startsWith('actions/upload-artifact')).map(step => step.with.name);
  assert.deepEqual(uploads(first), ['route-screenshots', 'playwright-report']);
  assert.deepEqual(uploads(second), ['route-screenshots-2', 'playwright-report-2']);
  for (const name of ['flaky-tests', 'compare-failures']) {
    const job = jobs[name];
    assert.deepEqual(job.needs, ['integration', 'integration-2'], name);
    const downloads = job.steps.filter(step => step.uses?.startsWith('actions/download-artifact')).map(step => step.with.name);
    assert.deepEqual(downloads, ['playwright-report', 'playwright-report-2'], name);
  }
  assert.match(jobs['flaky-tests'].if, /needs\.integration\.result != 'skipped' \|\| needs\.integration-2\.result != 'skipped'/);
  assert.match(jobs['compare-failures'].if, /needs\.integration\.result == 'failure' \|\| needs\.integration-2\.result == 'failure'/);
});
