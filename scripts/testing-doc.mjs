import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each file under tests/ keeps its row beside it, in tests/rows/ (#229): the file's own row comes first, and a browser
// spec's rows from "The browser suite, case by case" follow under `## Cases`. A row lives with the test it names, so two
// pull requests that add different tests never edit one shared table, even when their new files sort next to each
// other. docs/testing.md points at `node scripts/testing-doc.mjs --print`, which prints both tables from those rows,
// sorted by path; `./ci.sh static` runs the check as a node test (tests/testing-doc.test.mjs) and names every file with
// no row, every row with no file, and every row file that keeps two rows for its own file.

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
function declaredPath(file) {
  const path = relative(ROWS, file).split('\\').join('/').replace(/\.md$/, '');
  return path.endsWith('/index') ? path.slice(0, -'index'.length) : path;
}

/**
 * Reads every row file under tests/rows/, in path order. `row` is the file's own row and `moreRows` the other rows that
 * name it, so a row file keeping its row twice is named rather than silently read as its first.
 */
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
    return { path, file, row: own[0] ?? '', moreRows: own.slice(1), cases, other: lines.filter(line => !own.includes(line) && !cases.includes(line)) };
  });
}

/**
 * Names every file with no row, every row with no file, every file with more than one row and every row file keeping
 * two rows for its own file (#229), on fixtures or on the real tree. `files` are tests-relative paths; `rows` carry
 * `path`, `file`, `row`, `moreRows` and `cases`.
 */
export function rowProblems(files, rows) {
  const problems = [];
  const seen = new Map();
  for (const row of rows) {
    if (row.row && !files.includes(row.path)) problems.push(`${row.file}: names no file (tests/${row.path} does not exist)`);
    if (!row.row && row.cases.length === 0) problems.push(`${row.file}: has no row`);
    if (row.moreRows?.length) problems.push(`${row.file}: has ${row.moreRows.length + 1} rows for tests/${row.path}`);
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

/** A case row's parts: the spec it names, the case's title as Playwright lists it, the decision and its reason. */
export function caseRow(line) {
  const match = /^\| `([\w/-]+\.spec\.ts)` "(.+)" \| (stays|moved|removed) \| (.*) \|$/.exec(line);
  return match ? { file: match[1], title: match[2].replaceAll('\\|', '|'), decision: match[3], why: match[4] } : null;
}

/** Every case row in `rows` (see readRows), as `caseRow` reads it. */
export function caseDecisions(rows) {
  return rows.flatMap(row => row.cases).map(caseRow).filter(Boolean);
}

/** Both tables, printed from the rows. File rows are sorted by path; a spec's cases keep their order. */
export function renderTables(rows) {
  // A plain code-unit sort, so every Node makes the same order: ICU's collation may differ between versions.
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileRows = sorted.map(row => row.row).filter(Boolean);
  const caseRows = sorted.flatMap(row => row.cases);
  return [[FILE_HEADER, FILE_RULE, ...fileRows], [CASE_HEADER, CASE_RULE, ...caseRows]].map(lines => lines.join('\n')).join('\n\n') + '\n';
}

/** Everything an unpaired row or a file without its row would be told, in one list; the check `./ci.sh static` runs. */
export function problems(root = '.') {
  return rowProblems(testFiles(root), readRows(root));
}

function main(argv) {
  const root = process.cwd();
  if (argv.includes('--print')) {
    process.stdout.write(renderTables(readRows(root)));
    return;
  }
  const found = problems(root);
  if (found.length) {
    for (const problem of found) console.error(problem);
    process.exitCode = 1;
    return;
  }
  console.log(`${ROWS}/: every file under tests/ has its row`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
