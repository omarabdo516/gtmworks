import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// The install proof is four jobs (#406): the first install and its repeat with Companies, Agents, backup and restore
// (`install-first`), and the public address behind a proxy, the update between releases and the one-line install, each
// on a fresh isolated Docker machine of its own. Each job is one command of the repo, holds no check of its own, and
// loads the one app image the run built (#403): no install job builds an image. The profile-size measurement is a
// fifth job of its own that no pull request runs (#408).
const ci = load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
const areas = {
  'install-first': 'first-install',
  'install-proxy': 'proxy',
  'install-update': 'update',
  'install-one-line': 'one-line',
};
const measureJob = 'install-measure';
const proof = ['scripts/ci-install-check.sh', 'scripts/ci-install-lib.sh'];
const script = readFileSync(proof[0], 'utf8');

test('each install job runs one area of the proof with one command and holds no check of it', () => {
  for (const [job, area] of Object.entries(areas)) {
    const calls = ci.jobs[job].steps.filter(step => (step.run ?? '').trim() === `bash scripts/ci-install-check.sh ${area}`);
    assert.equal(calls.length, 1, `${job} runs its area with one command`);
    // No step of a job prints a failure of the proof: the sentences live in the repo's script, where a person runs them.
    for (const step of ci.jobs[job].steps) assert.doesNotMatch(step.run ?? '', /\bfail |\bfail\(/, `${job}'s ${step.name} holds no failure point`);
  }
});

test('the four install jobs load the one image the run built and build none of their own', () => {
  for (const job of Object.keys(areas)) {
    const steps = ci.jobs[job].steps;
    assert.equal(steps.some(step => (step.uses ?? '').startsWith('docker/build-push-action@')), false, `${job} runs no image build`);
    assert.equal(steps.some(step => /(^|\s)docker build(\s|$)/.test(step.run ?? '')), false, `${job} builds no image in a step`);
    const download = steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
    assert.equal(download.with.name, 'gtmworks-image', `${job} takes the image artifact`);
    const load = steps.find(step => /docker --host tcp:\/\/127\.0\.0\.1:2375 load/.test(step.run ?? ''));
    assert.match(load.run, /gtmworks-image\.tar/, `${job} loads that archive`);
    // The source install's own compose tag, which the release areas reuse: the installer then skips its build (tests only).
    assert.match(load.run, /docker --host tcp:\/\/127\.0\.0\.1:2375 tag gtmworks:ci gtmworks-local:237/, job);
    const run = steps.find(step => (step.run ?? '').trim() === `bash scripts/ci-install-check.sh ${areas[job]}`);
    assert.equal(run.env.GTMWORKS_IMAGE_PREBUILT, 'true', `${job} tells the installer the image is already there`);
  }
  // The switch is read only by the tests that load the run's one build; a source install anywhere else builds its image.
  const installer = readFileSync('scripts/install.sh', 'utf8');
  assert.match(installer, /GTMWORKS_IMAGE_PREBUILT/);
  assert.match(installer, /if \[ "\$\{GTMWORKS_IMAGE_PREBUILT:-\}" != true \]; then[\s\S]*?compose build web/);
});

test('the four install jobs share one condition: today\'s install condition and a successful image build', () => {
  const condition = "${{ !cancelled() && needs.image.result == 'success' && (needs.changes.result != 'success' || needs.changes.outputs.install != 'false') }}";
  for (const job of Object.keys(areas)) {
    assert.equal(ci.jobs[job].if, condition, `${job} runs when the install proof is asked for and the image built`);
    assert.deepEqual(ci.jobs[job].needs, ['changes', 'image'], job);
  }
});

test('a job on a GitHub-hosted runner does not wait for its Docker machine to be removed', () => {
  for (const job of Object.keys(areas)) {
    const remove = ci.jobs[job].steps.at(-1);
    assert.match(remove.run, /docker rm -fv install-docker/, `${job} keeps the removal step`);
    assert.equal(remove.if, "${{ runner.environment != 'github-hosted' }}", `${job} removes it only on a runner that is reused`);
  }
});

// The helpers the areas share are written once, in the lib or the script, never in both (#402).
test('no helper function is defined twice in the proof or its lib', () => {
  const definitions = proof.flatMap(path => [...readFileSync(path, 'utf8').matchAll(/^([a-z][a-z0-9_]*)\(\) \{/gm)].map(match => match[1]));
  assert.deepEqual(definitions.filter((name, index) => definitions.indexOf(name) !== index), [], 'each helper has one definition');
});

// The proof is the spec's seven areas in the order it has always run them, all of them when no area is named, and one
// area when one is (#406): the first-install job's four, then the proxy, the update and the one-line install. The
// profile-size measurement runs last of all, for a full run on a machine here; no pull request's job runs it (#408).
const seven = ['first_install', 'companies', 'agents', 'backup', 'proxy', 'update', 'one_line'];
const allAreas = [...seven, 'measure'];
test('the install proof is the seven areas of the spec, run one after another when named all, then the measurement', () => {
  for (const area of allAreas) assert.match(script, new RegExp(`^${area}\\(\\) \\{$`, 'm'), area);
  const all = script.split('\n').find(line => /^ all\)/.test(line));
  assert.ok(all, 'no argument runs every area');
  const calls = all.match(/[a-z][a-z0-9_]*(?=;|;;)/g);
  assert.deepEqual(calls, allAreas, 'all seven run in their order, and the measurement last');
});

test('each area is one command: no area runs every other, and naming one runs only it', () => {
  for (const [job, area] of Object.entries(areas)) assert.match(script, new RegExp(`^ ${area}\\)`, 'm'), `${job} has a command`);
  assert.match(script, /^ first-install\) first_install; companies; backup;;$/m);
  assert.match(script, /^ agents\) agents;;$/m);
  assert.match(script, /^ measure\) measure;;$/m);
  assert.match(script, /^ proxy\) proxy;;$/m);
  assert.match(script, /^ update\) update;;$/m);
  assert.match(script, /^ one-line\) one_line;;$/m);
  const all = script.split('\n').find(line => /^ all\)/.test(line));
  assert.ok(all, 'no argument runs every area');
  for (const area of allAreas) assert.match(all, new RegExp(`\\b${area}\\b`), area);
  // `./ci.sh install proxy` passes the area through to the same command.
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /bash scripts\/ci-install-check\.sh "\$@"/);
});

