// Reads the Playwright execution journal (scripts/playwright-journal-reporter.mjs) and says what a run selected and
// observed: never started, interrupted or complete, with exact counts and the cases that have no final outcome.
// Format and states: docs/ci-test-journal.md. Pure functions first (tests/playwright-journal.test.mjs); the command line
// at the bottom does the file work.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const JOURNAL_VERSION = 1;

// The only fields a record may carry. The reporter builds every record from this list, and the reader drops a record
// with any other field, so an error, console line, attachment, parameter or environment value has nowhere to go.
// repeatEachIndex (Playwright's TestCase.repeatEachIndex) is a compatible v1 extension: a record written before it
// existed lacks it, and that repetition stays unobserved (null), never assumed to be 0.
const identity = ['project', 'file', 'line', 'title', 'repeatEachIndex'];
const OPTIONAL_FIELDS = ['repeatEachIndex'];
export const ALLOWED_FIELDS = {
  launch: ['v', 'kind', 'invocation', 'run'],
  begin: ['v', 'kind', 'invocation', 'root', 'selected'],
  selected: ['v', 'kind', ...identity, 'retries'],
  started: ['v', 'kind', ...identity, 'retry'],
  finished: ['v', 'kind', ...identity, 'retry', 'status', 'expected', 'duration'],
  end: ['v', 'kind', 'status'],
};
// A test result's status (TestResult.status) and the run's (FullResult.status) spell a timeout differently.
export const TEST_STATUSES = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
export const RUN_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'];
const isKind = (kind) => typeof kind === 'string' && Object.hasOwn(ALLOWED_FIELDS, kind);
const MAX_TEXT = 500;

const text = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : null);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);
const pattern = (value, shape) => (typeof value === 'string' && shape.test(value) ? value : null);

// The fixed CI identifiers that bind a record to its run; anything else in the environment is never read.
export function runIdentity(env = process.env) {
  return { id: pattern(env.GITHUB_RUN_ID, /^\d{1,20}$/), attempt: pattern(env.GITHUB_RUN_ATTEMPT, /^\d{1,5}$/), sha: pattern(env.GITHUB_SHA, /^[0-9a-f]{40}$/) };
}

// One record, reduced to its kind's allowed fields with every value checked for type and range. An optional field
// without a valid value is left out rather than written as null.
export function record(kind, fields) {
  if (!isKind(kind)) throw new Error('playwright-journal: not a journal record kind');
  const clean = {
    v: JOURNAL_VERSION,
    kind,
    invocation: pattern(fields.invocation, /^[a-z][a-z0-9-]{0,31}$/),
    run: fields.run && runIdentity({ GITHUB_RUN_ID: fields.run.id, GITHUB_RUN_ATTEMPT: fields.run.attempt, GITHUB_SHA: fields.run.sha }),
    root: text(fields.root),
    selected: count(fields.selected),
    project: text(fields.project),
    file: text(fields.file),
    line: count(fields.line),
    title: text(fields.title),
    repeatEachIndex: count(fields.repeatEachIndex),
    retries: count(fields.retries),
    retry: count(fields.retry),
    status: oneOf(fields.status, kind === 'end' ? RUN_STATUSES : TEST_STATUSES),
    expected: oneOf(fields.expected, TEST_STATUSES),
    duration: count(fields.duration),
  };
  return Object.fromEntries(ALLOWED_FIELDS[kind].filter((key) => !(OPTIONAL_FIELDS.includes(key) && clean[key] === null)).map((key) => [key, clean[key]]));
}

// True only for a line that is exactly what record() writes: an object of one of the journal's own kinds (an inherited
// name such as "__proto__" or "toString" is not one), with every required field, no other field, and every value as
// record() checks it. A present optional field must hold a valid value.
function wellFormed(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !isKind(value.kind) || value.v !== JOURNAL_VERSION) return false;
  const allowed = ALLOWED_FIELDS[value.kind];
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !OPTIONAL_FIELDS.includes(key) && !Object.hasOwn(value, key))) return false;
  const clean = record(value.kind, value);
  return keys.length === Object.keys(clean).length && keys.every((key) => JSON.stringify(clean[key]) === JSON.stringify(value[key]));
}

// Every well-formed line; anything else (a line cut off by a killed process, another version, an unknown kind, an extra
// field or an out-of-range value) is counted as malformed and skipped, and the lines after it are still read.
export function parseJournal(journal) {
  const records = [];
  let malformed = 0;
  for (const line of String(journal ?? '').split('\n')) {
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); } catch { malformed += 1; continue; }
    if (wellFormed(value)) records.push(value);
    else malformed += 1;
  }
  return { records, malformed };
}

// One case is one repetition of one test; its retries are attempts of that case.
const keyOf = (r) => JSON.stringify([r.project, r.file, r.line, r.title, r.repeatEachIndex ?? null]);

