#!/usr/bin/env node
// The browser suite's shards, split by measured time (#653). Playwright's own --shard cuts the suite into runs of equal
// test counts in file order, so the slow conversation and Engine files, side by side in that order, all fell to one
// shard, which ran out its 12 minutes while the others finished in 8. Here every spec file goes whole to one shard, the
// slowest file first, to the shard it lengthens least, each shard's length worked out as Playwright runs it: its files
// in file order, each to the first free worker; a file's tests one after another on one worker, unless the file runs in
// parallel mode, when each test takes a worker of its own; and the first-run files only after every other file.
//
//   node scripts/browser-shards.mjs 3/6            the spec files of shard 3 of 6, one per line (ci.sh integration)
//   node scripts/browser-shards.mjs times <report.json>...
//                                                  writes tests/browser-shard-times.json from Playwright JSON reports
//
// The times are each file's seconds summed over its tests and their retries; a file with none counts as the middle
// measured one. Refresh them from a main run's `browser-times-<i>` artifacts (each shard's `times.json`) when the
// shards drift apart.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TIMES = 'tests/browser-shard-times.json';

// A spec file: its name, its number of tests, whether they run in parallel mode, and whether it is a first-run file,
// run after every other file. A bare name is one file of one test, run in order.
const fileOf = spec => (typeof spec === 'string' ? { file: spec, tests: 1, parallel: false, firstRun: false } : spec);

// How long a shard of these files runs on `workers` workers.
export function shardSeconds(files, seconds, workers) {
  let length = 0;
  for (const firstRun of [false, true]) {
    const free = Array(workers).fill(0);
    const jobs = files.filter(spec => spec.firstRun === firstRun).sort((a, b) => a.file.localeCompare(b.file))
      .flatMap(spec => (spec.parallel ? Array(spec.tests).fill(seconds(spec) / spec.tests) : [seconds(spec)]));
    for (const job of jobs) free[free.indexOf(Math.min(...free))] += job;
    length += Math.max(...free);
  }
  return length;
}

// The spec files in `count` shards for `workers` workers each, each shard's names in file order. The same files and
// times give the same split.
export function shardFiles(specs, times, count, workers = 1) {
  const known = Object.values(times).sort((a, b) => a - b);
  const middle = known.length ? known[Math.floor((known.length - 1) / 2)] : 1;
  const seconds = spec => times[spec.file] ?? middle;
  const files = [...new Map(specs.map(fileOf).map(spec => [spec.file, spec])).values()]
    .sort((a, b) => seconds(b) - seconds(a) || a.file.localeCompare(b.file));
  const shards = Array.from({ length: count }, () => []);
  for (const spec of files) {
    const lengths = shards.map(shard => shardSeconds([...shard, spec], seconds, workers));
    shards[lengths.indexOf(Math.min(...lengths))].push(spec);
  }
  return shards.map(shard => shard.map(spec => spec.file).sort());
}

// Every spec of a Playwright JSON report (or list) with its file's name: the browser specs all sit directly in tests/.
function eachSpec(report, use) {
  const visit = suite => {
    for (const spec of suite.specs ?? []) use(spec.file.replace(/^.*\//, ''), spec);
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
}

// Each spec file's seconds from Playwright JSON reports: every result of every test, retries included, as the shard
// spends them.
export function measuredTimes(reports) {
  const times = {};
  for (const report of reports) eachSpec(report, (file, spec) => {
    for (const run of spec.tests ?? []) for (const result of run.results ?? []) times[file] = (times[file] ?? 0) + result.duration / 1000;
  });
  return Object.fromEntries(Object.entries(times).sort(([a], [b]) => a.localeCompare(b)).map(([file, s]) => [file, Math.max(1, Math.round(s))]));
}

// The spec files the browser suite runs where the shards do, as Playwright lists them.
function suiteFiles() {
  const list = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GTMWORKS_HOSTED_ELSEWHERE: 'true' } });
  const files = new Map();
  eachSpec(JSON.parse(list), (file, spec) => {
    const entry = files.get(file) ?? { file, tests: 0, parallel: /describe\.configure\(\s*\{[^}]*\bmode\s*:\s*['"]parallel['"]/.test(readFileSync(`tests/${file}`, 'utf8')), firstRun: false };
    entry.tests += spec.tests.length;
    entry.firstRun ||= spec.tests.some(run => run.projectName === 'first-run');
    files.set(file, entry);
  });
  return [...files.values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arg, ...rest] = process.argv.slice(2);
  if (arg === 'times') {
    if (!rest.length) throw new Error('times needs one or more Playwright JSON reports');
    writeFileSync(TIMES, `${JSON.stringify(measuredTimes(rest.map(path => JSON.parse(readFileSync(path, 'utf8')))), null, 2)}\n`);
  } else {
    const match = /^(\d+)\/(\d+)$/.exec(arg ?? '');
    const [current, total] = match ? [Number(match[1]), Number(match[2])] : [];
    if (!match || current < 1 || current > total) {
      console.error('usage: node scripts/browser-shards.mjs <current>/<total> | times <report.json>...');
      process.exit(2);
    }
    const workers = Number(process.env.GTMWORKS_TEST_LANES || 1);
    const times = JSON.parse(readFileSync(TIMES, 'utf8'));
    for (const file of shardFiles(suiteFiles(), times, total, workers)[current - 1]) console.log(`tests/${file}`);
  }
}
