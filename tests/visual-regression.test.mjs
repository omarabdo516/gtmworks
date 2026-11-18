import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { failures, regressionIssue } from '../scripts/visual-regression.mjs';

// When the visual job fails on main, one issue labelled visual-regression names what failed and links the run's
// difference images (#257): a picture that differs, a lane check (a guard, a contrast measure) or a navigation budget,
// each under its own heading. No pull request waits for it.
const spec = (title, ok, line = 1, message = 'Error: expect(page).toHaveScreenshot(expected) failed') =>
  ({ title, ok, line, tests: [{ results: [ok ? { status: 'passed' } : { status: 'failed', error: { message } }] }] });
const lane = {
  suites: [{ title: 'visual-lane.spec.ts', file: 'visual-lane.spec.ts', specs: [], suites: [
    { title: 'home', file: 'visual-lane.spec.ts', specs: [spec('home 1440 light', false, 164), spec('home 390 dark', true, 164)], suites: [] },
    { title: 'card', file: 'visual-lane.spec.ts', specs: [spec('card 1440 light', false, 164, 'Error: this picture would not be the same on the next run: font "X" did not load')] },
  ] }],
};
const budgets = { suites: [{ title: 'navigation.spec.ts', file: 'navigation.spec.ts', specs: [spec('board opens within its budget', false, 12, 'Error: expect(received).toBeLessThan(expected)')] }] };
const run = { sha: 'abc1234def', runUrl: 'https://github.com/o/r/actions/runs/1', artifactUrl: 'https://github.com/o/r/actions/runs/1/artifacts/9' };
function folderOf(t, reports) {
  const folder = mkdtempSync(join(tmpdir(), 'gtmworks-visual-regression-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [name, report] of Object.entries(reports)) writeFileSync(join(folder, name), JSON.stringify(report));
  return folder;
}
const cli = (folder, ...flags) => execFileSync(process.execPath, [resolve('scripts/visual-regression.mjs'), ...flags, folder, run.sha, run.runUrl, run.artifactUrl], { encoding: 'utf8' });

test('a failed picture is a screen that differs, any other failed lane test is a check, and passed tests are not named', () => {
  assert.deepEqual(failures(lane), [
    { name: 'home › home 1440 light (visual-lane.spec.ts:164)', screen: true },
    { name: 'card › card 1440 light (visual-lane.spec.ts:164)', screen: false },
  ]);
  assert.deepEqual(failures({ suites: [] }), []);
  const missing = { suites: [{ title: 'visual-lane.spec.ts', file: 'visual-lane.spec.ts', specs: [spec('reports 1440 light', false, 164, "Error: A snapshot doesn't exist at tests/visual-lane/images/reports-ar-1440-light.png, writing actual.")] }] };
  assert.deepEqual(failures(missing), [{ name: 'reports 1440 light (visual-lane.spec.ts:164)', screen: true }]);
});

test('the issue names the screens and the checks under their own headings, with the commit, the run and the images', () => {
  const issue = regressionIssue({ ...run, screens: ['home › home 1440 light (visual-lane.spec.ts:164)'], checks: ['card › card 1440 light (visual-lane.spec.ts:164)'], budgets: [] });
  assert.equal(issue.title, 'Compared screens differ on main');
  assert.match(issue.body, /These screens differ from their approved images:\n- home › home 1440 light/);
  assert.match(issue.body, /These lane checks failed \(guards, contrast\):\n- card › card 1440 light/);
  assert.match(issue.body, /abc1234def/);
  assert.match(issue.body, /\/artifacts\/9/);
  assert.match(issue.body, /actions\/runs\/1\b/);
});

test('with no screen that differs, the title says the visual job failed', () => {
  assert.equal(regressionIssue({ ...run, screens: [], checks: [], budgets: ['board opens within its budget (navigation.spec.ts:12)'] }).title, 'The visual job failed on main');
  assert.equal(regressionIssue({ ...run, screens: [], checks: ['card'], budgets: [] }).title, 'The visual job failed on main');
});

test('the command line reads the lane and the budgets from the ledger folder, and prints the title on its own when asked', t => {
  const folder = folderOf(t, { 'lane.json': lane, 'measured.json': budgets });
  const body = cli(folder);
  assert.match(body, /These screens differ from their approved images:\n- home › home 1440 light/);
  assert.match(body, /These lane checks failed \(guards, contrast\):\n- card › card 1440 light/);
  assert.match(body, /These navigation budgets failed:\n- board opens within its budget \(navigation\.spec\.ts:12\)/);
  assert.equal(cli(folder, '--title').trim(), 'Compared screens differ on main');
  assert.equal(cli(folderOf(t, { 'measured.json': budgets }), '--title').trim(), 'The visual job failed on main');
});

test('a run that failed before writing any report still prints the issue', t => {
  const missing = join(folderOf(t, {}), 'never-written');
  const body = cli(missing);
  assert.match(body, /Nothing was compared: the run failed before or around the tests/);
  assert.match(body, /actions\/runs\/1\b/);
  assert.equal(cli(missing, '--title').trim(), 'The visual job failed on main');
});
