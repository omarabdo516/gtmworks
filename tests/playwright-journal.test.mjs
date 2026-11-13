import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { adaptReport, finalize, otherInvocations, parseJournal, reportState, summarizeJournal, ALLOWED_FIELDS } from '../scripts/playwright-journal.mjs';
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
// Records as the reporter now writes them: identity includes Playwright's repeatEachIndex (0 without --repeat-each).
const id = (title, project = 'functional', file = 'tests/a.spec.ts', lineNo = 3) => ({ project, file, line: lineNo, title, repeatEachIndex: 0 });
const rep = (record, repeatEachIndex) => ({ ...record, repeatEachIndex });
// A record as written before repeatEachIndex existed: still journal v1, with that field absent.
const legacy = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'repeatEachIndex'));
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
 // (A run that hit its global time limit ends "timedout", Playwright's FullResult spelling, not a test's "timedOut".)
 for (const status of ['interrupted', 'timedout']) {
  const stopped = summarizeJournal(journal(...head, { kind: 'end', status }));
  assert.equal(stopped.malformed, 0, status);
  assert.equal(stopped.endStatus, status);
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

test('the run times out as "timedout" and stays incomplete; a single test still times out as "timedOut"', () => {
 const head = [launch(), begin(1), selected('drags'), started('drags'), finished('drags', 'failed')];
 const run = summarizeJournal(journal(...head, { kind: 'end', status: 'timedout' }));
 assert.deepEqual([run.malformed, run.endStatus, run.state], [0, 'timedout', 'interrupted']);
 assert.deepEqual(run.unknownCases, [{ ...id('drags'), outcome: 'retry-pending' }]);
 // Each spelling belongs to its own record kind only.
 assert.equal(parseJournal(line({ kind: 'end', status: 'timedOut' })).malformed, 1);
 assert.equal(parseJournal(line(finished('drags', 'timedout'))).malformed, 1);
 // A test that timed out on its last attempt is a final failure, as before.
 const testTimeout = summarizeJournal(journal(launch(), begin(1), selected('drags', 0), started('drags'), finished('drags', 'timedOut'), { kind: 'end', status: 'failed' }));
 assert.equal(testTimeout.outcomes.unexpected, 1);
 assert.deepEqual(testTimeout.cases[0].attempts, [{ retry: 0, status: 'timedOut', duration: 10 }]);
 assert.deepEqual(failedTests(adaptReport(testTimeout)), ['functional › a.spec.ts › drags']);
});

test('two repetitions of one test keep separate outcomes, and retries group within their repetition', () => {
 // Same retry index 0 in both repetitions, different outcomes: neither overwrites the other.
 const twoOutcomes = summarizeJournal(journal(launch(), begin(2), rep(selected('drags', 0), 0), rep(selected('drags', 0), 1),
  rep(started('drags'), 0), rep(finished('drags', 'passed'), 0), rep(started('drags'), 1), rep(finished('drags', 'failed'), 1), { kind: 'end', status: 'failed' }));
 assert.deepEqual(twoOutcomes.cases.map(c => [c.repeatEachIndex, c.outcome, c.attempts]), [[0, 'expected', [{ retry: 0, status: 'passed', duration: 10 }]], [1, 'unexpected', [{ retry: 0, status: 'failed', duration: 10 }]]]);
 assert.deepEqual(twoOutcomes.outcomes, { expected: 1, unexpected: 1, flaky: 0, skipped: 0 });
 assert.deepEqual(adaptReport(twoOutcomes).suites[0].specs.map(spec => spec.tests.map(t => [t.repeatEachIndex, t.status])), [[[0, 'expected']], [[1, 'unexpected']]]);
 // Retries of repetition 1 group together; repetition 0 is untouched by them.
 const retried = summarizeJournal(journal(launch(), begin(2), rep(selected('drags'), 0), rep(selected('drags'), 1),
  rep(started('drags'), 0), rep(finished('drags', 'passed'), 0), rep(started('drags'), 1), rep(finished('drags', 'failed'), 1), rep(started('drags', 1), 1), rep(finished('drags', 'passed', 1), 1), { kind: 'end', status: 'passed' }));
 assert.deepEqual(retried.cases.map(c => [c.repeatEachIndex, c.outcome, c.attempts.map(a => [a.retry, a.status])]), [[0, 'expected', [[0, 'passed']]], [1, 'flaky', [[0, 'failed'], [1, 'passed']]]]);
 // A repetition still running is named with its index.
 const running = summarizeJournal(journal(launch(), begin(2), rep(selected('drags'), 0), rep(selected('drags'), 1), rep(started('drags'), 0), rep(finished('drags', 'passed'), 0), rep(started('drags'), 1)));
 assert.deepEqual(running.unknownCases, [{ ...id('drags'), repeatEachIndex: 1, outcome: 'interrupted' }]);
});

test('a v1 record written before repeatEachIndex existed stays readable with that index unobserved, never 0', () => {
 const summary = summarizeJournal(journal(launch(), begin(1), legacy(selected('opens')), legacy(started('opens')), legacy(finished('opens', 'passed')), { kind: 'end', status: 'passed' }));
 assert.equal(summary.malformed, 0);
 assert.deepEqual(summary.cases.map(c => [c.title, c.repeatEachIndex, c.outcome]), [['opens', null, 'expected']]);
 const stopped = summarizeJournal(journal(launch(), begin(1), legacy(selected('opens')), legacy(started('opens'))));
 assert.deepEqual(stopped.unknownCases, [{ ...id('opens'), repeatEachIndex: null, outcome: 'interrupted' }]);
});

test('a present but malformed repeatEachIndex rejects its record', () => {
 for (const bad of [-1, 1.5, '0', null, 2 ** 53, true, [0], {}]) {
  for (const record of [selected('opens'), started('opens'), finished('opens', 'passed')]) {
   assert.equal(parseJournal(line(rep(record, bad))).malformed, 1, `${record.kind} ${JSON.stringify(bad)}`);
  }
 }
 assert.equal(parseJournal(line(rep(started('opens'), 3))).malformed, 0);
});

test('selection cut off before identities were written: the missing cases count as unknown, without names', () => {
 const none = summarizeJournal(journal(launch(), begin(3)));
 assert.deepEqual([none.state, none.selected, none.unrecordedSelected], ['interrupted', 3, 3]);
 assert.deepEqual([none.cases, none.unknownCases], [[], []]);
 assert.deepEqual(none.unknown, { interrupted: 0, retryPending: 0, notStarted: 0 }, 'no case is invented as known never-started');
 const one = summarizeJournal(journal(launch(), begin(3), selected('opens'), started('opens'), finished('opens', 'passed')));
 assert.deepEqual([one.unrecordedSelected, one.outcomes.expected, one.unknownCases], [2, 1, []]);
 // Before Playwright selected anything the number is unknown, not zero.
 assert.equal(summarizeJournal(journal(launch())).unrecordedSelected, null);
 assert.equal(summarizeJournal('').unrecordedSelected, null);
 // Final outcomes + unknown outcomes + unrecorded selection = selected, for every consistent journal here.
 const retryHead = [launch(), begin(1), selected('drags'), started('drags'), finished('drags', 'failed')];
 for (const s of [none, one, summarizeJournal(interrupted), summarizeJournal(journal(...retryHead)), summarizeJournal(journal(...retryHead, { kind: 'end', status: 'timedout' })),
  summarizeJournal(journal(launch(), begin(2), selected('opens'), selected('drags'), started('opens')))]) {
  const total = Object.values(s.outcomes).reduce((a, b) => a + b, 0) + Object.values(s.unknown).reduce((a, b) => a + b, 0) + s.unrecordedSelected;
  assert.equal(total, s.selected);
 }
});

test('compare-failures and the proxy line count unrecorded selection as unknown, apart from known never-started cases', () => {
 const none = renderMarkdown(compareFailures(adaptReport(summarizeJournal(journal(launch(), begin(3)))), null), '');
 assert.match(none, /3 of 3 selected cases have no final outcome \(0 interrupted, 0 awaiting a retry, 0 never started, 3 selected but never recorded by name;/);
 const one = renderMarkdown(compareFailures(adaptReport(summarizeJournal(journal(launch(), begin(3), selected('opens'), selected('drags'), started('opens'), finished('opens', 'passed')))), null), '');
 assert.match(one, /2 of 3 selected cases have no final outcome \(0 interrupted, 0 awaiting a retry, 1 never started, 1 selected but never recorded by name;/);
 const unknownSelection = renderMarkdown(compareFailures(adaptReport(summarizeJournal(journal(launch()))), null), '');
 assert.match(unknownSelection, /The selected cases are unknown/);
 const dir = mkdtempSync(join(tmpdir(), 'journal-unrecorded-'));
 writeFileSync(join(dir, 'journal-proxy.jsonl'), journal(launch('proxy'), begin(3, 'proxy')));
 finalize(dir);
 assert.deepEqual(otherInvocations(JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))), ['proxy: interrupted, 0 expected, 0 unexpected, 0 flaky, 0 skipped, 3 without a final outcome (3 selected but never recorded by name)']);
});

test('a record whose kind is not one of the journal\'s own is malformed, never a crash, and later records still count', () => {
 const kinds = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'unknown', 42, null, ['end']];
 const badKinds = kinds.map(kind => JSON.stringify({ v: 1, kind, status: 'passed' }));
 const primitives = ['5', '"end"', 'null', 'true', '[]', '[{"v":1,"kind":"end","status":"passed"}]'];
 const extraKey = '{"v":1,"kind":"end","status":"passed","__proto__":{"status":"passed"}}';
 const text = [...badKinds, ...primitives, extraKey, '{"v":1,"kind":"en'].join('\n') + '\n' + interrupted;
 let parsed;
 assert.doesNotThrow(() => { parsed = parseJournal(text); });
 assert.equal(parsed.malformed, badKinds.length + primitives.length + 2);
 const summary = summarizeJournal(text);
 const clean = summarizeJournal(interrupted);
 assert.deepEqual([summary.state, summary.selected, summary.outcomes, summary.unknown, summary.unknownCases], [clean.state, clean.selected, clean.outcomes, clean.unknown, clean.unknownCases]);
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

// Main stopped early: `drags` failed there, `drops` never got an outcome. The PR (complete) fails both.
const interruptedMain = () => adaptReport(summarizeJournal(interrupted));
const prFailingBoth = () => adaptReport(summarizeJournal(journal(launch(), begin(2), selected('drags', 0), selected('drops', 0),
 started('drags'), finished('drags', 'failed'), started('drops'), finished('drops', 'failed'), { kind: 'end', status: 'failed' })));

test('an interrupted main run: a failure it observed is inherited, one it never showed is unknown on main, never the PR\'s own', () => {
 const result = compareFailures(prFailingBoth(), interruptedMain());
 assert.equal(result.mainIncomplete, true);
 assert.deepEqual(result.inherited, ['functional › a.spec.ts › drags']);
 assert.deepEqual(result.unknownOnMain, ['functional › a.spec.ts › drops']);
 assert.deepEqual(result.own, []);
 const text = renderMarkdown(result, 'https://example.test/run/1');
 assert.match(text, /### Inherited from main \(1\)\n\n- functional › a\.spec\.ts › drags\n/);
 assert.match(text, /### Unknown on main \(1\)\n\n[^\n]*\n\n- functional › a\.spec\.ts › drops\n/);
 assert.match(text, /### This PR's own \(0\)\n\nNone\./);
 // A complete main run keeps the original two-way split, with no unknown list.
 const completeMain = adaptReport(summarizeJournal(journal(launch(), begin(1), selected('drags', 0), started('drags'), finished('drags', 'failed'), { kind: 'end', status: 'failed' })));
 const complete = compareFailures(prFailingBoth(), completeMain);
 assert.deepEqual(complete, { mainReport: true, inherited: ['functional › a.spec.ts › drags'], own: ['functional › a.spec.ts › drops'] });
 assert.doesNotMatch(renderMarkdown(complete, ''), /Unknown on main/);
 // No main report: unchanged, everything is the PR's own.
 assert.deepEqual(compareFailures(prFailingBoth(), null), { mainReport: false, inherited: [], own: ['functional › a.spec.ts › drags', 'functional › a.spec.ts › drops'] });
});

test('the comment is still posted when every PR failure is unknown on an interrupted main', () => {
 const dir = mkdtempSync(join(tmpdir(), 'journal-unknown-on-main-'));
 const pr = adaptReport(summarizeJournal(journal(launch(), begin(1), selected('drops', 0), started('drops'), finished('drops', 'failed'), { kind: 'end', status: 'failed' })));
 writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr));
 writeFileSync(join(dir, 'main.json'), JSON.stringify(interruptedMain()));
 const ran = spawnSync(process.execPath, ['scripts/compare-failures.mjs', join(dir, 'pr.json'), join(dir, 'main.json'), 'https://example.test/run/4', join(dir, 'comment.md')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
 assert.equal(ran.status, 0, ran.stderr);
 assert.ok(existsSync(join(dir, 'comment.md')), ran.stdout);
 const comment = readFileSync(join(dir, 'comment.md'), 'utf8');
 assert.match(comment, /### Unknown on main \(1\)/);
 assert.match(comment, /- functional › a\.spec\.ts › drops/);
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
const make = (title, line) => ({ title, parent: describe, location: { file: dir + '/tests/a.spec.ts', line, column: 1 }, retries: 1, expectedStatus: 'passed', repeatEachIndex: 0 });
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

// The child runs outside CI by construction: it never inherits the CI run identity of the process that starts it (in CI
// the test process itself has GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT and GITHUB_SHA). Nothing in the parent is changed.
// parentEnv: the environment of the process that starts the child (this test process unless a test says otherwise).
// childIdentity: CI identifiers a test hands the child on purpose.
const CI_IDENTITY = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA'];
const outsideCi = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !CI_IDENTITY.includes(key)));
async function stopAfterReady(signal, { label = signal, parentEnv = process.env, childIdentity = {} } = {}) {
 const dir = mkdtempSync(join(tmpdir(), `journal-${label}-`));
 const child = spawn(process.execPath, ['--input-type=module', '-e', lifecycle, dir], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...outsideCi(parentEnv), ...childIdentity } });
 let stderr = '';
 child.stderr.on('data', chunk => { stderr += chunk; });
 await new Promise((ready, fail) => {
  child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) ready(); });
  child.on('exit', code => fail(new Error(`child exited ${code} before it was ready: ${stderr}`)));
 });
 const exited = new Promise(done => child.on('exit', (code, sig) => done(sig)));
 child.kill(signal);
 assert.equal(await exited, signal);
 keep(`lifecycle-${label}`, dir);
 const text = readFileSync(join(dir, 'out/journal-main.jsonl'), 'utf8');
 return { summary: summarizeJournal(text), text };
}

for (const signal of ['SIGTERM', 'SIGKILL']) {
 test(`a reporter process stopped by ${signal} before onEnd leaves an exact partial record on disk`, async () => {
  const { summary } = await stopAfterReady(signal);
  assert.equal(summary.state, 'interrupted');
  assert.equal(summary.endStatus, null);
  assert.equal(summary.selected, 3);
  assert.equal(summary.unrecordedSelected, 0);
  assert.deepEqual(summary.outcomes, { expected: 1, unexpected: 1, flaky: 0, skipped: 0 });
  assert.deepEqual(summary.unknownCases, [{ project: 'functional', file: 'tests/a.spec.ts', line: 5, title: 'board › drops', repeatEachIndex: 0, outcome: 'interrupted' }]);
  assert.deepEqual(summary.run, { id: null, attempt: null, sha: null });
 });
}

const VALID_CI = { GITHUB_RUN_ID: '43348255076', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a60ecbe37bfc2644c1a2a241a2dd7ecdf0380a72' };

test('a lifecycle child meant to run outside CI records no run identity even when its parent runs inside CI', async () => {
 const before = Object.fromEntries(Object.keys(VALID_CI).map(key => [key, process.env[key]]));
 const { summary } = await stopAfterReady('SIGKILL', { label: 'isolated-from-ci-parent', parentEnv: { ...process.env, ...VALID_CI } });
 assert.deepEqual(summary.run, { id: null, attempt: null, sha: null });
 assert.deepEqual(Object.fromEntries(Object.keys(VALID_CI).map(key => [key, process.env[key]])), before, 'the parent environment is not changed');
});

test('a lifecycle child handed CI identifiers on purpose records exactly the valid ones, and no marker', async () => {
 const valid = await stopAfterReady('SIGKILL', { label: 'given-valid-identity', childIdentity: VALID_CI });
 assert.deepEqual(valid.summary.run, { id: '43348255076', attempt: '1', sha: 'a60ecbe37bfc2644c1a2a241a2dd7ecdf0380a72' });
 const marker = 'MARKER-SECRET-lifecycle-51c0';
 const invalid = await stopAfterReady('SIGKILL', { label: 'given-invalid-identity', childIdentity: { GITHUB_RUN_ID: `1;${marker}`, GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: marker } });
 assert.deepEqual(invalid.summary.run, { id: null, attempt: '2', sha: null });
 assert.equal(invalid.text.includes(marker), false);
});

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

// This fixture's own global time limit, not any repository or CI timeout: Playwright 1.64.1 ends such a run "timedout".
test('a real Playwright run that reaches its global time limit ends "timedout" and keeps the running case unknown', async () => {
 const run = project(`test('waits', async () => { await new Promise(() => {}); });`, { config: 'globalTimeout: 4000,' });
 await run.exited;
 keep('playwright-globalTimeout', join(run.dir, 'out'));
 const summary = summarizeJournal(readFileSync(run.journalFile, 'utf8'));
 assert.deepEqual([summary.malformed, summary.endStatus, summary.state, summary.selected], [0, 'timedout', 'interrupted', 1], run.output());
 assert.deepEqual(summary.outcomes, { expected: 0, unexpected: 0, flaky: 0, skipped: 0 });
 assert.deepEqual(summary.unknownCases.map(c => [c.title, c.repeatEachIndex, c.outcome]), [['waits', 0, 'interrupted']]);
});

test('a real Playwright run with repeat-each keeps every repetition apart', async () => {
 const run = project(`test('repeats', ({}, testInfo) => { if (testInfo.repeatEachIndex === 1) throw new Error('second'); });`, { config: 'repeatEach: 2, retries: 0,' });
 assert.equal((await run.exited).code, 1, run.output());
 keep('playwright-repeatEach', join(run.dir, 'out'));
 const summary = summarizeJournal(readFileSync(run.journalFile, 'utf8'));
 assert.equal(summary.selected, 2);
 assert.deepEqual(summary.cases.map(c => [c.title, c.repeatEachIndex, c.outcome]), [['repeats', 0, 'expected'], ['repeats', 1, 'unexpected']]);
 const playwright = JSON.parse(readFileSync(join(run.dir, 'out/results.json'), 'utf8'));
 assert.deepEqual(playwright.suites[0].specs.flatMap(spec => spec.tests.map(t => t.status)).sort(), ['expected', 'unexpected']);
});
