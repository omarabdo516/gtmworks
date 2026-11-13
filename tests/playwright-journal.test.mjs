import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { adaptReport, finalize, parseJournal, reportState, summarizeJournal, ALLOWED_FIELDS } from '../scripts/playwright-journal.mjs';
import { compareFailures, failedTests, renderMarkdown } from '../scripts/compare-failures.mjs';
import { flakyTests, issueBody, renderSummary } from '../scripts/flaky-tests.mjs';

// A Playwright run that is killed before it finishes still leaves a truthful record of what it selected and observed
// (docs/ci-test-journal.md). JOURNAL_EVIDENCE_DIR keeps every on-disk journal these tests produce.
const repo = process.cwd();
const reporterPath = resolve('scripts/playwright-journal-reporter.mjs');
const runtime = resolve('node_modules/@playwright/test');
const keep = (name, dir) => {
 if (process.env.JOURNAL_EVIDENCE_DIR) cpSync(dir, join(process.env.JOURNAL_EVIDENCE_DIR, name), { recursive: true });
};

const line = (record) => JSON.stringify({ v: 1, ...record }) + '\n';
const id = (title, project = 'functional', file = 'tests/a.spec.ts', lineNo = 3) => ({ project, file, line: lineNo, title });
const journal = (...records) => records.map(line).join('');
const launch = (invocation = 'main') => ({ kind: 'launch', invocation, run: { id: '43330503472', attempt: '1', sha: '863d3557428f6f86d0f75d4458b6e0baac551501' } });
const begin = (selected, invocation = 'main') => ({ kind: 'begin', invocation, root: 'tests', selected });
const selected = (title, retries = 1) => ({ kind: 'selected', ...id(title), retries });
const started = (title, retry = 0) => ({ kind: 'started', ...id(title), retry });
const finished = (title, status, retry = 0, expected = 'passed') => ({ kind: 'finished', ...id(title), retry, status, expected, duration: 10 });

// Three selected cases: one passes, one fails on both attempts, one is still running when the process stops.
const interrupted = journal(
 launch(), begin(3), selected('opens'), selected('drags'), selected('drops'),
 started('opens'), finished('opens', 'passed'),
 started('drags'), finished('drags', 'failed'), started('drags', 1), finished('drags', 'failed', 1),
 started('drops'),
);

// ── The workflow ──────────────────────────────────────────────────────────────────────────────────────────────────────

const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
const integrationSteps = workflow.jobs.integration.steps;
const upload = integrationSteps.find(step => step.name === 'upload Playwright report');
// Every always() shell step between the suite and the report upload: they decide what the artifact says.
const reportSteps = integrationSteps.slice(integrationSteps.findIndex(step => step.name === 'integration') + 1, integrationSteps.indexOf(upload))
 .filter(step => step.run && step.if === 'always()');

function runReportSteps(files) {
 const dir = mkdtempSync(join(tmpdir(), 'journal-ci-'));
 symlinkSync(join(repo, 'scripts'), join(dir, 'scripts'));
 mkdirSync(join(dir, 'playwright-report'));
 for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'playwright-report', name), text);
 for (const step of reportSteps) {
  const ran = spawnSync('bash', ['-e', '-c', step.run], { cwd: dir, encoding: 'utf8' });
  assert.equal(ran.status, 0, `${step.name}: ${ran.stderr}`);
 }
 return dir;
}
const readReport = (dir) => JSON.parse(readFileSync(join(dir, 'playwright-report/results.json'), 'utf8'));

test('CI never labels an executed main suite notRun when Playwright wrote no report of its own', () => {
 assert.ok(reportSteps.length > 0, 'the integration job prepares the report before uploading it');
 const dir = runReportSteps({ 'journal-main.jsonl': interrupted });
 keep('ci-step-interrupted', join(dir, 'playwright-report'));
 const report = readReport(dir);
 assert.notEqual(report.notRun, true, 'tests ran, so the report must not say they did not');
 assert.equal(reportState(report), 'interrupted');
 assert.deepEqual(failedTests(report), ['functional › a.spec.ts › drags']);
 assert.equal(report.execution.invocations.main.selected, 3);
});

test('CI labels a run notRun only when no Playwright invocation started at all', () => {
 const nothing = readReport(runReportSteps({}));
 assert.equal(nothing.notRun, true);
 assert.equal(reportState(nothing), 'not-started');
 const result = compareFailures(nothing, null);
 assert.equal(result.prNotRun, true);
 assert.match(renderMarkdown(result, ''), /Playwright did not run in this CI run/);
});

