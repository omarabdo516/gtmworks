import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { installJob, jobSteps } from './install-job.mjs';

// The install proof is one job (#406): a matrix entry per area, each on a fresh isolated Docker machine of its own. The
// areas are the first install and its repeat (`first-install`); Companies and their Engines (`companies`, #407); Agents
// on their Engines (`agents`, #408); backup and restore (`backup`, #409); the public address behind a proxy (`proxy`);
// the update between releases (`update`); and the one-line install (`one-line`). Each entry is one command of the repo,
// holds no check of its own, and loads the one app image the run built (#403): no step of the job builds an image. The
// profile-size measurement is a job of its own that no pull request runs (#408).
const ci = load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
const job = ci.jobs.install;
const measureJob = 'install-measure';
const proof = ['scripts/ci-install-check.sh', 'scripts/ci-install-lib.sh'];
const script = readFileSync(proof[0], 'utf8');
const matrix = job.strategy.matrix.area;
// The areas the proof's own dispatch names, in the order it runs them when all are asked for.
const cases = [...script.matchAll(/^ ([\w-]+)\) (.*);;$/gm)].map(([, name, commands]) => ({ name, commands }));

test('the proof is one job with one matrix entry per area, every entry left to its end', () => {
  assert.equal(job.name, 'install-${{ matrix.area }}', 'the name says which area failed');
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { area: ['first-install', 'companies', 'agents', 'backup', 'proxy', 'rollback', 'update', 'previous-archive', 'sizes', 'engines-update', 'one-line', 'updater'] } });
  assert.equal(job.permissions.contents, 'read');
  // Its time limit is tests/ci-budgets.test.mjs's, one table for every job of the full check (#410).
});

const areaFns = ['first_install', 'companies', 'agents', 'backup', 'proxy', 'rollback', 'update', 'previous_archive', 'sizes', 'engines_update', 'one_line', 'updater'];
// The proof's twelve areas (#389's rollback, previous-archive and engines-update, #400's sizes, #443's updater the last) in the order it has always run them, then the measurement: all of them in subshells when no
// area is named, one area when one is (#406, #411).
const allAreas = [...areaFns, 'measure'];

test('the dispatch names every area once, in the matrix, the measurement and all\'s own subshells', () => {
  // The measurement is the one case outside the matrix: it is the `install-measure` job's (#408).
  assert.deepEqual(cases.map(({ name }) => name), ['all', ...matrix, 'measure'], 'the matrix and the dispatch name the same areas');
  // A case runs its own area only: one command of the nine or the measurement, never more.
  for (const { name, commands } of cases) if (name !== 'all') {
    const calls = commands.split('; ');
    assert.equal(calls.length, 1, `${name} runs only its own area`);
    for (const call of calls) assert.ok(allAreas.includes(call), `${name}: ${call}`);
  }
  assert.equal(cases.find(({ name }) => name === 'first-install').commands, 'first_install');
  // Naming one area runs only it.
  const dispatches = Object.fromEntries(cases.map(({ name, commands }) => [name, commands]));
  assert.equal(dispatches['first-install'], 'first_install');
  assert.equal(dispatches.companies, 'companies');
  assert.equal(dispatches.agents, 'agents');
  assert.equal(dispatches.backup, 'backup');
  assert.equal(dispatches.proxy, 'proxy');
  assert.equal(dispatches.rollback, 'rollback');
  assert.equal(dispatches.update, 'update');
  assert.equal(dispatches['previous-archive'], 'previous_archive');
  assert.equal(dispatches.sizes, 'sizes');
  assert.equal(dispatches['engines-update'], 'engines_update');
  assert.equal(dispatches['one-line'], 'one_line');
  assert.equal(dispatches.updater, 'updater');
  assert.equal(dispatches.measure, 'measure');
  // `./ci.sh install proxy` passes the area through to the same command.
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /bash scripts\/ci-install-check\.sh "\$@"/);
  // No argument runs every area in order, each in a subshell of its own, and the measurement last: one area's
  // fail_prefix, trap, HOME and cwd cannot reach the next one.
  for (const area of allAreas) assert.match(script, new RegExp(`^${area}\\(\\) \\{$`, 'm'), area);
  const all = script.split('\n').find(line => /^ all\)/.test(line));
  assert.ok(all, 'no argument runs every area');
  const calls = [...all.matchAll(/\(([a-z][a-z0-9_]*)\)/g)].map(match => match[1]);
  assert.deepEqual(calls, allAreas, 'all nine run in their order, each in its own subshell, and the measurement last');
});

