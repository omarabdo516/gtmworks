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

// #123, ADR 0016 (Sign-in): with one Company the subscription is signed in once on the root profile, which the Engine
// lends every Agent profile; with several, a root sign-in reaches every Company, so only then does the README warn.
const oneCompany='On an install with one company, the subscription is signed in once on the bundled Hermes\'s root profile from Settings, Subscription and models, and every agent of the company uses it.';
const severalCompanies='On an install with several companies, a subscription signed in on the root profile is shared by every company on the install, and a company that wants its own uses its own API key (#124).';

test('the README says which sign-in an install with one company uses, and warns against the root profile only with several',()=>{
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 for(const sentence of [oneCompany,severalCompanies]) assert.ok(readme.includes(sentence),sentence);
 const warnings=[...readme.matchAll(/do not sign in/gi)].map(match=>match.index);
 assert.equal(warnings.length,1);
 assert.ok(warnings[0]>readme.indexOf(severalCompanies),'the warning follows the several-companies sentence');
});
