import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { withTurnQueue } from './turn-queue.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { startUnknown } from '../lib/engine/runs.mjs';

// #143: the main Agent's Runs carry the brief its own person's Role calls for — its team, and the one question to ask
// for work no Agent of theirs does. The brief is pinned by the database on the first start (supabase/tests/lead_offer.sql
// proves the pin, the roles and the Agents a person sees); this reads what reaches the engine, by Role, for a send and
// for a turn that waited.
const hermes={address:'http://127.0.0.1:9',key:'fake-engine-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['10000000-0000-0000-0000-000000000001']) engineRecord(company,hermes);
const company='10000000-0000-0000-0000-000000000001';
const agent='a9000000-0000-0000-0000-000000000001';
const conversation='c1000000-0000-0000-0000-000000000001';
const sendKey='s1000000-0000-0000-0000-000000000001';
const briefs={
 owner:{role:'owner',owner:'Omar',agents:[{name:'Reach',job:'Plans the Meta ads.'}]},
 manager:{role:'manager',owner:'Omar',agents:[{name:'Reach',job:'Plans the Meta ads.'}]},
 contributor:{role:'contributor',owner:'Omar',agents:[]},
 viewer:{role:'viewer',owner:'Omar',agents:[{name:'Reach',job:'Plans the Meta ads.'}]},
};

// A stand-in for the database around one message: the reservation, the pins a Run makes and the message it records.
// `tools` are the names run_tools gives the Run's person (#167): pin_run answers those of the texts it was sent.
function database({brief,main=true,tools=null}={}) {
 const calls=[];
 const ok=data=>({data,error:null});
 const agentRow={id:agent,instructions:null,is_default:main};
 const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok(agentRow)};
 const rpc=async(name,args)=>{
  calls.push([name,args]);
  if(name==='conversation_agent') return ok(null);
  if(name==='reserve_conversation_turn') return ok({state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',profile:'writer',note:null});
  if(name==='conversation_handover_agents') return ok([{name:'Ads',job:'Meta ads'}]);
  if(name==='pin_run') return ok({tools:tools?JSON.stringify(tools.map(tool=>JSON.parse(args.specs[tool]))):null});
  if(name==='pin_run_history'||name==='pin_run_model') return ok(null);
  if(name==='pin_lead_brief') return ok(main?brief??null:null);
  if(name==='begin_turn_start') return ok(1);
  if(name==='send_conversation_message'||name==='record_conversation_turn') return ok(true);
  if(name==='queued_conversations') return ok([{conversation}]);
  if(name==='claim_conversation_turn') return ok([{company,agent,person:'p1000000-0000-0000-0000-000000000001',send_key:sendKey,message:'Do the Meta ads',connection:'f9000000-0000-0000-0000-000000000001',profile:'writer',note:null,retry:false}]);
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const queued=withTurnQueue(rpc);
 return {db:{rpc:queued,from:()=>chain},service:{rpc:queued,from:()=>chain},calls};
}
const send=async({db,service},fake)=>withEngineContract(fake.engineFor,()=>sendMessage(db,service,{company,conversation,sendKey,agent,message:'Do the Meta ads'}));

test('an Owner\'s Run is told "Make it?" with "Not now", and the team that person sees, beside Lead',async()=>{
 const fake=fakeEngine(); const store=database({brief:briefs.owner});
 assert.deepEqual(await send(store,fake),{conversation});
 const text=fake.runs[0].instructions;
 assert.match(text,/"Make it\?" with the choices "Make it" and "Not now"/);
 assert.match(text,/«اعمله»/);
 assert.match(text,/- Reach: Plans the Meta ads\./);
 assert.doesNotMatch(text,/Ask Omar for it\?/);
 assert.deepEqual(store.calls.filter(([name])=>name==='pin_lead_brief'),[['pin_lead_brief',{conversation,message_key:sendKey}]]);
});

test('a Manager\'s and a Contributor\'s Run is told to ask the Owner by first name, and to request an Agent',async()=>{
 for(const role of ['manager','contributor']) {
  const fake=fakeEngine(); const store=database({brief:briefs[role]});
  assert.deepEqual(await send(store,fake),{conversation},role);
  const text=fake.runs[0].instructions;
  assert.match(text,/"Ask Omar for it\?" with the choices "Ask Omar for it" and "Not now"/,role);
  assert.match(text,/«اطلبه من Omar»/,role);
  assert.match(text,/call request_agent in the same run/,role);
  assert.doesNotMatch(text,/"Make it\?" with the choices/,role);
 }
});

test('a Viewer\'s Run is told the team and no offer at all',async()=>{
 const fake=fakeEngine(); const store=database({brief:briefs.viewer});
 await send(store,fake);
 const text=fake.runs[0].instructions;
 for(const word of ['"Make it?"','"Not now"','Ask Omar for it?','create_agent','request_agent','اعمله']) assert.ok(!text.includes(word),word);
 assert.match(text,/- Reach: Plans the Meta ads\./);
});

test('a retry sends the same pinned brief, read again from the database for the same Run',async()=>{
 const fake=fakeEngine(); const store=database({brief:briefs.owner}); const started=[];
 // Every start of the fake Engine is recorded before it deduplicates a key, so a retry's own instructions are read.
 const engineFor=(/** @type {object} */ connection)=>{ const engine=fake.engineFor(connection);
  return {...engine,start:async(/** @type {any} */ args)=>{ started.push(args); const run=await engine.start(args); return lose-->0?startUnknown:run; }}; };
 // The first start's answer is lost, so the one starter of turns (#764) asks again with the same key.
 let lose=1;
 assert.deepEqual(await withEngineContract(engineFor,()=>sendMessage(store.db,store.service,{company,conversation,sendKey,agent,message:'Do the Meta ads'})),{conversation,queued:true});
 const first=fake.runs[0].instructions;
 assert.equal(await withEngineContract(engineFor,()=>startQueuedTurns(store.service,{})),1);
 assert.equal(started.length,2,'each attempt asks the Engine to start the Run');
 assert.deepEqual(started.map(start=>start.instructions),[first,first],'and both carry the same pinned brief');
 assert.equal(fake.runs.length,1,'the same send key is the same Run');
 assert.equal(store.calls.filter(([name])=>name==='pin_lead_brief').length,2,'each attempt reads the Run\'s one pinned brief');
});

test('another Agent\'s Run is told nothing of the person\'s team: the main Agent alone makes the offer',async()=>{
 const fake=fakeEngine(); const store=database({brief:briefs.owner,main:false});
 await send(store,fake);
 assert.equal(fake.runs[0].instructions,null);
 // The starter asks for every turn's brief (the service role may not read which Agent is the main one), and the
 // database answers none for any other Agent.
 assert.deepEqual(store.calls.filter(([name])=>name==='pin_lead_brief').length,1);
});

test('a Lead Run that waited starts with the same pinned brief',async()=>{
 const fake=fakeEngine(); const store=database({brief:briefs.manager});
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(store.service,{})),1);
 assert.match(fake.runs[0].instructions,/"Ask Omar for it\?" with the choices "Ask Omar for it" and "Not now"/);
 assert.deepEqual(store.calls.filter(([name])=>name==='pin_lead_brief'),[['pin_lead_brief',{conversation,message_key:sendKey}]]);
});

// #167: a Contributor with an Agent hidden from them is offered ask_to_open_agent, and told the Agent's job and never its
// name; one with none is offered neither. The database decides both (supabase/tests/agent_access_requests.sql); this
// reads what reaches the Engine.
test('a Contributor\'s Run carries ask_to_open_agent and the hidden job only while an Agent is hidden from them',async()=>{
 const withHidden=database({brief:{...briefs.contributor,hidden:[{job:'Campaigns and ads',asks:'Sara',role:'manager'}]},tools:['request_agent','ask_to_open_agent']});
 const fake=fakeEngine();
 await send(withHidden,fake);
 assert.deepEqual(fake.runs[0].tools.map(tool=>tool.name),['request_agent','ask_to_open_agent']);
 assert.match(fake.runs[0].instructions,/- "Campaigns and ads": say ".*Should I ask Sara \(Manager\) to open it for you\?"/);
 assert.doesNotMatch(fake.runs[0].instructions,/Reach/,'the hidden Agent is never named');
 const none=database({brief:briefs.contributor,tools:['request_agent']}); const other=fakeEngine();
 await send(none,other);
 assert.deepEqual(other.runs[0].tools.map(tool=>tool.name),['request_agent']);
 assert.doesNotMatch(other.runs[0].instructions,/ask_to_open_agent|isn't available to you/);
});
