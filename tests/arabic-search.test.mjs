import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchFold } from '../lib/arabic-search.mjs';

// One reading of a search for the Apps search (#201) and Find a setting (#613).
test('a search reads text without case, Arabic marks or tatweel, and every hamza seat as its letter', () => {
  assert.equal(searchFold('  Recurring   TASKS '), 'recurring tasks');
  assert.equal(searchFold('التعلّم'), 'التعلم');
  assert.equal(searchFold('مُـــهمّة'), 'مهمه');
  assert.equal(searchFold('أإآٱ'), 'اااا');
  assert.equal(searchFold('مسؤول شئون'), 'مسوول شيون');
  assert.equal(searchFold('مستوى'), 'مستوي');
  assert.equal(searchFold(''), '');
});

// The database's twin (public.search_fold, #673) folds the same pairs the same way: supabase/tests/all_conversations.sql
// checks it on every pair listed there, and this reads that list, so the two foldings cannot drift apart.
test('the interface folds every pair the database\'s search is tested on the same way', () => {
  const sql = readFileSync('supabase/tests/all_conversations.sql', 'utf8');
  const list = sql.slice(sql.indexOf('-- search-fold pairs'), sql.indexOf(';', sql.indexOf('-- search-fold pairs')));
  const pairs = [...list.matchAll(/\('((?:[^']|'')*)','((?:[^']|'')*)'\)/g)].map(([, input, folded]) => [input.replaceAll("''", "'"), folded.replaceAll("''", "'")]);
  assert.ok(pairs.length >= 8, 'the pairs are read');
  for (const [input, folded] of pairs) assert.equal(searchFold(input), folded, input);
});
