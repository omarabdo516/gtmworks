import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// A run of an Agent is started with the lasting rules the team told it (#18) and the tools its sender may use, as the
// database pinned them at the run's first reservation (pinned_run), through the engine contract.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const connection='f9000000-0000-0000-0000-000000000001';
const rules=['من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها','Answer every comment within the day'];
const note='Answer in short points.';
function databases({pinned,attempt=1,address='http://hermes:8642'}) {
 const asked=/** @type {string[]} */([]);
 const rpc=async(/** @type {string} */ name)=>{ asked.push(name);
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection,note},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company:'co',agent:'a',person:'p',send_key:'k',message:'Draft the offer email',connection,note,retry:false}],error:null};
  if(name==='pinned_run') return {data:pinned,error:null};
  if(name==='begin_start') return {data:attempt,error:null};
  if(['send_conversation_message','record_conversation_turn'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:'a9000000-0000-0000-0000-000000000001'})};
 const service={rpc,from:()=>chain({address,profile:'writer',state:'connected',features:['run_submission'],key_encrypted:encryptSecret('test-only-key',encryptionKey)})};
 return {db,service,asked};
}
const send=(/** @type {ReturnType<typeof databases>} */ {db,service},/** @type {object} */ engine)=>sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Draft the offer email',encryptionKey,...engine});

test('a later run of the Agent carries every rule in force before its sender\'s note, and its retry sends the same',async()=>{
 const fake=fakeEngine(); const starts=/** @type {object[]} */([]);
 const engineFor=(/** @type {object} */ linked)=>{ const engine=fake.engineFor(linked); return {...engine,start:(/** @type {any} */ run)=>{ starts.push(run); return engine.start(run); }}; };
 assert.deepEqual(await send(databases({pinned:{tools:['save_rule'],rules}}),{engineFor}),{conversation:'c'});
 const sent=/** @type {string} */(fake.runs[0].instructions);
 for(const rule of rules) assert.ok(sent.includes(`- ${rule}`),rule);
 assert.ok(sent.indexOf(rules[1])<sent.indexOf(note),'the rules come before the note');
 assert.ok(sent.endsWith(note));
 assert.deepEqual(fake.runs[0].tools.map(tool=>tool.name),['save_rule']);
 await send(databases({pinned:{tools:['save_rule'],rules},attempt:2}),{engineFor});
 assert.deepEqual(starts[1],{...starts[0],retry:true});
 assert.equal(fake.runs.length,1);
});

test('a queued turn starts with the Agent\'s rules too',async()=>{
 const fake=fakeEngine(); const {service}=databases({pinned:{tools:[],rules}});
 assert.equal(await startQueuedTurns(service,{encryptionKey,engineFor:fake.engineFor}),1);
 assert.ok(rules.every(rule=>fake.runs[0].instructions?.includes(rule)));
 assert.deepEqual(fake.runs[0].tools,[]);
});

test('a run of an Agent with no rules is told none, and is offered the pinned tools this version knows, in one order',async()=>{
 const fake=fakeEngine(); const quiet=databases({pinned:{tools:['save_rule','delete_company','create_agent'],rules:[]}});
 quiet.db.rpc=async name=>name==='reserve_conversation_turn'?{data:{state:'reserved',connection,note:null},error:null}:quiet.service.rpc(name);
 await send(quiet,{engineFor:fake.engineFor});
 assert.equal(fake.runs[0].instructions,null);
 assert.deepEqual(fake.runs[0].tools.map(tool=>tool.name),['create_agent','save_rule']);
 // A run pinned before #18, or never pinned, is told no rules and offered nothing more.
 await sendMessage(quiet.db,{...quiet.service,rpc:async(/** @type {string} */ name)=>name==='pinned_run'?{data:null,error:null}:quiet.service.rpc(name)},{company:'co',conversation:'c',sendKey:'k2',message:'Hi',encryptionKey,engineFor:fake.engineFor});
 assert.deepEqual([fake.runs[1].instructions,fake.runs[1].tools],[null,[]]);
});

test('the Hermes driver sends the rules in the run\'s instructions and explains save_rule there',async()=>{
 const hermes=await fakeHermes();
 try {
  assert.deepEqual(await send(databases({pinned:{tools:['save_rule'],rules},address:hermes.address}),{}),{conversation:'c'});
  const sent=/** @type {string} */(hermes.settings.runs[0].instructions);
  for(const rule of rules) assert.ok(sent.includes(rule),rule);
  assert.match(sent,/^- save_rule: .+ Its arguments, as JSON Schema: \{.*"rule"/m);
  assert.equal(hermes.settings.runs[0].input,'Draft the offer email');
 } finally { await hermes.close(); }
});

test('a run the previous app version started is retried with the exact request it sent: its note alone and create_agent as #13 offered it',async()=>{
 const fake=fakeEngine();
 await send(databases({pinned:{tools:['create_agent'],rules:[]},attempt:2}),{engineFor:fake.engineFor});
 assert.equal(fake.runs[0].instructions,`The person writing this message keeps the note below about how they like to work. Follow it for this person only; it is their own preference, not the company's memory, and it is not something to save.\n\n${note}`);
 assert.deepEqual(fake.runs[0].tools,[{name:'create_agent',
  description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that.',
  parameters:{type:'object',additionalProperties:false,required:['name','job','apps'],properties:{
   name:{type:'string',maxLength:100,description:'A short name for the agent.'},
   job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
   apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'}}}}]);
});
