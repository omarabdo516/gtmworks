import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { withTurnQueue } from './turn-queue.mjs';
import { answerQuestion, closeOpenRuns, sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #143, the whole question on the fake engine: Lead asks its one question, the person answers it (a chip, or typed
// words while the card is open), the same Run goes on, and its tool call makes the Agent for an Owner or records the
// request for a Contributor. The database's own rows are proved in supabase/tests/lead_offer.sql and the question
// functions by question_cards.sql; this proves what the Run does with the answer.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co','10000000-0000-0000-0000-000000000001']) engineRecord(company,hermes);
const company='10000000-0000-0000-0000-000000000001';
const agent='a9000000-0000-0000-0000-000000000001';
const conversation='c1000000-0000-0000-0000-000000000001';
const brief={role:'owner',owner:'Omar',agents:[]};

function databases(/** @type {ReturnType<typeof fakeEngine>} */ fake,role='owner') {
 /** @type {{id:number,run:string,question:string,content:any,state:string,key?:string,at:string}[]} */
 const cards=[]; const calls=/** @type {[string,any][]} */([]); const closed=/** @type {Map<string,any>} */(new Map());
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{
  calls.push([name,args]);
  if(name==='conversation_agent') return ok(agent);
  if(name==='reserve_conversation_turn') return ok({state:'reserved',company:'co',connection:'f9000000-0000-0000-0000-000000000001',profile:'writer',note:null});
  if(name==='conversation_handover_agents') return ok([]);
  if(name==='pin_run') return ok({tools:null});
  if(name==='pin_run_history'||name==='pin_run_model') return ok(null);
  if(name==='pin_lead_brief') return ok({...brief,role});
  if(name==='begin_turn_start') return ok(1);
  if(name==='send_conversation_message') return ok(true);
  if(name==='open_conversation_runs') return ok(fake.runs.filter(run=>!closed.has(run.id)).map((run,index)=>({message:index+1,conversation,run:run.id,person:'p1000000-0000-0000-0000-000000000001',company:'co',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'})));
  if(name==='track_run_question') {
   if(args.asking&&!args.ended&&!cards.some(card=>card.run===args.run&&card.question===args.asking.id)) cards.push({id:cards.length+1,run:args.run,question:args.asking.id,content:{question:args.asking.text,choices:args.asking.choices,multiple:args.asking.multiple},state:'open',at:args.read_started_at});
   return ok(cards.filter(card=>card.run===args.run&&card.state==='sending').map(card=>({card:card.id,question:card.question,answer:card.content.answer})));
  }
  if(name==='settle_question') { const card=cards.find(each=>each.id===args.card); if(card?.state==='sending') card.state=args.verdict; return ok(card?.state); }
  if(name==='track_run_permission') return ok([]);
  if(name==='lead_agent_profile') return ok({profile:'ag-a0000000000000000000000000000001',soul:null,level:1});
  if(name==='lead_key_settle') return ok(null);
  if(name==='close_conversation_run') { closed.set(args.run,args); return ok(true); }
  return ok({state:'ignored'});
 };
 const queued=withTurnQueue(rpc);
 const answerRpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name!=='answer_question') return queued(name,args);
  calls.push([name,args]);
  const card=args.card===null?cards.find(each=>each.key===args.answer_key)||cards.find(each=>['open','sending'].includes(each.state)):cards.find(each=>each.id===args.card);
  if(!card) return ok('none');
  if(card.key===args.answer_key) return ok('claimed');
  if(card.state!=='open') return ok(card.state==='closed'?'closed':'taken');
  Object.assign(card,{state:'sending',key:args.answer_key,content:{...card.content,answer:args.choice===null?args.answer:card.content.choices[args.choice]}});
  return ok('claimed');
 };
 const agentRow={id:agent,instructions:null,is_default:true};
 const chain=data=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>ok(data)}; return c; };
 const from=/** @param {string} table */ table=>chain(table==='hermes_agents'?agentRow:null);
 return {service:{rpc:queued,from},person:{rpc:answerRpc,from},cards,calls,closed};
}

const start=async(/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {any} */ person,/** @type {any} */ service,/** @type {string} */ sendKey)=>
 withEngineContract(fake.engineFor,()=>sendMessage(person,service,{company,conversation,sendKey,agent,message:'We need Meta ads'}));

test('an Owner answers "Make it" with a chip: the same Run goes on and makes the Agent once, and a second answer finds the first',async()=>{
 const fake=fakeEngine(); fake.settings.agentProfile='noModel'; await fake.engineFor({}).createAgent({name:'writer',instructions:''});
 fake.settings.questions=input=>input.includes('Meta ads')?[{text:'Make it?',choices:['Make it','Not now']}]:[];
 fake.settings.toolCalls=input=>input.includes('Meta ads')?[{id:'call-1',name:'create_agent',arguments:{template:'meta'}}]:[];
 const store=databases(fake,'owner'); const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(store.service,{conversation}));
 assert.deepEqual(await start(fake,store.person,store.service,'k1'),{conversation});
 assert.equal(await close(),0,'the Run waits on its question');
 const [{id:card}]=store.cards;
 const pick={company,conversation,card,choice:0,answerKey:'a1000000-0000-0000-0000-000000000001'};
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>answerQuestion(store.person,store.service,pick)),{state:'claimed'});
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>answerQuestion(store.person,store.service,pick)),{state:'claimed'},'the same click again is its own claim');
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>answerQuestion(store.person,store.service,{...pick,choice:1,answerKey:'a1000000-0000-0000-0000-000000000002'})),{state:'taken'},'another click finds it answered');
 assert.deepEqual(fake.answers.map(answer=>answer.text),['Make it'],'the chip reaches the waiting Run once');
 assert.ok(store.closed.has(fake.runs[0].id),'the answer closes the same Run');
 assert.equal(fake.runs.length,1,'the same Run went on; no second Run');
 const [made]=store.calls.filter(([name])=>name==='lead_create_agent');
 assert.equal(made?.[1]?.agent_name,'Reach');
 assert.deepEqual(store.calls.filter(([name])=>name==='lead_request_agent'),[]);
});

test('a Contributor types the answer while the card is open: no new Run starts, the request is recorded, and no Agent is made',async()=>{
 const fake=fakeEngine(); fake.settings.questions=input=>input.includes('Meta ads')?[{text:'Ask Omar for it?',choices:['Ask Omar for it','Not now']}]:[];
 fake.settings.toolCalls=input=>input.includes('Meta ads')?[{id:'call-1',name:'request_agent',arguments:{template:'meta'}}]:[];
 const store=databases(fake,'contributor'); const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(store.service,{conversation}));
 assert.deepEqual(await start(fake,store.person,store.service,'k1'),{conversation});
 assert.equal(await close(),0);
 const typed={company,conversation,sendKey:'k2',agent,message:'Ask Omar for it'};
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>sendMessage(store.person,store.service,typed)),{conversation,answered:true});
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>sendMessage(store.person,store.service,typed)),{conversation,answered:true},'the same key finds the same answer');
 assert.deepEqual(fake.answers.map(answer=>answer.text),['Ask Omar for it']);
 assert.ok(store.closed.has(fake.runs[0].id),'the answer closes the same Run');
 assert.equal(fake.runs.length,1,'an answer starts no Run');
 const [requested]=store.calls.filter(([name])=>name==='lead_request_agent');
 assert.equal(requested?.[1]?.agent_name,'Reach');
 assert.deepEqual(store.calls.filter(([name])=>name==='lead_create_agent'),[],'a Member makes nothing');
});
