import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { withTurnQueue } from './turn-queue.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { startUnknown } from '../lib/engine/runs.mjs';
import { conversationToolSpecTexts, toolSpecTexts } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #475 (decision 0057), made a Card by spec #831 (#844): any Agent of a Company gives a job to any other Agent of it from a
// Conversation, as a Card on the Company's board with the Engine's own kanban_create. A Company of three, Lead, Ads and
// Writer: a person writes to Writer, and the Writer's Run is told Lead's and Ads' board names, never its own as another's,
// from the brief the database pins with the Run (pin_run_brief, proved in supabase/tests/run_board_brief.sql), so a retry
// sends the same request. It is offered no tool of gtmworks's own for it: no hand_to_agent, and no Handover is kept.
const hermes={address:'http://127.0.0.1:9',key:'fake-engine-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co']) engineRecord(company,hermes);
const writer='a4750000-0000-0000-0000-000000000003';
const self='ag-a4750000000000000000000000000003';
const others=[{name:'Ads',job:'Meta ads and their numbers',board:'ag-ads',role:'meta'},{name:'Lead',job:'Runs the team',board:'co-team',role:null}];

/** A send to Writer, and what each database call was given. pin_run and pin_run_brief pin once, as the database does. */
function databases(listed=others) {
 const team=[...listed];
 const given=/** @type {Record<string,any[]>} */({}); let pinned=/** @type {string|null|undefined} */(undefined); let brief=/** @type {any} */(undefined);
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{
  (given[name]??=[]).push(args);
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection:'f4750000-0000-0000-0000-000000000003',profile:self,note:null},error:null};
  // The database offers a writer every tool run_tools names for this Agent among the texts it was given.
  if(name==='pin_run') { if(pinned===undefined) pinned=['show_draft','hand_to_agent'].some(tool=>args.specs[tool])?`[${['show_draft','hand_to_agent'].filter(tool=>args.specs[tool]).map(tool=>args.specs[tool]).join(',')}]`:null; return {data:{tools:pinned},error:null}; }
  if(name==='pin_run_brief') { brief??={role:'contributor',owner:'Omar',main:false,self,agents:[...team]}; return {data:brief,error:null}; }
  if(name==='pin_run_history'||name==='pin_run_model') return {data:null,error:null};
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

test('a Run of an Agent that is not the main one is told the other Agents\' board names and its own to make a Card, pinned with the Run, and offered no hand_to_agent',async()=>{
 const fake=fakeEngine(); const stores=databases(); const sent=/** @type {any[]} */([]);
 // The first start's answer is lost, so the starter asks again later with the same key (#764: one starter of turns).
 let lose=1;
 const engineFor=(/** @type {any} */ connection)=>{ const engine=fake.engineFor(connection); return {...engine,start:async(/** @type {any} */ args)=>{ sent.push(args); const run=await engine.start(args); return lose-->0?startUnknown:run; }}; };
 assert.deepEqual(await send(stores,engineFor),{conversation:'c4750000-0000-0000-0000-000000000001',queued:true});
 const run=fake.runs[0];
 assert.match(run.instructions,/The other agents of your company, each with its board name:\n- Ads: Meta ads and their numbers \(board name: ag-ads\)\n- Lead: Runs the team \(board name: co-team\)\n/);
 assert.match(run.instructions,new RegExp(`make a card with kanban_create[^.]*\\(yours is ${self}\\)`));
 assert.equal(run.tools.some((/** @type {any} */ tool)=>tool.name==='hand_to_agent'),false,'no hand_to_agent');
 assert.doesNotMatch(run.instructions,/hand_to_agent/);
 assert.equal('hand_to_agent' in stores.given.pin_run[0].specs,false,'nothing is asked of the database to pin it');
 // The words sent are the brief pinned: a retry of the same send sends them again, whoever the team became meanwhile.
 stores.team.splice(0,stores.team.length,{name:'Critic',job:'Reviews',board:'ag-critic',role:'hook'});
 assert.equal(await withEngineContract(engineFor,()=>startQueuedTurns(stores.service,{})),1);
 assert.equal(sent.length,2,'the same send asked again');
 assert.equal(sent[1].instructions,sent[0].instructions,'the retry sends the pinned words unchanged');
 assert.deepEqual(sent[1].tools,sent[0].tools);
});

test('a Conversation\'s tool texts are every tool but hand_to_agent, each with its own text',()=>{
 const {hand_to_agent:plain,...rest}=toolSpecTexts();
 assert.ok(plain,'the tool stays for a channel and a Handover already under way');
 assert.deepEqual(conversationToolSpecTexts(),rest);
});
