import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

// A flaky browser test may be set aside for 7 days at most, with an issue (#336, decision 0036). It is skipped with
// Playwright's own skip (test.fixme or test.skip) and named in tests/set-aside.json; a sign-in or Company isolation
// test is never set aside. Those are the cases whose "stays" row in docs/testing.md's case by case table names
// sign-in or isolation, and any case of a spec whose file name does.
const day = 24 * 60 * 60 * 1000;
const protectedWords = /sign-in|isolation/i;

function skippedCases(config) {
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', config, '--list', '--reporter=json'], { encoding: 'utf8' });
  const list = JSON.parse(run.stdout);
  assert.deepEqual((list.errors ?? []).map(error => error.message), [], `${config}: playwright --list reported errors`);
  assert.equal(run.status, 0, `${config}: playwright --list exited ${run.status}: ${run.stderr}`);
  const cases = [];
  const walk = (suites, outer) => {
    for (const suite of suites) {
      const path = suite.file && suite.title === suite.file ? outer : [...outer, suite.title];
      for (const spec of suite.specs ?? []) {
        if (spec.tests.some(item => item.expectedStatus === 'skipped')) cases.push(`${spec.file} › ${[...path, spec.title].join(' › ')}`);
      }
      walk(suite.suites ?? [], path);
    }
  };
  walk(list.suites, []);
  return cases;
}

export function setAsideProblems({ entries, skipped, doc, today }) {
  const problems = [];
  const sensitive = new Set([...doc.matchAll(/^\| `([\w/-]+\.spec\.ts)` "(.+)" \| stays \| ([^\n]*)$/gm)]
    .filter(([, , , why]) => protectedWords.test(why))
    .map(([, file, title]) => `${file} › ${title.replaceAll('\\|', '|')}`));
  const listed = entries.map(entry => `${entry.file} › ${entry.title}`);
  for (const [index, entry] of entries.entries()) {
    const name = listed[index];
    if (!Number.isInteger(entry.issue) || entry.issue <= 0) problems.push(`${name}: names no issue`);
    const since = Date.parse(`${entry.since}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.since ?? '') || Number.isNaN(since)) problems.push(`${name}: no date it was set aside`);
    else if (Math.floor((Date.parse(`${today}T00:00:00Z`) - since) / day) > 7) problems.push(`${name}: set aside on ${entry.since}, more than 7 days ago`);
    if (protectedWords.test(entry.file ?? '') || sensitive.has(name)) problems.push(`${name}: a sign-in or Company isolation test is never set aside`);
    if (!skipped.includes(name)) problems.push(`${name}: listed but not skipped`);
  }
  for (const name of skipped) if (!listed.includes(name)) problems.push(`${name}: skipped but not listed`);
  return problems;
}

const doc = '| `password.spec.ts` "a wrong password is refused" | stays | Sign-in: the server refuses it. |\n'
  + '| `channels.spec.ts` "a Member of another Company sees no channel" | stays | Company isolation through the server. |\n'
  + '| `numbers.spec.ts` "Numbers keeps its title" | stays | Only the page itself. |\n';
const entry = (since, more = {}) => ({ file: 'numbers.spec.ts', title: 'Numbers keeps its title', issue: 305, since, ...more });
const check = (entries, skipped = entries.map(item => `${item.file} › ${item.title}`)) => setAsideProblems({ entries, skipped, doc, today: '2026-11-18' });

test('an entry set aside 6 or 7 days ago passes, and one set aside 8 days ago turns the guard red', () => {
  assert.deepEqual(check([entry('2026-11-12')]), []);
  assert.deepEqual(check([entry('2026-11-11')]), []);
  assert.deepEqual(check([entry('2026-11-10')]), ['numbers.spec.ts › Numbers keeps its title: set aside on 2026-11-10, more than 7 days ago']);
  assert.deepEqual(check([entry('soon')]), ['numbers.spec.ts › Numbers keeps its title: no date it was set aside']);
});

test('an entry with no issue, or naming a sign-in or Company isolation test, turns the guard red', () => {
  assert.deepEqual(check([entry('2026-11-17', { issue: undefined })]), ['numbers.spec.ts › Numbers keeps its title: names no issue']);
  assert.deepEqual(check([entry('2026-11-17', { issue: '#305' })]), ['numbers.spec.ts › Numbers keeps its title: names no issue']);
  for (const [file, title] of [['password.spec.ts', 'a wrong password is refused'], ['channels.spec.ts', 'a Member of another Company sees no channel'], ['company-sign-in.spec.ts', 'any case']]) {
    assert.deepEqual(check([entry('2026-11-17', { file, title })]), [`${file} › ${title}: a sign-in or Company isolation test is never set aside`]);
  }
});

test('every listed test is skipped, and every skipped test is listed', () => {
  assert.deepEqual(check([entry('2026-11-17')], []), ['numbers.spec.ts › Numbers keeps its title: listed but not skipped']);
  assert.deepEqual(check([], ['numbers.spec.ts › Numbers keeps its title']), ['numbers.spec.ts › Numbers keeps its title: skipped but not listed']);
});

test('the set-aside list matches the browser tests Playwright skips, each with an issue, under 7 days and never sign-in or isolation', () => {
  const skipped = [...new Set(readdirSync('.').filter(name => /^playwright(\.[a-z]+)?\.config\.[cm]?[jt]s$/.test(name)).flatMap(skippedCases))];
  const problems = setAsideProblems({
    entries: JSON.parse(readFileSync('tests/set-aside.json', 'utf8')),
    skipped,
    doc: readFileSync('docs/testing.md', 'utf8'),
    today: new Date().toISOString().slice(0, 10),
  });
  assert.deepEqual(problems, []);
});
