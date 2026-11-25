import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { failures, regressionIssue } from '../scripts/budget-regression.mjs';

// When the navigation budgets fail on main, one issue labelled budget-regression names each budget that failed, the
// commit and the run (#224, #805). No pull request waits for it.
const spec = (title, ok, line = 1) =>
  ({ title, ok, line, tests: [{ results: [ok ? { status: 'passed' } : { status: 'failed', error: { message: 'Error: expect(received).toBeLessThan(expected)' } }] }] });
const report = { suites: [{ title: 'navigation.spec.ts', file: 'navigation.spec.ts', specs: [spec('home opens', true, 8)], suites: [
  { title: 'board', file: 'navigation.spec.ts', specs: [spec('board opens within its budget', false, 12)], suites: [] },
] }] };
const run = { sha: 'abc1234def', runUrl: 'https://github.com/o/r/actions/runs/1' };
function reportFile(t, contents) {
  const folder = mkdtempSync(join(tmpdir(), 'gtmworks-budget-regression-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'measured.json');
  if (contents !== undefined) writeFileSync(file, contents);
  return file;
}
const cli = (file, ...flags) => execFileSync(process.execPath, [resolve('scripts/budget-regression.mjs'), ...flags, file, run.sha, run.runUrl], { encoding: 'utf8' });

test('every failed budget is named with its block, file and line, and a passed one is not', () => {
  assert.deepEqual(failures(report), ['board › board opens within its budget (navigation.spec.ts:12)']);
  assert.deepEqual(failures({ suites: [] }), []);
});

test('the issue names the failed budgets, the commit and the run', () => {
  const issue = regressionIssue({ ...run, budgets: ['board opens within its budget (navigation.spec.ts:12)'] });
  assert.equal(issue.title, 'The navigation budgets failed on main');
  assert.match(issue.body, /These budgets failed:\n- board opens within its budget \(navigation\.spec\.ts:12\)/);
  assert.match(issue.body, /abc1234def/);
  assert.match(issue.body, /actions\/runs\/1\b/);
});

test('the command line reads the report and prints the title on its own when asked', t => {
  const file = reportFile(t, JSON.stringify(report));
  assert.match(cli(file), /These budgets failed:\n- board › board opens within its budget \(navigation\.spec\.ts:12\)/);
  assert.equal(cli(file, '--title').trim(), 'The navigation budgets failed on main');
});

test('a report with no failed budget says the run failed around the tests', t => {
  assert.match(cli(reportFile(t, JSON.stringify({ suites: [] }))), /Every budget measured passed: the run failed around the tests/);
});

test('a run that wrote no report, or one that cannot be read, still prints the issue', t => {
  for (const file of [reportFile(t), reportFile(t, '{not json')]) {
    const body = cli(file);
    assert.match(body, /No budget was measured: the run failed before the tests wrote their report/);
    assert.match(body, /actions\/runs\/1\b/);
  }
});