test('each entry runs its area with one command and holds no check of the proof', () => {
  const calls = job.steps.filter(step => (step.run ?? '').trim() === 'bash scripts/ci-install-check.sh ${{ matrix.area }}');
  assert.equal(calls.length, 1, 'the matrix entry names the area');
  // No step of the job prints a failure of the proof: the sentences live in the repo's script, where a person runs them.
  for (const step of job.steps) assert.doesNotMatch(step.run ?? '', /\bfail |\bfail\(/, `${step.name} holds no failure point`);
});

test('the install job loads the one image the run built and builds none of its own', () => {
  assert.equal(job.steps.some(step => (step.uses ?? '').startsWith('docker/build-push-action@')), false, 'no image build');
  assert.equal(job.steps.some(step => /(^|\s)docker build(\s|$)/.test(step.run ?? '')), false, 'no image built in a step');
  const steps = installJob().steps;
  const download = steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'gtmworks-image', 'it takes the image artifact');
  const load = steps.find(step => /docker --host tcp:\/\/127\.0\.0\.1:2375 load/.test(step.run ?? ''));
  assert.match(load.run, /gtmworks-image\.tar/, 'it loads that archive');
  // The source install's own compose tag, read from its compose file, which the release areas reuse: the installer then
  // skips its build (tests only).
  assert.match(load.run, /tag gtmworks:ci "\$web_image"/);
  assert.equal(steps.find(step => step.name === 'the install proof').env.GTMWORKS_IMAGE_PREBUILT, 'true');
  // The switch is read only by the tests that load the run's one build; a source install anywhere else builds its image.
  const installer = readFileSync('scripts/install.sh', 'utf8');
  assert.match(installer, /GTMWORKS_IMAGE_PREBUILT/);
  assert.match(installer, /if \[ "\$\{GTMWORKS_IMAGE_PREBUILT:-\}" != true \]; then[\s\S]*?compose build web/);
});

