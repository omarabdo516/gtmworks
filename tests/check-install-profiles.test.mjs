import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { generateInstallEnv } from '../lib/install-env.mjs';
import { proof, proofName, writeProof, writeName, stepClock } from '../lib/install-proof.mjs';
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

// The Library shows the Company's work folder (#395): the agents-sandbox area (#553) has an Agent write a file and a picture in its own
// folder, lists, previews and downloads them through gtmworks, and tries a write from the Engine's container as root and
// as its own user, which must fail.
test('the agents-sandbox area proves an Agent\'s file reaches its Library, and a write from the Engine fails', () => {
 const job=installJob().steps.map(step=>step.run||'').join('\n');
 const sandbox=job.indexOf('- sandbox "$sandbox_marker" < scripts/check-install-profiles.mjs');
 const library=job.indexOf('- library "$library_marker" < scripts/check-install-profiles.mjs');
 assert.ok(sandbox>=0&&library>sandbox,'the Library step runs in the agents-sandbox area, after the sandbox made the Agent\'s folder');
 assert.match(job,/for user in 0 hermes; do\n\s+if docker exec --user "\$user" "\$engine_id" sh -c 'printf x > "\/opt\/data\/work\//);
 assert.match(script,/step==='library'/);
 for(const read of ['agentLibrary(person','agentFilePreview(person','agentFileDownload(person']) assert.ok(script.includes(read),`${read} is the app's own service`);
});

// #553: the agents-sandbox area runs the sandbox steps without the verify step, so the `second` step makes the first
// Company's second Agent alone. Both steps make it through one helper, so the Agent the sandbox steps start in is made
// exactly as verify makes it, and `second` keeps it in the state file the sandbox steps read.
test('the verify and second steps make the first Company\'s second Agent through one helper', () => {
 const branch=name=>script.slice(script.indexOf(`step==='${name}') {`),script.indexOf('} else if(',script.indexOf(`step==='${name}') {`)));
 assert.equal(script.match(/lead_create_agent',\{conversation:first\.conversation/g).length,1,'one place makes the first Company\'s second Agent');
 for(const name of ['verify','second']) assert.match(branch(name),/await makeFirstSecondAgent\(/,`${name} makes it through the helper`);
 assert.match(branch('second'),/writeFileSync\(state,/,'second keeps the Agent for the sandbox steps');
 assert.match(branch('second'),/checkProfile\(firstEngine,first\.secondProfile\)/,'second checks the moved Agent\'s profile');
});

// Spec #831 (#833): the board's proof works only through the Engine's own Kanban routes and the dispatcher. It asks for a
// dispatch tick and starts no Run for a Card itself: its one Conversation is the main Agent's, asked to make a Card for
// the second Agent. A Card is never deleted, only worked to its end; and what the step found is printed through the
// proof's own named field, so the install job and a reader of the log see it.
test('the Kanban step works a Card through the Engine\'s own routes and its dispatcher, never a Run of its own', () => {
 const start=script.indexOf("step==='kanban') {");
 assert.ok(start>0,'the step exists');
 const branch=script.slice(start,script.indexOf('} else if(',start)>0?script.indexOf('} else if(',start):undefined);
 assert.match(branch,/\/api\/plugins\/kanban/);
 assert.match(branch,/'\/dispatch/,'the step asks the Engine for a dispatch tick');
 assert.doesNotMatch(branch,/method:'DELETE'/,'no Card is deleted');
 assert.equal(branch.match(/sendMessage\(/g)?.length,1,'one Conversation, the main Agent\'s');
 assert.doesNotMatch(branch,/\/v1\/runs|\/v1\/chat|\/v1\/responses/,'no Run API call of its own');
 assert.match(branch,/single_query_mode:'deny'/,'a profile\'s own write tries to turn the board worker\'s setting off');
 assert.match(branch,/writeProof\(\{step:'kanban',marker,sandbox_host:/);
 const kept=JSON.parse(proof({step:'kanban',board:{card:'t_1',told:true},secret:'x'}));
 assert.deepEqual(kept,{step:'kanban',board:{card:'t_1',told:true}},'the board\'s findings are a named field of the proof');
});

// Spec #831 (#833): the step ran past its area's 12 minutes on run 45841934073 having printed nothing. Its time is now its
// clock's: a budget that fits the open-design area beside what it ran before, a line as each phase ends, every wait
// held inside the budget (the waits it makes itself and the fake model's hold on a reviewer alike), and no fixed wait for
// the triage Card, which is read once the decomposer was called twice or its two ticks are past. A failure prints the
// Cards as the board reads them, through the proof's named field, before the step ends.
test('the Kanban step holds every wait inside its own budget and says how far it got', () => {
 const start=script.indexOf("step==='kanban') {");
 const branch=script.slice(start,script.indexOf('} else if(',start));
 const budget=Number(branch.match(/stepClock\('kanban',(\d+)\)/)?.[1]);
 assert.ok(budget>0&&budget<=270,`a budget inside the area's minutes: ${budget}`);
 assert.ok(branch.match(/clock\.phase\(/g)?.length>=10,'a line as each phase ends');
 // Each call whole, to its closing parenthesis; the one helper that passes its caller's seconds on is not a wait itself.
 const calls=name=>[...branch.matchAll(new RegExp(`\\b${name}\\(`,'g'))].map(({index})=>{
  let depth=0;
  for(let at=index+name.length;at<branch.length;at++) if(branch[at]==='(') depth++; else if(branch[at]===')'&&--depth===0) return branch.slice(index,at+1);
  return branch.slice(index);
 });
 const waits=[...calls('until'),...calls('reaches')].filter(found=>!found.endsWith(',seconds)'));
 assert.ok(waits.length>=8,`the step waits on the board: ${waits.length}`);
 for(const wait of waits) assert.match(wait,/clock\.within\(/,`every wait is inside the budget: ${wait}`);
 assert.doesNotMatch(branch,/setTimeout\(resolve,\d/,'no fixed wait of its own');
 assert.doesNotMatch(branch,/125_000/,'the triage Card is read when its two ticks are seen, not after a fixed wait');
 assert.match(branch,/catch\(error\) \{[\s\S]*?clock\.phase\('failed',\{marker,board:\{[\s\S]*?cards:await shownCards\(\)/,'a failure prints the Cards as the board reads them');
});

// Spec #831 (#833): a long step of the proof says how far it got as it goes and holds a deadline of its own inside its
// area's minutes. Its clock prints one line of named fields as each phase ends, with the whole seconds since the step
// began, and gives each wait the seconds it asked for, never more than the step has left; once they are spent a wait
// fails naming the step, its budget and the last phase it reached, so a slow Engine fails the step with how far it got
// before the job's own limit cancels it with nothing said.
test('a step\'s clock prints each phase as it ends and keeps every wait inside the step\'s own deadline', () => {
 let at=1_000_000;
 const written=[];
 const clock=stepClock('kanban',100,{now:()=>at,write:figures=>written.push(proof(figures))});
 at+=12_400;
 clock.phase('Card A started',{board:{card:'t_1'},secret:'x'});
 assert.deepEqual(written.map(line=>JSON.parse(line)),[{step:'kanban',seconds:12,board:{card:'t_1'},phase:'Card A started'}],'named fields only');
 assert.equal(clock.within(30),30,'a wait gets what it asks for while the step has time');
 at+=80_000;
 assert.equal(clock.within(30),7,'and never more than the step has left');
 at+=7_600;
 assert.throws(()=>clock.within(30),/kanban: its 100 s are spent after Card A started/);
 assert.equal(clock.left(),0);
});
