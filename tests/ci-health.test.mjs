import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { publish, readLedger, report, selectLedgers, upsertIssue } from '../scripts/ci-health.mjs';

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

test('a skipped test adds no duration and no run, and a test that only skipped is not among the slowest', () => {
  const tests = [testRecord('ran once', 120000), ...Array.from({ length: 6 }, () => testRecord('ran once', 0, 'skipped')), testRecord('never ran', 0, 'skipped')];
  const text = section(report(tests, { now, days: 7, runs: 7 }), 'Slowest tests');
  assert.match(text, /^\| integration \| playwright \| tests\/board\.spec\.ts › ran once \| 120\.0 s \| 1 \|$/m);
  assert.doesNotMatch(text, /never ran/);
});

test('a report that could not read every ledger in its window says how many it left out', () => {
  assert.match(report([], { now, days: 7, runs: 400, left: 12 }), /12 older ones in the window are not counted\./);
  assert.doesNotMatch(report([], { now, days: 7, runs: 3 }), /not counted/);
});

test('flaky and failed tests are counted', () => {
  const tests = [testRecord('drags', 1, 'flaky'), testRecord('drags', 1, 'flaky'), testRecord('drags', 1, 'failed'), testRecord('drags', 1), testRecord('steady', 1)];
  const text = section(report(tests, { now, days: 7, runs: 4 }), 'Flaky and failed tests');
  assert.match(text, /^\| integration \| tests\/board\.spec\.ts › drags \| 2 \| 1 \|$/m);
  assert.doesNotMatch(text, /steady/);
});

test('the flaky and failed list stops at twenty and says how many more there are, so the issue body stays in its limit', () => {
  const tests = Array.from({ length: 23 }, (_, n) => testRecord(`breaks ${n}`, 1, 'failed'));
  const text = section(report(tests, { now, days: 7, runs: 1 }), 'Flaky and failed tests');
  assert.equal(text.split('\n').filter(line => line.startsWith('| integration')).length, 20);
  assert.match(text, /^3 more not shown\.$/m);
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
  const { api, calls } = fakeApi([{ number: 307, title: 'CI health report', body: '<!-- ci-health -->\nold' }]);
  assert.deepEqual(await upsertIssue(api, 'CI health report', body), { action: 'updated', number: 307 });
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), [{ method: 'PATCH', path: '/issues/307', body: { body } }]);
});

test('the report creates exactly one issue when none is open, ignoring a same-titled issue without the marker and a pull request', async () => {
  const { api, calls } = fakeApi([
    { number: 305, title: 'CI health report', body: 'written by a person' },
    { number: 306, title: 'CI health report', body: '<!-- ci-health -->\n', pull_request: { url: 'x' } },
  ]);
  assert.deepEqual(await upsertIssue(api, 'CI health report', body), { action: 'created', number: 900 });
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), [{ method: 'POST', path: '/issues', body: { title: 'CI health report', body } }]);
  assert.match(calls[0].path, /state=open&creator=github-actions%5Bbot%5D&per_page=100/);
});

