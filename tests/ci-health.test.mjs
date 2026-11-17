import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report, upsertIssue } from '../scripts/ci-health.mjs';

// The nightly CI health report (#256): a week of ledgers read together into one tracking issue, which each night's
// report replaces. Percentiles are nearest-rank: the p-th of n sorted values is the ceil(p/100 * n)-th.
const job = (layer, duration_s, extra = {}) => ({
  kind: 'job', layer, name: layer, conclusion: 'success', completed_at: '2026-11-16T10:00:00Z', duration_s, queue_s: 0,
  environment: 'github-hosted', budget_s: 90, classification: null, ...extra,
});
const testRecord = (name, duration_ms, outcome = 'passed') => ({ kind: 'test', layer: 'integration', suite: 'playwright', file: 'tests/board.spec.ts', name, duration_ms, outcome });
const now = Date.parse('2026-11-17T02:30:00Z');
const section = (text, heading) => text.slice(text.indexOf(`## ${heading}`)).split('\n\n## ')[0];

test('per layer p50 and p90 by nearest rank over finished jobs, with the jobs over budget', () => {
  // Ten static jobs of 10..100 s: p50 is the 5th (50 s), p90 the 9th (90 s); one is over the 90 s budget.
  const jobs = Array.from({ length: 10 }, (_, n) => job('static', (n + 1) * 10));
  const notCounted = [job('static', 999, { conclusion: 'cancelled' }), job('static', 999, { conclusion: 'skipped' }), job('static', 999, { completed_at: null })];
  const text = report([...jobs, ...notCounted], { now, days: 7, runs: 10 });
  assert.ok(text.startsWith('<!-- ci-health -->\n'));
  assert.match(text, /The 7 days to 2026-11-17 02:30 UTC: 10 runs\./);
  assert.match(section(text, 'Layers'), /^\| static \| 10 \| 0\.8 min \| 1\.5 min \| 1 \|$/m);
});

test('the slowest tests are cut at twenty, by p50, with how often each ran', () => {
  const tests = [];
  for (let n = 1; n <= 25; n++) for (const factor of [1, 2, 3]) tests.push(testRecord(`case ${n}`, n * 1000 * factor));
  const text = section(report(tests, { now, days: 7, runs: 3 }), 'Slowest tests');
  const rows = text.split('\n').filter(line => line.startsWith('| integration'));
  assert.equal(rows.length, 20);
  // case 25 ran in 25, 50 and 75 s: its p50 is 50 s. case 6 is the slowest left in; case 5 is cut.
  assert.equal(rows[0], '| integration | playwright | tests/board.spec.ts › case 25 | 50.0 s | 3 |');
  assert.match(rows.at(-1), /case 6 \|/);
  assert.doesNotMatch(text, /case 5 \|/);
});

test('flaky and failed tests are counted', () => {
  const tests = [testRecord('drags', 1, 'flaky'), testRecord('drags', 1, 'flaky'), testRecord('drags', 1, 'failed'), testRecord('drags', 1), testRecord('steady', 1)];
  const text = section(report(tests, { now, days: 7, runs: 4 }), 'Flaky and failed tests');
  assert.match(text, /^\| integration \| tests\/board\.spec\.ts › drags \| 2 \| 1 \|$/m);
  assert.doesNotMatch(text, /steady/);
});

test('red jobs are counted by their label, infrastructure by cause', () => {
  const red = (classification) => job('integration', 60, { conclusion: 'failure', classification });
  const infrastructure = cause => ({ label: 'infrastructure', cause, evidence: 'x' });
  const jobs = [red(infrastructure('network change')), red(infrastructure('network change')), red(infrastructure('port in use')),
    red({ label: 'your change', cause: null, evidence: null }), red({ label: 'unknown', cause: null, evidence: null })];
  const text = section(report(jobs, { now, days: 7, runs: 5 }), 'Red jobs');
  assert.match(text, /^\| infrastructure: network change \| 2 \|$/m);
  assert.match(text, /^\| infrastructure: port in use \| 1 \|$/m);
  assert.match(text, /^\| your change \| 1 \|$/m);
  assert.match(text, /^\| log unavailable \| 1 \|$/m);
});

test('the PC queue: p50, p90 and the longest wait on the self-hosted runner, and the integration jobs that fell back', () => {
  // Queues of 60..600 s on the PC: p50 is the 5th (300 s), p90 the 9th (540 s), max 600 s.
  const pc = Array.from({ length: 10 }, (_, n) => job('integration', 300, { environment: 'self-hosted', queue_s: (n + 1) * 60 }));
  const hosted = [job('integration', 300, { queue_s: 9999 }), job('integration', 300, { queue_s: 9999 }), job('static', 30, { queue_s: 9999 })];
  const text = section(report([...pc, ...hosted], { now, days: 7, runs: 12 }), 'PC queue');
  assert.match(text, /10 jobs on the PC waited 5\.0 min at p50, 9\.0 min at p90 and 10\.0 min at most\./);
  assert.match(text, /2 integration jobs ran on a GitHub-hosted runner instead\./);
});

function fakeApi(issues) {
  const calls = [];
  let next = 900;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return path.includes('page=1') ? issues : [];
    if (method === 'POST') return { number: next++, ...body };
    return {};
  };
  return { api, calls };
}
const body = '<!-- ci-health -->\n# CI health report\n';

test('the report updates the open tracking issue and creates none', async () => {
  const { api, calls } = fakeApi([{ number: 7, title: 'CI health report', body: '<!-- ci-health -->\nold' }]);
  assert.deepEqual(await upsertIssue(api, 'CI health report', body), { action: 'updated', number: 7 });
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), [{ method: 'PATCH', path: '/issues/7', body: { body } }]);
});

test('the report creates exactly one issue when none is open, ignoring a same-titled issue without the marker and a pull request', async () => {
  const { api, calls } = fakeApi([
    { number: 5, title: 'CI health report', body: 'written by a person' },
    { number: 6, title: 'CI health report', body: '<!-- ci-health -->\n', pull_request: { url: 'x' } },
  ]);
  assert.deepEqual(await upsertIssue(api, 'CI health report', body), { action: 'created', number: 900 });
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), [{ method: 'POST', path: '/issues', body: { title: 'CI health report', body } }]);
  assert.match(calls[0].path, /state=open&creator=github-actions%5Bbot%5D&per_page=100/);
});