test('a proxy run that started while the main suite never did is not labelled notRun, and no main result is invented', () => {
 const proxyOnly = readReport(runReportSteps({ 'journal-proxy.jsonl': journal(launch('proxy'), begin(1, 'proxy'), selected('opens'), started('opens'), finished('opens', 'failed'), { kind: 'end', status: 'failed' }) }));
 assert.notEqual(proxyOnly.notRun, true, 'the proxy suite ran, so this CI run did execute Playwright');
 assert.equal(reportState(proxyOnly), 'not-started', 'the main suite itself never started');
 assert.equal(proxyOnly.execution.invocations.main.state, 'not-started');
 assert.equal(proxyOnly.execution.invocations.proxy.state, 'complete');
 assert.equal(proxyOnly.execution.invocations.proxy.outcomes.unexpected, 1);
 assert.deepEqual(proxyOnly.suites, [], 'no main-suite case is invented');
 assert.deepEqual(failedTests(proxyOnly), []);
 assert.deepEqual(flakyTests(proxyOnly), []);
 const result = compareFailures(proxyOnly, null);
 assert.equal(result.prNotRun, undefined);
 assert.equal(result.prMainNotStarted, true);
 assert.deepEqual(result.inherited, []);
 assert.deepEqual(result.own, []);
 const text = renderMarkdown(result, '');
 assert.doesNotMatch(text, /Playwright did not run in this CI run|none passed here/);
 assert.match(text, /main Playwright suite did not start/);
 assert.match(text, /proxy: complete \(failed\), 0 expected, 1 unexpected/);
 // A main run in the same shape is not a usable comparison either.
 assert.equal(compareFailures(adaptReport(summarizeJournal(interrupted)), proxyOnly).mainReport, false);
});

test('CI marks Playwright\'s own report from a graceful stop as interrupted: it calls unstarted cases skipped', () => {
 const own = { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'drops', file: 'a.spec.ts', tests: [{ projectName: 'functional', status: 'skipped', results: [] }] }] }] };
 const dir = runReportSteps({ 'results.json': JSON.stringify(own), 'journal-main.jsonl': interrupted + line({ kind: 'end', status: 'interrupted' }) });
 const report = readReport(dir);
 assert.equal(reportState(report), 'interrupted');
 assert.deepEqual(report.suites, own.suites);
 assert.equal(compareFailures(report, null).prIncomplete, true);
});

test('CI leaves a complete Playwright report byte for byte and uploads the journals but never the server log', () => {
 const original = JSON.stringify({ suites: [] }, null, 2);
 const dir = runReportSteps({ 'results.json': original, 'journal-main.jsonl': journal(launch(), begin(0), { kind: 'end', status: 'passed' }) });
 assert.equal(readFileSync(join(dir, 'playwright-report/results.json'), 'utf8'), original);
 const paths = upload.with.path.trim().split('\n').map(path => path.trim()).sort();
 assert.deepEqual(paths, ['playwright-report/execution.json', 'playwright-report/journal-*.jsonl', 'playwright-report/results.json']);
 assert.equal(upload.if, 'always()');
 assert.equal(upload.with['if-no-files-found'], 'error');
});

test('the journal is evidence only: required check still needs a successful integration job', () => {
 assert.ok(workflow.jobs.check.steps[0].run.includes('"$INTEGRATION_RESULT" == success'));
 for (const step of reportSteps) assert.equal(step['continue-on-error'], undefined, step.name);
 assert.equal(workflow.jobs.integration['continue-on-error'], undefined);
});

test('both Playwright configs keep their own journal where the upload finds it, beside the main JSON report', () => {
 const main = readFileSync('playwright.config.ts', 'utf8');
 assert.match(main, /\['json', \{ outputFile: 'playwright-report\/results\.json' \}\]/);
 for (const [config, invocation] of [['playwright.config.ts', 'main'], ['playwright.proxy.config.ts', 'proxy']]) {
  const source = readFileSync(config, 'utf8');
  assert.ok(source.includes(`['./scripts/playwright-journal-reporter.mjs', { invocation: '${invocation}', outputFile: 'playwright-report/journal-${invocation}.jsonl' }]`), config);
 }
});

// ── Reading a journal ─────────────────────────────────────────────────────────────────────────────────────────────────

test('zero start: no journal at all is the only state called not started', () => {
 const summary = summarizeJournal('');
 assert.equal(summary.state, 'not-started');
 assert.equal(summary.selected, null);
});

