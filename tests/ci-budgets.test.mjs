import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// Every job of the full check has a time limit near its budget (#410), so a job that slows down turns the pull request
// that slowed it red. The limits below are one table on purpose: each is one and a half times the minutes measured on
// run 44636876755, the first run with every other ticket of spec #401, kept between 3 and 12 minutes. Raising a limit
// means changing its row here in the same diff, where the reviewer sees it.
const budgets = {
  changes: { limit: 3, measured: 0.2 },
  fast: { limit: 5, measured: 2.7 },
  image: { limit: 6, measured: 3.7 },
  database: { limit: 4, measured: 2.1 },
  integration: { limit: 12, measured: 10.6 }, // its slowest shard
  install: { limit: 12, measured: 9.5 }, // its slowest area, backup
  check: { limit: 3, measured: 0.1 },
};
const MAX = 12;
// What the full check runs. `visual` and `install-measure` are not part of it: they run on main and on a manual run.
// `supabase-images` is not part of it either: it only warms a cache, never fails a run, and after a cache-key change it
// pulls every Supabase image, so its limit is not one of the check's.
const fullCheck = ['changes', 'fast', 'image', 'database', 'integration', 'install', 'check'];

const { jobs } = load(readFileSync('.github/workflows/ci.yml', 'utf8'));

test('the budget table covers the jobs of the full check, and check needs only jobs it covers', () => {
  assert.deepEqual(Object.keys(budgets).sort(), [...fullCheck].sort());
  for (const name of [...(jobs.check.needs ?? []), 'check']) assert.ok(budgets[name], `${name} has a budget`);
});

test('every job of the full check has its limit, at most 12 minutes and near its measured minutes', () => {
  for (const [name, { limit, measured }] of Object.entries(budgets)) {
    assert.ok(jobs[name], `${name} is a job of the full check`);
    assert.equal(jobs[name]['timeout-minutes'], limit, `${name} carries its budget`);
    assert.ok(limit <= MAX, `${name} is at most ${MAX} minutes`);
    assert.equal(limit, Math.min(MAX, Math.max(3, Math.ceil(measured * 1.5))), `${name}: one and a half times its measured minutes, kept between 3 and 12`);
  }
});

test('the Supabase images cache job is no part of the full check: it never fails a run, so its limit is its own', () => {
  const images = jobs['supabase-images'];
  assert.equal(images['continue-on-error'], true, 'it cannot fail a run');
  assert.equal(fullCheck.includes('supabase-images'), false, 'check does not wait for it');
  assert.equal(jobs.check.needs.includes('supabase-images'), false, 'the required check needs no cache job');
  // A cache-key change pulls every image, so 3 minutes would time it out and its cache would never be saved.
  assert.equal(images['timeout-minutes'], 15, 'a key change has time to pull and save every image');
});