// A pull request's own code writes its ledger, so the nightly report reads each one as untrusted input: a record of the
// wrong shape is skipped and counted, and no cell grows past a fixed length, so one ledger cannot stop the shared update.
test('a ledger with a wrong-shaped record and an oversized field still gives a report, with the record counted as unreadable', async () => {
  const good = testRecord('drags', 1500);
  const wrongShape = { ...testRecord('ghost', 1), name: { nested: true }, duration_ms: 'slow' };
  const oversized = { ...testRecord('x'.repeat(100000), 2500), file: 'tests/' + 'y'.repeat(100000) };
  const text = [good, wrongShape, oversized, { kind: 'job', layer: 'static', duration_s: [] }, 'not json', '{"kind":"surprise"}']
    .map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';
  const { records, rejected } = readLedger(text);
  assert.equal(rejected, 4, 'the wrong-shaped test and job, the line that is not JSON and the unknown kind');
  assert.deepEqual(records.map(record => record.name.slice(0, 6)), ['drags', 'xxxxxx'], 'the oversized record is kept; only its rendering is cut');
  const body = report(records, { now, days: 7, runs: 1, rejected });
  assert.match(body, /records could not be read/);
  for (const line of body.split('\n').filter(line => line.startsWith('| '))) {
    for (const part of line.slice(2, -2).split(' | ')) assert.ok(part.length <= 200, `a cell of ${part.length} characters`);
  }
  assert.match(body, /\| tests\/y+… \|/, 'the oversized test is shown, cut');
  assert.ok(body.length < 65536);
  const loud = report([testRecord('<!-- ci-health --> <img src=x> @someone', 1)], { now, days: 7, runs: 1 });
  assert.equal(loud.split('<!-- ci-health -->').length, 2, 'only the report\'s own marker');
  assert.doesNotMatch(loud, /<img|@someone/);
  const { api, calls } = fakeApi([]);
  assert.equal((await upsertIssue(api, 'CI health report', body)).action, 'created');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('a null line and a name that is an object are refused and counted, and the report is still written', () => {
  const lines = ['null', JSON.stringify({ ...testRecord('tricky', 1), name: { toString: 0, valueOf: 0 } }), JSON.stringify(testRecord('fine', 1))];
  const { records, rejected } = readLedger(lines.join('\n'));
  assert.equal(rejected, 2);
  assert.match(report(records, { now, days: 7, runs: 1, rejected }), /2 records could not be read\./);
});

test('cell text renders as plain text: no hidden comment, code, mention, reference or broken row', () => {
  const name = 'a\rb <!-- hide `code` @someone #12 owner/repo#34 back\\| end';
  const text = section(report([testRecord(name, 1)], { now, days: 7, runs: 1 }), 'Slowest tests');
  const cells = text.split('\n').find(line => line.includes('back')).split(/(?<!\\) \| /);
  assert.equal(cells.length, 5, 'the row keeps its five cells');
  assert.doesNotMatch(text, /\r|<!--|(?<!\\)`|@someone|#12|#34/);
});

test('the whole body stays under the limit, and says where it was cut', () => {
  const tests = Array.from({ length: 30 }, (_, n) => testRecord(`case ${n} ${'z'.repeat(500)}`, n + 1, 'failed'));
  const body = report(tests, { now, days: 7, runs: 1, limit: 3000 });
  assert.ok(body.length <= 3000, `${body.length} characters`);
  assert.ok(body.startsWith('<!-- ci-health -->\n'));
  assert.match(body, /The report was cut to stay under 3000 characters\.\n$/);
});

// Only this repository's own CI runs count: a fork's pull request run writes its ledger with its own code.
test('the report reads only recent ledgers of this repository\'s own ci.yml runs, under a size cap, newest first', () => {
  const since = Date.parse('2026-11-10T00:00:00Z');
  const run = (id, extra = {}) => ({ id, path: '.github/workflows/ci.yml', repository: { id: 1 }, head_repository: { id: 1 }, ...extra });
  const runs = [run(10), run(11), run(12, { head_repository: { id: 99 } }), run(13, { path: '.github/workflows/other.yml' }), run(14), run(15)];
  const artifact = (id, runId, extra = {}) => ({ id, name: 'ledger', size_in_bytes: 1000, expired: false, created_at: `2026-11-16T0${id % 10}:00:00Z`, workflow_run: { id: runId }, ...extra });
  const artifacts = [
    artifact(1, 10), artifact(2, 11), artifact(3, 12), artifact(4, 13), artifact(5, 99),
    artifact(6, 14, { size_in_bytes: 6 * 1024 * 1024 }), artifact(7, 15, { expired: true }), artifact(8, 10, { created_at: '2026-11-01T00:00:00Z' }),
  ];
  const chosen = selectLedgers(artifacts, runs, { since, cap: 1, maxBytes: 5 * 1024 * 1024 });
  assert.deepEqual(chosen.ledgers.map(a => a.id), [2], 'the newest of the two that count');
  assert.equal(chosen.left, 1);
  assert.equal(chosen.tooLarge, 1);
});

test('a pull request run of CI health prints the report and writes no issue', async () => {
  const { api, calls } = fakeApi([]);
  assert.deepEqual(await publish(api, body, { dryRun: true }), { action: 'dry run', number: null });
  assert.deepEqual(calls, []);
  assert.equal((await publish(api, body, { dryRun: false })).action, 'created');
  const workflow = load(readFileSync('.github/workflows/ci-health.yml', 'utf8'));
  const step = workflow.jobs.report.steps.find(step => /ci-health\.mjs/.test(step.run ?? ''));
  assert.equal(step.env.DRY_RUN, "${{ github.event_name == 'pull_request' }}");
});