test('launched but stopped before Playwright selected anything: interrupted, selection unknown', () => {
 const summary = summarizeJournal(journal(launch()));
 assert.equal(summary.state, 'interrupted');
 assert.equal(summary.selected, null);
 assert.equal(summary.started, 0);
});

test('interrupted before the first outcome: every case is unknown, none is passed or failed', () => {
 const summary = summarizeJournal(journal(launch(), begin(2), selected('opens'), selected('drags'), started('opens')));
 assert.equal(summary.state, 'interrupted');
 assert.deepEqual(summary.outcomes, { expected: 0, unexpected: 0, flaky: 0, skipped: 0 });
 assert.deepEqual(summary.unknown, { interrupted: 1, retryPending: 0, notStarted: 1 });
});

test('interrupted after outcomes: exact partial counts and the unknown identities', () => {
 const summary = summarizeJournal(interrupted);
 assert.equal(summary.state, 'interrupted');
 assert.equal(summary.selected, 3);
 assert.equal(summary.started, 3);
 assert.deepEqual(summary.outcomes, { expected: 1, unexpected: 1, flaky: 0, skipped: 0 });
 assert.deepEqual(summary.unknown, { interrupted: 1, retryPending: 0, notStarted: 0 });
 assert.deepEqual(summary.attempts, { started: 4, finished: 3 });
 assert.deepEqual(summary.unknownCases, [{ ...id('drops'), outcome: 'interrupted' }]);
});

test('a malformed or truncated trailing record is counted and ignored, never guessed', () => {
 const truncated = interrupted + line(finished('drops', 'passed')).slice(0, 40);
 const summary = summarizeJournal(truncated);
 assert.equal(summary.malformed, 1);
 assert.deepEqual(summary.unknownCases, [{ ...id('drops'), outcome: 'interrupted' }]);
 assert.equal(parseJournal('not json\n' + line({ kind: 'end', status: 'passed' }) + '{"v":99,"kind":"end"}\n').malformed, 2);
});

test('complete success and complete failure', () => {
 const passed = summarizeJournal(journal(launch(), begin(1), selected('opens'), started('opens'), finished('opens', 'passed'), { kind: 'end', status: 'passed' }));
 assert.equal(passed.state, 'complete');
 assert.equal(passed.endStatus, 'passed');
 assert.equal(passed.outcomes.expected, 1);
 const failed = summarizeJournal(journal(launch(), begin(1), selected('drags', 0), started('drags'), finished('drags', 'failed'), { kind: 'end', status: 'failed' }));
 assert.equal(failed.state, 'complete');
 assert.equal(failed.outcomes.unexpected, 1);
});

test('a retry: flaky when it then passed, unknown while it waits, failed only once no retry is left', () => {
 const head = [launch(), begin(1), selected('drags'), started('drags'), finished('drags', 'failed')];
 assert.equal(summarizeJournal(journal(...head, started('drags', 1), finished('drags', 'passed', 1), { kind: 'end', status: 'passed' })).outcomes.flaky, 1);
 assert.deepEqual(summarizeJournal(journal(...head)).unknown, { interrupted: 0, retryPending: 1, notStarted: 0 });
 assert.equal(summarizeJournal(journal(...head, started('drags', 1))).unknown.interrupted, 1);
 // Playwright completed the run, so no retry is still coming: the observed failure is final.
 assert.equal(summarizeJournal(journal(...head, { kind: 'end', status: 'failed' })).outcomes.unexpected, 1);
 // An interrupted or timed-out end proves no such thing: the retry may simply never have been scheduled.
 for (const status of ['interrupted', 'timedOut']) {
  const stopped = summarizeJournal(journal(...head, { kind: 'end', status }));
  assert.equal(stopped.state, 'interrupted', status);
  assert.deepEqual(stopped.outcomes, { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }, status);
  assert.deepEqual(stopped.unknown, { interrupted: 0, retryPending: 1, notStarted: 0 }, status);
  assert.deepEqual(failedTests(adaptReport(stopped)), [], status);
 }
 // A graceful stop marks the running attempt interrupted; that is not an outcome.
 const graceful = summarizeJournal(journal(launch(), begin(1), selected('opens'), started('opens'), finished('opens', 'interrupted'), { kind: 'end', status: 'interrupted' }));
 assert.equal(graceful.state, 'interrupted');
 assert.equal(graceful.unknown.interrupted, 1);
});

