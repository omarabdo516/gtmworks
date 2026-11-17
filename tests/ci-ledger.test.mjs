import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { layerOf, skipReason, summary, testRecords } from '../scripts/ci-ledger.mjs';

// The CI ledger (#256): every test a layer ran becomes one record, a skipped layer says why, and a red job carries its
// label. The fixtures are shaped like each reporter's own output (Playwright's JSON reporter, Vitest's JSON reporter,
// the node:test reporter run for real).
function folder(t, meta, files) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

const result = (status, duration, parallelIndex, retry = 0) => ({
  workerIndex: parallelIndex, parallelIndex, status, duration, error: undefined, errors: [], stdout: [], stderr: [], retry,
  startTime: '2026-11-16T10:00:00.000Z', attachments: [], annotations: [],
});
const playwrightTest = (projectName, status, results) => ({ timeout: 30000, annotations: [], expectedStatus: 'passed', projectName, projectId: projectName, results, status });
const spec = (title, file, tests) => ({ tags: [], title, ok: true, tests, id: title, file, line: 1, column: 1 });
const playwrightReport = {
  config: { configFile: '/runner/work/gtmworks/playwright.config.ts', rootDir: '/runner/work/gtmworks/tests', projects: [] },
  suites: [{
    title: 'board.spec.ts', file: 'board.spec.ts', line: 0, column: 0,
    specs: [spec('drags a card', 'board.spec.ts', [playwrightTest('functional', 'expected', [result('passed', 1200, 2)])])],
    suites: [{
      title: 'Viewer', file: 'board.spec.ts', line: 10, column: 1,
      specs: [
        spec('cannot drop', 'board.spec.ts', [playwrightTest('functional', 'flaky', [result('failed', 3000, 1), result('passed', 2000, 3, 1)])]),
        spec('not here', 'board.spec.ts', [playwrightTest('functional', 'skipped', [result('skipped', 0, 0)])]),
        spec('breaks', 'board.spec.ts', [playwrightTest('functional', 'unexpected', [result('failed', 500, 0), result('failed', 400, 0, 1)])]),
      ],
    }],
  }],
  errors: [],
  stats: { startTime: '2026-11-16T10:00:00.000Z', duration: 9000, expected: 1, unexpected: 1, flaky: 1, skipped: 1 },
};

test('Playwright: one record per test, a flaky one with its retry and its lane', t => {
  const dir = folder(t, { layer: 'integration', shard: '', runner: 'pc-ci', environment: 'self-hosted' }, { 'e2e.json': playwrightReport });
  const { tests, unreadable } = testRecords(dir);
  const { expected, unexpected, flaky, skipped } = playwrightReport.stats;
  assert.equal(tests.length, expected + unexpected + flaky + skipped);
  assert.deepEqual(unreadable, []);
  const byName = Object.fromEntries(tests.map(record => [record.name, record]));
  assert.deepEqual(Object.keys(byName).sort(), ['[functional] Viewer › breaks', '[functional] Viewer › cannot drop', '[functional] Viewer › not here', '[functional] drags a card']);
  const flakyOne = byName['[functional] Viewer › cannot drop'];
  assert.deepEqual({ outcome: flakyOne.outcome, retries: flakyOne.retries, lane: flakyOne.lane, duration_ms: flakyOne.duration_ms }, { outcome: 'flaky', retries: 1, lane: 3, duration_ms: 5000 });
  assert.equal(byName['[functional] Viewer › breaks'].outcome, 'failed');
  assert.equal(byName['[functional] Viewer › not here'].outcome, 'skipped');
  assert.equal(byName['[functional] drags a card'].outcome, 'passed');
  assert.equal(flakyOne.file, 'tests/board.spec.ts');
  assert.deepEqual([flakyOne.layer, flakyOne.runner, flakyOne.environment, flakyOne.suite], ['integration', 'pc-ci', 'self-hosted', 'playwright']);
});

