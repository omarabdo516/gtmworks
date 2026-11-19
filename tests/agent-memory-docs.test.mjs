import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Each Agent has its own Engine profile and memory (ADR 0016): the main Agent keeps what the Company's Agents remembered
// on the Company's profile, and an Agent moved out of it starts empty (#121). The README and the installer's closing
// words say so in the same words.
const sentence='Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory.';

test('the README and the install guide say what each Agent remembers',()=>{
 for(const file of ['README.md','scripts/install.sh']) assert.ok(readFileSync(file,'utf8').replace(/\s+/g,' ').includes(sentence),`${file} has the sentence`);
});