test('the proxy and main invocations keep separate identities in one report directory', () => {
 const dir = mkdtempSync(join(tmpdir(), 'journal-both-'));
 writeFileSync(join(dir, 'journal-proxy.jsonl'), journal(launch('proxy'), begin(1, 'proxy'), selected('opens'), started('opens'), finished('opens', 'passed'), { kind: 'end', status: 'passed' }));
 writeFileSync(join(dir, 'journal-main.jsonl'), interrupted);
 const execution = finalize(dir);
 assert.deepEqual(Object.keys(execution.invocations).sort(), ['main', 'proxy']);
 assert.equal(execution.invocations.proxy.state, 'complete');
 assert.equal(execution.invocations.main.state, 'interrupted');
 assert.deepEqual(JSON.parse(readFileSync(join(dir, 'execution.json'), 'utf8')), execution);
});

// ── Existing consumers ────────────────────────────────────────────────────────────────────────────────────────────────

test('the adapted report never turns an unknown case into a passed one', () => {
 const report = adaptReport(summarizeJournal(interrupted));
 const statuses = report.suites.flatMap(suite => suite.specs.flatMap(spec => spec.tests.map(t => [spec.title, t.status])));
 assert.deepEqual(statuses.sort(), [['drags', 'unexpected'], ['drops', 'unknown'], ['opens', 'expected']]);
 assert.deepEqual(flakyTests(report), []);
});

test('compare-failures says a PR run stopped early, even when it observed no failure yet', () => {
 const report = adaptReport(summarizeJournal(journal(launch(), begin(2), selected('opens'), selected('drags'), started('opens'), finished('opens', 'passed'))));
 const result = compareFailures(report, null);
 assert.equal(result.prIncomplete, true);
 assert.deepEqual(result.own, []);
 const text = renderMarkdown(result, '');
 assert.match(text, /stopped before it finished/);
 assert.match(text, /1 of 2 selected cases have no final outcome/);
 assert.doesNotMatch(text, /did not run/);
});

test('compare-failures does not treat an incomplete main run as a complete comparison', () => {
 const main = adaptReport(summarizeJournal(interrupted));
 const pr = adaptReport(summarizeJournal(journal(launch(), begin(1), selected('drags', 0), started('drags'), finished('drags', 'failed'), { kind: 'end', status: 'failed' })));
 const result = compareFailures(pr, main);
 assert.deepEqual(result.inherited, ['functional › a.spec.ts › drags']);
 assert.equal(result.mainIncomplete, true);
 assert.match(renderMarkdown(result, 'https://example.test/run/1'), /run on main stopped before Playwright finished/);
});

test('flaky reporting claims no green run for a run that stopped early', () => {
 const report = adaptReport(summarizeJournal(journal(launch(), begin(2), selected('drags'), selected('drops'), started('drags'), finished('drags', 'failed'), started('drags', 1), finished('drags', 'passed', 1))));
 const flaky = flakyTests(report);
 assert.equal(flaky.length, 1);
 const options = { incomplete: reportState(report) === 'interrupted' };
 assert.doesNotMatch(renderSummary(flaky, 'https://example.test/run/2', options), /stays green/);
 assert.match(renderSummary(flaky, 'https://example.test/run/2', options), /stopped before it finished/);
 assert.doesNotMatch(issueBody(flaky[0], 'https://example.test/run/2', options), /stayed green/);
 assert.match(renderSummary(flaky, 'https://example.test/run/2'), /stays green/);
});

// ── The reporter in a process that is stopped before onEnd ────────────────────────────────────────────────────────────

// A child drives the reporter's lifecycle by hand (no Playwright, no browser): one pass, one failure and its retry, then
// a third case starts, the child says "ready" and waits to be stopped.
const lifecycle = `
import Reporter from ${JSON.stringify(pathToFileURL(reporterPath).href)};
const dir = process.argv[1];
const project = { name: 'functional' };
const file = { type: 'file', title: 'a.spec.ts', project: () => project };
const describe = { type: 'describe', title: 'board', parent: file, project: () => project };
const make = (title, line) => ({ title, parent: describe, location: { file: dir + '/tests/a.spec.ts', line, column: 1 }, retries: 1, expectedStatus: 'passed' });
const tests = [make('opens', 3), make('drags', 4), make('drops', 5)];
const reporter = new Reporter({ configDir: dir, invocation: 'main', outputFile: 'out/journal-main.jsonl' });
reporter.onBegin({ configFile: dir + '/playwright.config.ts', rootDir: dir + '/tests' }, { allTests: () => tests });
const run = (test, retry, status) => { const result = { retry, status, duration: 7 }; reporter.onTestBegin(test, result); if (status) reporter.onTestEnd(test, result); };
run(tests[0], 0, 'passed');
run(tests[1], 0, 'failed');
run(tests[1], 1, 'failed');
run(tests[2], 0);
process.stdout.write('ready\\n');
setInterval(() => {}, 1000);
`;

