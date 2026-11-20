import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { generateInstallEnv } from '../lib/install-env.mjs';
import { proof, proofName, writeProof, writeName } from '../lib/install-proof.mjs';
import { installJob } from './install-job.mjs';

// The agents area's proof (#126) runs on the pinned Engine, against a real install: four Agents in two Companies, the
// shared space of each, and a key set for one Company. The capacity of twenty more Agent profiles is the measurement
// area's, which no pull request runs (#408). The proof prints names, states and counts only, and a unit test here holds
// that no value of the install's own environment can be printed (#2, ADR 0014, ADR 0016). The figures the README states
// come from the measurement job's log.
const script=readFileSync('scripts/check-install-profiles.mjs','utf8');

test('the install proof prints no value from .env.install, only the fields it names', () => {
 const env=generateInstallEnv();
 const output=proof({step:'verify',companies:[{company:'c0000000-0000-4000-8000-000000000001',profile:'co-c0000000000040008000000000000001'}],
  memory:[true,false,false,false],skills:[true,true,false,false],keys:[true,true,false,false,false,false],...env,
  apiKey:env.HERMES_API_KEY,connection:`http://gtmworks-engine-first:8642`});
 for(const [name,value] of Object.entries(env)) assert.ok(!output.includes(value),`${name} is not printed`);
 const kept=JSON.parse(output);
 assert.equal(kept.step,'verify');
 assert.equal(kept.companies[0].profile,'co-c0000000000040008000000000000001');
 assert.ok(!('apiKey' in kept)&&!('connection' in kept),'only the named fields are kept');
});

test('the proof prints a bare name alone, as the install job reads the first Company\'s profile', () => {
 assert.equal(proofName('co-c0000000000040008000000000000001'),'co-c0000000000040008000000000000001\n');
});

test('the proof script never prints on its own, so every line goes through the proof\'s named fields', () => {
 assert.match(script,/install-proof\.mjs/);
 assert.doesNotMatch(script,/\bconsole\.(log|error|warn|info)\(/, 'no console call prints a value the proof did not name');
 assert.doesNotMatch(script,/process\.stdout\.write\(/, 'no direct write bypasses the proof');
});

// The README carries the figures the first green install run measured: twenty more Agent profiles in one Company, the
// Engine's memory around them, and the disk one profile takes with and without its bundled Skills (CI run 44398966783).
// The sentence's shape is pinned here so a rewrite cannot drop one, and no figure is left a placeholder.
const figure=String.raw`\d+(?:\.\d+)?(?: to \d+(?:\.\d+)?)?(?: ?(?:KiB|MiB|GiB))?`;
const sentence=new RegExp(String.raw`An install was proven with four Agents across two Companies, and twenty more Agent profiles for capacity: each of the 20 took ${figure} seconds to be ready, the Engine held ${figure} before and ${figure} after making them, and one profile takes ${figure} KiB of disk with the Engine's bundled Skills and ${figure} KiB without\.`);

test('the README states the figures the install job measured, and the number of Agents proven', () => {
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 assert.match(readme,sentence);
 assert.doesNotMatch(readme,/\bTBD\b/,'every figure is the measured value');
});

// The agents area proves the database refuses another Company's profile. The capacity step left it for the measurement
// area, which no pull request runs (#408): the measurement makes its own install and the two Companies its prepare step
// reads, then measures twenty more profiles on the first Company's Engine.
test('the agents area proves the database refuses another Company\'s profile, and the measurement fills the capacity step', () => {
 const job=installJob().steps.map(step=>step.run||'').join('\n');
 assert.match(job,/insert into public\.hermes_agents/);
 assert.match(job,/hermesProfileNotShared/);
 assert.ok(job.includes('capacity with-skills'),'the capacity step runs');
 const measure=job.slice(job.indexOf('measure() {'),job.indexOf('case "${1:-all}"'));
 assert.match(measure,/docker stats --no-stream/);
 assert.match(measure,/du -sk/);
 assert.match(measure,/--volumes-from/);
 const prepared=job.indexOf('- prepare < scripts/check-install-profiles.mjs');
 const capacity=job.indexOf('capacity with-skills');
 assert.ok(prepared>=0&&capacity>prepared,'capacity runs after its own prepare made the pair it reads');
 // The secrets scan covers the twenty profiles too: it runs in measure after both capacity steps.
 assert.ok(measure.indexOf('check-hermes-keys.py')>measure.indexOf('capacity no-skills'),'the keys scan runs after the capacity profiles');
});

test('the script\'s printers write the proof\'s line and the bare name, and nothing else', t => {
 const written=[];
 t.mock.method(process.stdout,'write',chunk=>{ written.push(String(chunk)); return true; });
 writeProof({step:'capacity',seconds:1.5,key:'not printed'});
 writeName('co-c0000000000040008000000000000001');
 t.mock.restoreAll();
 assert.deepEqual(written,[proof({step:'capacity',seconds:1.5}),'co-c0000000000040008000000000000001\n']);
});
