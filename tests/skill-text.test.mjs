import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillLines, compareSkillText } from '../lib/skill-text.mjs';

// #181: a Skill's text is compared line by line when its earlier text can be read. The pinned Engine has no management
// route over the Skill ledger (engine.md), so the page draws one column only; this comparison is still proved, because a
// management route that returns the text before a change would make the two-column page possible. The reference's
// heuristic: a line whose wording changed keeps its first two words and reads as Edited, a line only in one text reads
// as New or Removed.
const tags = side => side.map(entry => entry.tag);

test('a Skill\'s text is its lines, blank ones left out, with the Engine\'s own line breaks', () => {
 assert.deepEqual(skillLines('---\nname: weekly-recap\n\nDo the thing.\n'), ['---', 'name: weekly-recap', 'Do the thing.']);
 assert.deepEqual(skillLines('One\r\nTwo\r\n\r\n'), ['One', 'Two'], 'a browser\'s CRLF and a last line break add no line');
 assert.deepEqual(skillLines(''), []);
});

test('the same text has no tag on either side', () => {
 const compared = compareSkillText('Do the thing.\nSend the recap.', 'Do the thing.\nSend the recap.');
 assert.deepEqual(compared.before.map(entry => entry.text), ['Do the thing.', 'Send the recap.']);
 assert.deepEqual(compared.after.map(entry => entry.text), ['Do the thing.', 'Send the recap.']);
 assert.deepEqual([tags(compared.before), tags(compared.after)], [[null, null], [null, null]]);
});

test('a line only in the newer text is New, and a line only in the older one is Removed', () => {
 const compared = compareSkillText('Write the recap.\nSend it.', 'Write the recap.\nCheck the numbers.\nSend it.');
 assert.deepEqual(compared.before.map(entry => [entry.text, entry.tag]), [['Write the recap.', null], ['Send it.', null]]);
 assert.deepEqual(compared.after.map(entry => [entry.text, entry.tag]), [['Write the recap.', null], ['Check the numbers.', 'new'], ['Send it.', null]]);
 assert.deepEqual(compareSkillText('Write the recap.\nSend it.', 'Write the recap.').before.map(entry => [entry.text, entry.tag]),
  [['Write the recap.', null], ['Send it.', 'removed']]);
});

test('a line whose wording changed, keeping its first two words, is Edited in both texts', () => {
 const compared = compareSkillText('Send the Friday recap to the team.', 'Send the Friday recap by 4pm.');
 assert.deepEqual(compared.before.map(entry => [entry.text, entry.tag]), [['Send the Friday recap to the team.', 'edited']]);
 assert.deepEqual(compared.after.map(entry => [entry.text, entry.tag]), [['Send the Friday recap by 4pm.', 'edited']]);
 // A changed line with different first words is a removal and an addition, never a guess.
 const rewritten = compareSkillText('Write the recap.', 'Check the numbers are right.');
 assert.deepEqual([tags(rewritten.before), tags(rewritten.after)], [['removed'], ['new']]);
});
