import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each file under tests/ keeps its row from docs/testing.md's "Every file" table beside it, in tests/rows/ (#229): the
// file's own row comes first, and a browser spec's rows from "The browser suite, case by case" follow under `## Cases`.
// A row lives with the test it names, so two pull requests that add different tests never edit one shared table. This
// script writes both tables from those rows and checks they are current; `./ci.sh static` runs the check as a node test
// (tests/testing-doc.test.mjs). A new test file writes its row beside it and runs `node scripts/testing-doc.mjs --write`.

export const DOC = 'docs/testing.md';
export const ROWS = 'tests/rows';
const ROW_PREFIX = 'rows/';
const FILE_HEADER = '| File | Promise | Runtime | Also guarded by | Decision |';
const CASE_HEADER = '| Case | Decision | Why, and what guards it now |';
const FILE_RULE = '|---|---|---|---|---|';
const CASE_RULE = '|---|---|---|';
// Rows for a folder are data for a test, like the lane's screens and images: the folder keeps one row, not each file.
const folders = ['ci-logs/', 'visual-lane/'];

const title = text => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

/** Every file under tests/ as git sees it, untracked ones included, folded to one entry per data folder. */
export function testFiles(root = '.') {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tests'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).map(path => path.slice('tests/'.length));
  return [...new Set(listed
    .filter(path => !path.startsWith(ROW_PREFIX))
    .map(path => (/\.(test|spec)\.[^/]+$/.test(path) ? path : folders.find(folder => path.startsWith(folder)) ?? path)))]
    .sort();
}

/** The row file for a file under tests/: its path, and `index.md` for a folded folder. */
export const rowPath = path => `${ROWS}/${path.endsWith('/') ? `${path}index` : path}.md`;

/** The tests-relative path a row file declares, read from its own name. */
export function declaredPath(file) {
  const path = relative(ROWS, file).split('\\').join('/').replace(/\.md$/, '');
  return path.endsWith('/index') ? path.slice(0, -'index'.length) : path;
}

/** Reads every row file under tests/rows/, in path order. */
export function readRows(root = '.') {
  const files = readdirSync(join(root, ROWS), { recursive: true })
    .filter(name => name.endsWith('.md') && statSync(join(root, ROWS, name)).isFile())
    .sort();
  return files.map(name => {
    const file = `${ROWS}/${name.split('\\').join('/')}`;
    const path = declaredPath(file);
    const lines = readFileSync(join(root, file), 'utf8').split('\n').filter(line => line.trim() !== '' && line.trim() !== '## Cases');
    // A spec whose last case moved or was removed is gone from the tree, but its case rows keep their decision here:
    // such a row file has no file row, only case rows.
    const own = lines.filter(line => line.startsWith(`| \`${path}\` |`));
    const cases = lines.filter(line => line.startsWith(`| \`${path}\` "`));
    return { path, file, row: own[0] ?? '', cases, other: lines.filter(line => !own.includes(line) && !cases.includes(line)) };
  });
}

/**
 * Names every file with no row, every row with no file and every file with more than one row (#229), on fixtures or on
 * the real tree. `files` are tests-relative paths; `rows` carry `path`, `file`, `row` and `cases`.
 */
export function rowProblems(files, rows) {
  const problems = [];
  const seen = new Map();
  for (const row of rows) {
    if (row.row && !files.includes(row.path)) problems.push(`${row.file}: names no file (tests/${row.path} does not exist)`);
    if (!row.row && row.cases.length === 0) problems.push(`${row.file}: has no row`);
    if (seen.has(row.path)) problems.push(`tests/${row.path}: more than one row (${seen.get(row.path).file} and ${row.file})`);
    else seen.set(row.path, row);
    for (const line of row.cases) {
      if (!row.path.endsWith('.spec.ts')) problems.push(`${row.file}: a case row names tests/${row.path}, which is not a browser spec`);
      if (!/^\| `[^`]+` ".+" \| (stays|moved|removed) \|/.test(line)) problems.push(`${row.file}: a case row does not name a decision: ${title(line)}`);
    }
    for (const line of row.other) problems.push(`${row.file}: text that is neither the file's row nor a case row: ${title(line)}`);
  }
  for (const path of files) {
    if (!seen.get(path)?.row) problems.push(`tests/${path}: no row (write ${rowPath(path)})`);
  }
  return problems;
}

/** Replaces the table under `header` with `rows`, leaving the prose around it as it is. */
export function replaceTable(doc, header, rule, rows) {
  const lines = doc.split('\n');
  const start = lines.indexOf(header);
  if (start < 0) throw new Error(`${DOC} has no "${header}" table`);
  if (lines[start + 1] !== rule) throw new Error(`${DOC}'s "${header}" table has no separator line`);
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith('|')) end++;
  lines.splice(start + 2, end - (start + 2), ...rows);
  return lines.join('\n');
}

/** docs/testing.md's tests tables, as written from rows. File rows are sorted by path; a spec's cases keep their order. */
export function renderTables(doc, rows) {
  // A plain code-unit sort, so every Node makes the same order: ICU's collation may differ between versions.
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileRows = sorted.map(row => row.row).filter(Boolean);
  const caseRows = sorted.flatMap(row => row.cases);
  const cases = replaceTable(doc, CASE_HEADER, CASE_RULE, caseRows);
  return replaceTable(cases, FILE_HEADER, FILE_RULE, fileRows);
}

/** Names lines of the tables that differ from the rows, so a stale table says what is missing or extra. */
export function staleLines(doc, rows) {
  const expected = renderTables(doc, rows);
  if (expected === doc) return [];
  const actual = new Set(doc.split('\n'));
  const wanted = new Set(expected.split('\n'));
  const missing = [...wanted].filter(line => !actual.has(line));
  const extra = [...actual].filter(line => !wanted.has(line));
  const say = (sign, line) => `${sign} ${title(line)}`;
  const shown = [...missing.slice(0, 5).map(line => say('+', line)), ...extra.slice(0, 5).map(line => say('-', line))];
  if (missing.length + extra.length > shown.length) shown.push(`... ${missing.length + extra.length - shown.length} more`);
  return shown;
}

/** Everything a stale tree or an unpaired row would be told, in one list. */
export function documentProblems({ doc, rows, files }) {
  const problems = rowProblems(files, rows);
  const stale = staleLines(doc, rows);
  if (stale.length) problems.push(`${DOC} is out of date: run "node scripts/testing-doc.mjs --write"`, ...stale);
  return problems;
}

/** Reads the document and the rows; the check a person and `./ci.sh static` run alike. */
export function problems(root = '.') {
  return documentProblems({
    doc: readFileSync(join(root, DOC), 'utf8'),
    rows: readRows(root),
    files: testFiles(root),
  });
}

export function writeTable(root = '.') {
  const file = join(root, DOC);
  writeFileSync(file, renderTables(readFileSync(file, 'utf8'), readRows(root)));
}

function main(argv) {
  const root = process.cwd();
  if (argv.includes('--write')) {
    writeTable(root);
    console.log(`${DOC}: wrote the tables from ${ROWS}/`);
    return;
  }
  if (argv.includes('--print')) {
    process.stdout.write(renderTables(readFileSync(join(root, DOC), 'utf8'), readRows(root)));
    return;
  }
  const found = problems(root);
  if (found.length) {
    for (const problem of found) console.error(problem);
    process.exitCode = 1;
    return;
  }
  console.log(`${DOC}: every file under tests/ has its row in ${ROWS}/, and both tables match`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