// A case's outcome from its observed attempts only. Playwright's own words for a final outcome (expected, unexpected,
// flaky, skipped); interrupted, retry-pending and not-started are unknown and never counted as passed or failed.
function outcome(attempts, retries, complete) {
  if (!attempts.length) return 'not-started';
  const last = attempts.at(-1);
  if (!last.status || last.status === 'interrupted') return 'interrupted';
  if (last.status === 'skipped') return 'skipped';
  const ok = (a) => a.status === a.expected;
  if (ok(last)) return attempts.some((a) => !ok(a)) ? 'flaky' : 'expected';
  // A failed attempt with a retry left is final only once Playwright has completed the run (passed or failed) and so
  // retried everything it was going to. An interrupted or timed-out end stopped scheduling: the retry stays unknown.
  return complete || (retries !== null && last.retry >= retries) ? 'unexpected' : 'retry-pending';
}

export function summarizeJournal(journal) {
  const { records, malformed } = parseJournal(journal);
  let launched = null, began = null, ended = null;
  let cases = new Map();
  const caseFor = (r) => {
    if (!cases.has(keyOf(r))) cases.set(keyOf(r), { project: r.project, file: r.file, line: r.line, title: r.title, repeatEachIndex: r.repeatEachIndex ?? null, retries: null, attempts: new Map() });
    return cases.get(keyOf(r));
  };
  for (const r of records) {
    if (r.kind === 'launch') { launched = r; began = null; ended = null; cases = new Map(); }
    else if (r.kind === 'begin') { launched ??= r; began = r; }
    else if (r.kind === 'selected') caseFor(r).retries = r.retries;
    else if (r.kind === 'started' && r.retry !== null) caseFor(r).attempts.set(r.retry, { retry: r.retry, status: null, expected: null, duration: null });
    else if (r.kind === 'finished' && r.retry !== null) caseFor(r).attempts.set(r.retry, { retry: r.retry, status: r.status, expected: r.expected, duration: r.duration });
    else if (r.kind === 'end') ended = r;
  }
  const complete = Boolean(launched && ended && ['passed', 'failed'].includes(ended.status));
  const state = !launched ? 'not-started' : complete ? 'complete' : 'interrupted';
  const summary = {
    v: JOURNAL_VERSION,
    invocation: launched?.invocation ?? null,
    run: launched?.run ?? { id: null, attempt: null, sha: null },
    state,
    endStatus: ended?.status ?? null,
    root: began?.root ?? null,
    selected: began?.selected ?? null,
    // Selected cases whose identity was never written (the process stopped while writing the selection): unknown,
    // and never named, started or given an outcome. null while the selection itself is unknown.
    unrecordedSelected: Number.isSafeInteger(began?.selected) ? Math.max(0, began.selected - cases.size) : null,
    started: 0,
    outcomes: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    unknown: { interrupted: 0, retryPending: 0, notStarted: 0 },
    attempts: { started: 0, finished: 0 },
    malformed,
    cases: [],
  };
  const unknownKey = { interrupted: 'interrupted', 'retry-pending': 'retryPending', 'not-started': 'notStarted' };
  for (const c of cases.values()) {
    const attempts = [...c.attempts.values()].sort((a, b) => a.retry - b.retry);
    const result = outcome(attempts, c.retries, complete);
    if (attempts.length) summary.started += 1;
    summary.attempts.started += attempts.length;
    summary.attempts.finished += attempts.filter((a) => a.status).length;
    if (unknownKey[result]) summary.unknown[unknownKey[result]] += 1;
    else summary.outcomes[result] += 1;
    summary.cases.push({ project: c.project, file: c.file, line: c.line, title: c.title, repeatEachIndex: c.repeatEachIndex, outcome: result, attempts: attempts.filter((a) => a.status).map(({ retry, status, duration }) => ({ retry, status, duration })) });
  }
  summary.unknownCases = summary.cases.filter((c) => unknownKey[c.outcome]).map(({ project, file, line, title, repeatEachIndex, outcome: o }) => ({ project, file, line, title, repeatEachIndex, outcome: o }));
  return summary;
}

// The summary without its per-case attempts, for execution.json and the report's `execution` field.
const compact = (summary) => Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'cases'));

