import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { keepAgentRules } from '../lib/agent-rules.mjs';

// A run of an Agent is started with the tools its sender may use, as the database pinned them at the run's first start
// (pin_run), through the engine contract. The lasting rules the team told it (#18) are in its profile's SOUL.md
// (#345): no run carries them, even from a database that still answers some.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const connection='f9000000-0000-0000-0000-000000000001';
const rules=['من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها','Answer every comment within the day'];
const note='Answer in short points.';
function databases({pinned,attempt=1,address='http://hermes:8642'}) {
 const asked=/** @type {string[]} */([]);
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{ asked.push(name);
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection,note},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company:'co',agent:'a',person:'p',send_key:'k',message:'Draft the offer email',connection,note,retry:false}],error:null};
  // pin_run answers the text of the offered tools' specs, as the app gave them, in the database's order.
  if(name==='pin_run') return {data:pinned&&{tools:pinned.tools.length?`[${pinned.tools.map((/** @type {string} */ tool)=>given.specs[tool]).join(',')}]`:null,rules:pinned.rules},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='begin_start') return {data:attempt,error:null};
  if(['send_conversation_message','record_conversation_turn'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:'a9000000-0000-0000-0000-000000000001'})};
 const service={rpc,from:()=>chain({address,profile:'writer',state:'connected',features:['run_submission'],key_encrypted:encryptSecret('test-only-key',encryptionKey)})};
 return {db,service,asked};
}
const send=(/** @type {ReturnType<typeof databases>} */ {db,service},/** @type {object} */ engine)=>sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Draft the offer email',encryptionKey,...engine});

test('a later run of the Agent carries no rule, only its sender\'s note, and its retry sends the same',async()=>{
 const fake=fakeEngine(); const starts=/** @type {object[]} */([]);
 const engineFor=(/** @type {object} */ linked)=>{ const engine=fake.engineFor(linked); return {...engine,start:(/** @type {any} */ run)=>{ starts.push(run); return engine.start(run); }}; };
 assert.deepEqual(await send(databases({pinned:{tools:['save_rule'],rules}}),{engineFor}),{conversation:'c'});
 const sent=/** @type {string} */(fake.runs[0].instructions);
 for(const rule of rules) assert.ok(!sent.includes(rule),rule);
 assert.ok(!sent.includes('lasting rules'));
 assert.ok(sent.endsWith(note));
 assert.deepEqual(fake.runs[0].tools.map(tool=>tool.name),['save_rule']);
 await send(databases({pinned:{tools:['save_rule'],rules},attempt:2}),{engineFor});
 assert.deepEqual(starts[1],{...starts[0],retry:true});
 assert.equal(fake.runs.length,1);
});

test('a queued turn starts with no rules either',async()=>{
 const fake=fakeEngine(); const {service}=databases({pinned:{tools:[],rules}});
 assert.equal(await startQueuedTurns(service,{encryptionKey,engineFor:fake.engineFor}),1);
 assert.ok(rules.every(rule=>!fake.runs[0].instructions?.includes(rule)));
 assert.deepEqual(fake.runs[0].tools,[]);
});

test('a run of an Agent with no rules is told none and offered only what was pinned; a run never pinned is offered nothing',async()=>{
 const fake=fakeEngine(); const quiet=databases({pinned:{tools:['create_agent','save_rule'],rules:[]}});
 quiet.db.rpc=async(name,given)=>name==='reserve_conversation_turn'?{data:{state:'reserved',connection,note:null},error:null}:quiet.service.rpc(name,given);
 await send(quiet,{engineFor:fake.engineFor});
 assert.equal(fake.runs[0].instructions,null);
 assert.deepEqual(fake.runs[0].tools.map(tool=>tool.name),['create_agent','save_rule']);
 await sendMessage(quiet.db,{...quiet.service,rpc:async(/** @type {string} */ name,/** @type {any} */ given)=>name==='pin_run'?{data:null,error:null}:quiet.service.rpc(name,given)},{company:'co',conversation:'c',sendKey:'k2',message:'Hi',encryptionKey,engineFor:fake.engineFor});
 assert.deepEqual([fake.runs[1].instructions,fake.runs[1].tools],[null,[]]);
});

