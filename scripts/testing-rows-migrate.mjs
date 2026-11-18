import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DOC, readRows, rowPath, writeTable } from './testing-doc.mjs';

// The one-off migration for #229, kept runnable so it can run again after another branch adds rows: every row of
// docs/testing.md's "Every file" table and of "The browser suite, case by case" moves, word for word, into
// tests/rows/<path>.md (a folded folder's row into tests/rows/<folder>/index.md, a spec no longer in the tree into a
// file of its case rows alone). It writes the missing files, writes both tables back from the rows, and compares the old
// table with the new source: it prints no difference when every row was carried over unchanged. Run
// `node scripts/testing-rows-migrate.mjs --write` to move new rows, then plain `node scripts/testing-rows-migrate.mjs`
// to compare.

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
if (fileRows.length === 0) throw new Error(`${DOC}'s "Every file" table has no rows to move`);

const byFile = new Map();
for (const line of fileRows) byFile.set(/^\| `([^`]+)` \|/.exec(line)[1], { line, cases: [] });
const caseRows = section('| Case | Decision | Why, and what guards it now |')
  .flatMap(line => {
    const match = /^\| `([\w/-]+\.spec\.ts)` ".+" \| (?:stays|moved|removed) \|/.exec(line);
    return match ? [{ file: match[1], line }] : [];
  });
for (const { file, line } of caseRows) {
  // A case row's spec has its file row; a spec whose last case moved or was removed has only case rows.
  if (!byFile.has(file)) byFile.set(file, { line: '', cases: [] });
  byFile.get(file).cases.push(line);
}

let moved = 0;
for (const [path, { line, cases }] of byFile) {
  const file = rowPath(path);
  const parts = line ? [line] : [];
  if (cases.length) parts.push(...(line ? [''] : []), '## Cases', '', ...cases);
  const content = `${parts.join('\n')}\n`;
  if (!existsSync(file)) {
    if (!write) {
      console.error(`${file}: missing; run "node scripts/testing-rows-migrate.mjs --write"`);
      process.exitCode = 1;
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    moved++;
  } else if (readFileSync(file, 'utf8') !== content) {
    console.error(`${file}: differs from ${DOC}'s row; the row file is the source now, so the difference is left standing`);
    process.exitCode = 1;
  }
}
if (write) {
  writeTable();
  console.log(`${DOC}: wrote both tables from tests/rows/ (${moved} new row file(s))`);
}

// Every old row against the new source, in both directions, as sets: the old table's order was not sorted by path.
const rows = readRows();
const difference = (old, now) => {
  const before = new Set(old), after = new Set(now);
  const missing = old.filter(line => !after.has(line));
  const extra = now.filter(line => !before.has(line));
  for (const line of missing) console.error(`missing from tests/rows/: ${line.slice(0, 160)}`);
  for (const line of extra) console.error(`only in tests/rows/: ${line.slice(0, 160)}`);
  if (missing.length + extra.length) process.exitCode = 1;
  return missing.length + extra.length === 0;
};
const same = [
  difference(fileRows, rows.map(row => row.row).filter(Boolean)),
  difference(caseRows.map(row => row.line), rows.flatMap(row => row.cases)),
];
console.log(`${DOC}: ${fileRows.length} file rows and ${caseRows.length} case rows; tests/rows/: ${rows.length} row files`);
console.log(same.every(Boolean) ? 'no difference' : 'difference (see above)');
