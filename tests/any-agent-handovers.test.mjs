import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { withTurnQueue } from './turn-queue.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { startUnknown } from '../lib/hermes.mjs';
import { conversationHandOverSpec, conversationToolSpecTexts, toolSpecTexts } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #475 (decision 0057): any Agent of a Company hands a job to any other Agent of it from a Conversation. A Company of
// three, Lead, Ads and Writer: a person writes to Writer, and the Writer's Run is offered hand_to_agent naming Lead and
// Ads with their jobs, never itself, as the database lists them (conversation_handover_agents, proved in
// supabase/tests/handovers.sql). The text is the one pin_run pins, so a retry sends the same request.
const hermes={address:'http://127.0.0.1:9',key:'fake-engine-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co']) engineRecord(company,hermes);
const writer='a4750000-0000-0000-0000-000000000003';
const others=[{name:'Ads',job:'Meta ads and their numbers'},{name:'Lead',job:'Runs the team'}];

/** A send to Writer, and what each database call was given. pin_run pins the texts once, as the database does. */
function databases(listed=others) {
 const team=[...listed];
 const given=/** @type {Record<string,any[]>} */({}); let pinned=/** @type {string|null|undefined} */(undefined);
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{
  (given[name]??=[]).push(args);
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection:'f4750000-0000-0000-0000-000000000003',profile:'ag-a4750000000000000000000000000003',note:null},error:null};
  if(name==='conversation_handover_agents') return {data:[...team],error:null};
  // The database offers a writer every tool run_tools names for this Agent among the texts it was given.
  if(name==='pin_run') { if(pinned===undefined) pinned=['show_draft','hand_to_agent'].some(tool=>args.specs[tool])?`[${['show_draft','hand_to_agent'].filter(tool=>args.specs[tool]).map(tool=>args.specs[tool]).join(',')}]`:null; return {data:{tools:pinned},error:null}; }
  if(name==='pin_run_history'||name==='pin_run_model'||name==='pin_lead_brief') return {data:null,error:null};
  if(name==='begin_turn_start') return {data:(given.begin_turn_start?.length??0),error:null};
  if(name==='send_conversation_message') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{id:writer,instructions:null,is_default:false},error:null})};
 const queued=withTurnQueue(rpc);
 return {db:{rpc:queued,from:()=>chain},service:{rpc:queued,from:()=>chain},given,team};
}
const send=(/** @type {ReturnType<typeof databases>} */ {db,service},/** @type {any} */ engineFor,sendKey='k1')=>
 withEngineContract(engineFor,()=>sendMessage(db,service,{company:'co',conversation:'c4750000-0000-0000-0000-000000000001',sendKey,agent:writer,message:'Write the March ad copy'}));

test('a Run of an Agent that is not the main one is offered hand_to_agent naming the Company\'s other Agents with their jobs, pinned with the Run',async()=>{
 const fake=fakeEngine(); const stores=databases(); const sent=/** @type {any[]} */([]);
 // The first start's answer is lost, so the starter asks again later with the same key (#764: one starter of turns).
 let lose=1;
 const engineFor=(/** @type {any} */ connection)=>{ const engine=fake.engineFor(connection); return {...engine,start:async(/** @type {any} */ args)=>{ sent.push(args); const run=await engine.start(args); return lose-->0?startUnknown:run; }}; };
 assert.deepEqual(await send(stores,engineFor),{conversation:'c4750000-0000-0000-0000-000000000001',queued:true});
 assert.deepEqual(stores.given.conversation_handover_agents,[{conversation:'c4750000-0000-0000-0000-000000000001',message_key:'k1'}],'the list is the database\'s, for this Run');
 const run=fake.runs[0];
 const hand=run.tools.find((/** @type {any} */ tool)=>tool.name==='hand_to_agent');
 assert.ok(hand,'the Writer is offered hand_to_agent');
 assert.deepEqual(hand.parameters.properties.agent.enum,['Ads','Lead'],'its enum is the Company\'s other Agents, never the asker');
 assert.match(hand.description,/- Ads: Meta ads and their numbers\n- Lead: Runs the team\n/,'each with its job line');
 assert.match(hand.description,/answer comes back to you, the agent that asked, never to the person/,'the answer comes back to the asking Agent');
 assert.deepEqual(hand.parameters.required,['agent','goal']);
 // The text sent is the text pinned: a retry of the same send sends it again, whoever the team became meanwhile.
 assert.equal(JSON.stringify(hand),stores.given.pin_run[0].specs.hand_to_agent);
 stores.team.splice(0,stores.team.length,{name:'Critic',job:'Reviews'});
 assert.equal(await withEngineContract(engineFor,()=>startQueuedTurns(stores.service,{})),1);
 assert.equal(sent.length,2,'the same send asked again');
 assert.deepEqual(sent[1].tools,sent[0].tools,'the retry sends the pinned tools unchanged');
});

test('a Run with no other Agent to hand to is not offered hand_to_agent, and the other tools keep their own text',async()=>{
 const fake=fakeEngine(); const stores=databases([]);
 await send(stores,fake.engineFor);
 assert.equal('hand_to_agent' in stores.given.pin_run[0].specs,false,'nothing is asked of the database to pin a tool with no target');
 assert.deepEqual(fake.runs[0].tools.map((/** @type {any} */ tool)=>tool.name),['show_draft']);
 const {hand_to_agent:plain,...rest}=toolSpecTexts();
 assert.ok(plain);
 assert.deepEqual(conversationToolSpecTexts([]),rest);
 assert.deepEqual(Object.keys(conversationToolSpecTexts(others)).sort(),Object.keys(toolSpecTexts()).sort());
});

test('the tool names each Agent once, even when two share a name, and keeps a name with no job line',()=>{
 const spec=conversationHandOverSpec([{name:' Ads ',job:'Meta ads'},{name:'Ads',job:'Other'},{name:'Critic',job:null}]);
 assert.deepEqual(spec.parameters.properties.agent.enum,['Ads','Critic']);
 assert.match(spec.description,/- Ads: Meta ads\n- Critic\n/);
});
