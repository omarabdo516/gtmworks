import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// The real playwright.config.ts runs in a sandbox with stand-in specs and no web server, so the order and the
// skip rules of its projects (functional, then measured alone, then first run) are observed through Playwright itself, as CI runs them (CI=true: one retry).
function sandbox(t, { functional, firstRun = true, measured }) {
 const output = resolve('test-results');
 mkdirSync(output, { recursive: true });
 const dir = mkdtempSync(join(output, 'projects-'));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 copyFileSync('package.json', join(dir, 'package.json'));
 // tests/lane.mjs, which the config imports, reads the stack's ports from the repository root's Supabase config.
 mkdirSync(join(dir, 'supabase'));
 copyFileSync('supabase/config.toml', join(dir, 'supabase/config.toml'));
 symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
 mkdirSync(join(dir, 'tests'));
 writeFileSync(join(dir, 'playwright.config.ts'), `import base from ${JSON.stringify(resolve('playwright.config.ts'))};
export default { ...base, webServer: undefined, reporter: [['json', { outputFile: 'report.json' }]] };
`);
 const spec = (name, passes) => `import { test, expect } from '@playwright/test';
test('${name} first', async () => { await new Promise(r => setTimeout(r, 30)); expect(${passes}).toBe(true); });
test('${name} second', async () => { await new Promise(r => setTimeout(r, 30)); });
`;
 writeFileSync(join(dir, 'tests/board.spec.ts'), spec('board', functional));
 writeFileSync(join(dir, 'tests/first-run.spec.ts'), spec('empty install', firstRun));
 if (measured !== undefined) writeFileSync(join(dir, 'tests/navigation.spec.ts'), spec('navigation budget', measured));
 return dir;
}

// `npm` runs the package scripts itself: `npx npm` would download npm from the registry (#266).
const run = async (dir, args, env = {}) => {
 // Playwright's own CLI straight from node, as scripts/check-test-discovery.mjs runs it; npm scripts through npm.
 const [command, ...rest] = args[0] === 'playwright' ? [process.execPath, resolve('node_modules/@playwright/test/cli.js'), ...args.slice(1)] : args;
 const child = spawn(command, rest, { cwd: dir, timeout: 60000, env: { ...process.env, CI: 'true', NODE_TEST_CONTEXT: undefined, GTMWORKS_HOSTED_ELSEWHERE: undefined, ...env } });
 let output = '';
 child.stdout.on('data', chunk => { output += chunk; });
 child.stderr.on('data', chunk => { output += chunk; });
 const status = await new Promise(done => child.on('close', code => done(code)));
 // A run killed by its time limit writes no report: say so, with what it printed, rather than fail on the missing file.
 assert.ok(existsSync(join(dir, 'report.json')), `playwright ${args.join(' ')} ended (${status ?? 'killed'}) with no report:\n${output}`);
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
 return { status, output, results };
};

