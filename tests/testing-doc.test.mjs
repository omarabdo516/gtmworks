import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// docs/testing.md keeps one row per file under tests/ (#69): what it guards, its runtime and the decision.
test('docs/testing.md has exactly one row per file under tests/', () => {
  const tracked = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(path => !path.startsWith('tests/visual.spec.ts-snapshots/')).map(path => path.slice('tests/'.length));
  const rows = [...readFileSync('docs/testing.md', 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1])
    .filter(name => name !== 'visual.spec.ts-snapshots/');
  assert.deepEqual([...rows].sort(), [...new Set(tracked)].sort());
  assert.equal(new Set(rows).size, rows.length, 'a file has more than one row');
});