async function stopAfterReady(signal) {
 const dir = mkdtempSync(join(tmpdir(), `journal-${signal}-`));
 const child = spawn(process.execPath, ['--input-type=module', '-e', lifecycle, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
 let stderr = '';
 child.stderr.on('data', chunk => { stderr += chunk; });
 await new Promise((ready, fail) => {
  child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) ready(); });
  child.on('exit', code => fail(new Error(`child exited ${code} before it was ready: ${stderr}`)));
 });
 const exited = new Promise(done => child.on('exit', (code, sig) => done(sig)));
 child.kill(signal);
 assert.equal(await exited, signal);
 keep(`lifecycle-${signal}`, dir);
 return summarizeJournal(readFileSync(join(dir, 'out/journal-main.jsonl'), 'utf8'));
}

for (const signal of ['SIGTERM', 'SIGKILL']) {
 test(`a reporter process stopped by ${signal} before onEnd leaves an exact partial record on disk`, async () => {
  const summary = await stopAfterReady(signal);
  assert.equal(summary.state, 'interrupted');
  assert.equal(summary.endStatus, null);
  assert.equal(summary.selected, 3);
  assert.deepEqual(summary.outcomes, { expected: 1, unexpected: 1, flaky: 0, skipped: 0 });
  assert.deepEqual(summary.unknownCases, [{ project: 'functional', file: 'tests/a.spec.ts', line: 5, title: 'board › drops', outcome: 'interrupted' }]);
  assert.deepEqual(summary.run, { id: null, attempt: null, sha: null });
 });
}

// ── The reporter inside a real Playwright run (no browser: these tests never ask for a page) ─────────────────────────

const SECRET = 'MARKER-SECRET-7f3a91';

function project(spec, { config = '', env = {} } = {}) {
 const dir = mkdtempSync(join(tmpdir(), 'journal-pw-'));
 mkdirSync(join(dir, 'tests'));
 writeFileSync(join(dir, 'playwright.config.mjs'), `export default {
  testDir: './tests', testMatch: '*.spec.mjs', workers: 1, retries: 1, timeout: 60000,
  reporter: [['json', { outputFile: 'out/results.json' }], [${JSON.stringify(reporterPath)}, { invocation: 'main', outputFile: 'out/journal-main.jsonl' }]],
  ${config}
 };\n`);
 writeFileSync(join(dir, 'tests/a.spec.mjs'), `import { test, expect } from ${JSON.stringify(pathToFileURL(join(runtime, 'index.mjs')).href)};\n${spec}`);
 const child = spawn(process.execPath, [join(runtime, 'cli.js'), 'test', '-c', 'playwright.config.mjs'], {
  // An empty browser folder: these runs prove the journal without any browser installed, as in the static CI job.
  cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: join(dir, 'no-browsers'), ...env },
 });
 let output = '';
 child.stdout.on('data', chunk => { output += chunk; });
 child.stderr.on('data', chunk => { output += chunk; });
 const exited = new Promise(done => child.on('exit', (code, signal) => done({ code, signal })));
 const journalFile = join(dir, 'out/journal-main.jsonl');
 return { dir, child, exited, journalFile, output: () => output };
}

async function waitFor(file, pattern, child) {
 for (let i = 0; i < 600; i++) {
  if (existsSync(file) && pattern.test(readFileSync(file, 'utf8'))) return;
  if (child.exitCode !== null) break;
  await new Promise(done => setTimeout(done, 50));
 }
 assert.fail(`never saw ${pattern} in ${file}`);
}

