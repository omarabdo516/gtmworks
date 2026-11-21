import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveHandovers } from '../lib/handovers.mjs';
import { driveChannelRuns } from '../lib/channel-runs.mjs';
import { runToolCall } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #150: Lead hands a job over inside a channel, on #317's record with a channel link. The database is a small stand-in
// for the handover functions (supabase/tests/channel_handovers.sql proves the real ones) that records what the driver
// asked of it.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const leadProfile='co-10000000000000000000000000000001';
const targetProfile='ag-01000000000000000000000000000001';
const channel='c1500000-0000-0000-0000-000000000001';
const message=5;
const targetSession='d1500000-0000-0000-0000-000000000001';
const leadSession='d1500000-0000-0000-0000-000000000002';

/** The one channel handover as the database keeps it, and what the driver asked of it. */
function handover(overrides = {}) {
 const row={id:8,state:'waiting',conversation:null,channel,message,goal:'Plan the Meta ads for the March intake',context:'EGP 9,000 for 30 days.',target:'Ads',
  target_attempts:0,return_attempts:0,target_run:null,follow_up_run:null,target_outcome:null,summary:null,follow_up_outcome:null,...overrides};
 const calls=/** @type {[string,any][]} */([]); const wrote=/** @type {{author:string,body:string}[]} */([]);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const input=()=>{
  if(row.state==='waiting') return `Lead in the team is handing you a job in one of the team's chats.\n\nThe job:\n${row.goal}\n\nWhat Lead knows about the job:\n${row.context}`;
  return row.target_outcome==='completed'?`You handed this job to Ads in this channel.\n\nWhat Ads reported:\n${row.summary}`:`The job Ads was given did not finish: ${row.goal}`;
 };
 const service={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   // No Run Stop ended a handover on is left to stop (#478).
   if(name==='handover_runs_stopping') return {data:[],error:null};
   if(name==='handovers_due') return ok(row.state==='done'||row.state==='failed'||row.id<=args.after?[]:[{id:row.id,state:row.state,
    conversation:row.conversation,run:row.state==='target'?row.target_run:row.state==='follow_up'?row.follow_up_run:null,
    profile:row.state==='waiting'||row.state==='target'?targetProfile:leadProfile,
    attempt:row.state==='returning'?row.return_attempts:row.target_attempts}]);
   if(name==='begin_handover') {
    if(row.state==='waiting') { row.target_attempts+=1; return ok([{state:'waiting',attempt:row.target_attempts,company:'10000000-0000-0000-0000-000000000001',profile:targetProfile,session:targetSession,input:input(),instructions:'Run the Meta ads.'}]); }
    if(row.state==='returning') { row.return_attempts+=1; return ok([{state:'returning',attempt:row.return_attempts,company:'10000000-0000-0000-0000-000000000001',profile:leadProfile,session:leadSession,input:input(),instructions:'Lead the team.'}]); }
    return ok([]);
   }
   if(name==='answer_handover') {
    if(args.run===null) return ok(false);
    if(row.state==='waiting') { row.target_run=args.run; row.state='target'; return ok(true); }
    if(row.state==='returning') { row.follow_up_run=args.run; row.state='follow_up'; return ok(true); }
    return ok(false);
   }
   if(name==='close_handover_target') { if(row.state!=='target') return ok(false); Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.words}); return ok(true); }
   if(name==='close_handover_follow_up') { if(row.state!=='follow_up') return ok(false); if(args.reply) wrote.push({author:'agent',body:args.reply}); row.state='done'; row.follow_up_outcome=args.run_outcome; return ok(true); }
   return {data:null,error:{message:'unexpected'}};
  },
 };
 return {row,service,calls,wrote};
}

/** Lead on the Company's profile and Ads on its own, routed by profile as the install's Hermes is. */
function engines() {
 const lead=fakeEngine(); const target=fakeEngine();
 const used=/** @type {string[]} */([]);
 const engineFor=(/** @type {any} */ connection)=>{ used.push(connection.profile); return (connection.profile===targetProfile?target:lead).engineFor(connection); };
 return {lead,target,used,engineFor};
}

// The worker's passes, one after another, until the handover is finished or the bound is reached.
const drive=async(/** @type {any} */ service,/** @type {any} */ engineFor,/** @type {any} */ row,most=10)=>{
 for(let pass=0;pass<most&&row.state!=='done'&&row.state!=='failed';pass++) await driveHandovers(service,{hermes,engineFor,channel});
};

