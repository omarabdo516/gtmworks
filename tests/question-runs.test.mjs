import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedOf } from '../lib/run-parts.mjs';

// #138: the question a Run asks, as its card keeps it (lib/run-parts.mjs askedOf, which a channel's Run uses).
test('a question longer than the card keeps is shortened between characters, never inside one',()=>{
 const long=`${'a'.repeat(3998)}😀😀b`;
 const kept=askedOf({id:'q1',text:long,choices:['Yes','No'],multiple:false}).text;
 assert.equal(kept,`${'a'.repeat(3998)}😀…`);
 assert.ok(kept.isWellFormed(),'no half of a surrogate pair is left');
});