// #408: the agents area runs on its own machine and makes everything it reads itself — its install, the first run that
// makes the first Company, and the second Company on its own Engine — and first-install no longer runs it.
test('the agents area makes its own install, first run and second Company, and first-install no longer runs it', () => {
  const text = readFileSync(proof[0], 'utf8');
  const agents = text.slice(text.indexOf('\nagents() {'), text.indexOf('\nbackup() {'));
  assert.ok(agents, 'the agents area');
  for (const step of ['reset_install', 'install_source', 'complete_setup', "company add --name 'Second Company'"]) {
    assert.ok(agents.includes(step), `the agents area makes ${step} itself`);
  }
  assert.equal(agents.includes('capacity'), false, 'the measurement left the agents area');
  assert.match(script, /^ first-install\) first_install; companies; backup;;$/m, 'first-install no longer runs the agents area');
});

// #408: the measurement is an area of its own, with a fresh install and whatever Company it reads, and it prints the
// same line of numbers it printed inside the agents area.
test('the measurement is an area of its own and prints the same line of numbers', () => {
  const text = readFileSync(proof[0], 'utf8');
  const measure = text.slice(text.indexOf('\nmeasure() {'), text.indexOf('\ncase "${1:-all}"'));
  assert.ok(measure, 'the measure area');
  for (const step of ['reset_install', 'install_source', 'complete_setup', "company add --name 'Second Company'", 'capacity with-skills', 'capacity no-skills']) {
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
  const download = job.steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'gtmworks-image');
  const load = job.steps.find(step => /docker --host tcp:\/\/127\.0\.0\.1:2375 load/.test(step.run ?? ''));
  assert.match(load.run, /gtmworks-image\.tar/);
  assert.match(load.run, /docker --host tcp:\/\/127\.0\.0\.1:2375 tag gtmworks:ci gtmworks-local:237/);
  const remove = job.steps.at(-1);
  assert.match(remove.run, /docker rm -fv install-docker/);
  assert.equal(remove.if, "${{ runner.environment != 'github-hosted' }}");
  assert.equal(ci.jobs.check.needs.includes(measureJob), false, 'the required check does not wait for the measurement');
});
