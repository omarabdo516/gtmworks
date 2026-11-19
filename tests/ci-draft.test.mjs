import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// Which CI jobs an event starts (#405, replacing the draft rule of #333): a draft pull request runs the suites its files
// need, exactly as a ready one does, and marking it ready starts nothing by itself; a push to main runs every suite
// unless the change is documents only. The real workflow's job conditions are evaluated against the real area script's
// answer. The app image is built by one job and loaded by the browser suite (#403) and by the install proof (#406),
// which the guard tests below read from the same file.
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
// The install proof is one job, one matrix entry per area (#406), named `install-<area>`.
const installJobs = ['install'];
const screenFiles = ['app/c/[slug]/[[...section]]/home.tsx'];
const documentFiles = ['docs/testing.md', 'README.md'];

test('marking a pull request ready starts no run by itself: the pull request event types leave out ready_for_review', () => {
  assert.equal(ci.on.pull_request.types.includes('ready_for_review'), false);
  for (const type of ['opened', 'synchronize', 'reopened']) assert.ok(ci.on.pull_request.types.includes(type), type);
});

test('the change touches database, app and install files', () => {
  const outputs = areas(heavyFiles, false);
  for (const suite of heavy) assert.equal(outputs[suite], 'true', suite);
});

test('a draft that changes database, app and install files starts the image, database, integration and install jobs', () => {
  assert.deepEqual(started({ event: 'pull_request', draft: true, files: heavyFiles }),
    ['changes', 'check', 'database', 'fast', 'image', 'install', 'integration', 'supabase-images']);
});

test('a draft that changes only screens starts only changes, fast and check', () => {
  const outputs = areas(screenFiles, false);
  assert.equal(outputs.components, 'true');
  for (const suite of heavy) assert.equal(outputs[suite], 'false', suite);
  assert.deepEqual(started({ event: 'pull_request', draft: true, files: screenFiles }), ['changes', 'check', 'fast']);
});

test('a draft that changes only documents starts no heavy suite', () => {
  for (const suite of heavy) assert.equal(areas(documentFiles, false)[suite], 'false', suite);
  assert.deepEqual(started({ event: 'pull_request', draft: true, files: documentFiles }), ['changes', 'check', 'fast']);
});

test('a draft and a ready pull request start the same jobs for the same files', () => {
  for (const files of [heavyFiles, screenFiles, documentFiles]) {
    assert.deepEqual(
      started({ event: 'pull_request', draft: true, files }),
      started({ event: 'pull_request', draft: false, files }),
      files.join(', '),
    );
  }
});

test('a push to main runs every suite for a code change, and none of the heavy ones for documents only', () => {
  const code = started({ event: 'push', files: ['scripts/ci-fast.mjs'] });
  for (const job of ['changes', 'fast', 'check', 'visual', 'image', 'database', 'integration', ...installJobs]) assert.ok(code.includes(job), job);
  assert.deepEqual(started({ event: 'push', files: documentFiles }), ['changes', 'check', 'fast']);
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
  assert.equal(build.with['cache-from'], 'type=gha');
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

test('the image job runs when the browser suite or the install proof is asked for, and each waits for it (#403, #406)', () => {
  for (const draft of [true, false]) {
    const journeys = started({ event: 'pull_request', draft, files: ['tests/frame.spec.ts'] });
    assert.ok(journeys.includes('image') && journeys.includes('integration'), `a draft=${draft} pull request`);
    const install = started({ event: 'pull_request', draft, files: ['scripts/install.sh'] });
    assert.ok(install.includes('image'), `a draft=${draft} install pull request`);
    for (const job of installJobs) assert.ok(install.includes(job), `a draft=${draft} pull request starts ${job}`);
    assert.equal(started({ event: 'pull_request', draft, files: ['tests/db.sh'] }).includes('image'), false, `a draft=${draft} pull request`);
    assert.equal(started({ event: 'pull_request', draft, files: documentFiles }).includes('image'), false, `a draft=${draft} pull request`);
  }
  assert.equal(started({ event: 'push', files: documentFiles }).includes('image'), false);
});

test('a pull request that changes install files starts the install proof as one job of four areas, each on its own', () => {
  const run = started({ event: 'pull_request', draft: false, files: ['scripts/install.sh'] });
  for (const job of installJobs) assert.ok(run.includes(job), job);
  // One matrix job: each entry's name is the area that failed, and one area's fault leaves the rest running.
  assert.deepEqual(ci.jobs.install.strategy, { 'fail-fast': false, matrix: { area: ['first-install', 'companies', 'proxy', 'update', 'one-line'] } });
  assert.equal(ci.jobs.install.name, 'install-${{ matrix.area }}');
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
