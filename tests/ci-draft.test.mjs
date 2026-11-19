import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// Which CI jobs an event starts (#333, spec #332): a draft pull request runs only the fast job; marking it ready, and
// every later push to it, starts the heavy suites its files need; a push to main runs every suite unless the change is
// documents only. The real workflow's job conditions are evaluated against the real area script's answer. The app image
// is built by one job and loaded by the browser suite (#403), which the guard tests below read from the same file.
const ci = load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
const areas = (files, main) => Object.fromEntries(
  execFileSync(process.execPath, [resolve('scripts/ci-areas.mjs'), ...(main ? ['--main'] : []), ...files], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.split('=')),
);

// GitHub's expression syntax, for the operators ci.yml's job conditions use, read as JavaScript: no job fails here, and
// a missing property reads as null, as GitHub reads it.
const evaluate = (expression, context) => new Function(
  'github', 'needs', 'inputs', 'always', 'cancelled', 'success', 'failure',
  `return (${expression.replace(/^\$\{\{|\}\}$/g, '').trim().replace(/\b(github|needs|inputs)((?:\.\w+)+)/g, (path) => path.replaceAll('.', '?.'))});`,
)(context.github, context.needs, {}, () => true, () => false, () => true, () => false);

function started({ event, draft, files }) {
  const outputs = areas(files, event === 'push');
  const github = { event_name: event, event: event === 'pull_request' ? { pull_request: { draft } } : {} };
  const run = new Set();
  // A job that names no condition is skipped unless each of its needs ran; one that names a status function is judged
  // by its own condition, which reads its needs' results as GitHub gives them (#403). The pass repeats until no job is
  // left to add, so a job's place in the file does not decide what starts.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (run.has(name)) continue;
      const needs = Object.fromEntries([...run].map(ran => [ran, { result: 'success', outputs: ran === 'changes' ? outputs : {} }]));
      const ready = [job.needs ?? []].flat().every(need => run.has(need));
      if (job.if === undefined ? ready : evaluate(String(job.if), { github, needs })) {
        run.add(name);
        changed = true;
      }
    }
  }
  return [...run].sort();
}

// next.config.mjs reads NEXT_SKIP_CHECKS when it loads, as Next does inside the image build (#403): each case loads it
// in a process of its own, with the variable set as the build sets it.
const configFor = value => JSON.parse(spawnSync(process.execPath, [
  '--input-type=module', '-e',
  `const { default: config } = await import(${JSON.stringify(resolve('next.config.mjs'))}); process.stdout.write(JSON.stringify(config));`,
], {
  encoding: 'utf8',
  env: value === undefined ? { PATH: process.env.PATH } : { PATH: process.env.PATH, NEXT_SKIP_CHECKS: value },
}).stdout);

const heavyFiles = ['supabase/migrations/0001_example.sql', 'app/api/health/route.ts', 'scripts/install.sh'];
const heavy = ['database', 'integration', 'install'];

test('the pull request events include ready_for_review, so marking a PR ready starts a run', () => {
  assert.ok(ci.on.pull_request.types.includes('ready_for_review'));
  for (const type of ['opened', 'synchronize', 'reopened']) assert.ok(ci.on.pull_request.types.includes(type), type);
});

test('the change touches database, app and install files', () => {
  const outputs = areas(heavyFiles, false);
  for (const suite of heavy) assert.equal(outputs[suite], 'true', suite);
});

test('a draft pull request that changes database, app and install files starts only changes, fast and check', () => {
  assert.deepEqual(started({ event: 'pull_request', draft: true, files: heavyFiles }), ['changes', 'check', 'fast']);
});

test('marking that pull request ready, and a later push to it, starts the image build, the database, integration and install jobs', () => {
  const jobs = started({ event: 'pull_request', draft: false, files: heavyFiles });
  for (const job of ['changes', 'fast', 'check', 'image', ...heavy]) assert.ok(jobs.includes(job), job);
  assert.equal(jobs.includes('visual'), false);
});

test('a later push to a ready pull request starts only the suites its files need', () => {
  const jobs = started({ event: 'pull_request', draft: false, files: ['tests/db.sh'] });
  assert.ok(jobs.includes('database'));
  assert.equal(jobs.includes('integration'), false);
  assert.equal(jobs.includes('install'), false);
});

