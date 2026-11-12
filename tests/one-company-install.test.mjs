import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Until each company has its own Engine home (#2), the companies on the bundled Engine profile share its memory
// (ADR 0010). The README, the installer's closing words and the Owner's settings warning say so in the same sentence.
const sentence='One install serves one company until each company gets its own agent engine home: companies on the bundled agent engine share one agent memory, so an agent can repeat facts from one company to people in another.';

test('the README and the install guide say one install serves one company, and why',()=>{
 for(const file of ['README.md','scripts/install.sh']) assert.ok(readFileSync(file,'utf8').replace(/\s+/g,' ').includes(sentence),`${file} has the sentence`);
});

test('the Owner\'s warning is the same sentence, in both catalogues',()=>{
 const en=JSON.parse(readFileSync('lib/messages/en.json','utf8')); const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));
 assert.equal(en.sharedEngineWarning,sentence);
 assert.match(ar.sharedEngineWarning,/^[^A-Za-z]+$/,'the Arabic warning is Arabic');
});