test('a channel handover runs the job on the target\'s own profile in the channel session, then Lead\'s follow-up in Lead\'s, and each end is kept once',async()=>{
 const {row,service,wrote,calls}=handover();
 const {lead,target,engineFor}=engines();
 target.settings.reply=()=>'Three ad sets, 30 days, EGP 9,000.';
 lead.settings.reply=()=>'Ads planned the March intake: three ad sets, 30 days, EGP 9,000.';
 await drive(service,engineFor,row);
 assert.equal(row.state,'done');

 assert.deepEqual(calls.filter(([name])=>name==='handovers_due').map(([,args])=>args).slice(0,1),
  [{just_conversation:null,just_channel:channel,after:0}],'the pass asks for the channel\'s handovers only');
 const targetRuns=target.runs.filter(run=>run.key===`handover:${row.id}:target`);
 assert.equal(targetRuns.length,1,'the Target runs once');
 assert.equal(targetRuns[0].conversation,targetSession,'in the session it has in this channel');
 assert.deepEqual(targetRuns[0].tools,[],'the Target is offered no gtmworks tools: it cannot hand on');
 assert.match(targetRuns[0].input,/Plan the Meta ads for the March intake/);
 assert.match(targetRuns[0].input,/EGP 9,000 for 30 days\./);
 const followUp=lead.runs.filter(run=>run.key===`handover:${row.id}:return`);
 assert.equal(followUp.length,1,'Lead gets one follow-up Run');
 assert.equal(followUp[0].conversation,leadSession,'in Lead\'s own session of this channel');
 assert.match(followUp[0].input,/Three ad sets, 30 days, EGP 9,000\./);
 assert.deepEqual(followUp[0].tools,[],'the follow-up writes the reply, it does not hand on again');
 assert.deepEqual(wrote,[{author:'agent',body:'Ads planned the March intake: three ad sets, 30 days, EGP 9,000.'}]);
 // The arguments are the names the handover functions declare: PostgREST resolves a call by them.
 assert.deepEqual(calls.filter(([name])=>name.startsWith('close_handover')).map(([name,args])=>[name,Object.keys(args).sort().join(',')]),
  [['close_handover_target','h,run,run_outcome,words'],['close_handover_follow_up','h,reply,run,run_outcome']]);
 // Closing again, or a second pass, stores nothing more.
 assert.deepEqual(await driveHandovers(service,{hermes,engineFor,channel}),{started:0,closed:0});
 assert.equal(wrote.length,1,'the record keeps one reply');
});

test('a channel Run\'s hand_to_agent call is carried out once, for its message, as a job for the channel',async()=>{
 const fake=fakeEngine();
 fake.settings.reply=()=>'On it: I handed the job to Ads.';
 fake.settings.toolCalls=()=>[{id:'call_9',name:'hand_to_agent',arguments:{agent:'Ads',goal:'Plan the Meta ads',context:'EGP 9,000'}}];
 const handed=/** @type {{message:number,run:string,call:string,agent_name:string,goal:string,context:string}[]} */([]);
 // The database keeps one row per message, run and call (on conflict do nothing), as channel_show_card does for a card.
 const kept=new Map();
 const closed=new Set();
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='channel_runs_due') return {data:[{message,run,profile:'ag-ads'}],error:null};
  if(name==='track_channel_permission') return {data:[],error:null};
  if(name==='channel_hand_to_agent') { handed.push(args); kept.set(`${args.message}:${args.run}:${args.call}`,args); return {data:{state:'created',agent:'Ads'},error:null}; }
  if(name==='close_channel_run') { if(closed.has(args.run)) return {data:false,error:null}; closed.add(args.run); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const run=await fake.engineFor({}).start({conversation:'s-1',input:'Omar: @Lead plan the ads',idempotencyKey:`channel:${message}`});
 const drive=()=>driveChannelRuns(/** @type {any} */(service),{hermes,engineFor:fake.engineFor,channel});
 assert.deepEqual(await drive(),{started:0,closed:1});
 assert.deepEqual([...kept.values()],[{message,run,call:'call_9',agent_name:'Ads',goal:'Plan the Meta ads',context:'EGP 9,000'}]);
 closed.delete(run);
 assert.deepEqual(await drive(),{started:0,closed:1});
 assert.equal(kept.size,1,'the same message, run and call keep one handover');
});

test('hand_to_agent in a channel asks channel_hand_to_agent for the message, and the conversation\'s tool still asks for the Conversation',async()=>{
 const fake=fakeEngine(); const calls=/** @type {[string,any][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]); return {data:{state:'created',agent:'Ads'},error:null}; }};
 const call=(/** @type {any} */ context,/** @type {unknown} */ args)=>runToolCall({db,engine:fake.engineFor({}),profile:leadProfile,run:'run-1',...context},{id:'call-1',name:'hand_to_agent',arguments:args});
 assert.deepEqual(await call({channel:{message}},{agent:'Ads',goal:'Plan the Meta ads'}),{state:'created',agent:'Ads'});
 assert.deepEqual(await call({conversation:'c-1'},{agent:'Ads',goal:'Plan the Meta ads'}),{state:'created',agent:'Ads'});
 assert.deepEqual(calls,[
  ['channel_hand_to_agent',{message,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads',context:null}],
  ['lead_hand_to_agent',{conversation:'c-1',run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads',context:null}],
 ]);
});
