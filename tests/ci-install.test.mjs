import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { area: ['first-install', 'companies', 'agents', 'agents-sandbox', 'backup', 'backup-engines', 'proxy', 'rollback', 'update', 'previous-archive', 'release-update', 'sandbox-update', 'staged-update', 'sandbox-rollback', 'sizes', 'engines-update', 'one-line', 'updater'] } });
  assert.equal(job.permissions.contents, 'read');
  // Its time limit is tests/ci-budgets.test.mjs's, one table for every job of the full check (#410).
});

const areaFns = ['first_install', 'companies', 'agents', 'agents_sandbox', 'backup', 'backup_engines', 'proxy', 'rollback', 'update', 'previous_archive', 'release_update', 'sandbox_update', 'staged_update', 'sandbox_rollback', 'sizes', 'engines_update', 'one_line', 'updater'];
// The proof's eighteen areas (#553's agents-sandbox and backup-engines, #389's rollback, previous-archive, engines-update and staged-update, #483's release-update, #397's sandbox-update, #504's sandbox-rollback, #400's sizes, #443's updater the last) in the order it has always run them, then the measurement: all of them in subshells when no
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
  assert.equal(dispatches['agents-sandbox'], 'agents_sandbox');
  assert.equal(dispatches.backup, 'backup');
  assert.equal(dispatches['backup-engines'], 'backup_engines');
  assert.equal(dispatches.proxy, 'proxy');
  assert.equal(dispatches.rollback, 'rollback');
  assert.equal(dispatches.update, 'update');
  assert.equal(dispatches['previous-archive'], 'previous_archive');
  assert.equal(dispatches['release-update'], 'release_update');
  assert.equal(dispatches['sandbox-update'], 'sandbox_update');
  assert.equal(dispatches['staged-update'], 'staged_update');
  assert.equal(dispatches['sandbox-rollback'], 'sandbox_rollback');
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
  assert.deepEqual(action.runs.steps.map(step => step.name), ['start the isolated Docker machine', 'download the image', 'restore the work sandbox image', 'load the images']);
  for (const step of action.runs.steps.filter(step => step.run)) assert.equal(step.shell, 'bash', `${step.name} names its shell`);
  const [start, image, sandbox, loadBoth] = action.runs.steps;
  assert.equal(start.run.trim(), 'bash scripts/ci-install-machine.sh start');
  assert.equal(image.with.name, 'gtmworks-image');
  // #608: the work sandbox image is kept in the cache under its own files' key, which the image job names.
  assert.equal(sandbox.uses, 'actions/cache/restore@v4');
  assert.deepEqual(sandbox.with, { path: '${{ runner.temp }}/gtmworks-sandbox-image.tar', key: '${{ inputs.sandbox-key }}', 'fail-on-cache-miss': true });
  assert.equal(action.inputs['sandbox-key'].required, true);
  assert.match(loadBoth.run, /gtmworks-image\.tar" & app=\$!/, 'the two images load at once');
  assert.match(loadBoth.run, /gtmworks-sandbox-image\.tar" & sandbox=\$!/);
  assert.match(loadBoth.run, /wait "\$app" \|\| status=\$\?; wait "\$sandbox" \|\| status=\$\?\n\s*\(\( status == 0 \)\)/, 'a failed load fails the step once both have ended');
  for (const name of ['install', measureJob]) {
    const used = ci.jobs[name].steps.find(step => step.uses === './.github/actions/install-machine');
    assert.deepEqual(used.with, { 'sandbox-key': '${{ needs.image.outputs.sandbox-key }}' }, `${name} names the run's sandbox image`);
    assert.equal(ci.jobs[name].steps.at(-1).run, 'bash scripts/ci-install-machine.sh stop', `${name} removes the machine`);
  }
});

// #608: the work sandbox image is built only when its files changed: the image job keeps it in the cache under their
// hash and builds and saves it on a miss, and no longer uploads it as an artifact every run.
test('the image job builds the work sandbox image only when no image of its files is kept', () => {
  const image = ci.jobs.image;
  assert.equal(image.outputs['sandbox-key'], '${{ steps.sandbox.outputs.key }}');
  const key = image.steps.find(step => step.id === 'sandbox');
  assert.match(key.run, /^echo "key=install-sandbox-image-\$\{\{ hashFiles\('sandbox\/\*\*'\) \}\}" >> "\$GITHUB_OUTPUT"$/);
  const lookup = image.steps.find(step => step.id === 'sandbox-cache');
  assert.deepEqual(lookup.with, { path: '${{ runner.temp }}/gtmworks-sandbox-image.tar', key: '${{ steps.sandbox.outputs.key }}', 'lookup-only': true });
  const build = image.steps.find(step => step.name === 'build the work sandbox image');
  assert.match(build.if, /steps\.sandbox-cache\.outputs\.cache-hit != 'true'/);
  assert.equal(build.with.outputs, 'type=docker,dest=${{ runner.temp }}/gtmworks-sandbox-image.tar');
  const save = image.steps.find(step => step.name === 'keep the work sandbox image');
  assert.equal(save.uses, 'actions/cache/save@v4');
  assert.equal(save.if, build.if);
  assert.deepEqual(save.with, { path: lookup.with.path, key: lookup.with.key });
  // A failed upload only warns, so the job looks the entry up and is red without it.
  const kept = image.steps[image.steps.indexOf(save) + 1];
  assert.equal(kept.name, 'the work sandbox image is kept');
  assert.equal(kept.if, build.if);
  assert.deepEqual(kept.with, { ...lookup.with, 'fail-on-cache-miss': true });
  assert.equal(image.steps.some(step => step.with?.name === 'gtmworks-sandbox-image'), false, 'no artifact of it');
});

