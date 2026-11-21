import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// The required `check` (#76, like Hermes `all-checks-pass`): a suite the first job did not ask for counts as passed only
// when it was skipped; a suite it asked for, or one whose need is unknown, must succeed; a failed or cancelled stage is
// always red. The compared screens are not a stage: they run on main only and never judge a pull request (#257).
// The app image is a stage of its own (#403): it follows the browser suite's and the install proof's own answers and the
// required check waits for it. The install proof is one stage (#406): its job runs one matrix entry per area — the first
// install with Companies, Agents and backup; the proxy; the update; and the one-line install — so its one result is red
// when any area failed or was cancelled. The fast job's steps (scripts/ci-fast.mjs, #258) are listed one by one, and
// each must succeed; its component tests may be skipped only when the first job did not ask for them.
const script = resolve('scripts/ci-verdict.mjs');
const stages = ['IMAGE', 'DATABASE', 'INTEGRATION', 'CHAT_OPEN', 'INSTALL'];
const fastSteps = 'discovery=success docs=success i18n=success openapi=success lint=success typecheck=success knip=success node=success components=success';
const green = {
  CHANGES_RESULT: 'success', FAST_RESULT: 'success', FAST_STEPS: fastSteps, COMPONENTS_RUN: 'true',
  ...Object.fromEntries(stages.flatMap(stage => [[`${stage}_RUN`, 'true'], [`${stage}_RESULT`, 'success']])),
};
const run = overrides => {
  const env = { PATH: process.env.PATH, ...green, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env });
};
const verdict = overrides => run(overrides).status;

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

// #405 (replacing the draft rule of #333): a draft pull request runs what a ready one runs. A heavy suite its files need
// may not pass by being skipped, whatever the pull request's draft state, and the verdict reads no draft state at all; a
// suite nobody asked for still passes skipped.
const skippedHeavy = Object.fromEntries(stages.map(stage => [`${stage}_RESULT`, 'skipped']));
const notAsked = Object.fromEntries(stages.map(stage => [`${stage}_RUN`, 'false']));

test("a draft's skipped heavy suite is red when its files need it", () => {
  assert.equal(verdict({ DRAFT: 'true', LIVE_DRAFT: 'true', ...skippedHeavy }), 1);
  assert.equal(verdict(skippedHeavy), 1);
});

test('a skipped heavy suite nobody asked for still passes on a draft', () => {
  assert.equal(verdict({ DRAFT: 'true', LIVE_DRAFT: 'true', ...skippedHeavy, ...notAsked }), 0);
});

test('check reads no draft state: no live step, no pull request permission and no draft flag for the verdict', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { check } = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs;
  assert.equal(check.permissions['pull-requests'], undefined);
  assert.equal(check.steps.some(step => step.id === 'live'), false);
  assert.equal(check.steps.at(-1).env.DRAFT, undefined);
  assert.equal(check.steps.at(-1).env.LIVE_DRAFT, undefined);
});

// The browser suite runs in 6 shards (#335, #404) with fail-fast off: GitHub's one result for the matrix is a failure or
// cancelled when any shard is, so it alone judges them.
test('integration is red when one shard failed or was cancelled, green when all passed', () => {
  assert.equal(verdict({ INTEGRATION_RESULT: 'success' }), 0);
  for (const result of ['failure', 'cancelled']) assert.equal(verdict({ INTEGRATION_RESULT: result }), 1, result);
});

test('the integration job runs as 6 shards, each uploading its own artifacts, and check reads the matrix result (#335, #404)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const { integration, check } = jobs;
  assert.deepEqual(integration.strategy, { 'fail-fast': false, matrix: { shard: [1, 2, 3, 4, 5, 6] } });
  const steps = integration.steps;
  const suite = steps.findIndex(step => step.name === 'integration');
  assert.equal(steps[suite].run, './ci.sh integration --shard=${{ matrix.shard }}/6');
  // Matrix legs share one outputs namespace, so per-shard outputs could overwrite each other: none are written.
  assert.equal(integration.outputs, undefined);
  const env = check.steps.at(-1).env;
  assert.equal(env.INTEGRATION_RESULT, '${{ needs.integration.result }}');
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(uploads.length >= 3);
  for (const upload of uploads) assert.match(upload.with.name, /-\$\{\{ matrix\.shard \}\}$/, upload.with.name);
  // The proxy suite runs once, in shard 1; every argument after `integration` reaches the browser suite.
  const ci = readFileSync('ci.sh', 'utf8');
  assert.match(ci, /\[\[ " \$\* " == \*' --shard='\* && " \$\* " != \*' --shard=1\/'\* \]\] && proxy=false/);
  assert.match(ci, /if \[\[ \$proxy == true \]\]; then npm run test:e2e:proxy; fi/);
  assert.match(ci, /npm run test:e2e -- "\$@"\n/);
});

