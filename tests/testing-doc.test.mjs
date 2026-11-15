import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// docs/testing.md keeps one row per file under tests/ (#69): what it guards, its runtime and the decision.
// The approved images and the compared screens are data folders with one row each, so adding a screen needs no row.
test('docs/testing.md has exactly one row per file under tests/', () => {
  const folders = ['visual.spec.ts-snapshots/', 'visual-screens/'];
  const tracked = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(path => path.slice('tests/'.length)).map(path => folders.find(folder => path.startsWith(folder)) ?? path);
  const rows = [...readFileSync('docs/testing.md', 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  assert.deepEqual([...rows].sort(), [...new Set(tracked)].sort());
  assert.equal(new Set(rows).size, rows.length, 'a file has more than one row');
});
