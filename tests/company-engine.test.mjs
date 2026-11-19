import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineOf, onProfile } from '../lib/bundled-hermes.mjs';
import { engineRecord } from '../lib/engine-record.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { readAgentMemory } from '../lib/agent-memory.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// One module answers "the Engine of this Company" (ADR 0018): its address and its key. The database's Engine record for the
// Company is the source (#380); every Hermes call the app and the worker make asks it for the Company it serves. A Company
// with no record, or one this install cannot decrypt, is one named state (`noEngine`, or the Engine's own `unreachable`),
// never an exception.
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const agent='3a000000-0000-0000-0000-000000000011';
const profile=`ag-${agent.replaceAll('-','')}`;
const engineNames=/BUNDLED_HERMES_URL|HERMES_API_KEY/;
const encryptionKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const sources=()=>['app','lib','worker'].flatMap(folder=>readdirSync(folder,{recursive:true})
 .map(file=>join(folder,file)).filter(file=>/\.(mjs|cjs|js|mts|ts|tsx)$/.test(file)));
// A service-role client that answers the Engine record: one row per Company, its key encrypted as the installer writes it.
const records=rows=>{
 const asked=[];
 return {asked,from:table=>({select:()=>({eq:(column,value)=>({maybeSingle:async()=>{ asked.push({table,column,value});
  return {data:rows[value]??null,error:null}; }})})})};
};
const recordFor=(address,key)=>({address,key_encrypted:encryptSecret(key,encryptionKey)});

test('the install Engine\'s address and key are read only by the module that answers the Engine of a Company', async () => {
 // The installer makes the key once, into `.env.install`; nothing outside the module reads either to call an Engine.
 const named=sources().filter(file=>engineNames.test(readFileSync(file,'utf8')));
 assert.deepEqual(named.sort(),['lib/bundled-hermes.mjs','lib/install-env.mjs']);
 assert.deepEqual(sources().filter(file=>/BUNDLED_HERMES_URL/.test(readFileSync(file,'utf8'))),['lib/bundled-hermes.mjs']);
 // The record answers each Company's Engine, with the key decrypted for the driver alone.
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const db=records({[company]:recordFor('http://hermes:8642','k'.repeat(64))});
  assert.deepEqual(await engineOf(company,db),{address:'http://hermes:8642',key:'k'.repeat(64)});
  // Another Company's record is its own: this one has none, so the module answers null, never the other's.
  assert.equal(await engineOf(other,db),null);
  assert.deepEqual(db.asked,[{table:'company_engines',column:'company_id',value:company},{table:'company_engines',column:'company_id',value:other}]);
  assert.equal(await engineOf(null,db),null);
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});

test('a Company\'s call asks the module for its Engine, and a Company with no reachable Engine gets one named state, not an exception', async t => {
 const saved={BUNDLED_HERMES_URL:process.env.BUNDLED_HERMES_URL,HERMES_API_KEY:process.env.HERMES_API_KEY,WEBHOOK_ENCRYPTION_KEY:process.env.WEBHOOK_ENCRYPTION_KEY};
 t.after(()=>{ for(const [name,value] of Object.entries(saved)) { if(value===undefined) delete process.env[name]; else process.env[name]=value; } });
 const fake=await fakeHermes({managementPort:9119});
 t.after(()=>fake.close());
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.memory.set(profile,{memory:['Prefers short subject lines.'],profile:[]});
 // The signed-in person's own session, naming the Agent and the profile its memory is in.
 const db={rpc:async name=>name==='company_app_agents'?{data:[{agent,profile,main:true}],error:null}:{data:null,error:{message:`unexpected ${name}`}}};
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 // The Engine record is what every route and every worker loop answers from now (#380).
 const record=records({[company]:recordFor(fake.address,fake.settings.key)});
 const hermes=await engineOf(company,record);
 assert.deepEqual(hermes,{address:fake.address,key:fake.settings.key});
 const read=await readAgentMemory(db,{company,agent,hermes});
 assert.equal(read.state,'found');
 assert.deepEqual(read.notes.map(note=>note.text),['Prefers short subject lines.']);
 // It went to that Engine, with that key, on the Agent's own profile.
 const asked=fake.settings.managementRequests.filter(request=>request.path.startsWith('/api/learning/graph'));
 assert.deepEqual(asked.map(request=>request.authorization),['Bearer test-only-key']);
 assert.match(asked[0].path,new RegExp(`profile=${profile}`));
 // The Engine stops answering: the same call answers the one named state the driver gives, and throws nothing.
 await fake.close();
 assert.equal((await readAgentMemory(db,{company,agent,hermes})).state,'unreachable');
 // No Engine record for the Company: the module answers null and the call answers `noEngine`.
 assert.equal(await engineOf(company,records({})),null);
 assert.equal((await readAgentMemory(db,{company,agent,hermes:null})).state,'noEngine');
 // A pin the module refuses is still a value, not a throw: another Company's own profile never opens this Company's Engine.
 assert.deepEqual(onProfile(`co-${company.replaceAll('-','')}`,company,hermes)?.profile,`co-${company.replaceAll('-','')}`);
 assert.equal(onProfile(`co-${other.replaceAll('-','')}`,company,hermes),null);
 assert.equal(onProfile(null,company,hermes),null);
});

test('the record module returns an Engine or nothing, never its ciphertext, and fails closed on a key it cannot decrypt', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const key='engine-key-'.repeat(6);
  const db=records({[company]:recordFor('http://hermes:8642',key)});
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  assert.equal(await engineRecord(db,other),null);
  assert.equal(await engineRecord(db,null),null);
  // A ciphertext written by another install is no Engine, not an exception.
  process.env.WEBHOOK_ENCRYPTION_KEY='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  assert.equal(await engineRecord(db,company),null);
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});