test('the install job runs under today\'s install condition and a successful image build', () => {
  assert.equal(job.if, "${{ !cancelled() && needs.image.result == 'success' && (needs.changes.result != 'success' || needs.changes.outputs.install != 'false') }}");
  assert.deepEqual(job.needs, ['changes', 'image']);
});

test('only the update, previous-archive and sandbox-update areas fetch the pull request\'s full history: they build an earlier release from its commit', () => {
  const checkout = job.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], "${{ (matrix.area == 'update' || matrix.area == 'previous-archive' || matrix.area == 'sandbox-update' || matrix.area == 'staged-update') && '0' || '1' }}");
  assert.match(script, /git worktree add "\$RUNNER_TEMP\/previous-release"/);
  // #397: the release before the work sandbox, a fixed commit of main with an Engine per Company.
  assert.match(script, /git worktree add "\$RUNNER_TEMP\/sandbox-previous-release"/);
});

test('only the proxy area installs the test packages: its browser check is the one host command that needs them', () => {
  const installs = job.steps.filter(step => /npm ci --ignore-scripts/.test(step.run ?? ''));
  assert.deepEqual(installs.map(step => [step.name, step.if]), [['test packages for the install browser check', "${{ matrix.area == 'proxy' }}"]]);
  assert.equal(script.match(/npx --no-install playwright test/g).length, 1, 'the proxy area runs the browser alone');
});

test('a job on a GitHub-hosted runner does not wait for its Docker machine to be removed', () => {
  const remove = job.steps.at(-1);
  assert.equal(remove.run, 'bash scripts/ci-install-machine.sh stop');
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
  const agents = text.slice(text.indexOf('\nagents() {'), text.indexOf('\n# agents-sandbox:'));
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
  assert.equal(remove.run, 'bash scripts/ci-install-machine.sh stop');
  assert.equal(remove.if, "${{ always() && runner.environment != 'github-hosted' }}", 'removed on a reused runner, also after a failure');
  assert.equal(ci.jobs.check.needs.includes(measureJob), false, 'the required check does not wait for the measurement');
});

// #410: the checks document tells a reader to run one area by name (`./ci.sh install <area>`), so every area it writes
// must be a case of the proof's dispatch: a command in the document runs as written.
test('every ./ci.sh install area the checks document names is a case of the dispatch', () => {
  const doc = readFileSync('docs/agents/checks.md', 'utf8');
  const dispatches = new Set([...script.matchAll(/^ ([\w-]+)\)/gm)].map(([, name]) => name));
  const areas = new Set([...doc.matchAll(/\.\/ci\.sh install ([a-z][a-z-]*)/g)].map(([, area]) => area));
  assert.deepEqual([...areas].sort(), ['agents', 'agents-sandbox', 'backup', 'backup-engines', 'companies', 'engines-update', 'first-install', 'measure', 'one-line', 'previous-archive', 'proxy', 'release-update', 'rollback', 'sandbox-rollback', 'sandbox-update', 'sizes', 'staged-update', 'update', 'updater']);
  for (const area of areas) assert.ok(dispatches.has(area), `./ci.sh install ${area}`);
});

// #409: backup and restore is an area of its own, so the first-install job no longer runs a backup or a restore check,
// and naming it runs only its area on the machine it makes.
test('backup and restore is an area of its own and the first-install job no longer runs it', () => {
  const first = script.split('\n').find(line => /^ first-install\)/.test(line));
  assert.doesNotMatch(first, /backup/, 'the first-install area runs no backup check');
  assert.match(script, /^ backup\) backup;;$/m, 'the proof has a backup area of its own');
  // The area is one command of the repo, and its sentence names it on a failure.
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /install \[first-install \| companies \| agents \| agents-sandbox \| backup \| backup-engines \| proxy \| rollback \| update \| previous-archive \| release-update \| sandbox-update \| staged-update \| sandbox-rollback \| sizes \| engines-update \| one-line \| updater \| measure\]/);
});

