import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { sendMessage } from '../lib/conversation-runs.mjs';

// A send that starts its own turn (no `later`: tests, the install's checks) says how that turn went, also when another
// starter, the worker's pass over waiting turns, claimed it first (#889): the claim keeps the two from starting it twice,
// so this send's own pass finds the turn already being started and waits for that start, rather than answering
// "queued" for a turn that ran. When the other start never reached the Engine, the turn is due again and this send starts it.
const company='10000000-0000-0000-0000-000000000003';
const profile=`co-${company.replaceAll('-','')}`;
const connection='f9000000-0000-0000-0000-000000000003';
const agent='a9000000-0000-0000-0000-000000000003';

// The database as a send and its starter see it, with one other starter, `other`, that claims the turn first: it begins
// its attempt as soon as the turn is queued, and settles it (recorded, or handed back as never reached) a moment later.
function databases(other) {
 const calls=[]; const turns=new Map(); const reservations=new Map();
 const settle=(key,how)=>setTimeout(()=>{
  const reservation=reservations.get(key);
  if(how==='started') { turns.get(key).started_at='now'; reservation.abandoned_at='done'; }
  else { reservation.start_attempts--; reservation.start_unreached_at='now'; reservation.in_flight=false; }
 },150);
 const rpc=async(name,args)=>{ calls.push({name,args});
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='queue_conversation_turn') {
   turns.set(args.message_key,{message:args.message,started_at:null,failed_at:null,model_refused:false});
   // The other starter's claim and attempt land before this send's own pass.
   reservations.set(args.message_key,{start_attempts:1,start_unknown_at:null,start_unreached_at:null,abandoned_at:null,in_flight:true});
   settle(args.message_key,other);
   return {data:{state:'queued'},error:null};
  }
  const due=[...turns.entries()].find(([,turn])=>!turn.started_at&&!turn.failed_at);
  if(name==='queued_conversations') return {data:due?[{conversation:'c'}]:[],error:null};
  if(name==='claim_conversation_turn') return {data:due?[{company,agent,person:'p',send_key:due[0],message:due[1].message,connection,profile,note:null,retry:false,has_files:false}]:[],error:null};
  if(['conversation_handover_agents'].includes(name)) return {data:[],error:null};
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(['pin_run_history','pin_run_model','pin_lead_brief'].includes(name)) return {data:null,error:null};
  if(name==='begin_turn_start') {
   const reservation=reservations.get(args.message_key);
   if(reservation.in_flight) return {data:0,error:null};
   reservation.in_flight=true; reservation.start_attempts++; return {data:reservation.start_attempts,error:null};
  }
  if(name==='record_conversation_turn') { turns.get(args.message_key).started_at='now'; reservations.get(args.message_key).abandoned_at='done'; return {data:true,error:null}; }
  // Where a turn stands, as the database answers the service role (queued_turn_start).
  if(name==='queued_turn_start') {
   const turn=turns.get(args.message_key); const held=reservations.get(args.message_key);
   const state=!turn?'waiting':turn.started_at?'started':turn.failed_at?(turn.model_refused?'modelRefused':'failed')
    :!held||held.abandoned_at||held.start_unknown_at?'waiting':'inFlight';
   return {data:state,error:null};
  }
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const from=table=>{
  const filter={};
  const read={select:()=>read,eq:(column,value)=>{ filter[column]=value; return read; },maybeSingle:async()=>{
   if(table==='hermes_agents') return {data:{id:agent,instructions:null},error:null};
   // As the database grants them: the service role reads neither table itself (only authenticated reads a turn, under
   // its row policy), so a send learns where its turn stands from queued_turn_start alone.
   if(table==='conversation_queued_turns'||table==='conversation_run_reservations') return {data:null,error:{code:'42501',message:`permission denied for table ${table}`}};
   return {data:null,error:null};
  }};
  return read;
 };
 return {db:{rpc,from},service:{rpc,from},calls};
}

test('a send whose turn the worker started first answers that it started, and starts no second Run', async () => {
 const fake=await engineServing(company);
 const {db,service,calls}=databases('started');
 try {
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k-1',agent,message:'Plan the launch week'}),{conversation:'c'});
  assert.equal(fake.settings.runs.length,0,'the other starter ran it');
  assert.equal(calls.some(call=>call.name==='record_conversation_turn'),false);
 } finally { await fake.close(); }
});

test('a send whose turn the worker could not get to the Engine starts it itself, once', async () => {
 const fake=await engineServing(company);
 const {db,service,calls}=databases('unreached');
 try {
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k-2',agent,message:'Add a teaser post'}),{conversation:'c'});
  assert.equal(fake.settings.runs.length,1);
  assert.equal(calls.filter(call=>call.name==='record_conversation_turn').length,1);
 } finally { await fake.close(); }
});