// #411: the tag an install machine loads the run's build under is the one the source install's compose file names, read
// from that file: a tag change there cannot silently make an install build its own image again.
test('the image an install machine loads carries the tag the compose file names for the web service', () => {
  const compose = load(readFileSync('docker-compose.install.yml', 'utf8'));
  const image = compose.services.web.image;
  assert.equal(image, compose.services.worker.image, 'the app and the worker run one image');
  const loadStep = installJob().steps.find(step => /load --input/.test(step.run ?? ''));
  assert.ok(loadStep, 'the install machine loads the run build');
  assert.doesNotMatch(loadStep.run, new RegExp(image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no step hard-codes the tag');
  assert.match(loadStep.run, /docker-compose\.install\.yml/, 'the tag comes from the compose file');
  const assignment = loadStep.run.split('\n').find(line => /^web_image=/.test(line));
  assert.ok(assignment, 'the step reads the tag into web_image');
  const resolved = spawnSync('bash', ['-c', `${assignment}\nprintf '%s' "$web_image"`], { encoding: 'utf8' });
  assert.equal(resolved.stdout, image, 'the tag the step reads is the compose file\'s web image');
  assert.match(loadStep.run, /tag gtmworks:ci "\$web_image"/, 'it tags the run build as that image');
});

// #411: the isolated machine, the run's image downloaded and loaded are one composite action both install jobs use, so
// the two jobs cannot drift apart; each job's last step still removes the machine.
test('the install and measurement jobs share one composite action for their machine and the image', () => {
  for (const name of ['install', measureJob]) {
    const used = ci.jobs[name].steps.filter(step => step.uses === './.github/actions/install-machine');
    assert.equal(used.length, 1, `${name} uses the install machine action once`);
  }
  const action = load(readFileSync('.github/actions/install-machine/action.yml', 'utf8'));
  assert.equal(action.runs.using, 'composite');
  assert.deepEqual(action.runs.steps.map(step => step.name), ['start the isolated Docker machine', 'download the image', 'load the image', 'download the work sandbox image', 'load the work sandbox image']);
  for (const step of action.runs.steps.filter(step => step.run)) assert.equal(step.shell, 'bash', `${step.name} names its shell`);
  assert.match(action.runs.steps[0].run, /--privileged --name install-docker/);
  assert.match(action.runs.steps[0].run, /docker --host tcp:\/\/127\.0\.0\.1:2375 info/, 'the start step waits for the daemon');
  assert.equal(action.runs.steps[1].with.name, 'gtmworks-image');
  assert.match(action.runs.steps[2].run, /gtmworks-image\.tar/);
});

test('the install job runs under today\'s install condition and a successful image build', () => {
  assert.equal(job.if, "${{ !cancelled() && needs.image.result == 'success' && (needs.changes.result != 'success' || needs.changes.outputs.install != 'false') }}");
  assert.deepEqual(job.needs, ['changes', 'image']);
});

test('only the update and previous-archive areas fetch the pull request\'s full history: they build the previous release from its commit', () => {
  const checkout = job.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], "${{ (matrix.area == 'update' || matrix.area == 'previous-archive') && '0' || '1' }}");
  assert.match(script, /git worktree add "\$RUNNER_TEMP\/previous-release"/);
});

test('only the proxy area installs the test packages: its browser check is the one host command that needs them', () => {
  const installs = job.steps.filter(step => /npm ci --ignore-scripts/.test(step.run ?? ''));
  assert.deepEqual(installs.map(step => [step.name, step.if]), [['test packages for the install browser check', "${{ matrix.area == 'proxy' }}"]]);
  assert.equal(script.match(/npx --no-install playwright test/g).length, 1, 'the proxy area runs the browser alone');
});

test('a job on a GitHub-hosted runner does not wait for its Docker machine to be removed', () => {
  const remove = job.steps.at(-1);
  assert.match(remove.run, /docker rm -fv install-docker/);
  assert.equal(remove.if, "${{ always() && runner.environment != 'github-hosted' }}", 'the removal stays for a runner that is reused, also after a failure');
});

// The helpers the areas share are written once, in the lib or the script, never in both (#402).
test('no helper function is defined twice in the proof or its lib', () => {
  const definitions = proof.flatMap(path => [...readFileSync(path, 'utf8').matchAll(/^([a-z][a-z0-9_]*)\(\) \{/gm)].map(match => match[1]));
  assert.deepEqual(definitions.filter((name, index) => definitions.indexOf(name) !== index), [], 'each helper has one definition');
});

// #408: the agents area runs on its own machine and makes everything it reads itself — its install, the first run that
// makes the first Company, and the second Company on its own Engine — and first-install no longer runs it.
test('the agents area makes its own install, first run and second Company, and first-install no longer runs it', () => {
  const text = readFileSync(proof[0], 'utf8');
  const agents = text.slice(text.indexOf('\nagents() {'), text.indexOf('\nbackup() {'));
  assert.ok(agents, 'the agents area');
  for (const step of ['area_setup', 'reset_install', 'install_source', 'complete_setup', 'second_company']) {
    assert.ok(agents.includes(step), `the agents area makes ${step} itself`);
  }
  assert.equal(agents.includes('capacity'), false, 'the measurement left the agents area');
  assert.match(script, /^ first-install\) first_install;;$/m, 'first-install no longer runs the agents area');
});