// #553: the two areas that held the install job longest are each split in two, every check kept and run once: the agents
// area keeps the contract, the profiles, the apps and the scan, and agents-sandbox an Agent's work in its sandbox; the
// backup area keeps the install's own archive, and backup-engines every Company's Engine and the refused archives. Each
// half makes its own install, first run and the Companies it reads on a machine of its own.
test('the agents and backup areas are each split in two, each half making the install it reads', () => {
  const text = readFileSync(proof[0], 'utf8');
  const area = (name, next) => text.slice(text.indexOf(`\n${name}() {`), text.indexOf(next, text.indexOf(`\n${name}() {`)));
  const agents = area('agents', '\n# agents-sandbox:');
  const sandbox = area('agents_sandbox', '\n# backup:');
  const backup = area('backup', '\n# backup-engines:');
  const engines = area('backup_engines', '\n# proxy:');
  for (const [name, body] of [['agents', agents], ['agents-sandbox', sandbox], ['backup', backup], ['backup-engines', engines]]) {
    assert.ok(body.length > 100, name);
    for (const step of ['area_setup', 'reset_install', 'install_source', 'complete_setup']) assert.ok(body.includes(step), `${name} makes ${step} itself`);
  }
  for (const body of [agents, sandbox]) {
    assert.ok(body.includes('second_company ||'), 'each agents half has its second Company');
    assert.ok(body.includes('point_engine_at_fake_model'), 'each agents half points its Engine at the fake model');
    assert.match(body, /\nscan_engines\n\}\n*$/, 'each agents half ends with the scan of every Engine, sandbox and exit');
  }
  // The profiles' verify step stays in the agents area; the sandbox half makes only the second Agent it starts in.
  assert.match(agents, /check-install-profiles\.mjs - verify|- verify "\$marker" < scripts\/check-install-profiles\.mjs/);
  assert.doesNotMatch(sandbox, / - verify /);
  assert.ok(sandbox.indexOf(' - prepare <') < sandbox.indexOf(' - second <') && sandbox.indexOf(' - second <') < sandbox.indexOf(' - sandbox "$sandbox_marker"'), 'prepare, then the second Agent, then the sandbox steps');
  for (const step of ['sandbox', 'sandbox-mcp-add', 'sandbox-mcp', 'library', 'sandbox-key', 'sandbox-sync']) {
    assert.ok(sandbox.includes(` - ${step} `), `agents-sandbox runs ${step}`);
    assert.equal(agents.includes(` - ${step} `), false, `agents no longer runs ${step}`);
  }
  assert.ok(agents.includes('check-install-agent.mjs') && !sandbox.includes('check-install-agent.mjs'), 'the contract check runs once');
  // The backup halves: the install's own archive in backup, every Engine's in backup-engines, each run once.
  assert.ok(backup.includes("fail 'backup'") && backup.includes('lifecycle verify'));
  assert.equal(backup.includes('second_company'), false, 'the backup area adds no second Company');
  assert.ok(engines.includes('second_company scripts/install.sh --memory 1536m --cpus 1.5'));
  for (const refused of ['incomplete-engines.tgz', 'hard-link.tgz', 'partial-work.tgz', 'restore "$every_engine"']) {
    assert.ok(engines.includes(refused), refused);
    assert.equal(backup.includes(refused), false, `${refused} runs once`);
  }
  assert.equal(engines.includes('lifecycle seed'), false, 'the lifecycle data is the backup area\'s');
});

// #483: the update a stable install really takes. The release-update area installs the latest published release from
// its own two files, read from the releases list on every run (never a fixed commit or tag), and updates it to this one.
test('the release-update area installs the latest published release from its two files and updates it to this one', () => {
  const area = script.slice(script.indexOf('\nrelease_update() {'), script.indexOf('\n}\n', script.indexOf('\nrelease_update() {')));
  assert.match(area, /stable=\$\(node scripts\/latest-release\.mjs "\$dir"\)/, 'the release is read from the releases list');
  assert.doesNotMatch(area, /git (worktree|fetch|cat-file)|[0-9a-f]{40}|v\d+\.\d+\.\d+/, 'no fixed commit or tag');
  assert.match(area, /sh "\$dir\/install\.sh" \|\| fail/, 'installed from its own install.sh');
  assert.match(area, /cp "\$root\/release-first\/docker-compose\.install\.yml" "\$root\/release-first\/install\.sh" \. .*\n\s*sh install\.sh update \|\| fail/, 'updated to this release with its two files');
  assert.match(readFileSync(resolve('scripts/ci-install-lib.sh'), 'utf8'), /for fixture in [^;]*\bstable-release-install\b/, 'a later area takes its install down');
});

// #423: the four areas that update from a fixed commit of main (update and previous-archive from the release before the
// Engines, sandbox-update and staged-update from the release before the work sandbox) spent about three minutes each
// building that commit's image. A fixed commit's image is the same on every run, so CI keeps it, keyed by the commit,
// and an area loads it instead of building it again; the proof itself is unchanged.
const lib = readFileSync(proof[1], 'utf8');
const fixedAreas = { update: 'previous', 'previous-archive': 'previous', 'sandbox-update': 'before_sandbox', 'staged-update': 'before_sandbox' };
const commitOf = area => spawnSync('bash', ['-c', '. scripts/ci-install-lib.sh; area_release_commit "$1"', '_', area], { encoding: 'utf8' });

