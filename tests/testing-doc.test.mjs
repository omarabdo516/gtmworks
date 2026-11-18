import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { problems, readRows, rowProblems, rowPath, testFiles } from '../scripts/testing-doc.mjs';

// docs/testing.md's table has one row per file under tests/ (#69). Each row lives with the file it names, in
// tests/rows/, so two pull requests that add different tests never edit one shared table (#229); this file writes the
// tables into docs/testing.md from those rows (`node scripts/testing-doc.mjs --write`) and fails when a file has no row,
// a row names no file, a file has two rows, or the tables do not match the rows.
const row = path => ({ path, file: rowPath(path), row: `| \`${path}\` | promise | — | — | keep |`, cases: [], other: [] });

test('a file with no row and a row with no file are both named, and each file keeps exactly one row', () => {
  assert.deepEqual(rowProblems(['a.test.mjs', 'b.test.mjs'], [row('a.test.mjs')]), [
    'tests/b.test.mjs: no row (write tests/rows/b.test.mjs.md)',
  ]);
  assert.deepEqual(rowProblems(['a.test.mjs'], [row('a.test.mjs'), row('gone.test.mjs')]), [
    'tests/rows/gone.test.mjs.md: names no file (tests/gone.test.mjs does not exist)',
  ]);
  assert.deepEqual(rowProblems(['a.test.mjs'], [row('a.test.mjs'), row('a.test.mjs')]), [
    'tests/a.test.mjs: more than one row (tests/rows/a.test.mjs.md and tests/rows/a.test.mjs.md)',
  ]);
});

test('every file under tests/ has exactly one row in tests/rows/, and both tables in docs/testing.md match them', () => {
  assert.deepEqual(problems(), []);
  const rows = readRows();
  const files = testFiles();
  assert.deepEqual(rows.filter(entry => entry.row).map(entry => entry.path).sort(), files.sort());
  assert.equal(new Set(rows.map(entry => entry.path)).size, rows.length);
  // A spec whose last case moved or was removed is gone, and only its case rows are kept.
  for (const entry of rows.filter(entry => !entry.row)) {
    assert.ok(entry.path.endsWith('.spec.ts') && !files.includes(entry.path), `${entry.file} keeps only the cases of a spec no longer in the tree`);
    assert.ok(entry.cases.every(line => / \| (moved|removed) \|/.test(line)), `${entry.file} keeps no case that stays`);
  }
  assert.ok(rows.filter(entry => entry.cases.length > 0).length > 20, 'the browser specs keep their case rows');
});

