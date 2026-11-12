import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// The real playwright.config.ts runs in a sandbox with stand-in specs and no web server, so the order and the
// skip rules of its two projects are observed through Playwright itself, as CI runs them (CI=true: one retry).
function sandbox(t, { visual, functional, firstRun = true }) {
 const output = resolve('test-results');
 mkdirSync(output, { recursive: true });
 const dir = mkdtempSync(join(output, 'projects-'));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 copyFileSync('package.json', join(dir, 'package.json'));
 symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
 mkdirSync(join(dir, 'tests'));
 writeFileSync(join(dir, 'playwright.config.ts'), `import base from ${JSON.stringify(resolve('playwright.config.ts'))};
export default { ...base, webServer: undefined, reporter: [['json', { outputFile: 'report.json' }]] };
`);
 const spec = (name, passes) => `import { test, expect } from '@playwright/test';
test('${name} first', async () => { await new Promise(r => setTimeout(r, 30)); expect(${passes}).toBe(true); });
test('${name} second', async () => { await new Promise(r => setTimeout(r, 30)); });
`;
 writeFileSync(join(dir, 'tests/visual.spec.ts'), spec('screen', visual));
 writeFileSync(join(dir, 'tests/board.spec.ts'), spec('board', functional));
 writeFileSync(join(dir, 'tests/first-run.spec.ts'), spec('empty install', firstRun));
 return dir;
}

const run = (dir, args) => {
 const result = spawnSync('npx', args, {
  cwd: dir, encoding: 'utf8', timeout: 60000,
  env: { ...process.env, CI: 'true', NODE_TEST_CONTEXT: undefined },
 });
 const output = result.stdout + result.stderr;
 const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
 rmSync(join(dir, 'report.json'));
 const results = [];
 const walk = suites => {
  for (const suite of suites ?? []) {
   for (const spec of suite.specs ?? []) for (const t of spec.tests) for (const r of t.results) {
    const start = Date.parse(r.startTime);
    results.push({ project: t.projectName, title: spec.title, status: r.status, start, end: start + r.duration });
   }
   walk(suite.suites);
  }
 };
 walk(report.suites);
 return { status: result.status, output, results };
};

test('a failed screen comparison does not skip the functional tests, and both failures are reported', t => {
 const dir = sandbox(t, { visual: false, functional: false });
 const { status, results, output } = run(dir, ['playwright', 'test']);
 assert.notEqual(status, 0, output);
 const failed = results.filter(r => r.status === 'failed').map(r => `${r.project} ${r.title}`);
 assert.ok(failed.includes('visual screen first'), output);
 assert.ok(failed.includes('functional board first'), output);
 assert.ok(results.some(r => r.project === 'functional' && r.title === 'board second' && r.status === 'passed'), output);
});

const ends = (results, project) => Math.max(...results.filter(r => r.project === project).map(r => r.end));
const starts = (results, project) => Math.min(...results.filter(r => r.project === project).map(r => r.start));
const count = (results, project) => results.filter(r => r.project === project).length;

test('every screen comparison, its retry included, ends before the first functional test starts', t => {
 const dir = sandbox(t, { visual: false, functional: true });
 const { status, results, output } = run(dir, ['playwright', 'test']);
 assert.notEqual(status, 0, output);
 assert.equal(count(results, 'visual'), 3, output); // the failing comparison ran twice: CI retries once
 assert.equal(count(results, 'functional'), 2, output);
 assert.ok(ends(results, 'visual') <= starts(results, 'functional'), output);
});

test('the empty-install tests run last, after every functional test and retry, also when one failed', t => {
 const dir = sandbox(t, { visual: true, functional: false });
 const { status, results, output } = run(dir, ['playwright', 'test']);
 assert.notEqual(status, 0, output);
 assert.equal(count(results, 'functional'), 3, output);
 assert.equal(count(results, 'first-run'), 2, output);
 assert.ok(ends(results, 'visual') <= starts(results, 'functional'), output);
 assert.ok(ends(results, 'functional') <= starts(results, 'first-run'), output);
});

test('the run passes only when every group passes', t => {
 const green = run(sandbox(t, { visual: true, functional: true }), ['playwright', 'test']);
 assert.equal(green.status, 0, green.output);
 assert.equal(green.results.length, 6, green.output);
 assert.notEqual(run(sandbox(t, { visual: true, functional: false }), ['playwright', 'test']).status, 0);
 assert.notEqual(run(sandbox(t, { visual: true, functional: true, firstRun: false }), ['playwright', 'test']).status, 0);
});

test('the screen-only commands run only screens, and one project alone runs only itself', t => {
 const dir = sandbox(t, { visual: true, functional: true });
 for (const script of ['test:visual', 'test:visual:update']) {
  const { status, results, output } = run(dir, ['npm', 'run', script]);
  assert.equal(status, 0, output);
  assert.deepEqual([...new Set(results.map(r => r.project))], ['visual'], `${script}: ${output}`);
 }
 for (const project of ['functional', 'first-run']) {
  const { results, output } = run(dir, ['playwright', 'test', `--project=${project}`]);
  assert.deepEqual([...new Set(results.map(r => r.project))], [project], output);
 }
});
