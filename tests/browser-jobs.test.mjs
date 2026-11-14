import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { secondJobFiles } from './browser-jobs.mjs';

// CI splits the browser suite across two integration jobs (#74). Playwright lists the files of each job with the real
// config, as CI selects them, so a spec file can be neither lost between the jobs nor run by both.
function list(job, args = []) {
  const env = { ...process.env, NODE_TEST_CONTEXT: undefined };
  if (job === undefined) delete env.GTMWORKS_BROWSER_JOB; else env.GTMWORKS_BROWSER_JOB = job;
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json', ...args], { encoding: 'utf8', env, timeout: 60000 });
  if (result.status !== 0) return { status: result.status, output: result.stdout + result.stderr };
  const files = {};
  const walk = suites => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const t of spec.tests) (files[t.projectName] ??= new Set()).add(spec.file);
      walk(suite.suites);
    }
  };
  walk(JSON.parse(result.stdout).suites);
  return { status: 0, files: Object.fromEntries(Object.entries(files).map(([project, set]) => [project, [...set].sort()])) };
}

test('the two jobs together run every functional file exactly once', () => {
  const all = list(undefined).files;
  const first = list('1').files;
  const second = list('2').files;
  assert.ok(first.functional.length > 0 && second.functional.length > 0);
  assert.deepEqual(first.functional.filter(file => second.functional.includes(file)), []);
  assert.deepEqual([...first.functional, ...second.functional].sort(), all.functional);
});

test('the first job keeps the screens, the navigation budgets and first run, as a run without the split has them', () => {
  const all = list(undefined).files;
  const first = list('1').files;
  for (const project of ['visual', 'measured', 'first-run']) {
    assert.ok(all[project]?.length, project);
    assert.deepEqual(first[project], all[project], project);
  }
});

test('the second job runs only functional files, whatever projects it is asked for', () => {
  const second = list('2');
  assert.deepEqual(Object.keys(second.files), ['functional']);
  assert.deepEqual(second.files.functional, [...secondJobFiles].sort());
});

test('the second job names only functional spec files that exist', () => {
  assert.equal(new Set(secondJobFiles).size, secondJobFiles.length);
  for (const file of secondJobFiles) {
    assert.ok(existsSync(`tests/${file}`), file);
    assert.ok(!['visual.spec.ts', 'navigation.spec.ts', 'first-run.spec.ts'].includes(file), file);
  }
});

test('an unknown job is refused instead of running a part of the suite', () => {
  const { status, output } = list('3');
  assert.notEqual(status, 0);
  assert.match(output, /GTMWORKS_BROWSER_JOB/);
});