test('Vitest: one record per assertion, and a file that does not parse is named, not counted', t => {
  const assertion = (fullName, status, duration) => ({ ancestorTitles: [], fullName, status, title: fullName, meta: {}, duration, failureMessages: [], location: null, tags: [], benchmarks: [] });
  const report = {
    numFailedTests: 1, numFailedTestSuites: 1, numPassedTests: 2, numPassedTestSuites: 1, numPendingTests: 1, numPendingTestSuites: 0,
    numTodoTests: 1, numTotalTests: 5, numTotalTestSuites: 2, startTime: 0, success: false, snapshot: {},
    testResults: [
      { message: '', name: '/runner/work/gtmworks/tests/components/board.test.tsx', status: 'passed', startTime: 0, endTime: 1,
        assertionResults: [assertion('board shows six columns', 'passed', 12), assertion('board drags', 'passed', null), assertion('board later', 'todo', null)] },
      { message: '', name: '/runner/work/gtmworks/tests/components/card.test.tsx', status: 'failed', startTime: 0, endTime: 1,
        assertionResults: [assertion('card opens', 'failed', 30), assertion('card waits', 'skipped', 0)] },
    ],
  };
  const dir = folder(t, { layer: 'components', shard: '1/2', runner: 'GitHub Actions 7', environment: 'github-hosted', root: '/runner/work/gtmworks' },
    { 'vitest.json': report, 'screens.json': '{"suites": [' });
  const { tests, unreadable } = testRecords(dir);
  assert.equal(tests.length, report.numTotalTests);
  assert.deepEqual(tests.map(record => record.outcome), ['passed', 'passed', 'skipped', 'failed', 'skipped']);
  assert.equal(tests[1].duration_ms, 0);
  assert.equal(tests[0].file, 'tests/components/board.test.tsx');
  assert.equal(tests[0].shard, '1/2');
  assert.deepEqual(unreadable, [join(dir, 'screens.json')]);
});

test('node: the reporter run by node --test gives one record per test', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ledger-node-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'two.test.mjs'), `import { test, describe } from 'node:test';
describe('group', () => { test('first', () => {}); });
test('second', { skip: 'later' }, () => {});
`);
  const run = spawnSync(process.execPath, ['--test', `--test-reporter=${resolve('scripts/ci-ledger-node.mjs')}`, '--test-reporter-destination=ledger.jsonl', 'two.test.mjs'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.map(({ file, name, outcome, retries }) => ({ file, name, outcome, retries })), [
    { file: 'two.test.mjs', name: 'group › first', outcome: 'passed', retries: 0 },
    { file: 'two.test.mjs', name: 'second', outcome: 'skipped', retries: 0 },
  ]);
  for (const line of lines) assert.equal(typeof line.duration_ms, 'number');
  const ledger = mkdtempSync(join(tmpdir(), 'ci-ledger-'));
  t.after(() => rmSync(ledger, { recursive: true, force: true }));
  writeFileSync(join(ledger, 'meta.json'), JSON.stringify({ layer: 'static', shard: '', runner: 'GitHub Actions 3', environment: 'github-hosted' }));
  writeFileSync(join(ledger, 'node.jsonl'), readFileSync(join(dir, 'ledger.jsonl')));
  assert.equal(testRecords(ledger).tests.length, 2);
});

test('database: each check is one record', t => {
  const lines = [
    { suite: 'database', file: 'supabase/migrations/0001.verify.sql', name: 'verify', duration_ms: 812, outcome: 'passed', retries: 0 },
    { suite: 'database', file: 'tests/db.sh', name: 'test:db', duration_ms: 64000, outcome: 'failed', retries: 0 },
  ];
  const dir = folder(t, { layer: 'database', shard: '', runner: 'GitHub Actions 2', environment: 'github-hosted' }, { 'database.jsonl': lines.map(line => JSON.stringify(line)).join('\n') + '\n' });
  assert.deepEqual(testRecords(dir).tests.map(({ file, outcome }) => ({ file, outcome })), lines.map(({ file, outcome }) => ({ file, outcome })));
});

test('a matrix job is read as its layer', () => {
  assert.equal(layerOf('components (1/2)'), 'components');
  assert.equal(layerOf('integration'), 'integration');
});

const areaRule = 'no changed file is in its area (scripts/ci-areas.mjs)';
const docsOnly = { components: 'false', database: 'false', integration: 'false', install: 'false', lane: 'false' };