// #229: the row travels with the test, so two branches that add different tests do not conflict in one table. Their rows
// sort apart here, as two different tests do: the merge keeps both and the merged table is still what the rows write.
test('two branches that each add a test with its row merge without a conflict and leave a valid table', t => {
  mkdirSync('test-results', { recursive: true });
  const dir = mkdtempSync(join('test-results', 'rows-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--shared', resolve('.'), dir], { encoding: 'utf8' });
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('config', 'user.email', 'tests@example.test');
  git('config', 'user.name', 'testing doc');
  const base = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  const add = (branch, file) => {
    git('checkout', '--quiet', '-b', branch);
    writeFileSync(join(dir, 'tests', file), `import { test } from 'node:test';\ntest('added on ${branch}', () => {});\n`);
    mkdirSync(join(dir, 'tests/rows'), { recursive: true });
    writeFileSync(join(dir, 'tests/rows', `${file}.md`), `| \`${file}\` | a test added on ${branch}, with its row | — | — | keep |\n`);
    execFileSync(process.execPath, ['scripts/testing-doc.mjs', '--write'], { cwd: dir, encoding: 'utf8' });
    git('add', '--all');
    git('commit', '--quiet', '-m', `test: add ${file}`);
  };
  add('first', 'aa-merge-first.test.mjs');
  git('checkout', '--quiet', base);
  add('second', 'zz-merge-second.test.mjs');
  git('checkout', '--quiet', 'first');
  const merge = spawnSync('git', ['merge', '--no-edit', 'second'], { cwd: dir, encoding: 'utf8' });
  assert.equal(merge.status, 0, `the branches conflicted:\n${merge.stdout}${merge.stderr}`);
  const doc = readFileSync(join(dir, 'docs/testing.md'), 'utf8');
  assert.doesNotMatch(doc, /^(<{7}|={7}|>{7})/m, 'the merged table has conflict markers');
  for (const file of ['aa-merge-first.test.mjs', 'zz-merge-second.test.mjs']) assert.match(doc, new RegExp(`\\| \`${file}\` \\|`), `the merged table has ${file}'s row`);
  const check = spawnSync(process.execPath, ['scripts/testing-doc.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(check.status, 0, `the merged table is not valid:\n${check.stdout}${check.stderr}`);
});


// #218: every case of the `functional` project has its decision in "The browser suite, case by case". The cases come
// from Playwright itself (`--list` loads the config and the spec files, and starts no browser or server), so a case
// written in any form, double quotes, test.fixme or a title on its next line, is listed the way the runner sees it.
// A case that stays has one "stays" row: a row whose title holds `${...}` stands for every case its template makes, any
// other row for exactly one case, so two cases with the same title need two rows. A case that moved or was removed is
// gone from its file, and a spec with no case left is deleted.
// Playwright refuses some files outright (two cases with the same title in one file, a syntax error): it lists nothing
// then, and its own error is the problem to report.
function listCases(config, project) {
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', config, '--list', '--reporter=json', ...[project].flat().map(name => `--project=${name}`)], { encoding: 'utf8' });
  const list = JSON.parse(run.stdout);
  const cases = [], errors = (list.errors ?? []).map(error => error.message);
  if (run.status !== 0 && errors.length === 0) errors.push(`playwright --list exited ${run.status}: ${run.stderr}`);
  const walk = (suites, outer) => {
    for (const suite of suites) {
      const path = suite.file && suite.title === suite.file ? outer : [...outer, suite.title];
      for (const spec of suite.specs ?? []) cases.push({ file: spec.file, title: [...path, spec.title].join(' › ') });
      walk(suite.suites ?? [], path);
    }
  };
  walk(list.suites, []);
  return { cases, errors };
}
const titlePattern = title => new RegExp(`^${title.split(/\$\{[^}]*\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`);
function decisionProblems(doc, { cases, errors = [] }) {
  const section = doc.slice(doc.indexOf('## The browser suite, case by case'));
  const rows = [...section.matchAll(/^\| `([\w-]+\.spec\.ts)` "(.+)" \| (stays|moved|removed) \|/gm)]
    .map(([, file, title, decision]) => ({ file, title: title.replaceAll('\\|', '|'), decision }));
  const problems = [...errors];
  if (rows.length === 0) problems.push('the case-by-case table has no rows');
  for (const file of [...new Set([...cases.map(item => item.file), ...rows.map(row => row.file)])].sort()) {
    const listed = cases.filter(item => item.file === file).map(item => item.title);
    const decided = rows.filter(row => row.file === file);
    const titles = decided.map(row => row.title);
    for (const title of new Set(titles.filter((title, index) => titles.indexOf(title) !== index))) problems.push(`${file}: "${title}" has more than one row`);
    const matches = row => listed.filter(title => (row.title.includes('${') ? titlePattern(row.title).test(title) : title === row.title));
    for (const title of listed) {
      const stays = decided.filter(row => row.decision === 'stays' && matches(row).includes(title));
      if (stays.length === 0) problems.push(`${file}: no "stays" row for the case "${title}"`);
    }
    for (const row of decided) {
      const found = matches(row).length;
      if (row.decision !== 'stays' && found > 0) problems.push(`${file}: "${row.title}" is ${row.decision} but still in the file`);
      if (row.decision === 'stays' && found === 0) problems.push(`${file}: "${row.title}" stays but is not in the file`);
      if (row.decision === 'stays' && !row.title.includes('${') && found > 1) problems.push(`${file}: "${row.title}" is ${found} cases with one row`);
    }
  }
  return problems;
}

test('cases in any form are listed by Playwright and each needs its own row', () => {
  mkdirSync('test-results', { recursive: true });
  const dir = mkdtempSync('test-results/testing-doc-');
  try {
    writeFileSync(`${dir}/playwright.config.mjs`, "export default { testDir: '.', projects: [{ name: 'functional' }] };\n");
    writeFileSync(`${dir}/forms.spec.ts`, [
      "import { test } from '@playwright/test';",
      'test("double quoted", async () => {});',
      "test.fixme('marked fixme', async () => {});",
      'test(',
      "  'title on its next line',",
      '  async () => {},',
      ');',
      "test('one title', async () => {});",
      'test("says \\"hi\\" | twice", async () => {});',
      "for (const width of [390, 1440]) test(`at ${width}px`, async () => {});",
      "// test('commented out', async () => {});",
      "const pattern = /x/; pattern.test('not a case');",
      '',
    ].join('\n'));
    const cases = listCases(`${dir}/playwright.config.mjs`, 'functional');
    const row = (title, decision = 'stays') => `| \`forms.spec.ts\` "${title}" | ${decision} | why |`;
    const doc = title => ['## The browser suite, case by case (#218)', '', ...title].join('\n');
    const all = ['double quoted', 'marked fixme', 'title on its next line', 'one title', 'says "hi" \\| twice', 'at ${width}px'];
    const rows = all.map(title => row(title));
    // Every form listed, each with its correct row: nothing to report.
    assert.deepEqual(decisionProblems(doc(rows), cases), []);
    // No rows at all: every case is named.
    assert.deepEqual(decisionProblems(doc([row('placeholder', 'removed')]), cases), [
      'forms.spec.ts: no "stays" row for the case "double quoted"',
      'forms.spec.ts: no "stays" row for the case "marked fixme"',
      'forms.spec.ts: no "stays" row for the case "title on its next line"',
      'forms.spec.ts: no "stays" row for the case "one title"',
      'forms.spec.ts: no "stays" row for the case "says "hi" | twice"',
      'forms.spec.ts: no "stays" row for the case "at 390px"',
      'forms.spec.ts: no "stays" row for the case "at 1440px"',
    ]);
    // A case marked moved that is still in its file, in any form; and one row written twice.
    assert.deepEqual(decisionProblems(doc([...rows.filter(line => !line.includes('marked fixme')), row('marked fixme', 'moved')]), cases),
      ['forms.spec.ts: no "stays" row for the case "marked fixme"', 'forms.spec.ts: "marked fixme" is moved but still in the file']);
    assert.deepEqual(decisionProblems(doc([...rows, row('one title')]), cases), ['forms.spec.ts: "one title" has more than one row']);
    // Two cases with the same title in one file: Playwright refuses the file, and its error is the problem reported.
    writeFileSync(`${dir}/forms.spec.ts`, "import { test } from '@playwright/test';\ntest('the same title', async () => {});\ntest('the same title', async () => {});\n");
    const refused = decisionProblems(doc([row('the same title')]), listCases(`${dir}/playwright.config.mjs`, 'functional'));
    assert.match(refused[0], /duplicate test title "the same title"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The chat's open time runs in a project of its own, `alone` (#346); its case keeps its row like a functional one.
test('every case of the functional project has its decision, and only kept cases are still in their file', () => {
  const listed = listCases('playwright.config.ts', ['functional', 'alone']);
  assert.ok(new Set(listed.cases.map(item => item.file)).size > 30, 'Playwright lists the functional project\'s spec files');
  for (const file of ['visual-lane.spec.ts', 'first-run.spec.ts', 'navigation.spec.ts', 'proxy/production-shape.spec.ts']) assert.ok(!listed.cases.some(item => item.file === file), `${file} is not in the functional project`);
  assert.deepEqual(decisionProblems(readFileSync('docs/testing.md', 'utf8'), listed), []);
});

// #336: the doc says how to set a flaky test aside and when it must come back.
test('docs/testing.md says how to set a test aside and when it must come back', () => {
  const doc = readFileSync('docs/testing.md', 'utf8');
  const start = doc.indexOf('\n## Setting a test aside');
  assert.ok(start >= 0, 'docs/testing.md has a "Setting a test aside" section');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  for (const words of ['test.fixme', 'tests/set-aside.json', 'issue', 'must come back within 7 days', 'never set aside']) assert.ok(section.includes(words), `the section names ${words}`);
});
