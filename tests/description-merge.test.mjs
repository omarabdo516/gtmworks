import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDescriptions } from '../lib/description-merge.mjs';

// #680: two people, or a person and a tick, changing one description at once lose nothing.
const base = '# Brief\n- [ ] Hook\n- [ ] Caption\nNotes';

test('changes to different lines both stay', () => {
 const mine = '# Brief\n- [ ] Hook\n- [ ] Caption, shorter\nNotes';
 const theirs = '# Brief, June\n- [ ] Hook\n- [ ] Caption\nNotes';
 assert.deepEqual(mergeDescriptions(base, mine, theirs), { text: '# Brief, June\n- [ ] Hook\n- [ ] Caption, shorter\nNotes', conflicted: false });
});

test('a tick and a typed line elsewhere both stay', () => {
 const ticked = '# Brief\n- [x] Hook\n- [ ] Caption\nNotes';
 const typed = '# Brief\n- [ ] Hook\n- [ ] Caption\nNotes and more';
 assert.deepEqual(mergeDescriptions(base, typed, ticked), { text: '# Brief\n- [x] Hook\n- [ ] Caption\nNotes and more', conflicted: false });
});

test('changes on neighbouring lines both stay', () => {
 const ticked = '# Brief\n- [x] Hook\n- [ ] Caption\nNotes';
 const typed = '# Brief\n- [ ] Hook\n- [ ] Caption, short\nNotes';
 const titled = '# Brief, June\n- [x] Hook\n- [ ] Caption\nNotes';
 assert.deepEqual(mergeDescriptions(base, typed, ticked), { text: '# Brief\n- [x] Hook\n- [ ] Caption, short\nNotes', conflicted: false });
 assert.deepEqual(mergeDescriptions(base, typed, titled), { text: '# Brief, June\n- [x] Hook\n- [ ] Caption, short\nNotes', conflicted: false });
});

test('a line both changed keeps both choices, the one saved first before the one being saved', () => {
 const mine = '# Brief\n- [ ] Hook, bold\n- [ ] Caption\nNotes';
 const theirs = '# Brief\n- [ ] Hook, short\n- [ ] Caption\nNotes';
 assert.deepEqual(mergeDescriptions(base, mine, theirs), { text: '# Brief\n- [ ] Hook, short\n- [ ] Hook, bold\n- [ ] Caption\nNotes', conflicted: true });
});

test('the same change twice, or a change on one side only, is taken as it is', () => {
 const same = '# Brief\n- [ ] Hook\nNotes';
 assert.deepEqual(mergeDescriptions(base, same, same), { text: same, conflicted: false });
 assert.deepEqual(mergeDescriptions(base, base, same), { text: same, conflicted: false });
 assert.deepEqual(mergeDescriptions(base, same, base), { text: same, conflicted: false });
});

test('lines added at the same place by both are both kept', () => {
 const mine = base + '\nMine';
 const theirs = base + '\nTheirs';
 const merged = mergeDescriptions(base, mine, theirs);
 assert.equal(merged.text, base + '\nTheirs\nMine');
});
