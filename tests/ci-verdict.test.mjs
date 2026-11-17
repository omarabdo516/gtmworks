import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// The required `check` (#76, like Hermes `all-checks-pass`): a suite the first job did not ask for counts as passed only
// when it was skipped; a suite it asked for, or one whose need is unknown, must succeed; a failed or cancelled stage is
// always red. The compared screens are not a stage: they run on main only and never judge a pull request (#257).
const script = resolve('scripts/ci-verdict.mjs');
const stages = ['COMPONENTS', 'DATABASE', 'INTEGRATION', 'INSTALL'];
const green = { CHANGES_RESULT: 'success', STATIC_RESULT: 'success', ...Object.fromEntries(stages.flatMap(stage => [[`${stage}_RUN`, 'true'], [`${stage}_RESULT`, 'success']])) };
const verdict = overrides => {
  const env = { PATH: process.env.PATH, ...green, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env }).status;
};

test('every stage green passes', () => {
  assert.equal(verdict({}), 0);
});

test('a document-only change passes with every long suite skipped', () => {
  assert.equal(verdict(Object.fromEntries(stages.flatMap(stage => [[`${stage}_RUN`, 'false'], [`${stage}_RESULT`, 'skipped']]))), 0);
});

for (const stage of stages) {
  test(`${stage}: skipped passes only when the first job did not ask for it`, () => {
    assert.equal(verdict({ [`${stage}_RUN`]: 'false', [`${stage}_RESULT`]: 'skipped' }), 0);
    assert.equal(verdict({ [`${stage}_RESULT`]: 'skipped' }), 1);
    assert.equal(verdict({ [`${stage}_RUN`]: '', [`${stage}_RESULT`]: 'skipped' }), 1);
    assert.equal(verdict({ [`${stage}_RUN`]: undefined, [`${stage}_RESULT`]: 'skipped' }), 1);
  });

  test(`${stage}: a failed or cancelled run is red, even where it could have been skipped`, () => {
    for (const result of ['failure', 'cancelled']) {
      assert.equal(verdict({ [`${stage}_RESULT`]: result }), 1, result);
      assert.equal(verdict({ [`${stage}_RUN`]: 'false', [`${stage}_RESULT`]: result }), 1, result);
    }
  });
}

test('check passes with no compared screens at all: a pull request never runs them (#257)', () => {
  assert.equal(verdict({ VISUAL_RUN: undefined, VISUAL_RESULT: undefined, LANE_RUN: undefined, LANE_RESULT: undefined }), 0);
  assert.equal(verdict({ VISUAL_RESULT: 'failure', LANE_RESULT: 'failure' }), 0);
});

test('classification and static must succeed', () => {
  for (const key of ['CHANGES_RESULT', 'STATIC_RESULT']) {
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(verdict({ [key]: result }), 1, `${key}=${result}`);
  }
});

test('ci.yml decides the suites in its first job, gates each suite on it, and judges check with this verdict', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const { jobs } = workflow;
  const classify = jobs.changes.steps.find(step => step.id === 'classify');
  assert.match(classify.run, /node scripts\/ci-areas\.mjs \$main < "\$RUNNER_TEMP\/changed-files"/);
  for (const [job, output] of [['components', 'components'], ['database', 'database'], ['integration', 'integration'], ['install', 'install']]) {
    assert.equal(jobs.changes.outputs[output], `\${{ steps.classify.outputs.${output} }}`, output);
    assert.deepEqual(jobs[job].needs, ['changes'], job);
    assert.equal(jobs[job].if, `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${output} != 'false') }}`, job);
  }
  // The images job only warms a cache: it cannot fail a run, and check, database and integration do not wait for it (#259).
  assert.equal(jobs['supabase-images']['continue-on-error'], true);
  assert.deepEqual(jobs['supabase-images'].needs, ['changes']);
  const step = jobs.check.steps.at(-1);
  assert.equal(step.run, 'node scripts/ci-verdict.mjs');
  assert.equal(jobs.check.if, '${{ always() }}');
  assert.deepEqual(jobs.check.needs, ['changes', 'static', 'components', 'database', 'integration', 'install']);
  for (const key of Object.keys(green)) assert.ok(step.env[key], key);
  assert.deepEqual(Object.keys(step.env).filter(key => /VISUAL|LANE/.test(key)), []);
});

// Omar, 2026-11-17: the compared screens (and the navigation budgets with them) run on a push to main and on a manual
// run, never on a pull request, and no pull request waits for them. Each job's condition is read for every event.
test('a pull request starts no compared-screen job, and check needs none of them (#257)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const screenJobs = ['visual', 'lane', 'lane-proof', 'lane-proof-compare'];
  for (const name of screenJobs) {
    assert.ok(jobs[name], name);
    const condition = jobs[name].if ?? '';
    assert.match(condition, /github\.event_name == '(push|workflow_dispatch)'/, `${name} names the events it runs on`);
    assert.doesNotMatch(condition.replace(/github\.event_name == '(push|workflow_dispatch)'/g, ''), /event_name|pull_request/, `${name} has no other event test`);
    assert.doesNotMatch(condition, /\|\|\s*needs\.changes\.result/, `${name} cannot start because classification failed`);
  }
  for (const [name, job] of Object.entries(jobs)) if (!screenJobs.includes(name) && name !== 'ledger') {
    for (const need of [job.needs ?? []].flat()) assert.ok(!screenJobs.includes(need), `${name} waits for ${need}`);
  }
});

test('the browser and install suites never run by default on a manual run: their inputs default to off', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const inputs = workflow.on.workflow_dispatch.inputs;
  for (const name of ['e2e', 'install']) assert.deepEqual({ type: inputs[name].type, default: inputs[name].default }, { type: 'boolean', default: false }, name);
  const classify = workflow.jobs.changes.steps.find(step => step.id === 'classify');
  assert.equal(classify.env.E2E, '${{ inputs.e2e }}');
  assert.equal(classify.env.INSTALL, '${{ inputs.install }}');
  assert.match(classify.run, /integration=\$E2E/);
  assert.match(classify.run, /install=\$INSTALL/);
});
