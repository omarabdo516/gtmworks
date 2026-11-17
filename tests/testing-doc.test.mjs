import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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

// #218: each case of a browser spec named in "The browser suite, case by case" has its decision. A case that stays is
// still in its file; a case that moved or was removed is gone from it, and a spec with no case left is deleted.
test('every case of a decided browser spec has its decision, and only kept cases are still in the file', () => {
  const doc = readFileSync('docs/testing.md', 'utf8');
  const section = doc.slice(doc.indexOf('## The browser suite, case by case'));
  const rows = [...section.matchAll(/^\| `([\w-]+\.spec\.ts)` "(.+)" \| (stays|moved|removed) \|/gm)]
    .map(([, file, title, decision]) => ({ file, title, decision }));
  assert.ok(rows.length > 0, 'the case-by-case table has no rows');
  for (const file of new Set(rows.map(row => row.file))) {
    const source = existsSync(`tests/${file}`) ? readFileSync(`tests/${file}`, 'utf8') : '';
    const cases = [...source.matchAll(/\btest\((['`])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2].replaceAll("\\'", "'"));
    const decided = rows.filter(row => row.file === file);
    assert.deepEqual(decided.filter(row => row.decision === 'stays').map(row => row.title).sort(), [...cases].sort(), `${file}: the cases still in the file are the ones that stay`);
    assert.equal(new Set(decided.map(row => row.title)).size, decided.length, `${file}: a case has more than one row`);
  }
});