test('each area that updates from a fixed release names its commit once, in the lib, and builds it only through release_image', () => {
  const commits = Object.fromEntries([...lib.matchAll(/^(previous|before_sandbox)_release_commit=([0-9a-f]{40})$/gm)].map(([, name, sha]) => [name, sha]));
  assert.deepEqual(Object.keys(commits).sort(), ['before_sandbox', 'previous']);
  for (const [area, name] of Object.entries(fixedAreas)) {
    const out = commitOf(area);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, commits[name], `${area} updates from its fixed commit`);
  }
  for (const area of matrix.filter(area => !fixedAreas[area])) assert.equal(commitOf(area).stdout, '', `${area} builds no earlier release`);
  // No area builds a fixed commit's image itself, and no commit is written a second time in the proof.
  assert.doesNotMatch(script, /docker build[^\n]*"\$RUNNER_TEMP\/(previous-release|sandbox-previous-release|staged-previous-release)"/);
  for (const sha of Object.values(commits)) assert.equal(script.includes(sha), false, `${sha} is written in the lib only`);
  assert.equal(script.match(/^\s*release_image "\$\w+" localhost:5000\/gtmworks:0\.0\.0-\w+ "\$RUNNER_TEMP\/[\w-]+"/gm).length, 3, 'the three builds of a fixed commit go through release_image');
});

test('the install job keeps a fixed release image keyed by its commit, for the areas that update from one only', () => {
  const release = job.steps.find(step => step.id === 'release');
  assert.ok(release, 'a step reads the fixed commit of the area');
  assert.match(release.run, /area_release_commit "\$\{\{ matrix\.area \}\}"/);
  const cache = job.steps.find(step => (step.uses ?? '').startsWith('actions/cache@'));
  assert.ok(cache, 'the job keeps the image in the Actions cache');
  assert.equal(cache.if, "${{ steps.release.outputs.commit != '' }}", 'only an area with a fixed release keeps one');
  assert.equal(cache.with.key, 'install-release-image-${{ steps.release.outputs.commit }}', 'keyed by the commit alone: the image is that commit\'s');
  const proofStep = job.steps.find(step => step.name === 'the install proof');
  assert.equal(proofStep.env.GTMWORKS_RELEASE_IMAGES, cache.with.path, 'the proof reads and writes the kept images where the cache keeps them');
  assert.ok(job.steps.indexOf(cache) < job.steps.indexOf(proofStep), 'restored before the proof runs');
});

