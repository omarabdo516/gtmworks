import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// docs/testing.md keeps one row per file under tests/ (#69): what it guards, its runtime and the decision.
// The approved images, the compared screens and the failed job logs are data folders with one row each, so adding a
// screen or a log needs no row.
test('docs/testing.md has exactly one row per file under tests/', () => {
  const folders = ['visual.spec.ts-snapshots/', 'visual-screens/', 'ci-logs/'];
  const tracked = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(path => path.slice('tests/'.length))
    .map(path => (/\.(test|spec)\.[^/]+$/.test(path) ? undefined : folders.find(folder => path.startsWith(folder))) ?? path);
  const rows = [...readFileSync('docs/testing.md', 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  assert.deepEqual([...rows].sort(), [...new Set(tracked)].sort());
  assert.equal(new Set(rows).size, rows.length, 'a file has more than one row');
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
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', config, '--list', '--reporter=json', `--project=${project}`], { encoding: 'utf8' });
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

test('every case of the functional project has its decision, and only kept cases are still in their file', () => {
  const listed = listCases('playwright.config.ts', 'functional');
  assert.ok(new Set(listed.cases.map(item => item.file)).size > 30, 'Playwright lists the functional project\'s spec files');
  for (const file of ['visual.spec.ts', 'first-run.spec.ts', 'navigation.spec.ts', 'proxy/production-shape.spec.ts']) assert.ok(!listed.cases.some(item => item.file === file), `${file} is not in the functional project`);
  assert.deepEqual(decisionProblems(readFileSync('docs/testing.md', 'utf8'), listed), []);
});
