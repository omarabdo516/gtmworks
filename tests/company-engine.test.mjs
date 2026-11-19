import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineOf, onProfile } from '../lib/bundled-hermes.mjs';
import { readAgentMemory } from '../lib/agent-memory.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// One module answers "the Engine of this Company" (ADR 0018): its address and its key. Every Hermes call the app and the
// worker make asks it for the Company it serves, so a Company on its own Engine is a change behind this seam alone. Until
// #380 keeps an Engine record per Company, every Company is served by the install's one Engine, and a Company with no
// Engine to reach is one named state (`noEngine`, or the Engine's own `unreachable`), never an exception.
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const agent='3a000000-0000-0000-0000-000000000011';
const profile=`ag-${agent.replaceAll('-','')}`;
const engineNames=/BUNDLED_HERMES_URL|HERMES_API_KEY/;
const sources=()=>['app','lib','worker'].flatMap(folder=>readdirSync(folder,{recursive:true})
 .map(file=>join(folder,file)).filter(file=>/\.(mjs|cjs|js|mts|ts|tsx)$/.test(file)));

test('the install Engine\'s address and key are read only by the module that answers the Engine of a Company', () => {
 // The installer makes the key once, into `.env.install`; nothing outside the module reads either to call an Engine.
 const named=sources().filter(file=>engineNames.test(readFileSync(file,'utf8')));
 assert.deepEqual(named.sort(),['lib/bundled-hermes.mjs','lib/install-env.mjs']);
 assert.deepEqual(sources().filter(file=>/BUNDLED_HERMES_URL/.test(readFileSync(file,'utf8'))),['lib/bundled-hermes.mjs']);
 // Every call names its Company, and the module answers the install's one Engine for each of them today.
 const env={BUNDLED_HERMES_URL:'http://hermes:8642',HERMES_API_KEY:'k'.repeat(64)};
 assert.deepEqual(engineOf(company,env),{address:'http://hermes:8642',key:'k'.repeat(64)});
 assert.deepEqual(engineOf(other,env),engineOf(company,env));
 assert.equal(engineOf(company,{}),null,'no Engine is a value, never a throw');
});

test('a Company\'s call asks the module for its Engine, and a Company with no reachable Engine gets one named state, not an exception', async t => {
 const saved={BUNDLED_HERMES_URL:process.env.BUNDLED_HERMES_URL,HERMES_API_KEY:process.env.HERMES_API_KEY};
 t.after(()=>{ for(const [name,value] of Object.entries(saved)) { if(value===undefined) delete process.env[name]; else process.env[name]=value; } });
 const fake=await fakeHermes({managementPort:9119});
 t.after(()=>fake.close());
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.memory.set(profile,{memory:['Prefers short subject lines.'],profile:[]});
 // The signed-in person's own session, naming the Agent and the profile its memory is in.
 const db={rpc:async name=>name==='company_app_agents'?{data:[{agent,profile,main:true}],error:null}:{data:null,error:{message:`unexpected ${name}`}}};
 // The app's and the worker's environment is the only place the module reads its Engine from today, so a call with no
 // `hermes` given is the call every route and every worker loop makes.
 process.env.BUNDLED_HERMES_URL=fake.address;
 process.env.HERMES_API_KEY=fake.settings.key;
 assert.deepEqual(engineOf(company),{address:fake.address,key:fake.settings.key});
 const read=await readAgentMemory(db,{company,agent});
 assert.equal(read.state,'found');
 assert.deepEqual(read.notes.map(note=>note.text),['Prefers short subject lines.']);
 // It went to that Engine, with that key, on the Agent's own profile.
 const asked=fake.settings.managementRequests.filter(request=>request.path.startsWith('/api/learning/graph'));
 assert.deepEqual(asked.map(request=>request.authorization),['Bearer test-only-key']);
 assert.match(asked[0].path,new RegExp(`profile=${profile}`));
 // The Engine stops answering: the same call answers the one named state the driver gives, and throws nothing.
 await fake.close();
 assert.equal((await readAgentMemory(db,{company,agent})).state,'unreachable');
 // No Engine at all for the Company: the module answers null and the call answers `noEngine`.
 delete process.env.BUNDLED_HERMES_URL;
 delete process.env.HERMES_API_KEY;
 assert.equal(engineOf(company),null);
 assert.equal((await readAgentMemory(db,{company,agent})).state,'noEngine');
 // A pin the module refuses is still a value, not a throw: another Company's own profile never opens this Company's Engine.
 const pin=engineOf(company,{BUNDLED_HERMES_URL:'http://hermes:8642',HERMES_API_KEY:'k'.repeat(64)});
 assert.deepEqual(onProfile(`co-${company.replaceAll('-','')}`,company,pin)?.profile,`co-${company.replaceAll('-','')}`);
 assert.equal(onProfile(`co-${other.replaceAll('-','')}`,company,pin),null);
 assert.equal(onProfile(null,company,pin),null);
});