// A Playwright-shaped report (the fields scripts/compare-failures.mjs and scripts/flaky-tests.mjs read) built only from
// what the journal observed. A case without a final outcome gets status "unknown", which no consumer reads as passed,
// failed or flaky; its attempts list only the attempts that finished.
export function adaptReport(summary, execution = { v: JOURNAL_VERSION, run: summary.run, invocations: { main: compact(summary) } }) {
  const prefix = summary.root ? `${summary.root}/` : '';
  const files = new Map();
  for (const c of summary.cases) {
    const file = c.file?.startsWith(prefix) ? c.file.slice(prefix.length) : c.file;
    if (!files.has(file)) files.set(file, { title: file, file, specs: [] });
    files.get(file).specs.push({
      title: c.title,
      file,
      line: c.line,
      tests: [{ projectName: c.project, repeatEachIndex: c.repeatEachIndex, status: ['expected', 'unexpected', 'flaky', 'skipped'].includes(c.outcome) ? c.outcome : 'unknown', results: c.attempts }],
    });
  }
  return { source: 'journal', execution, suites: [...files.values()] };
}

// What a report says about the main suite: not-started, interrupted, or complete (a plain Playwright report).
// not-started does not mean nothing ran: see otherInvocations.
export function reportState(report) {
  if (report?.notRun) return 'not-started';
  return report?.execution?.invocations?.main?.state ?? 'complete';
}

// How many cases of a summary have no final outcome: the named unknown ones plus the selected ones never recorded by name.
export function withoutFinalOutcome(s) {
  return s.unknown.interrupted + s.unknown.retryPending + s.unknown.notStarted + (s.unrecordedSelected ?? 0);
}

// The invocations other than main that started, as one line each: "proxy: complete (failed), 0 expected, 1 unexpected, …".
export function otherInvocations(report) {
  return Object.entries(report?.execution?.invocations ?? {})
    .filter(([name, s]) => name !== 'main' && s.state !== 'not-started')
    .map(([name, s]) => {
      const unrecorded = s.unrecordedSelected ? ` (${s.unrecordedSelected} selected but never recorded by name)` : '';
      return `${name}: ${s.state}${s.endStatus ? ` (${s.endStatus})` : ''}, ${s.outcomes.expected} expected, ${s.outcomes.unexpected} unexpected, ${s.outcomes.flaky} flaky, ${s.outcomes.skipped} skipped, ${withoutFinalOutcome(s)} without a final outcome${unrecorded}`;
    });
}

// Reads every journal-<invocation>.jsonl in dir, writes execution.json, and makes results.json truthful:
// - Playwright's own report for a complete main suite stays byte for byte;
// - its report for an interrupted suite gains an `execution` field;
// - no readable report: a started main suite becomes the journal's report; a main suite that never started is notRun
//   only when no other invocation started either, and otherwise an empty report whose execution names what did run.
export function finalize(dir) {
  mkdirSync(dir, { recursive: true });
  const invocations = {};
  for (const name of readdirSync(dir).filter((n) => /^journal-[a-z][a-z0-9-]{0,31}\.jsonl$/.test(n)).sort()) {
    invocations[name.slice('journal-'.length, -'.jsonl'.length)] = summarizeJournal(readFileSync(join(dir, name), 'utf8'));
  }
  const main = invocations.main ?? summarizeJournal('');
  const execution = {
    v: JOURNAL_VERSION,
    run: Object.values(invocations).find((s) => s.run.id)?.run ?? main.run,
    invocations: Object.fromEntries(Object.entries(invocations).map(([name, summary]) => [name, compact(summary)])),
  };
  if (!execution.invocations.main) execution.invocations.main = compact(main);
  writeFileSync(join(dir, 'execution.json'), JSON.stringify(execution, null, 2) + '\n');

  const reportPath = join(dir, 'results.json');
  let report = null;
  if (existsSync(reportPath)) { try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; } }
  if (report && main.state !== 'interrupted') return execution;
  // notRun means no Playwright invocation started at all. A main suite that never started after another invocation ran
  // (the proxy suite, before ci.sh stopped) has no cases and says so through execution.invocations.main.state alone.
  const nothingStarted = Object.values(execution.invocations).every((s) => s.state === 'not-started');
  const truthful = report ? { ...report, execution }
    : main.state !== 'not-started' ? adaptReport(main, execution)
    : nothingStarted ? { notRun: true, suites: [], execution }
    : { suites: [], execution };
  writeFileSync(reportPath, JSON.stringify(truthful, null, 2) + '\n');
  return execution;
}

// node scripts/playwright-journal.mjs <report-dir>
// The real path: a CI step reached through a symlink must still run, never pass silently.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: playwright-journal.mjs <report-dir>'); process.exit(2); }
  const { invocations } = finalize(dir);
  for (const [name, s] of Object.entries(invocations)) {
    console.log(`${name}: ${s.state}${s.endStatus ? ` (${s.endStatus})` : ''}, selected ${s.selected ?? 'unknown'}, final ${JSON.stringify(s.outcomes)}, unknown ${JSON.stringify(s.unknown)}, selected but never recorded by name ${s.unrecordedSelected ?? 'unknown'}, malformed ${s.malformed}`);
  }
}
