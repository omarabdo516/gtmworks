import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// Which CI jobs an event starts (#333, spec #332): a draft pull request runs only the fast job; marking it ready, and
// every later push to it, starts the heavy suites its files need; a push to main runs every suite unless the change is
// documents only. The real workflow's job conditions are evaluated against the real area script's answer.
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
  const needs = { changes: { result: 'success', outputs } };
  const run = new Set();
  for (const [name, job] of Object.entries(ci.jobs)) {
    const ready = [job.needs ?? []].flat().every(need => run.has(need));
    if (job.if === undefined ? ready : evaluate(String(job.if), { github, needs })) run.add(name);
  }
  return [...run].sort();
}

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

test('marking that pull request ready, and a later push to it, starts the database, integration and install jobs', () => {
  const jobs = started({ event: 'pull_request', draft: false, files: heavyFiles });
  for (const job of ['changes', 'fast', 'check', ...heavy]) assert.ok(jobs.includes(job), job);
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
