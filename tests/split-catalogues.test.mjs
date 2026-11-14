import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Components with their own catalogue (kept out of the catalogue every route loads) translate through a local helper;
// every key they ask for is in both of their catalogues, so a typo fails here, not at render.
const owners = [
 ['app/member-note.tsx', 'member-note', /\bt\('([A-Za-z]+)'/g],
 ['app/member-note-actions.ts', 'member-note', /'(memberNote[A-Za-z]*)'/g],
 ['app/c/[slug]/conversations/[id]/conversation.tsx', 'conversation', /\bc\('([A-Za-z]+)'/g],
];
test('every key a split catalogue owner asks for is in its catalogue in both languages', () => {
 for (const [file, name, pattern] of owners) {
  const source = readFileSync(file, 'utf8');
  const keys = [...new Set([...source.matchAll(pattern)].map(match => match[1]))];
  assert.ok(keys.length > 0, `${file} uses its catalogue`);
  for (const language of ['en', 'ar']) {
   const catalogue = JSON.parse(readFileSync(`lib/messages/${name}.${language}.json`, 'utf8'));
   for (const key of keys) assert.ok(Object.hasOwn(catalogue, key), `${file}: ${key} in ${name}.${language}.json`);
  }
 }
});