// #421: the chat's open time runs in a job of its own, on the pull request too, so the browser shards no longer share
// its machine; `check` judges it by the browser suite's own answer and the job's one result.
test('the chat-open job runs the one command and check reads its result (#421)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const chatOpen = jobs['chat-open'];
  assert.ok(chatOpen, 'the workflow has a chat-open job');
  assert.deepEqual(chatOpen.needs, ['changes']);
  assert.equal(chatOpen.if, "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.integration != 'false') }}");
  assert.equal(chatOpen.steps.find(step => step.name === 'chat open').run, './ci.sh chat-open');
  const env = jobs.check.steps.at(-1).env;
  assert.equal(env.CHAT_OPEN_RUN, '${{ needs.changes.outputs.integration }}');
  assert.equal(env.CHAT_OPEN_RESULT, '${{ needs.chat-open.result }}');
});

// #410: a job that runs past its `timeout-minutes` ends as a failure or as cancelled, the two ways GitHub ends it, and
// either turns the required check red for the install proof and the browser suite alike.
test('a job that ran past its limit turns check red', () => {
  for (const stage of ['INSTALL', 'INTEGRATION']) {
    for (const result of ['failure', 'cancelled']) assert.equal(verdict({ [`${stage}_RESULT`]: result }), 1, `${stage}=${result}`);
  }
});

// The install proof runs as a matrix (#406) with fail-fast off: GitHub's one result for the matrix is a failure or
// cancelled when any area is, so it alone judges them, and a skipped install passes only when it was not asked for.
test('the install proof is red when one area failed or was cancelled, green when all passed', () => {
  assert.equal(verdict({ INSTALL_RESULT: 'success' }), 0);
  for (const result of ['failure', 'cancelled']) assert.equal(verdict({ INSTALL_RESULT: result }), 1, result);
  assert.equal(verdict({ INSTALL_RUN: 'false', INSTALL_RESULT: 'skipped' }), 0);
  for (const run of [undefined, '', 'true']) assert.equal(verdict({ INSTALL_RUN: run, INSTALL_RESULT: 'skipped' }), 1, String(run));
});

test('the install job runs as one matrix of nine areas on a fresh Docker machine each, and check reads its one result (#406)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const { install, check } = jobs;
  assert.equal(install.name, 'install-${{ matrix.area }}');
  assert.deepEqual(install.strategy, { 'fail-fast': false, matrix: { area: ['first-install', 'companies', 'agents', 'backup', 'proxy', 'rollback', 'update', 'previous-archive', 'release-update', 'sandbox-update', 'staged-update', 'sandbox-rollback', 'sizes', 'engines-update', 'one-line', 'updater'] } });
  assert.deepEqual(install.needs, ['changes', 'image']);
  assert.ok(check.needs.includes('install'), 'the required check waits for the proof');
  const env = check.steps.at(-1).env;
  assert.equal(env.INSTALL_RUN, '${{ needs.changes.outputs.install }}');
  assert.equal(env.INSTALL_RESULT, '${{ needs.install.result }}');
  // Matrix legs share one outputs namespace, so per-area outputs could overwrite each other: none are written.
  assert.equal(install.outputs, undefined);
});

test('the image build is judged by the browser suite\'s own answer: failed or cancelled is red, skipped passes only when nothing needed it (#403)', () => {
  assert.equal(verdict({}), 0);
  for (const result of ['failure', 'cancelled']) assert.equal(verdict({ IMAGE_RESULT: result }), 1, result);
  assert.equal(verdict({ IMAGE_RUN: 'false', IMAGE_RESULT: 'skipped' }), 0);
  for (const run of [undefined, '', 'true']) assert.equal(verdict({ IMAGE_RUN: run, IMAGE_RESULT: 'skipped' }), 1, String(run));
});

