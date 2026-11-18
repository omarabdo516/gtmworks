import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DOC, readRows, rowPath, writeTable } from './testing-doc.mjs';

// The one-off migration for #229, kept runnable so it can run again after another branch adds rows: every row of
// docs/testing.md's "Every file" table and of "The browser suite, case by case" moves, word for word, into
// tests/rows/<path>.md (a folded folder's row into tests/rows/<folder>/index.md). It writes the missing files, writes
// both tables back from the rows, and compares the old table with the new source: it prints no difference when every
// row was carried over unchanged. Run `node scripts/testing-rows-migrate.mjs --write` to move new rows, then plain
// `node scripts/testing-rows-migrate.mjs` to compare.

const write = process.argv.includes('--write');
const doc = readFileSync(DOC, 'utf8');
const lines = doc.split('\n');
const section = (header, toEnd = false) => {
  const start = lines.indexOf(header);
  if (start < 0) throw new Error(`${DOC} has no "${header}" section`);
  const end = toEnd ? lines.length : lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end);
};

const fileRows = section('| File | Promise | Runtime | Also guarded by | Decision |', true)
  .filter(line => /^\| `[^`]+` \|/.test(line));
const caseRows = [];
for (const line of section('| Case | Decision | Why, and what guards it now |')) {
  const match = /^\| `([\w/-]+\.spec\.ts)` ".+" \| (?:stays|moved|removed) \|/.exec(line);
  if (match) caseRows.push({ file: match[1], line });
}
if (fileRows.length === 0) throw new Error(`${DOC}'s "Every file" table has no rows to move`);

const byFile = new Map(fileRows.map(line => [/^\| `([^`]+)` \|/.exec(line)[1], { line, cases: [] }]));
const byPath = new Map();
for (const { file, line } of caseRows) (byPath.get(file) ?? byPath.set(file, []).get(file)).push(line);
for (const [file, cases] of byPath) {
  if (byFile.has(file)) byFile.get(file).cases.push(...cases);
  else byFile.set(file, { line: '', cases }); // the spec is gone; its case rows keep their decision
}

let written = 0;
for (const [path, { line, cases }] of byFile) {
  const file = rowPath(path);
  const content = `${[line, ...(cases.length ? [line ? '' : undefined, '## Cases', '', ...cases] : [])].filter(part => part !== undefined).join('\n')}\n`;
  if (!existsSync(file)) {
    if (!write) {
      console.error(`${file}: missing; run "node scripts/testing-rows-migrate.mjs --write"`);
      process.exitCode = 1;
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written++;
  } else if (readFileSync(file, 'utf8') !== content) {
    console.error(`${file}: differs from ${DOC}'s row; the row file is the source now, so the difference is left standing`);
    process.exitCode = 1;
  }
}
if (write) {
  writeTable();
  console.log(`${DOC}: wrote both tables from tests/rows/ (${written} new row file(s))`);
}

// Every old row against the new source, in both directions, as sets: the old table's order was not sorted by path.
const rows = readRows();
const difference = (name, old, now) => {
  const missing = old.filter(line => !now.includes(line));
  const extra = now.filter(line => !old.includes(line));
  for (const line of missing) console.error(`missing from tests/rows/: ${line.slice(0, 160)}`);
  for (const line of extra) console.error(`only in tests/rows/: ${line.slice(0, 160)}`);
  if (missing.length + extra.length) process.exitCode = 1;
  return missing.length + extra.length === 0;
};
const same = [
  difference('file rows', fileRows, rows.map(row => row.row).filter(Boolean)),
  difference('case rows', caseRows.map(row => row.line), rows.flatMap(row => row.cases)),
];
console.log(`${DOC}: ${fileRows.length} file rows and ${caseRows.length} case rows; tests/rows/: ${rows.length} row files`);
console.log(same.every(Boolean) ? 'no difference' : 'difference (see above)');
