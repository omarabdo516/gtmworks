// CI runs this on stdin inside /app in the installed web container, after the conversation check. It proves, on the
// pinned release, that the engine contract creates an Agent as a profile in the bundled Engine through its management
// listener (ADR 0011) with the install key, reads it back, and that a Run then starts for it and is read back.
// It prints states and names only, never the key.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const {engineFor}=await import(`${process.cwd()}/lib/engine.mjs`);

assert.ok(process.env.HERMES_API_KEY,'the install key is in the web container');
const connection={address:'http://hermes:8642',profile:'default',key:process.env.HERMES_API_KEY};
const engine=engineFor(connection);
const name=`install-check-${randomBytes(4).toString('hex')}`;
const instructions='You write short launch posts for the install check.';

const created=await engine.createAgent({name,instructions});
assert.equal(created.state,'created');
assert.equal((await engine.createAgent({name,instructions:'Other.'})).state,'exists');
const found=await engine.readAgent(name);
assert.equal(found.state,'found');
assert.equal(found.agent.instructions,instructions);
assert.equal(found.agent.ready,true);
assert.equal((await engine.readAgent(`${name}-missing`)).state,'missing');
assert.equal((await engineFor({...connection,key:randomBytes(32).toString('hex')}).readAgent(name)).state,'refused');

// One Agent is one profile: a Run for it uses the Agent's name as the profile, with the same key.
const agent=engineFor({...connection,profile:name});
const run=await agent.start({conversation:randomUUID(),input:'مرحباً، اكتب عنواناً قصيراً.',idempotencyKey:randomUUID()});
assert.equal(typeof run,'string','a Run started for the new Agent');
// The Engine knows the Run under that profile; it is read until it ends or a minute passes.
let read;
for(let left=60;left>0;left--) {
 read=await agent.read(run);
 assert.ok(['running','completed','failed','stopped'].includes(read.state),`run read back as ${read.state}`);
 if(read.state!=='running') break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
console.log(JSON.stringify({agent:name,created:created.state,read:found.state,ready:found.agent.ready,run,runState:read.state}));