// #411: a manual run with both inputs off asks for no browser or install suite, and still starts the image job because the
// measurement loads that build (#408). `check` must read the image as asked for there, or a successful build would be
// marked skipped and turn the required check red.
test('a manual run with both suites off asks check for the image the measurement loads', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const expression = jobs.check.steps.at(-1).env.IMAGE_RUN;
  const evaluate = (source, context) => new Function('github', 'needs',
    `return (${source.replace(/^\$\{\{|\}\}$/g, '').trim().replace(/\b(github|needs)((?:\.\w+)+)/g, path => path.replaceAll('.', '?.'))});`,
  )(context.github, context.needs);
  const asked = evaluate(expression, {
    github: { event_name: 'workflow_dispatch' },
    needs: { changes: { result: 'success', outputs: { integration: 'false', install: 'false' } } },
  });
  assert.equal(asked, true, 'the image is asked for on a manual run');
  assert.equal(verdict({ IMAGE_RUN: String(asked), IMAGE_RESULT: 'success' }), 0);
  // A skipped image that was asked for is red: a manual run whose build was skipped must not pass.
  assert.equal(verdict({ IMAGE_RUN: String(asked), IMAGE_RESULT: 'skipped' }), 1);
});

test('check passes with no compared screens at all: a pull request never runs them (#257)', () => {
  assert.equal(verdict({ VISUAL_RUN: undefined, VISUAL_RESULT: undefined, LANE_RUN: undefined, LANE_RESULT: undefined }), 0);
  assert.equal(verdict({ VISUAL_RESULT: 'failure', LANE_RESULT: 'failure' }), 0);
});

test('classification and the fast job must succeed', () => {
  for (const key of ['CHANGES_RESULT', 'FAST_RESULT']) {
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(verdict({ [key]: result }), 1, `${key}=${result}`);
  }
});

test('a failing lint step is listed red and every other fast step green', () => {
  const { status, stdout } = run({ FAST_RESULT: 'failure', FAST_STEPS: fastSteps.replace('lint=success', 'lint=failure') });
  assert.equal(status, 1);
  const listed = Object.fromEntries([...stdout.matchAll(/^fast (\S+): (\S+)$/gm)].map(match => [match[1], match[2]]));
  assert.deepEqual(listed, { ...Object.fromEntries(fastSteps.split(' ').map(pair => pair.split('='))), lint: 'failure' });
});

test('a fast step that failed is red even when the job reports success', () => {
  assert.equal(verdict({ FAST_STEPS: fastSteps.replace('knip=success', 'knip=failure') }), 1);
  assert.equal(verdict({ FAST_STEPS: fastSteps.replace('node=success', 'node=cancelled') }), 1);
});

test('a fast job that listed no steps is red and says so', () => {
  for (const steps of ['', undefined]) {
    const { status, stdout } = run({ FAST_RESULT: 'failure', FAST_STEPS: steps });
    assert.equal(status, 1);
    assert.match(stdout, /^fast: no step results$/m);
  }
  assert.equal(verdict({ FAST_STEPS: '' }), 1);
});

test('the component tests may be skipped only when the first job did not ask for them', () => {
  const skipped = fastSteps.replace('components=success', 'components=skipped');
  assert.equal(verdict({ COMPONENTS_RUN: 'false', FAST_STEPS: skipped }), 0);
  assert.equal(verdict({ COMPONENTS_RUN: 'true', FAST_STEPS: skipped }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: '', FAST_STEPS: skipped }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: 'true', FAST_STEPS: fastSteps.replace(' components=success', '') }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: 'false', FAST_STEPS: fastSteps.replace('components=success', 'components=failure') }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: 'false', FAST_STEPS: fastSteps.replace('components=success', 'components=cancelled') }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: undefined, FAST_STEPS: skipped }), 1);
  assert.equal(verdict({ COMPONENTS_RUN: 'false', FAST_STEPS: fastSteps.replace('lint=success', 'lint=skipped') }), 1);
});

