import test from 'node:test';
import assert from 'node:assert/strict';
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
