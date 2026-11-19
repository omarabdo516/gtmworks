import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

// The install proof is one command of the repo (#402): CI's `install` job calls it and holds no check of its own, and the
// proof itself is scripts/ci-install-check.sh with the helpers its areas share in scripts/ci-install-lib.sh. These guards
// read the real workflow and the real scripts, so a check added to the job, or a failure point lost in a move, is seen.
const ci = load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
const job = ci.jobs.install;
const proof = ['scripts/ci-install-check.sh', 'scripts/ci-install-lib.sh'];
const script = readFileSync(proof[0], 'utf8');
const text = proof.map(path => readFileSync(path, 'utf8')).join('\n');

// Every failure point the proof prints: the sentence after `fail` or `fail_update`, in the form the script writes it
// (`'…'` or `"…"`), so a message that changed by one byte is a different line. fail_update's own body forwards its
// argument (`fail "$1"`), which is no failure point, so the line that defines it is left out of the list.
const messages = source => source.split('\n')
  .filter(line => !/^fail_update\(\) \{/.test(line))
  .flatMap(line => [...line.matchAll(/\bfail(?:_update)? (?:'[^']*'|"[^"]*")/g)])
  .map(match => match[0].replace(/^fail(?:_update)? /, ''))
  .sort();

test('the install job runs the whole proof with one command and holds no check of it', () => {
  const calls = job.steps.filter(step => step.run === 'bash scripts/ci-install-check.sh');
  assert.equal(calls.length, 1, 'exactly one step runs the install proof');
  // No step of the job prints a failure of the proof: the sentences live in the repo's script, where a person runs them.
  for (const step of job.steps) assert.doesNotMatch(step.run ?? '', /\bfail |\bfail\(/, `${step.name} holds no failure point`);
});

// The move keeps every failure point the install job had before it, once each. Five sentences repeat in the job before
// the move because the same check runs on the first Engine, the restored one and the previous release's Engine; making
// them unique would change a message, so the guard compares the list, name by name, with the one taken before the move.
test('every failure point of the install proof before the move exists in it, once, after it', () => {
  const before = readFileSync('scripts/ci-install-points.txt', 'utf8').trim().split('\n').sort();
  assert.deepEqual(messages(text), before);
});

// The helpers the areas share are written once, in the lib or the script, never in both (#402).
test('no helper function is defined twice in the proof or its lib', () => {
  const definitions = proof.flatMap(path => [...readFileSync(path, 'utf8').matchAll(/^([a-z][a-z0-9_]*)\(\) \{/gm)].map(match => match[1]));
  assert.deepEqual(definitions.filter((name, index) => definitions.indexOf(name) !== index), [], 'each helper has one definition');
});

// The proof is the spec's seven areas, one after another: the first install and its repeat; Companies and their Engines;
// Agents on their Engines; backup and restore; the public address behind a proxy; the update between releases; the
// one-line install. Today they share one machine and the state each carried before the move (#406–#409 split them).
test('the install proof is the seven areas of the spec, run one after another', () => {
  const areas = ['first_install', 'companies', 'agents', 'backup', 'proxy', 'update', 'one_line'];
  for (const area of areas) assert.match(script, new RegExp(`^${area}\\(\\) \\{$`, 'm'), area);
  assert.deepEqual([...script.matchAll(/^([a-z][a-z0-9_]*)$/gm)].map(match => match[1]).filter(name => areas.includes(name)), areas);
});