test('ci.yml decides the suites in its first job, gates each suite on it, and judges check with this verdict', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const { jobs } = workflow;
  const classify = jobs.changes.steps.find(step => step.id === 'classify');
  assert.match(classify.run, /node scripts\/ci-areas\.mjs \$main < "\$RUNNER_TEMP\/changed-files"/);
  // The fast job's component step reads this output; without it the step would always run and never be skippable.
  assert.equal(jobs.changes.outputs.components, '${{ steps.classify.outputs.components }}');
  // The image build follows the browser suite's own answer (#403), and now the install proof's too (#406).
  for (const [job, output] of [['database', 'database']]) {
    assert.equal(jobs.changes.outputs[output], `\${{ steps.classify.outputs.${output} }}`, output);
    assert.deepEqual(jobs[job].needs, ['changes'], job);
    assert.equal(jobs[job].if, `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${output} != 'false') }}`, job);
  }
  assert.equal(jobs.changes.outputs.install, '${{ steps.classify.outputs.install }}');
  // A manual run builds the image even with nothing asked: the measurement runs on every manual run (#408).
  assert.equal(jobs.image.if, "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.integration != 'false' || needs.changes.outputs.install != 'false' || github.event_name == 'workflow_dispatch') }}");
  // The install proof is one job under today's install condition and a successful image build (#406).
  assert.deepEqual(jobs.install.needs, ['changes', 'image']);
  assert.equal(jobs.install.if, "${{ !cancelled() && needs.image.result == 'success' && (needs.changes.result != 'success' || needs.changes.outputs.install != 'false') }}");
  // The browser suite takes the image the image job built, and does not start when that build failed (#403).
  assert.deepEqual(jobs.integration.needs, ['changes', 'image']);
  assert.equal(jobs.integration.if, '${{ !cancelled() && needs.image.result == \'success\' && (needs.changes.result != \'success\' || needs.changes.outputs.integration != \'false\') }}');
  // The images job only warms a cache: it cannot fail a run, and check, database and integration do not wait for it (#259).
  assert.equal(jobs['supabase-images']['continue-on-error'], true);
  assert.deepEqual(jobs['supabase-images'].needs, ['changes']);
  const step = jobs.check.steps.at(-1);
  assert.equal(step.run, 'node scripts/ci-verdict.mjs');
  assert.equal(jobs.check.if, '${{ always() }}');
  assert.deepEqual(jobs.check.needs, ['changes', 'fast', 'image', 'database', 'integration', 'chat-open', 'install']);
  // The image build is judged by what the browser suite or the install proof asked for, by the job's own result, and by
  // the manual run the measurement always makes (#403, #411).
  assert.equal(step.env.IMAGE_RUN, "${{ needs.changes.outputs.integration != 'false' || needs.changes.outputs.install != 'false' || github.event_name == 'workflow_dispatch' }}");
  assert.equal(step.env.IMAGE_RESULT, '${{ needs.image.result }}');
  // The install proof is judged by its own answer and its job's result, red when any area was (#406).
  assert.equal(step.env.INSTALL_RUN, '${{ needs.changes.outputs.install }}');
  assert.equal(step.env.INSTALL_RESULT, '${{ needs.install.result }}');
  for (const key of Object.keys(green)) assert.ok(step.env[key], key);
  assert.deepEqual(Object.keys(step.env).filter(key => /VISUAL|LANE/.test(key)), []);
  // The fast job runs on every change; only its component step follows the first job's answer, and an unknown answer
  // runs it.
  assert.deepEqual(jobs.fast.needs, ['changes']);
  assert.equal(jobs.fast.if, '${{ !cancelled() }}');
  assert.equal(jobs.fast.outputs.steps, '${{ steps.fast.outputs.steps }}');
  assert.equal(step.env.FAST_STEPS, '${{ needs.fast.outputs.steps }}');
  assert.equal(step.env.COMPONENTS_RUN, '${{ needs.changes.outputs.components }}');
  const fast = jobs.fast.steps.find(entry => entry.id === 'fast');
  assert.equal(fast.run, './ci.sh fast');
  assert.equal(jobs.fast.env.COMPONENTS, "${{ needs.changes.result == 'success' && needs.changes.outputs.components || 'true' }}");
});

// #408: the profile-size measurement is not a stage: it runs on main and on a manual run only, and no pull request
// waits for it.
test('check waits for no measurement: the profile-size measurement is no stage of the verdict (#408)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(jobs.check.needs.includes('install-measure'), false, 'check needs no measurement job');
  assert.deepEqual(Object.keys(jobs.check.steps.at(-1).env).filter(key => /MEASURE/.test(key)), [], 'the verdict reads no measurement');
});