test('a complete Playwright run: the journal agrees with Playwright\'s own report on every case', async () => {
 const run = project(`
test('passes', () => {});
test('fails', () => { expect(1).toBe(2); });
test('flakes', ({}, testInfo) => { if (testInfo.retry === 0) throw new Error('first try'); });
test.describe('board', () => { test('skips', () => { test.skip(); }); });
test('expected failure', () => { test.fail(); throw new Error('known'); });
`);
 const { code } = await run.exited;
 assert.equal(code, 1, run.output());
 keep('playwright-complete', join(run.dir, 'out'));
 const summary = summarizeJournal(readFileSync(run.journalFile, 'utf8'));
 assert.equal(summary.state, 'complete');
 assert.equal(summary.endStatus, 'failed');
 assert.deepEqual(summary.outcomes, { expected: 2, unexpected: 1, flaky: 1, skipped: 1 });
 const playwright = JSON.parse(readFileSync(join(run.dir, 'out/results.json'), 'utf8'));
 const theirs = playwright.suites.flatMap(s => [...s.specs, ...(s.suites ?? []).flatMap(d => d.specs)]).map(spec => [spec.title, spec.tests[0].status]).sort();
 const ours = summary.cases.map(c => [c.title.split(' › ').at(-1), c.outcome]).sort();
 assert.deepEqual(ours, theirs);
 assert.deepEqual(failedTests(adaptReport(summary)), failedTests(playwright));
});

const stoppable = `
test('passes', () => {});
test('fails', () => { throw new Error('red'); });
test('waits', async () => { await new Promise(() => {}); });
test('never starts', () => {});
`;

for (const signal of ['SIGINT', 'SIGKILL']) {
 test(`a real Playwright run stopped by ${signal} while a test runs keeps exact counts and unknown cases`, async () => {
  const run = project(stoppable);
  await waitFor(run.journalFile, /"kind":"started"[^\n]*"title":"waits"/, run.child);
  process.kill(-run.child.pid, signal);
  await run.exited;
  keep(`playwright-${signal}`, join(run.dir, 'out'));
  const summary = summarizeJournal(readFileSync(run.journalFile, 'utf8'));
  assert.equal(summary.state, 'interrupted');
  assert.equal(summary.endStatus, signal === 'SIGINT' ? 'interrupted' : null);
  assert.equal(summary.selected, 4);
  assert.deepEqual(summary.outcomes, { expected: 1, unexpected: 1, flaky: 0, skipped: 0 });
  assert.deepEqual(summary.unknownCases.map(c => [c.title, c.outcome]), [['waits', 'interrupted'], ['never starts', 'not-started']]);
  if (signal === 'SIGKILL') assert.equal(existsSync(join(run.dir, 'out/results.json')), false, 'an abrupt stop leaves no Playwright report');
 });
}

test('nothing from errors, console, attachments, annotations, parameters or the environment enters the journal', async () => {
 const run = project(`
test.use({ marker: '${SECRET}-parameter' });
test('fails loudly', async ({}, testInfo) => {
 console.log('${SECRET}-stdout'); console.error('${SECRET}-stderr');
 testInfo.annotations.push({ type: 'note', description: '${SECRET}-annotation' });
 await testInfo.attach('${SECRET}-attachment-name', { body: '${SECRET}-attachment-body' });
 throw new Error('${SECRET}-error ' + process.env.MARKER);
});
`, {
  config: `metadata: { marker: '${SECRET}-metadata' }, use: { marker: '${SECRET}-use' },`,
  env: { MARKER: `${SECRET}-env`, GITHUB_RUN_ID: `1;${SECRET}`, GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: `${SECRET}` },
 });
 await run.exited;
 keep('playwright-secrets', join(run.dir, 'out'));
 const text = readFileSync(run.journalFile, 'utf8');
 assert.ok(readFileSync(join(run.dir, 'out/results.json'), 'utf8').includes(SECRET), 'the markers reached Playwright');
 assert.equal(text.includes(SECRET), false);
 const { records, malformed } = parseJournal(text);
 assert.equal(malformed, 0);
 for (const record of records) {
  assert.deepEqual(Object.keys(record).filter(key => !ALLOWED_FIELDS[record.kind].includes(key)), [], record.kind);
 }
 assert.deepEqual(records[0].run, { id: null, attempt: '2', sha: null });
});

test('the reporter binds a record to valid CI identifiers only', async () => {
 const run = project(`test('passes', () => {});`, { env: { GITHUB_RUN_ID: '43330503472', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: '863d3557428f6f86d0f75d4458b6e0baac551501' } });
 assert.equal((await run.exited).code, 0, run.output());
 const summary = summarizeJournal(readFileSync(run.journalFile, 'utf8'));
 assert.deepEqual(summary.run, { id: '43330503472', attempt: '1', sha: '863d3557428f6f86d0f75d4458b6e0baac551501' });
 assert.equal(summary.invocation, 'main');
 assert.deepEqual(summary.cases.map(c => [c.file, c.line, c.title]), [['tests/a.spec.mjs', 2, 'passes']]);
});