test('a push to main runs every suite for a code change, and none of the heavy ones for documents only', () => {
  const code = started({ event: 'push', files: ['scripts/ci-fast.mjs'] });
  for (const job of ['changes', 'fast', 'check', 'visual', ...heavy]) assert.ok(code.includes(job), job);
  assert.deepEqual(started({ event: 'push', files: ['docs/testing.md', 'README.md'] }), ['changes', 'check', 'fast']);
});

// #403: the app image is built once per run, with its layer cache, and the browser suite loads that build: no shard
// builds an image of its own. The install job's `docker build` steps make test release images from the app image, so
// the app image is the one `docker/build-push-action` produces.
const usesBuildPush = step => (step.uses ?? '').startsWith('docker/build-push-action@');
const buildsInPlace = step => /(^|\s)docker build(\s|$)/.test(step.run ?? '');

test('exactly one job builds the app image, and the browser suite loads that build (#403)', () => {
  const builders = Object.entries(ci.jobs).filter(([, job]) => job.steps.some(usesBuildPush)).map(([name]) => name);
  assert.deepEqual(builders, ['image']);
  for (const step of ci.jobs.integration.steps) {
    assert.equal(usesBuildPush(step) || buildsInPlace(step), false, `${step.name} builds no image`);
    assert.doesNotMatch(step.uses ?? '', /^docker\/setup-buildx-action@/, `${step.name} sets no builder up`);
  }
  const build = ci.jobs.image.steps.find(usesBuildPush);
  assert.equal(build.with.tags, 'gtmworks:ci');
  // Its own layers are kept between runs, so a change that leaves the dependencies alone restores them.
  assert.equal(build.with['cache-from'], 'type=gha,mode=max');
  assert.equal(build.with['cache-to'], 'type=gha,mode=max');
  assert.match(build.with.outputs, /^type=docker,dest=\$\{\{ runner\.temp \}\}\/gtmworks-image\.tar$/);
  // One archive, handed over as an artifact that is dropped after a day and stored as it is.
  const upload = ci.jobs.image.steps.find(step => (step.uses ?? '').startsWith('actions/upload-artifact@'));
  assert.deepEqual(
    [upload.with.name, upload.with.path, upload.with['retention-days'], upload.with['compression-level']],
    ['gtmworks-image', '${{ runner.temp }}/gtmworks-image.tar', 1, 0],
  );
  assert.ok(ci.jobs.integration.needs.includes('image'), 'the browser suite waits for the image build');
  const download = ci.jobs.integration.steps.find(step => (step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'gtmworks-image');
  const load = ci.jobs.integration.steps.find(step => /docker load/.test(step.run ?? ''));
  assert.match(load.run, /gtmworks-image\.tar/);
});

test('the image job runs only when the browser suite is asked for, and the suite waits for it (#403)', () => {
  const journeys = started({ event: 'pull_request', draft: false, files: ['tests/frame.spec.ts'] });
  assert.ok(journeys.includes('image') && journeys.includes('integration'));
  assert.equal(started({ event: 'pull_request', draft: false, files: ['tests/db.sh'] }).includes('image'), false);
  assert.equal(started({ event: 'pull_request', draft: true, files: ['tests/frame.spec.ts'] }).includes('image'), false);
  assert.equal(started({ event: 'push', files: ['docs/testing.md'] }).includes('image'), false);
});

// The fast job already linted and type-checked, so the image build does neither; a release or local build keeps both.
test('the image build skips the lint and type check the fast job ran, and only it (#403)', () => {
  const build = ci.jobs.image.steps.find(usesBuildPush);
  assert.equal(build.with['build-args'], 'NEXT_SKIP_CHECKS=true');
  for (const value of [undefined, 'false', '']) {
    assert.deepEqual([configFor(value).eslint, configFor(value).typescript], [undefined, undefined], String(value));
  }
  assert.deepEqual(configFor('true').eslint, { ignoreDuringBuilds: true });
  assert.deepEqual(configFor('true').typescript, { ignoreBuildErrors: true });
  // The build stage declares the argument before it builds, so the value reaches `next build`, and its default keeps
  // the checks wherever the argument is not passed.
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const stage = dockerfile.indexOf('FROM dependencies AS build');
  const argument = dockerfile.indexOf('ARG NEXT_SKIP_CHECKS=false');
  const buildRun = dockerfile.indexOf('RUN npm run build');
  assert.ok(stage >= 0 && stage < argument && argument < buildRun, 'the build stage declares NEXT_SKIP_CHECKS, defaulting to the checks');
});