test('the fast job restores its dependencies by lock-file hash and the browser by version, never the bundler cache (#218, #258)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { steps } = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.fast;
  const uses = (action, path) => steps.filter(step => step.uses?.startsWith(`actions/cache/${action}@`) && step.with.path.includes(path));
  const index = step => steps.indexOf(step);
  const fast = steps.findIndex(step => step.id === 'fast');
  for (const [path, key] of [['node_modules', /hashFiles\('package-lock\.json'\)/], ['ms-playwright', /steps\.browser-version\.outputs\.version/]]) {
    const [restore] = uses('restore', path);
    const [save] = uses('save', path);
    assert.ok(restore && save, path);
    assert.match(restore.with.key, key, path);
    assert.equal(save.with.key, restore.with.key, path);
    assert.equal(save.with.path, restore.with.path, path);
    assert.equal(restore.with['restore-keys'], undefined, `${path}: an exact key only`);
    // Saved right after a fresh install, before any test can write a cache of its own into it.
    assert.ok(index(restore) < index(save) && index(save) < fast, path);
    assert.match(save.if, new RegExp(`steps\\.${restore.id}\\.outputs\\.cache-hit != 'true'`), path);
  }
  const [modules] = uses('save', 'node_modules');
  assert.deepEqual(modules.with.path.split('\n').map(line => line.trim()).filter(Boolean), ['node_modules', '!node_modules/.vite', '!node_modules/.cache']);
  assert.ok(!steps.some(step => step.with?.cache), 'no package-manager cache beside the restored dependencies');
  // A miss installs exactly what a hit restores: the browser alone, on the image's own system packages and fonts, so a
  // component test draws the same on every run (no --with-deps on one run and not the next).
  const version = steps.find(step => step.id === 'browser-version');
  assert.match(version.run, /\$ImageOS/);
  assert.match(version.run, /\$ImageVersion/);
  assert.ok(!steps.some(step => /ldd|install-deps|with-deps/.test(step.run ?? '')), 'no system packages on one run only');
  assert.equal(steps.find(step => /playwright install/.test(step.run ?? '')).run, 'npx playwright install chromium');
  // The OpenAPI linter has an npm cache of its own (its manifest and its npx install), keyed by its pinned version, so a
  // hit lints with no registry request.
  const linter = (await import('../scripts/ci-fast.mjs')).steps.find(step => step.name === 'openapi').command.match(/@redocly\/cli@([\d.]+)/)[1];
  const [npxRestore] = uses('restore', 'npx-cache');
  const [npxSave] = uses('save', 'npx-cache');
  assert.ok(npxRestore && npxSave, 'the linter cache is restored and saved');
  assert.ok(npxRestore.with.key.endsWith(`-redocly-${linter}`), npxRestore.with.key);
  assert.equal(npxSave.with.key, npxRestore.with.key);
  assert.equal(npxSave.with.path, npxRestore.with.path);
  assert.equal(steps.find(step => step.id === 'fast').env.NPX_CACHE, npxRestore.with.path);
  assert.ok(index(npxRestore) < fast && fast < index(npxSave), 'saved after the fast step has filled it');
  assert.match(npxSave.if, new RegExp(`steps\\.${npxRestore.id}\\.outputs\\.cache-hit != 'true'`));
  // The browser key names the one Playwright in the lock file, which Vitest's provider and the browser suite both load.
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const versions = new Set(Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/playwright-core$/.test(path)).map(([, entry]) => entry.version));
  assert.equal(versions.size, 1, [...versions].join(', '));
});

// Omar, 2026-11-17: the compared screens (and the navigation budgets with them) run on a push to main and on a manual
// run, never on a pull request, and no pull request waits for them. Each job's condition is read for every event.
test('a pull request starts no compared-screen job, and check needs none of them (#257)', async () => {
  const { load } = await import('js-yaml');
  const { readFileSync } = await import('node:fs');
  const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const screenJobs = ['visual'];
  for (const name of screenJobs) {
    assert.ok(jobs[name], name);
    const condition = jobs[name].if ?? '';
    assert.match(condition, /github\.event_name == '(push|workflow_dispatch)'/, `${name} names the events it runs on`);
    assert.doesNotMatch(condition.replace(/github\.event_name == '(push|workflow_dispatch)'/g, ''), /event_name|pull_request/, `${name} has no other event test`);
    assert.doesNotMatch(condition, /\|\|\s*needs\.changes\.result/, `${name} cannot start because classification failed`);
  }
  for (const [name, job] of Object.entries(jobs)) if (!screenJobs.includes(name)) {
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
