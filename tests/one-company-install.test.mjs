import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Each company has its own Engine profile (#2, ADR 0014); a company still on the shared default profile of an earlier
// install shares its memory until it moves. The README, the installer's closing words and the Owner's settings warning
// say so in the same sentence.
const sentence='Each company gets its own agent engine profile, with its own memory and sign-in; a company still on the shared default profile from an earlier install shares that memory, so an agent can repeat facts from one company to people in another until it moves.';

test('the README and the install guide say each company has its own profile, and what a shared one means',()=>{
 for(const file of ['README.md','scripts/install.sh']) assert.ok(readFileSync(file,'utf8').replace(/\s+/g,' ').includes(sentence),`${file} has the sentence`);
});

test('the Owner\'s warning is the same sentence, in both catalogues',()=>{
 const en=JSON.parse(readFileSync('lib/messages/en.json','utf8')); const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));
 assert.equal(en.sharedEngineWarning,sentence);
 assert.match(ar.sharedEngineWarning,/^[^A-Za-z]+$/,'the Arabic warning is Arabic');
});