test('a documents-only pull request names the area rule for every long layer it skipped', () => {
  for (const layer of ['components', 'database', 'visual', 'integration', 'install', 'lane']) assert.equal(skipReason(layer, docsOnly, 'pull_request'), areaRule, layer);
});

test('screens alone, a push, a manual run and a cancelled run each give their own reason', () => {
  const screens = { components: 'true', database: 'false', integration: 'visual', install: 'false' };
  assert.equal(skipReason('integration', screens, 'pull_request'), 'screens alone: only the compared screens run (visual job)');
  assert.equal(skipReason('database', docsOnly, 'push'), 'every changed file is a document');
  assert.equal(skipReason('visual', docsOnly, 'workflow_dispatch'), 'manual run: the e2e input is off');
  assert.equal(skipReason('lane', docsOnly, 'workflow_dispatch'), 'manual run: the e2e input is off');
  assert.equal(skipReason('install', docsOnly, 'workflow_dispatch'), 'manual run: the install input is off');
  const all = { components: 'true', database: 'true', integration: 'true', install: 'true' };
  assert.equal(skipReason('install', all, 'pull_request'), 'not started: the run was cancelled or a job it needs did not succeed');
});

test('the summary has a row per layer with its reason, marks a layer over budget and labels a red job', () => {
  const job = (name, layer, conclusion, extra = {}) => ({
    kind: 'job', layer, name, conclusion, duration_s: 60, queue_s: 6, runner: 'GitHub Actions 1', environment: 'github-hosted',
    budget_s: null, skip_reason: null, classification: null, steps: [], ...extra,
  });
  const jobs = [
    job('install', 'install', 'skipped', { skip_reason: areaRule, budget_s: 720 }),
    job('changes', 'changes', 'success'),
    job('static', 'static', 'success', { duration_s: 114, budget_s: 90 }),
    job('components (2/2)', 'components', 'success', { budget_s: 90 }),
    job('components (1/2)', 'components', 'success', { budget_s: 90 }),
    job('database', 'database', 'failure', { budget_s: 180, classification: { label: 'infrastructure', cause: 'port in use', evidence: 'failed to bind host port 0.0.0.0:54322/tcp: address already in use' } }),
    job('visual', 'visual', 'skipped', { skip_reason: areaRule, budget_s: 300 }),
    job('integration', 'integration', 'failure', { budget_s: 720, classification: { label: 'your change', cause: null, evidence: null } }),
    job('check', 'check', 'success'),
  ];
  const tests = [
    ...Array.from({ length: 3 }, () => ({ layer: 'static', shard: '', suite: 'node', outcome: 'passed' })),
    { layer: 'static', shard: '', suite: 'node', outcome: 'skipped' },
    { layer: 'components', shard: '1/2', suite: 'vitest', outcome: 'passed' },
  ];
  const text = summary({ run: { wall_s: 660, budget_s: 600 }, jobs, tests, unreadable: ['ledger-visual/visual/screens.json'] });
  const rows = text.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Layer'));
  assert.deepEqual(rows.map(row => row.split(' | ')[0].slice(2)), ['changes', 'static', 'components (1/2)', 'components (2/2)', 'database', 'visual', 'integration', 'install']);
  const row = name => rows.find(line => line.startsWith(`| ${name} |`));
  assert.match(row('static'), /\| 1\.9 min \(over\) \| 1\.5 min \|/);
  assert.match(row('static'), /\| 3 passed, 1 skipped \|/);
  assert.match(row('components (1/2)'), /\| 1 passed \|/);
  assert.doesNotMatch(row('components (2/2)'), /passed/);
  assert.doesNotMatch(row('components (1/2)'), /over/);
  assert.ok(row('visual').endsWith(`| ${areaRule} |`));
  assert.ok(row('install').endsWith(`| ${areaRule} |`));
  assert.match(row('database'), /\| infrastructure: port in use: `failed to bind host port 0\.0\.0\.0:54322\/tcp: address already in use` \|$/);
  assert.match(row('integration'), /\| your change \|$/);
  assert.match(text, /11\.0 min \(over\)/);
  assert.match(text, /Budgets are reported, not enforced\./);
  assert.match(text, /node 4, vitest 1/);
  assert.match(text, /unreadable results: ledger-visual\/visual\/screens\.json/);
});
