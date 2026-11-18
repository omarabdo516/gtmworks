import { execFileSync } from 'node:child_process';
import { DOC, readRows } from './testing-doc.mjs';

// The one-off migration for #229, kept runnable so its compare can run again after another branch adds or edits rows:
// every row of docs/testing.md's "Every file" table and of "The browser suite, case by case" moved, word for word, into
// tests/rows/<path>.md (a folded folder's row into tests/rows/<folder>/index.md, a spec no longer in the tree into a
// file of its case rows alone). The tables no longer live in docs/testing.md, which points at
// `node scripts/testing-doc.mjs --print`: the compare reads the table the doc held before they left it, from
// `git show <rev>:docs/testing.md` (`origin/main` unless `--from <rev>` names another), and prints no difference when
// every row of it is carried over unchanged. A row another ticket rewrote after that revision prints as a difference in
// both directions; `--from <rev>` names the revision whose table to compare with instead, such as the last commit whose
// doc still held the tables. Run `node scripts/testing-rows-migrate.mjs [--from <rev>]`.

const args = process.argv.slice(2);
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'origin/main';
if (!from) {
  console.error('usage: node scripts/testing-rows-migrate.mjs [--from <rev>]');
  process.exitCode = 2;
} else {
  const doc = execFileSync('git', ['show', `${from}:${DOC}`], { encoding: 'utf8' });
  const lines = doc.split('\n');
  const section = (header, toEnd = false) => {
    const start = lines.indexOf(header);
    if (start < 0) throw new Error(`${from}:${DOC} has no "${header}" section`);
    const end = toEnd ? lines.length : lines.findIndex((line, index) => index > start && line.startsWith('## '));
    return lines.slice(start, end < 0 ? undefined : end);
  };

  const fileRows = section('| File | Promise | Runtime | Also guarded by | Decision |', true)
    .filter(line => /^\| `[^`]+` \|/.test(line));
  if (fileRows.length === 0) throw new Error(`${from}:${DOC}'s "Every file" table has no rows`);
  const caseRows = section('| Case | Decision | Why, and what guards it now |')
    .flatMap(line => {
      const match = /^\| `([\w/-]+\.spec\.ts)` ".+" \| (?:stays|moved|removed) \|/.exec(line);
      return match ? [line] : [];
    });

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
    difference(caseRows, rows.flatMap(row => row.cases)),
  ];
  console.log(`${from}: ${fileRows.length} file rows and ${caseRows.length} case rows; tests/rows/: ${rows.length} row files`);
  console.log(same.every(Boolean) ? 'no difference' : 'difference (see above)');
}