// Each case has a sandbox of its own, so three run at a time beside the other fast steps; each still reads the order
// inside its own run.
describe('the Playwright projects', { concurrency: 3 }, () => {
 const ends = (results, project) => Math.max(...results.filter(r => r.project === project).map(r => r.end));
 const starts = (results, project) => Math.min(...results.filter(r => r.project === project).map(r => r.start));
 const count = (results, project) => results.filter(r => r.project === project).length;

 test('a failed functional test skips nothing after it: measured and first run still run, and the run fails', async t => {
  const { status, results, output } = await run(sandbox(t, { functional: false, measured: true }), ['playwright', 'test']);
  assert.notEqual(status, 0, output);
  assert.ok(results.some(r => r.project === 'functional' && r.title === 'board first' && r.status === 'failed'), output);
  assert.ok(results.some(r => r.project === 'functional' && r.title === 'board second' && r.status === 'passed'), output);
  assert.equal(count(results, 'measured'), 2, output);
  assert.equal(count(results, 'first-run'), 2, output);
 });

 test('the empty-install tests run last, after every functional test and retry, also when one failed', async t => {
  const dir = sandbox(t, { functional: false });
  const { status, results, output } = await run(dir, ['playwright', 'test']);
  assert.notEqual(status, 0, output);
  assert.equal(count(results, 'functional'), 3, output); // the failing test ran twice: CI retries once
  assert.equal(count(results, 'first-run'), 2, output);
  assert.ok(ends(results, 'functional') <= starts(results, 'first-run'), output);
 });

 test('the run passes only when every group passes', async t => {
  const green = await run(sandbox(t, { functional: true, measured: true }), ['playwright', 'test']);
  assert.equal(green.status, 0, green.output);
  assert.equal(green.results.length, 6, green.output);
  assert.notEqual((await run(sandbox(t, { functional: false }), ['playwright', 'test'])).status, 0);
  assert.notEqual((await run(sandbox(t, { functional: true, firstRun: false }), ['playwright', 'test'])).status, 0);
 });

 test('one project alone runs only itself', async t => {
  const dir = sandbox(t, { functional: true, measured: true });
  for (const project of ['functional', 'first-run']) {
   const { results, output } = await run(dir, ['playwright', 'test', `--project=${project}`]);
   assert.deepEqual([...new Set(results.map(r => r.project))], [project], output);
  }
  const { results, output } = await run(dir, ['playwright', 'test', '--project=measured', '--no-deps']);
  assert.deepEqual([...new Set(results.map(r => r.project))], ['measured'], output);
 });

 test('the measured budgets are left empty where they run elsewhere, and the other groups keep their order', async t => {
  const dir = sandbox(t, { functional: true, measured: true });
  const { status, results, output } = await run(dir, ['playwright', 'test'], { GTMWORKS_HOSTED_ELSEWHERE: 'true' });
  assert.equal(status, 0, output);
  assert.equal(count(results, 'measured'), 0, output);
  assert.ok(ends(results, 'functional') <= starts(results, 'first-run'), output);
 });

 test('the navigation time budgets run alone after every functional test and before first run, and hide no failure', async t => {
  for (const [functional, measured] of [[true, true], [false, true], [true, false]]) {
   const { status, results, output } = await run(sandbox(t, { functional, measured }), ['playwright', 'test']);
   assert.equal(status === 0, functional && measured, output);
   assert.equal(count(results, 'measured'), measured ? 2 : 3, output); // a failing budget ran twice: CI retries once
   assert.equal(count(results, 'first-run'), 2, output);
   assert.ok(ends(results, 'functional') <= starts(results, 'measured'), output);
   assert.ok(ends(results, 'measured') <= starts(results, 'first-run'), output);
  }
 });
});

// The real config and specs, listed and never run: --list starts no web server.
const list = (args, ci) => {
 const env = { ...process.env, NODE_TEST_CONTEXT: undefined, GTMWORKS_HOSTED_ELSEWHERE: 'true' };
 if (ci) env.CI = 'true'; else delete env.CI;
 const child = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '--list', '--reporter=json', ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
 assert.equal(child.status, 0, child.stderr);
 return JSON.parse(child.stdout);
};
const listed = report => {
 const ids = [];
 const walk = suites => { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) for (const t of spec.tests) ids.push(`${t.projectName} ${spec.file} ${spec.title}`); walk(suite.suites); } };
 walk(report.suites);
 return ids;
};

test('the real config retries a failed browser test once on CI and never locally', () => {
 for (const [ci, retries] of [[true, 1], [false, 0]]) {
  const { config } = list([], ci);
  assert.ok(config.projects.length > 0);
  for (const project of config.projects) assert.equal(project.retries, retries, `${project.name} CI=${ci}`);
 }
});

// CI runs the browser suite as --shard=<i>/3 (#335): together the three shards list every test exactly once.
test('the three shards together run every browser test exactly once (#335, #319)', () => {
 const whole = listed(list([], true)).sort();
 assert.ok(whole.length > 0);
 const shards = [1, 2, 3].map(shard => listed(list([`--shard=${shard}/3`], true)));
 for (const shard of shards) assert.ok(shard.length > 0, 'every shard has tests');
 assert.deepEqual(shards.flat().sort(), whole);
});
