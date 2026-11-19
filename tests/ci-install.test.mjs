import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// The install proof is one job (#406): a matrix entry per area, each on a fresh isolated Docker machine of its own. The
// areas are the first install and its repeat with Companies, Agents, backup and restore (`first-install`); the public
// address behind a proxy (`proxy`); the update between releases (`update`); and the one-line install (`one-line`). Each
// entry is one command of the repo, holds no check of its own, and loads the one app image the run built (#403): no step
// of the job builds an image.
const ci = load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
const job = ci.jobs.install;
const proof = ['scripts/ci-install-check.sh', 'scripts/ci-install-lib.sh'];
const script = readFileSync(proof[0], 'utf8');
const matrix = job.strategy.matrix.area;
// The areas the proof's own dispatch names, in the order it runs them when all are asked for.
const cases = [...script.matchAll(/^ ([\w-]+)\) (.*);;$/gm)].map(([, name, commands]) => ({ name, commands }));

test('the proof is one job with one matrix entry per area, every entry left to its end', () => {
  assert.equal(job.name, 'install-${{ matrix.area }}', 'the name says which area failed');
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { area: ['first-install', 'proxy', 'update', 'one-line'] } });
  assert.equal(job['timeout-minutes'], 90);
  assert.equal(job.permissions.contents, 'read');
});

const seven = ['first_install', 'companies', 'agents', 'backup', 'proxy', 'update', 'one_line'];

test('every area of the matrix is one case of the proof, and every case but all is in the matrix', () => {
  assert.deepEqual(cases.map(({ name }) => name), ['all', ...matrix], 'the matrix and the dispatch name the same areas');
  // A matrix entry runs its own areas only: every command of it is one of the seven, and never all seven.
  for (const { name, commands } of cases) if (name !== 'all') {
    const calls = commands.split('; ');
    assert.ok(calls.length < seven.length, `${name} runs only its own areas`);
    for (const call of calls) assert.ok(seven.includes(call), `${name}: ${call}`);
  }
  assert.equal(cases.find(({ name }) => name === 'first-install').commands, 'first_install; companies; agents; backup');
});

test('each entry runs its area with one command and holds no check of the proof', () => {
  const calls = job.steps.filter(step => (step.run ?? '').trim() === 'bash scripts/ci-install-check.sh ${{ matrix.area }}');
  assert.equal(calls.length, 1, 'the matrix entry names the area');
  // No step of the job prints a failure of the proof: the sentences live in the repo's script, where a person runs them.
  for (const step of job.steps) assert.doesNotMatch(step.run ?? '', /\bfail |\bfail\(/, `${step.name} holds no failure point`);
});

test('the install job loads the one image the run built and builds none of its own', () => {
  const steps = job.steps;
  assert.equal(steps.some(step => (step.uses ?? '').startsWith('docker/build-push-action@')), false, 'no image build');
  assert.equal(steps.some(step => /(^|\s)docker build(\s|$)/.test(step.run ?? '')), false, 'no image built in a step');
  const download = steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'gtmworks-image', 'it takes the image artifact');
  const load = steps.find(step => /docker --host tcp:\/\/127\.0\.0\.1:2375 load/.test(step.run ?? ''));
  assert.match(load.run, /gtmworks-image\.tar/, 'it loads that archive');
  // The source install's own compose tag, which the release areas reuse: the installer then skips its build (tests only).
  assert.match(load.run, /docker --host tcp:\/\/127\.0\.0\.1:2375 tag gtmworks:ci gtmworks-local:237/);
  assert.equal(steps.find(step => step.name === 'the install proof').env.GTMWORKS_IMAGE_PREBUILT, 'true');
  // The switch is read only by the tests that load the run's one build; a source install anywhere else builds its image.
  const installer = readFileSync('scripts/install.sh', 'utf8');
  assert.match(installer, /GTMWORKS_IMAGE_PREBUILT/);
  assert.match(installer, /if \[ "\$\{GTMWORKS_IMAGE_PREBUILT:-\}" != true \]; then[\s\S]*?compose build web/);
});

test('the install job runs under today\'s install condition and a successful image build', () => {
  assert.equal(job.if, "${{ !cancelled() && needs.image.result == 'success' && (needs.changes.result != 'success' || needs.changes.outputs.install != 'false') }}");
  assert.deepEqual(job.needs, ['changes', 'image']);
});

test('only the update area fetches the pull request\'s full history: it builds the previous release from the base', () => {
  const checkout = job.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], "${{ matrix.area == 'update' && '0' || '1' }}");
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

// The proof is the spec's seven areas in the order it has always run them, all of them when no area is named, and one
// area when one is (#406): the first-install entries' four, then the proxy, the update and the one-line install.
test('the install proof is the seven areas of the spec, run one after another when named all', () => {
  for (const area of seven) assert.match(script, new RegExp(`^${area}\\(\\) \\{$`, 'm'), area);
  const all = script.split('\n').find(line => /^ all\)/.test(line));
  assert.ok(all, 'no argument runs every area');
  const calls = all.match(/[a-z][a-z0-9_]*(?=;|;;)/g);
  assert.deepEqual(calls, seven, 'all seven run in their order');
});

test('naming one area runs only it, and ./ci.sh install passes the area through', () => {
  const dispatches = Object.fromEntries([...script.matchAll(/^ ([\w-]+)\) (.*);;$/gm)].map(([, name, commands]) => [name, commands]));
  assert.equal(dispatches['first-install'], 'first_install; companies; agents; backup');
  assert.equal(dispatches.proxy, 'proxy');
  assert.equal(dispatches.update, 'update');
  assert.equal(dispatches['one-line'], 'one_line');
  assert.match(readFileSync(resolve('ci.sh'), 'utf8'), /bash scripts\/ci-install-check\.sh "\$@"/);
});
