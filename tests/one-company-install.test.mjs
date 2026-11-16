import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Each Agent has its own Engine profile and memory (ADR 0016): the main Agent keeps what the Company's Agents remembered
// on the Company's profile, and an Agent moved out of it starts empty (#121). A company still on the shared default
// profile of an earlier install shares its memory until it moves (#2, ADR 0014). The README, the installer's closing
// words and the Owner's settings warning say so in the same words.
const sentence='Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory. A company still on the shared default profile from an earlier install shares that memory, so an agent can repeat facts from one company to people in another until it moves.';

test('the README and the install guide say what each Agent remembers, and what a shared profile means',()=>{
 for(const file of ['README.md','scripts/install.sh']) assert.ok(readFileSync(file,'utf8').replace(/\s+/g,' ').includes(sentence),`${file} has the sentence`);
});

test('the Owner\'s warning is the same sentence, in both catalogues',()=>{
 const en=JSON.parse(readFileSync('lib/messages/en.json','utf8')); const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));
 assert.equal(en.sharedEngineWarning,sentence);
 assert.match(ar.sharedEngineWarning,/^[^A-Za-z]+$/,'the Arabic warning is Arabic');
});