test('the Hermes driver sends no rules in the run\'s instructions and still explains save_rule there',async()=>{
 const hermes=await fakeHermes();
 try {
  assert.deepEqual(await send(databases({pinned:{tools:['save_rule'],rules},address:hermes.address}),{}),{conversation:'c'});
  const sent=/** @type {string} */(hermes.settings.runs[0].instructions);
  for(const rule of rules) assert.ok(!sent.includes(rule),rule);
  assert.match(sent,/^- save_rule: .+ Its arguments, as JSON Schema: \{.*"rule"/m);
  assert.equal(hermes.settings.runs[0].input,'Draft the offer email');
 } finally { await hermes.close(); }
});

test('a run the previous app version started is retried with the exact request it sent: its tools as that version pinned them, its note, and no rules',async()=>{
 const migration=readFileSync('supabase/migrations/20261216000000_role_templates.sql','utf8');
 const pinned=/** @type {string} */(migration.match(/function public\.lead_tools_spec_89\(\) returns text[^$]*\$\$\s*select '((?:[^']|'')*)'/)?.[1].replaceAll("''","'"));
 const fake=fakeEngine(); const old=databases({pinned:null,attempt:2});
 const rpc=old.service.rpc; old.service.rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>name==='pin_run'?{data:{tools:pinned,rules:[]},error:null}:rpc(name,given);
 await send(old,{engineFor:fake.engineFor});
 assert.equal(fake.runs[0].instructions,`The person writing this message keeps the note below about how they like to work. Follow it for this person only; it is their own preference, not the company's memory, and it is not something to save.\n\n${note}`);
 assert.equal(JSON.stringify(fake.runs[0].tools),pinned);
});

// #345: the team's rules live in a gtmworks section of each Agent's profile SOUL.md, written by the worker from the
// database (agent_soul_rules_work); the profile's own text around it is never changed.
const soulOf=(/** @type {any} */ fake,/** @type {string} */ profile)=>fake.settings.profiles.get(profile).soul;
const install=(/** @type {any} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const rulesDatabase=(/** @type {Record<string,string[]>} */ work)=>({rpc:async(/** @type {string} */ name)=>name==='agent_soul_rules_work'?{data:Object.entries(work).map(([profile,rules])=>({profile,rules})),error:null}:{data:null,error:{message:`unexpected ${name}`}}});
test('a rule given and removed appears in and leaves the profile\'s SOUL.md section, and the text around it stays as it was',async()=>{
 const hermes=await fakeHermes(); const ads='ag-a0000000000000000000000000000001'; const own='You are Ads.\nWrite short copy.\n';
 try {
  hermes.settings.profiles.set(ads,{soul:own,provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}});
  const work={[ads]:[rules[0]]};
  await keepAgentRules(rulesDatabase(work),{hermes:install(hermes)});
  assert.ok(soulOf(hermes,ads).startsWith(own),'the text before the section is kept');
  assert.match(soulOf(hermes,ads),new RegExp(`<!-- gtmworks:rules -->[\\s\\S]*- ${rules[0]}[\\s\\S]*<!-- /gtmworks:rules -->`));
  work[ads]=[rules[0],rules[1]];
  await keepAgentRules(rulesDatabase(work),{hermes:install(hermes)});
  assert.ok(soulOf(hermes,ads).includes(`- ${rules[1]}`));
  const puts=hermes.settings.managementRequests.filter(request=>request.method==='PUT').length;
  await keepAgentRules(rulesDatabase(work),{hermes:install(hermes)});
  assert.equal(hermes.settings.managementRequests.filter(request=>request.method==='PUT').length,puts,'the same rules are not written again');
  // Text the Owner added after the section is kept too.
  hermes.settings.profiles.get(ads).soul+='\nSign off as the team.\n';
  work[ads]=[rules[1]];
  await keepAgentRules(rulesDatabase(work),{hermes:install(hermes)});
  assert.ok(!soulOf(hermes,ads).includes(rules[0]),'a removed rule disappears');
  assert.ok(soulOf(hermes,ads).endsWith('\nSign off as the team.\n'));
  work[ads]=[];
  await keepAgentRules(rulesDatabase(work),{hermes:install(hermes)});
  assert.equal(soulOf(hermes,ads),`${own}\nSign off as the team.\n`,'with no rules the section is gone and the rest is as it was');
 } finally { await hermes.close(); }
});