// release_image with a stand-in `docker` that logs its calls: without GTMWORKS_RELEASE_IMAGES it builds as before; with
// it, the first run builds and saves, and the next run loads the saved image and builds nothing.
test('release_image builds a fixed commit once, then loads what it saved', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/release-image-`);
  try {
    writeFileSync(`${dir}/docker`, '#!/bin/sh\necho "$*" >> "$DOCKER_LOG"\nif [ "$1" = save ]; then : > "$3"; fi\nif [ "$1" = "${DOCKER_FAILS:-}" ]; then exit 1; fi\n');
    chmodSync(`${dir}/docker`, 0o755);
    const run = (env, status = 0) => {
      const out = spawnSync('bash', ['-c', '. scripts/ci-install-lib.sh; release_image abc123 localhost:5000/gtmworks:0.0.0-main /src --build-arg X=1'], {
        encoding: 'utf8', env: { ...process.env, NODE_EXTRA_CA_CERTS: '', PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: `${dir}/log`, ...env },
      });
      assert.equal(out.status, status, out.stderr);
      const log = readFileSync(`${dir}/log`, 'utf8').trim().split('\n');
      rmSync(`${dir}/log`);
      return log;
    };
    assert.deepEqual(run({ GTMWORKS_RELEASE_IMAGES: '' }), ['build -q --build-arg X=1 -t gtmworks-release:abc123 /src', 'tag gtmworks-release:abc123 localhost:5000/gtmworks:0.0.0-main']);
    const kept = { GTMWORKS_RELEASE_IMAGES: `${dir}/kept` };
    assert.deepEqual(run(kept), ['build -q --build-arg X=1 -t gtmworks-release:abc123 /src', `save -o ${dir}/kept/abc123.tar gtmworks-release:abc123`, 'tag gtmworks-release:abc123 localhost:5000/gtmworks:0.0.0-main']);
    assert.deepEqual(run(kept), [`load -q -i ${dir}/kept/abc123.tar`, 'tag gtmworks-release:abc123 localhost:5000/gtmworks:0.0.0-main']);
    // A kept archive that does not load (a cut-off save) is built and saved again, then tagged.
    assert.deepEqual(run({ ...kept, DOCKER_FAILS: 'load' }), [`load -q -i ${dir}/kept/abc123.tar`, 'build -q --build-arg X=1 -t gtmworks-release:abc123 /src', `save -o ${dir}/kept/abc123.tar gtmworks-release:abc123`, 'tag gtmworks-release:abc123 localhost:5000/gtmworks:0.0.0-main']);
    // A failed build saves and tags nothing, and the area's own sentence names it.
    rmSync(`${dir}/kept`, { recursive: true });
    assert.deepEqual(run({ ...kept, DOCKER_FAILS: 'build' }, 1), ['build -q --build-arg X=1 -t gtmworks-release:abc123 /src']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #423: `./ci.sh install` loads every image the proof runs from the host, found by name in the proof's files; the local
// registry's image is named in the lib (start_registry), so the lib is one of the files it reads.
test('./ci.sh install loads the images the lib names too', () => {
  // The lane's list is the install machine's (#608).
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /images=\$\(bash scripts\/ci-install-machine\.sh images\)/);
  const lane = readFileSync(resolve('scripts/ci-install-machine.sh'), 'utf8').split('\n').find(line => line.includes('registry:[0-9.]+'));
  assert.ok(lane, 'the lane finds the images by name');
  assert.match(lane, /scripts\/ci-install-check\.sh scripts\/ci-install-lib\.sh/);
  assert.match(lib, /registry:2\.8\.3/, 'the registry image is named in the lib');
});

// #504: an update of a sandbox-enabled release with two Companies that fails rolls back to that release's own sandboxes.
// The area installs this release from its own two files, adds a second Company, then takes two failing updates, one whose
// work sandbox does not start and one whose Engine does not start; after each, every Company's Engine reaches its own
// sandbox over SSH with its own key, and every sandbox runs the image the install recorded before.
test('the sandbox-rollback area rolls a failed update of two sandbox-enabled Companies back to their own sandboxes', () => {
  const start = script.indexOf('\nsandbox_rollback() {');
  assert.ok(start > 0, 'the area has a function of its own');
  const area = script.slice(start, script.indexOf('\n}\n', start));
  assert.match(area, /cp "\$root\/release-first\/docker-compose\.install\.yml" "\$root\/release-first\/install\.sh" "\$dir\/"/, "installed from this release's own two files");
  assert.match(area, /second_company install\.sh/, 'with a second Company');
  assert.match(area, /for failing in sandbox engine; do/, 'one update whose sandbox, and one whose Engine, does not start');
  assert.match(area, /if GTMWORKS_ENGINE_WAIT=\d+ sh install\.sh update > update\.log 2>&1; then fail_update/, 'each update must fail');
  assert.match(area, /the previous release keeps serving, with its own Engines again/, 'and say the previous release keeps serving');
  assert.match(area, /ssh -i \/opt\/data\/ssh\/id_ed25519 [\s\S]{0,200}StrictHostKeyChecking=yes[\s\S]{0,200}pn@sandbox hostname/, 'each Engine reaches its sandbox over SSH, as its Agents do');
  assert.match(area, /authorized_keys/, "each sandbox takes its own Engine's key");
  assert.match(area, /\.work-sandbox-image\) == "\$sandbox"/, 'the image recorded before stays recorded');
  assert.match(area, /\{\{\.Config\.Image\}\}' "gtmworks-\$part-\$slug"\) == "\$sandbox"/, 'and every sandbox and exit runs it');
  assert.equal(commitOf('sandbox-rollback').stdout, '', 'it updates from this release, so no fixed commit is built');
  assert.match(lib, /for fixture in [^;]*\brollback-release-install\b/, 'a later area takes its install down');
});

// #540: whether a container publishes a host port is read from its real bindings, never from how many ports it lists.
// Docker lists an exposed, unpublished port with a null binding (`{"2222/tcp":null}`), so a count failed a correct
// sandbox. A stand-in `docker` answers `inspect` with the two fields exactly as Docker 28.5.1 and 29.10.0 both printed
// them for `--expose 2222`, `-p 2222`, `-p 127.0.0.1:2223:2222` and no port (recorded 2026-11-21).
test('publishes_host_port holds for a real binding only, on Docker 28 and Docker 29 output alike', () => {
  const dir = mkdtempSync(`${tmpdir()}/host-port-`);
  try {
    writeFileSync(`${dir}/docker`, '#!/bin/sh\n[ "$1" = inspect ] || exit 2\n[ -n "$INSPECT" ] || exit 1\nprintf "%s\\n" "$INSPECT"\n');
    chmodSync(`${dir}/docker`, 0o755);
    const publishes = inspect => {
      const out = spawnSync('bash', ['-c', '. scripts/ci-install-lib.sh; publishes_host_port some-container'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, INSPECT: inspect },
      });
      assert.ok(out.status === 0 || out.status === 1, out.stderr);
      return out.status === 0;
    };
    // `.NetworkSettings.Ports` then `.HostConfig.PortBindings`, as `docker inspect` printed them.
    assert.equal(publishes('{} {}'), false, 'no port at all');
    assert.equal(publishes('{"2222/tcp":null} {}'), false, 'an exposed, unpublished port is listed with no binding');
    assert.equal(publishes('{"2222/tcp":[{"HostIp":"127.0.0.1","HostPort":"2223"}]} {"2222/tcp":[{"HostIp":"127.0.0.1","HostPort":"2223"}]}'), true, 'a fixed host port');
    assert.equal(publishes('{"2222/tcp":[{"HostIp":"0.0.0.0","HostPort":"32768"}]} {"2222/tcp":[{"HostIp":"","HostPort":""}]}'), true, 'a host port Docker chose');
    assert.equal(publishes('null {"2222/tcp":[{"HostIp":"","HostPort":""}]}'), true, 'a binding asked for on a container that is not running');
    assert.equal(publishes(''), true, 'a container docker cannot inspect fails the check');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every "publishes no host port" check of the proof asks publishes_host_port, and none counts ports', () => {
  assert.doesNotMatch(script + lib, /len \.NetworkSettings\.Ports/, 'no check counts the ports a container lists');
  assert.doesNotMatch(script, /\.NetworkSettings\.Ports/, 'the proof reads bindings only through the lib');
  const checks = script.split('\n').filter(line => /publishes no (host )?port/.test(line) && !/^\s*\|\|/.test(line));
  assert.ok(checks.length > 0);
  for (const line of checks) assert.match(line, /publishes_host_port /, line);
});

// The Engine is running while a release area writes its memory, so its SQLite journal (`state.db-journal`) can appear
// and vanish anywhere in the profile; a `chown -R` over the whole profile then fails on the vanished file (#606). A
// stand-in `docker exec` runs the helper's own script against a scratch data folder with a `chown` that records its
// arguments: the memory lands in MEMORY.md, and the profile folder alone and the memories folder it wrote, with what
// is in it, are handed to the Engine's user.
test('tell_engine hands the profile folder and the memories it wrote to the Engine user, never the whole live profile', () => {
  const dir = mkdtempSync(`${tmpdir()}/tell-engine-`);
  try {
    const data = `${dir}/data`;
    mkdirSync(`${data}/profiles/co-1`, { recursive: true });
    writeFileSync(`${dir}/docker`, [
      '#!/bin/bash', '[ "$1" = exec ] && [ "$2" = -i ] || exit 2', 'shift 3',
      '[ "$1" = sh ] && [ "$2" = -ec ] || exit 2', 'body=${3//\\/opt\\/data/$DATA}', 'shift 3',
      'exec sh -ec "$body" "$@"', '',
    ].join('\n'));
    writeFileSync(`${dir}/chown`, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CHOWNS"\n');
    chmodSync(`${dir}/docker`, 0o755);
    chmodSync(`${dir}/chown`, 0o755);
    const out = spawnSync('bash', ['-c', '. scripts/ci-install-lib.sh; tell_engine some-engine co-1 marker-1'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATA: data, CHOWNS: `${dir}/chowns` },
    });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(`${data}/profiles/co-1/memories/MEMORY.md`, 'utf8'), 'The company code word is marker-1.\n');
    assert.deepEqual(readFileSync(`${dir}/chowns`, 'utf8').split('\n').filter(Boolean), [`hermes:hermes ${data}/profiles/co-1`, `-R hermes:hermes ${data}/profiles/co-1/memories`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Spec #831 (#833): a board worker's dangerous command runs because the Engine's managed scope says approve, and the
// proof reads it from inside each Engine, where the Engine reads it, never from the checkout. A stand-in `docker exec`
// answers with a managed file: the install's own holds, and one with no approvals, one that denies, one that names the
// setting under another key and an Engine docker cannot reach each fail. Its temp folder (the next test) is the test's own
// short folder, so only the managed file decides here.
test('engine_board_settings holds only for an Engine whose managed scope approves a board worker\'s dangerous command', () => {
  const dir = mkdtempSync(`${tmpdir()}/board-settings-`);
  try {
    writeFileSync(`${dir}/docker`, [
      '#!/bin/sh', 'if [ "$1 $2 $3 $4 $5 $6" = "exec -u hermes some-engine sh -c" ]; then TMPDIR=$SCRATCH sh -c "$7"; exit; fi',
      '[ "$1" = exec ] && [ "$2" = some-engine ] && [ "$3" = cat ] && [ "$4" = /etc/hermes/config.yaml ] || exit 2',
      '[ -f "$MANAGED" ] || exit 1', 'cat "$MANAGED"', '',
    ].join('\n'));
    chmodSync(`${dir}/docker`, 0o755);
    const holds = managed => {
      if (managed !== null) writeFileSync(`${dir}/managed.yml`, managed);
      else rmSync(`${dir}/managed.yml`, { force: true });
      const out = spawnSync('bash', ['-c', 'set -o pipefail; . scripts/ci-install-lib.sh; engine_board_settings some-engine'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MANAGED: `${dir}/managed.yml`, SCRATCH: dir },
      });
      assert.ok(out.status === 0 || out.status === 1, out.stderr);
      return out.status === 0;
    };
    const terminal = 'terminal:\n  backend: ssh\n';
    assert.equal(holds(readFileSync('scripts/engine-managed.yml', 'utf8')), true, 'the install\'s own managed file');
    assert.equal(holds(terminal), false, 'no approvals at all: a single-query Run refuses a dangerous command');
    assert.equal(holds(`${terminal}approvals:\n  single_query_mode: deny\n`), false, 'a managed scope that denies');
    assert.equal(holds(`${terminal}approvals:\n  cron_mode: approve\n`), false, 'another approval is not the board worker\'s');
    assert.equal(holds(`approvals:\n  cron_mode: deny\nterminal:\n  single_query_mode: approve\n`), false, 'the key under another section');
    assert.equal(holds(null), false, 'an Engine whose managed file docker cannot read');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #833: a board worker's ssh control socket goes under the temp folder its Engine sets, which must be short enough for a
// Unix socket path and exist for the Engine's own user before the gateway starts. The proof asks the Engine itself, as
// its user: a stand-in `docker exec -u hermes` runs the proof's own question with TMPDIR set to the test's folder. The
// install's managed file is the stand-in's answer to the first question, so only the temp folder decides.
test('engine_board_settings holds only for an Engine whose own user has a short temp folder it can write', () => {
  const dir = mkdtempSync(`${tmpdir()}/s-`);
  try {
    writeFileSync(`${dir}/docker`, [
      '#!/bin/sh',
      'if [ "$1 $2 $3 $4" = "exec some-engine cat /etc/hermes/config.yaml" ]; then cat scripts/engine-managed.yml; exit; fi',
      '[ "$1 $2 $3 $4 $5 $6" = "exec -u hermes some-engine sh -c" ] || exit 2',
      'if [ -n "$ENGINE_TMPDIR" ]; then TMPDIR=$ENGINE_TMPDIR sh -c "$7"; else env -u TMPDIR sh -c "$7"; fi', '',
    ].join('\n'));
    chmodSync(`${dir}/docker`, 0o755);
    const holds = scratch => {
      const out = spawnSync('bash', ['-c', 'set -o pipefail; . scripts/ci-install-lib.sh; engine_board_settings some-engine'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ENGINE_TMPDIR: scratch },
      });
      assert.ok(out.status === 0 || out.status === 1, out.stderr);
      return out.status === 0;
    };
    const short = `${dir}/scratch`;
    mkdirSync(short);
    // A board worker's own profile scratch, the folder Hermes picks when TMPDIR is unset: 52 characters before the
    // control folder and the socket's name, which take the path past Linux's 108 bytes.
    const profile = `${dir}/profiles/ag-${'0'.repeat(32)}/cache/scratch`;
    mkdirSync(profile, { recursive: true });
    assert.equal(holds(short), true, 'a short folder the Engine\'s user writes');
    assert.equal(holds(''), false, 'no TMPDIR: every board worker takes its profile\'s scratch');
    assert.equal(holds(`${dir}/missing`), false, 'a TMPDIR that is not there: Python falls back to /tmp');
    assert.equal(holds(profile), false, 'a folder as long as a profile\'s scratch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Spec #831 (#843): the Agent working a Card opens a person's file where the Engine names it, so every Company's work
// sandbox mounts the Engine's Kanban attachments folder, that one folder of the Engine's own data volume, read-only at
// the Engine's own path, and its user cannot write there. The proof asks the host's Docker: a stand-in `docker` answers
// for an Engine and its sandbox, and only the install's mount holds: none, one of another volume, the whole volume, one
// the sandbox can write, and one whose folder the sandbox's own write reaches each fail.
test('sandbox_card_files holds only for a sandbox that mounts its Engine\'s attachments folder alone, read-only, at the Engine\'s path', () => {
  const dir = mkdtempSync(`${tmpdir()}/card-files-`);
  try {
    writeFileSync(`${dir}/docker`, [
      '#!/bin/sh',
      'case "$*" in',
      '  "inspect -f {{.Name}} some-engine") echo /gtmworks-engine-first;;',
      '  "inspect -f {{range .Mounts}}{{if eq .Destination \\"/opt/data\\"}}{{.Name}}{{end}}{{end}} some-engine") echo gtmworks-engine-first-data;;',
      '  "inspect -f {{range .Mounts}}"*" gtmworks-sandbox-first") echo "$MOUNT";;',
      '  "inspect -f {{range .HostConfig.Mounts}}"*" gtmworks-sandbox-first") echo "$SUBPATH";;',
      '  "exec gtmworks-sandbox-first test -d /opt/data/kanban/attachments") exit 0;;',
      '  "exec gtmworks-sandbox-first sh -c "*) exit "$WRITE";;',
      '  *) exit 2;;',
      'esac', '',
    ].join('\n'));
    chmodSync(`${dir}/docker`, 0o755);
    const holds = ({ mount = 'volume gtmworks-engine-first-data false', subpath = 'kanban/attachments', write = 1 } = {}) => {
      const out = spawnSync('bash', ['-c', 'set -o pipefail; . scripts/ci-install-lib.sh; sandbox_card_files some-engine'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOUNT: mount, SUBPATH: subpath, WRITE: String(write) },
      });
      assert.ok(out.status === 0 || out.status === 1, out.stderr);
      return out.status === 0;
    };
    assert.equal(holds(), true, 'the install\'s own mount');
    assert.equal(holds({ mount: '' }), false, 'no mount: the Agent cannot open a person\'s file');
    assert.equal(holds({ mount: 'volume gtmworks-engine-second-data false' }), false, 'another Engine\'s folder');
    assert.equal(holds({ mount: 'volume gtmworks-engine-first-data true' }), false, 'a mount the sandbox can write');
    assert.equal(holds({ subpath: '' }), false, 'the Engine\'s whole volume, its keys with it');
    assert.equal(holds({ write: 0 }), false, 'a folder the sandbox\'s write reaches');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Spec #831 (#833): the board's proof on the real Engine is one step of an area the proof already runs, never a job of
// its own. It ran in agents-sandbox until that area reached its 12 minutes with the step still waiting (run 45841934073),
// then in the open-design area; when that area went with Open Design (decision 0079, #911) it moved to the proxy area,
// the install proof's shortest (5.2 to 6.1 of its 12 minutes on runs 46017590820, 46015520768 and 45984865346). The
// proxy area makes the second Company and the first Company's second Agent as agents-sandbox does, before its rate limit
// locks the Owner out, and reads where the worker's file landed from the host's Docker; every Engine it made, the new
// Company's included, and every Engine an update brings up holds the board worker's setting.
test('the Kanban check runs inside the proxy area, and every Engine made or updated holds the board setting', () => {
  const area = (name, next) => script.slice(script.indexOf(`\n${name}() {`), script.indexOf(next, script.indexOf(`\n${name}() {`)));
  const held = area('proxy', '\n# update:');
  const sandbox = area('agents_sandbox', '\n# backup:');
  const kanban = held.indexOf(' - kanban "$kanban_marker" <');
  assert.ok(kanban > 0, 'the proxy area runs the Kanban check');
  assert.equal(sandbox.includes(' - kanban '), false, 'agents-sandbox no longer runs it');
  assert.ok(held.indexOf('second_company ||') < held.indexOf(' - prepare <'), 'two Companies before their profiles are read');
  assert.ok(held.indexOf(' - prepare <') < held.indexOf(' - second <') && held.indexOf(' - second <') < kanban, 'the Card is worked by the second Agent, which exists by then');
  assert.ok(held.indexOf('point_engine_at_fake_model') < held.indexOf(' - prepare <'), 'the Engine answers Runs with the fake model');
  assert.ok(held.indexOf('kanban-board/restore.py') > kanban && held.indexOf('kanban-board/restore.py') < held.indexOf('check-install-rate-limit.mjs'), 'the board is worked before the rate limit locks the Owner out');
  assert.ok(held.indexOf('dashboard_theme') < held.indexOf('point_engine_at_fake_model'), 'the dashboard\'s theme is read before the fake model rewrites the Engine\'s config');
  assert.equal(script.split(' - kanban ').length - 1, 1, 'the Kanban check runs once in the whole proof');
  assert.ok(!matrix.includes('kanban') && !cases.some(({ name }) => /kanban|board/.test(name)), 'no area of its own');
  // Where the worker's file and its dangerous command landed is read from the host's Docker, which a tool's answer
  // cannot fake: in the Company's sandbox, and nowhere on the Engine outside its Kanban folders.
  for (const read of ['docker exec "$sandbox" cat "/work/$kanban_marker-card.txt"', '/opt/data/kanban']) {
    assert.ok(held.includes(read), read);
    assert.equal(sandbox.includes(read), false, `agents-sandbox no longer reads ${read}`);
  }
  assert.match(held, /for folder in \.engines\/\*\/; do[\s\S]*?engine_board_settings "\$name"/, 'every Company\'s Engine of the area holds the setting');
  assert.match(held, /for folder in \.engines\/\*\/; do[\s\S]*?sandbox_card_files "\$name"/, 'every Company\'s sandbox of the area holds the Engine\'s attachments folder (#843)');
  // The worker opened the person's file in the sandbox and could not write beside it, read from the host's Docker (#843).
  for (const read of ['docker exec "$sandbox" cat "/work/$kanban_marker-attachment.txt"', '"attachment_write":"refused"', '$kanban_marker-planted']) assert.ok(held.includes(read), read);
  for (const [name, update] of [['update', "sh install.sh update || fail 'release update'"], ['engines_update', "sh install.sh update || fail 'update every Company Engine'"]]) {
    const body = area(name, '\n}\n');
    const updated = body.indexOf(update);
    assert.ok(updated > 0 && body.indexOf('engine_board_settings', updated) > updated, `${name}: an Engine the update brought up holds the setting`);
    assert.ok(body.indexOf('sandbox_card_files', updated) > updated, `${name}: a sandbox the update brought up holds the Engine's attachments folder`);
  }
});

