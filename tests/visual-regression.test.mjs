import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { failedTests, regressionIssue } from '../scripts/visual-regression.mjs';

// When the compared screens fail on main, one issue labelled visual-regression names each failed screen and links the
// run's difference images (#257). No pull request waits for it.
const spec = (title, ok, line = 1) => ({ title, ok, line, tests: [{ results: [{ status: ok ? 'passed' : 'failed' }] }] });
const report = {
  suites: [{ title: 'visual-lane.spec.ts', file: 'visual-lane.spec.ts', specs: [], suites: [
    { title: 'signed-in screens', file: 'visual-lane.spec.ts', specs: [spec('home ar 1440', false, 659), spec('board ar 1440', true, 659)], suites: [] },
    { title: 'anonymous screens', file: 'visual-lane.spec.ts', specs: [spec('sign-in en 390', false, 598)] },
  ] }],
};

test('every failed screen is named with its describe block and line, and passed ones are not', () => {
  assert.deepEqual(failedTests(report), ['signed-in screens › home ar 1440 (visual-lane.spec.ts:659)', 'anonymous screens › sign-in en 390 (visual-lane.spec.ts:598)']);
  assert.deepEqual(failedTests({ suites: [] }), []);
});

test('the issue names the screens, the commit, the run and the difference images', () => {
  const issue = regressionIssue({ failed: failedTests(report), sha: 'abc1234def', runUrl: 'https://github.com/o/r/actions/runs/1', artifactUrl: 'https://github.com/o/r/actions/runs/1/artifacts/9' });
  assert.equal(issue.title, 'Compared screens differ on main');
  assert.match(issue.body, /- signed-in screens › home ar 1440 \(visual-lane\.spec\.ts:659\)/);
  assert.match(issue.body, /- anonymous screens › sign-in en 390/);
  assert.match(issue.body, /abc1234def/);
  assert.match(issue.body, /https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/9/);
  assert.match(issue.body, /https:\/\/github\.com\/o\/r\/actions\/runs\/1\b/);
});

test('a failure with no failed screen (the stack, the build) still opens the issue and says to read the run', () => {
  const issue = regressionIssue({ failed: [], sha: 'abc', runUrl: 'https://run', artifactUrl: '' });
  assert.match(issue.body, /No screen comparison failed/);
  assert.match(issue.body, /https:\/\/run/);
});

test('the command line reads every Playwright report in a folder and prints the body', t => {
  const folder = mkdtempSync(join(tmpdir(), 'gtmworks-visual-regression-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'screens.json'), JSON.stringify(report));
  writeFileSync(join(folder, 'meta.json'), '{"layer":"visual"}');
  const body = execFileSync(process.execPath, [resolve('scripts/visual-regression.mjs'), folder, 'abc', 'https://run', 'https://artifact'], { encoding: 'utf8' });
  assert.match(body, /home ar 1440/);
  assert.match(body, /https:\/\/artifact/);
});

test('a navigation budget that failed is named as a budget, not as a screen that differs', t => {
  const folder = mkdtempSync(join(tmpdir(), 'gtmworks-visual-regression-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const budgets = { suites: [{ title: 'navigation.spec.ts', file: 'navigation.spec.ts', specs: [spec('board opens within its budget', false, 12)] }] };
  writeFileSync(join(folder, 'measured.json'), JSON.stringify(budgets));
  const body = execFileSync(process.execPath, [resolve('scripts/visual-regression.mjs'), folder, 'abc', 'https://run', 'https://artifact'], { encoding: 'utf8' });
  assert.match(body, /navigation budgets failed:\n- board opens within its budget \(navigation\.spec\.ts:12\)/i);
  assert.doesNotMatch(body, /differ from their approved images/);
});

