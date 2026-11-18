import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// #338: a browser case that checked only the server moved to the database or node tests. tests/moved-tests.json names
// each moved case and its new homes: a home is a file and the name of one test in it, written as the test names itself
// (a pgTAP description or a node test title, in quotes). The guard turns red when a home is gone or the case is back.
const unquote = (file, text) => (file.endsWith('.sql') ? text.replaceAll("''", "'") : text.replaceAll("\\'", "'"));

export function moveProblems({ moved, listed, read }) {
  const problems = [];
  for (const entry of moved) {
    const name = `${entry.file} › ${entry.title}`;
    if (listed.includes(name)) problems.push(`${name}: moved but still in the browser suite`);
    if (!entry.homes?.length) problems.push(`${name}: names no new home`);
    for (const home of entry.homes ?? []) {
      const text = read(home.file);
      if (text === undefined) problems.push(`${name}: its home ${home.file} does not exist`);
      else if (!unquote(home.file, text).includes(`'${home.test}'`)) problems.push(`${name}: ${home.file} has no test "${home.test}"`);
    }
  }
  return problems;
}

const files = { 'supabase/tests/a.sql': "select ok(true,'a Member''s row is hidden');", 'tests/b.test.mjs': "test('it maps \\'42501\\'',()=>{});" };
const read = file => files[file];
const entry = homes => ({ file: 'x.spec.ts', title: 'a case', homes });

test('a moved case whose homes hold their tests passes', () => {
  const homes = [{ file: 'supabase/tests/a.sql', test: "a Member's row is hidden" }, { file: 'tests/b.test.mjs', test: "it maps '42501'" }];
  assert.deepEqual(moveProblems({ moved: [entry(homes)], listed: [], read }), []);
});

test('a moved case still listed, with no home, a missing home file or a missing test turns the guard red', () => {
  assert.deepEqual(moveProblems({ moved: [entry([{ file: 'supabase/tests/a.sql', test: "a Member's row is hidden" }])], listed: ['x.spec.ts › a case'], read }),
    ['x.spec.ts › a case: moved but still in the browser suite']);
  assert.deepEqual(moveProblems({ moved: [entry([])], listed: [], read }), ['x.spec.ts › a case: names no new home']);
  assert.deepEqual(moveProblems({ moved: [entry([{ file: 'supabase/tests/gone.sql', test: 'any' }])], listed: [], read }),
    ['x.spec.ts › a case: its home supabase/tests/gone.sql does not exist']);
  assert.deepEqual(moveProblems({ moved: [entry([{ file: 'supabase/tests/a.sql', test: 'a row is hidden' }])], listed: [], read }),
    ['x.spec.ts › a case: supabase/tests/a.sql has no test "a row is hidden"']);
});

test('every moved browser case is gone from the browser suite and each of its new homes holds its test', () => {
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `playwright --list exited ${run.status}: ${run.stderr}`);
  const listed = [];
  const walk = (suites, outer) => {
    for (const suite of suites) {
      const path = suite.file && suite.title === suite.file ? outer : [...outer, suite.title];
      for (const spec of suite.specs ?? []) listed.push(`${spec.file} › ${[...path, spec.title].join(' › ')}`);
      walk(suite.suites ?? [], path);
    }
  };
  walk(JSON.parse(run.stdout).suites, []);
  assert.ok(listed.length > 100, 'Playwright lists the browser suite');
  const moved = JSON.parse(readFileSync('tests/moved-tests.json', 'utf8'));
  assert.ok(moved.length > 0, 'the move list names the moved cases');
  assert.deepEqual(moveProblems({ moved, listed, read: file => (existsSync(file) ? readFileSync(file, 'utf8') : undefined) }), []);
});