// #911 (decision 0079): no Open Design ships, and an area that stays proves it on the real install: the running work
// sandbox has no /opt/open-design, and no Engine of the area, once its Agents are made, holds an `od-` design profile.
// The check reads each Engine's own profiles, and fails when it cannot read its Company's own, so it is never vacuous.
test('the proxy area checks the work sandbox carries no Open Design and no Engine holds a design profile', () => {
  const area = (name, next) => script.slice(script.indexOf(`\n${name}() {`), script.indexOf(next, script.indexOf(`\n${name}() {`)));
  const held = area('proxy', '\n# update:');
  const image = held.indexOf('docker exec "$sandbox" test ! -e /opt/open-design');
  assert.ok(image > 0, 'the running sandbox has no /opt/open-design');
  assert.ok(held.indexOf(' - second <') < held.indexOf("grep -q '^od-'"), 'the profiles are read once every Agent is made');
  assert.match(held, /for folder in \.engines\/\*\/; do\n  name=\$\(engine_value "\$folder" NAME\)\n  profiles=\$\(docker exec "\$name" ls \/opt\/data\/profiles\)[^\n]*\n  grep -q '\^co-'[^\n]*\n  if grep -q '\^od-'/, 'every Engine of the area');
  assert.doesNotMatch(script, /\nopen_design\(\) \{/, 'the open-design area is gone');
  assert.doesNotMatch(readFileSync(resolve('sandbox/Dockerfile'), 'utf8'), /open-design|OPEN_DESIGN/, 'the image builds no Open Design');
  assert.doesNotMatch(readFileSync(resolve('sandbox/sshd_config'), 'utf8'), /StreamLocal/, 'sshd forwards no socket: only the Open Design runtime used one');
});