// #408: the measurement is an area of its own, with a fresh install and whatever Company it reads, and it prints the
// same line of numbers it printed inside the agents area.
test('the measurement is an area of its own and prints the same line of numbers', () => {
  const text = readFileSync(proof[0], 'utf8');
  const measure = text.slice(text.indexOf('\nmeasure() {'), text.indexOf('\ncase "${1:-all}"'));
  assert.ok(measure, 'the measure area');
  for (const step of ['area_setup', 'reset_install', 'install_source', 'complete_setup', 'second_company', 'capacity with-skills', 'capacity no-skills']) {
    assert.ok(measure.includes(step), `the measurement makes ${step}`);
  }
  assert.match(measure, /capacity: engine memory \$memory_before before and \$memory_after after 20 agent profiles; \$per_with KiB per profile with the bundled Skills, \$per_without KiB without/);
});

// #408: the measurement is no check a pull request needs. It runs as one job of its own on a push to main and on a
// manual run, loads the run's one image as the install areas do, and the required check does not wait for it.
test('the profile-size measurement is a job of its own, and the required check does not need it', () => {
  const job = ci.jobs[measureJob];
  assert.ok(job, `${measureJob} exists`);
  assert.deepEqual(job.needs, ['changes', 'image']);
  assert.doesNotMatch(String(job.if), /pull_request/);
  assert.match(String(job.if), /github\.event_name == 'push'/);
  assert.match(String(job.if), /github\.event_name == 'workflow_dispatch'/);
  assert.match(String(job.if), /needs\.image\.result == 'success'/);
  const calls = job.steps.filter(step => (step.run ?? '').trim() === 'bash scripts/ci-install-check.sh measure');
  assert.equal(calls.length, 1, 'one command of the repo runs the measurement');
  assert.equal(calls[0].env.GTMWORKS_IMAGE_PREBUILT, 'true');
  const steps = jobSteps(job);
  const download = steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'gtmworks-image');
  const load = steps.find(step => /docker --host tcp:\/\/127\.0\.0\.1:2375 load/.test(step.run ?? ''));
  assert.match(load.run, /gtmworks-image\.tar/);
  assert.match(load.run, /tag gtmworks:ci "\$web_image"/);
  const remove = job.steps.at(-1);
  assert.match(remove.run, /docker rm -fv install-docker/);
  assert.equal(remove.if, "${{ always() && runner.environment != 'github-hosted' }}", 'removed on a reused runner, also after a failure');
  assert.equal(ci.jobs.check.needs.includes(measureJob), false, 'the required check does not wait for the measurement');
});

// #410: the checks document tells a reader to run one area by name (`./ci.sh install <area>`), so every area it writes
// must be a case of the proof's dispatch: a command in the document runs as written.
test('every ./ci.sh install area the checks document names is a case of the dispatch', () => {
  const doc = readFileSync('docs/agents/checks.md', 'utf8');
  const dispatches = new Set([...script.matchAll(/^ ([\w-]+)\)/gm)].map(([, name]) => name));
  const areas = new Set([...doc.matchAll(/\.\/ci\.sh install ([a-z][a-z-]*)/g)].map(([, area]) => area));
  assert.deepEqual([...areas].sort(), ['agents', 'backup', 'companies', 'engines-update', 'first-install', 'measure', 'one-line', 'previous-archive', 'proxy', 'rollback', 'sizes', 'update', 'updater']);
  for (const area of areas) assert.ok(dispatches.has(area), `./ci.sh install ${area}`);
});

// #409: backup and restore is an area of its own, so the first-install job no longer runs a backup or a restore check,
// and naming it runs only its area on the machine it makes.
test('backup and restore is an area of its own and the first-install job no longer runs it', () => {
  const first = script.split('\n').find(line => /^ first-install\)/.test(line));
  assert.doesNotMatch(first, /backup/, 'the first-install area runs no backup check');
  assert.match(script, /^ backup\) backup;;$/m, 'the proof has a backup area of its own');
  // The area is one command of the repo, and its sentence names it on a failure.
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /install \[first-install \| companies \| agents \| backup \| proxy \| rollback \| update \| previous-archive \| sizes \| engines-update \| one-line \| updater \| measure\]/);
});
