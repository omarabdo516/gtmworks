import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
import { runToolCall } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #317 on the fake engine: Lead hands a job to another Agent, and gtmworks moves the two Runs itself. The database is a
// small stand-in for the handover functions (supabase/tests/handovers.sql proves the real ones) that records what the
// driver asked of it.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co','10000000-0000-0000-0000-000000000001']) engineRecord(company,hermes);
const leadProfile='co-10000000000000000000000000000001';
const targetProfile='ag-01000000000000000000000000000001';
const conversation='c1000000-0000-0000-0000-000000000001';
const targetSession='d1000000-0000-0000-0000-000000000001';

/** The one handover as the database keeps it, and what the driver asked of it. */
function handover(overrides = {}) {
 const row={id:7,state:'waiting',conversation,goal:'Plan the Meta ads for the March intake',context:'EGP 9,000 for 30 days.',target:'Ads',
  asker_profile:leadProfile,target_attempts:0,return_attempts:0,target_run:null,follow_up_run:null,target_outcome:null,summary:null,follow_up_outcome:null,...overrides};
 const calls=/** @type {[string,any][]} */([]); const messages=/** @type {{author:string,body:string,run:string}[]} */([]); const ends=/** @type {{run:string,outcome:string}[]} */([]);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const input=()=>{
  if(row.state==='waiting') return `hand this to Ads: ${row.goal}\n\nWhat Lead knows: ${row.context}`
   +'\n\nNobody but Lead reads this chat: put anything you need from the person in your reply.';
  return row.target_outcome==='completed'?`The job Ads was given: ${row.goal}\n\nWhat Ads reported:\n${row.summary}`:`The job Ads was given did not finish: ${row.goal}`;
 };
 const service={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   // No Run Stop ended a handover on is left to stop (#478).
   if(name==='stopped_runs_open') return {data:[],error:null};
   if(name==='handover_runs_stopping') return {data:[],error:null};
  if(name==='handovers_due') return ok(row.state==='done'||row.state==='failed'||row.id<=args.after?[]:[{id:row.id,state:row.state,company:'10000000-0000-0000-0000-000000000001',
    conversation:row.conversation,run:row.state==='target'?row.target_run:row.state==='follow_up'?row.follow_up_run:null,
    profile:row.state==='waiting'||row.state==='target'?targetProfile:row.asker_profile,
    attempt:row.state==='returning'?row.return_attempts:row.target_attempts}]);
   if(name==='begin_handover') {
    if(row.state==='waiting') { row.target_attempts+=1; return ok([{state:'waiting',attempt:row.target_attempts,company:'10000000-0000-0000-0000-000000000001',profile:targetProfile,session:targetSession,input:input(),instructions:'Run the Meta ads.'}]); }
    if(row.state==='returning') { row.return_attempts+=1; return ok([{state:'returning',attempt:row.return_attempts,company:'10000000-0000-0000-0000-000000000001',profile:row.asker_profile,session:conversation,input:input(),instructions:row.asker_profile===leadProfile?'Lead the team.':null}]); }
    return ok([]);
   }
   // #514: only the attempt that began is handed back, and only while its leg named no Run.
   if(name==='release_handover_start') {
    const [attempts,run]=/** @type {Record<string,[string,string]>} */({waiting:['target_attempts','target_run'],handing:['answer_attempts','answer_run'],returning:['return_attempts','follow_up_run']})[args.leg]??[];
    if(!attempts||args.leg!==row.state||row[run]||row[attempts]!==args.attempt) return ok(false);
    row[attempts]-=1; return ok(true);
   }
   if(name==='answer_handover') {
    if(args.run===null) return ok(false);
    if(row.state==='waiting') { row.target_run=args.run; row.state='target'; return ok(true); }
    if(row.state==='returning') { row.follow_up_run=args.run; row.state='follow_up'; return ok(true); }
    return ok(false);
   }
   if(name==='close_handover_target') { Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.words}); return ok(true); }
   if(name==='close_handover_follow_up') { ends.push({run:args.run,outcome:args.run_outcome}); if(args.reply) messages.push({author:'agent',body:args.reply,run:args.run}); row.state='done'; row.follow_up_outcome=args.run_outcome; return ok(true); }
   return {data:null,error:{message:'unexpected'}};
  },
 };
 return {row,service,calls,messages,ends};
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
 for(let pass=0;pass<most&&row.state!=='done'&&row.state!=='failed';pass++) await withEngineContract(engineFor,()=>driveHandovers(service,{}));
};

test('Lead\'s handover runs the job on the target\'s own profile, then a follow-up Lead Run in the conversation\'s session reports what came of it',async()=>{
 const {row,service,messages,calls}=handover();
 const {lead,target,engineFor}=engines();
 target.settings.reply=()=>'Three ad sets, 30 days, EGP 9,000.';
 lead.settings.reply=()=>'Ads planned the March intake: three ad sets, 30 days, EGP 9,000.';
 // The Target asks and asks to act; nobody reads its chat, so its question is answered empty and its action denied.
 target.settings.questions=()=>[{text:'Which audience first?',choices:['Parents','Students']}];
 target.settings.permissions=()=>[{description:'Read the campaign file',command:'cat campaigns.csv'}];
 await drive(service,engineFor,row);
 assert.equal(row.state,'done');

 const targetRuns=target.runs.filter(run=>run.key===`handover:${row.id}:target`);
 assert.equal(targetRuns.length,1,'the Target runs once');
 assert.equal(targetRuns[0].conversation,targetSession,'in a session of its own for this chat, never Lead\'s');
 // This stand-in lists no other Agent for the Target to hand to, so it is offered no gtmworks tool; the chain's own test
 // offers hand_to_agent (tests/handover-chains.test.mjs).
 assert.deepEqual(targetRuns[0].tools,[],'the Target is offered no card tool, and here no Agent to hand to');
 assert.equal(targetRuns[0].instructions,null,'its instructions are its own profile\'s soul, never the Company\'s Agent instructions');
 assert.match(targetRuns[0].input,/Plan the Meta ads for the March intake/);
 assert.match(targetRuns[0].input,/EGP 9,000 for 30 days\./);
 // #477: the Target works with all its own tools; nobody but the asking Agent reads its chat, so a need goes in its reply.
 assert.match(targetRuns[0].input,/put anything you need from the person in your reply\./);
 assert.deepEqual(target.answers.map(answer=>answer.text),[''],'its question is answered empty');
 assert.deepEqual(target.permits.map(permit=>permit.choice),['deny'],'its action is not allowed');
 assert.deepEqual([target.provided,target.agentReads],[[],[]],'nothing is made or read on the Target\'s profile');

 const followUp=lead.runs.filter(run=>run.key===`handover:${row.id}:return`);
 assert.equal(followUp.length,1,'Lead gets one follow-up Run');
 assert.equal(followUp[0].conversation,conversation,'in the same conversation session');
 assert.match(followUp[0].input,/Three ad sets, 30 days, EGP 9,000\./);
 assert.deepEqual(followUp[0].tools,[],'the follow-up writes the reply, it does not hand on again');
 assert.equal(followUp[0].instructions,'Lead the team.','it runs as the Lead on the Company\'s profile, with its instructions');
 assert.deepEqual(messages,[{author:'agent',body:'Ads planned the March intake: three ad sets, 30 days, EGP 9,000.',run:followUp[0].id}]);
 // The arguments are the names the handover functions declare: PostgREST resolves a call by them, so one that names
 // another leaves the leg where it is (a Card still follows the handover, #147).
 assert.deepEqual(calls.filter(([name])=>name.startsWith('close_handover')).map(([name,args])=>[name,Object.keys(args).sort().join(',')]),
  [['close_handover_target','h,run,run_outcome,words'],['close_handover_follow_up','h,reply,run,run_outcome']]);
});

// #475: any Agent asks, not only Lead. Writer, on a profile of its own, hands Ads a job from the Writer's own chat: Ads
// runs on its own profile in its own session, and Writer's follow-up runs on Writer's profile in the Conversation's.
test('an Agent that is not the main one hands a job over: the target runs on its own profile, then the asking Agent replies on its own',async()=>{
 const writerProfile='ag-01000000000000000000000000000002';
 const {row,service,messages}=handover({asker_profile:writerProfile});
 const {lead:writer,target,used,engineFor}=engines();
 target.settings.reply=()=>'Last campaign: 1,240 leads at EGP 7.30 each.';
 writer.settings.reply=()=>'Ads says last campaign brought 1,240 leads at EGP 7.30 each; the copy leads with that.';
 await drive(service,engineFor,row);
 assert.equal(row.state,'done');
 assert.deepEqual([...new Set(used)],[targetProfile,writerProfile],'Ads on its own profile first, then the Writer on its own');
 const asked=target.runs.filter(run=>run.key===`handover:${row.id}:target`);
 assert.equal(asked.length,1); assert.equal(asked[0].conversation,targetSession,'Ads works in its own session of this chat');
 const followUp=writer.runs.filter(run=>run.key===`handover:${row.id}:return`);
 assert.equal(followUp.length,1,'the Writer gets one follow-up Run');
 assert.equal(followUp[0].conversation,conversation,'in the Conversation\'s own session');
 assert.equal(followUp[0].instructions,null,'an Agent on its own profile has its instructions as its soul');
 assert.match(followUp[0].input,/1,240 leads at EGP 7\.30 each\./);
 assert.deepEqual(messages.map(message=>message.body),['Ads says last campaign brought 1,240 leads at EGP 7.30 each; the copy leads with that.']);
});

test('a Target Run that fails still brings Lead back to say the job did not finish, and the handover keeps no summary',async()=>{
 const {row,service,messages}=handover();
 const {lead,target,engineFor}=engines();
 target.settings.ending='failed';
 lead.settings.reply=()=>'Ads could not finish the campaign plan; I can try again with the budget.';
 await drive(service,engineFor,row);
 assert.equal(row.state,'done');
 assert.equal(row.target_outcome,'failed');
 assert.equal(row.summary,null);
 const followUp=lead.runs.find(run=>run.key===`handover:${row.id}:return`);
 assert.ok(followUp,'Lead still answers');
 assert.match(followUp.input,/did not finish/);
 assert.deepEqual(messages.map(message=>message.body),['Ads could not finish the campaign plan; I can try again with the budget.']);
});

// #428: a leg the Engine failed for want of any model provider (`noModel`, #422) ends as no_model, and Lead's follow-up
// that ends so closes the person's Run as no_model, which the chat reads to say the Company has no model connected.
test('a Target and a follow-up that fail for want of any model end as no_model, so the chat says no model is connected',async()=>{
 const {row,service,messages,ends}=handover();
 const {lead,target,engineFor}=engines();
 target.settings.ending='noModel'; lead.settings.ending='noModel';
 await drive(service,engineFor,row);
 assert.equal(row.state,'done');
 assert.equal(row.target_outcome,'no_model');
 assert.equal(row.summary,null);
 assert.equal(row.follow_up_outcome,'no_model');
 const followUp=lead.runs.find(run=>run.key===`handover:${row.id}:return`);
 assert.ok(followUp,'Lead is still asked to report it');
 assert.deepEqual(ends,[{run:followUp.id,outcome:'no_model'}]);
 assert.deepEqual(messages,[]);
});

// #530: a leg whose model call cannot succeed on a retry (`modelRefused`, #457) keeps its cause, so a command's target
// that ran out of credit closes the person's Run as no_credit and the chat says what to fix instead of offering a retry.
test('a Target and a follow-up whose model refused them keep the cause, so the chat says what to fix',async()=>{
 for(const [reason,outcome] of /** @type {const} */([['credit','no_credit'],['key','key_refused'],['model','model_missing']])) {
  const {row,service,messages,ends}=handover();
  const {lead,target,engineFor}=engines();
  target.settings.ending=reason; lead.settings.ending=reason;
  await drive(service,engineFor,row);
  assert.equal(row.state,'done');
  assert.equal(row.target_outcome,outcome);
  assert.equal(row.summary,null);
  assert.equal(row.follow_up_outcome,outcome);
  const followUp=lead.runs.find(run=>run.key===`handover:${row.id}:return`);
  assert.ok(followUp,'Lead is still asked to report it');
  assert.deepEqual(ends,[{run:followUp.id,outcome}]);
  assert.deepEqual(messages,[]);
 }
});

test('a start whose answer was lost is asked again with the same key, never failed, and nothing is reported to Lead yet',async()=>{
 const {row,service,calls}=handover();
 const fake=fakeEngine(); const asked=/** @type {{idempotencyKey:string,input:string}[]} */([]);
 // The first start makes the Run and loses its answer; the next pass asks again with the same key.
 const lost=()=>({start:async(/** @type {any} */ args)=>{ asked.push(args); await fake.engineFor({}).start(args); return {state:'unknown'}; }});
 await withEngineContract(lost,()=>driveHandovers(service,{}));
 assert.equal(row.state,'waiting','the next pass asks again');
 assert.equal(row.target_attempts,1);
 assert.equal(calls.filter(([name])=>name==='answer_handover').length,0,'an unknown start is neither recorded nor failed');
 await withEngineContract(()=>({start:async(/** @type {any} */ args)=>{ asked.push(args); return fake.engineFor({}).start(args); }}),()=>driveHandovers(service,{}));
 assert.equal(row.state,'target','the retried start records the Run it made');
 assert.deepEqual(asked.map(start=>start.idempotencyKey),[`handover:${row.id}:target`,`handover:${row.id}:target`],'both starts ask for the same key');
 assert.equal(asked[0].input,asked[1].input,'and send the same job');
 assert.equal(fake.runs.filter(run=>run.key===`handover:${row.id}:target`).length,1,'so the target runs once');
});

test('a leg claimed by begin_handover names the start\'s key and its own answer, though the row read earlier said otherwise',async()=>{
 // Another driver moved the handover between the read that found it due and this call: the row still reads as waiting, and
 // the leg claimed is the follow-up. Its key and its answer follow the leg that was claimed (#354), so a retry after a lost
 // answer keeps the same identity, and an answer from another leg records nothing.
 const fake=fakeEngine(); const calls=/** @type {[string,any][]} */([]);
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  calls.push([name,args]);
  if(name==='stopped_runs_open') return {data:[],error:null};
  if(name==='handover_runs_stopping') return {data:[],error:null};
  if(name==='handovers_due') return {data:[{id:7,state:'waiting',conversation,run:null,profile:leadProfile,attempt:0}],error:null};
  if(name==='begin_handover') return {data:[{state:'returning',attempt:1,company:'10000000-0000-0000-0000-000000000001',profile:leadProfile,session:conversation,
   input:'The job Ads was given did not finish.',instructions:'Lead the team.'}],error:null};
  if(name==='answer_handover') return {data:true,error:null};
  return {data:[],error:null};
 }};
 await withEngineContract(fake.engineFor,()=>driveHandovers(service,{}));
 assert.deepEqual(fake.runs.map(run=>run.key),['handover:7:return'],'the key names the follow-up leg that was claimed');
 assert.deepEqual(calls.filter(([name])=>name==='answer_handover').map(([,args])=>args),
  [{h:7,attempt:1,leg:'returning',run:fake.runs[0].id}],'and the answer names that leg, and its attempt, with the Run');
});

test('hand_to_agent reads the Agent, the job and the context, asks the database, and asks the Engine nothing',async()=>{
 const fake=fakeEngine(); const calls=/** @type {[string,any][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]); return {data:{state:'created',agent:'Ads'},error:null}; }};
 const call=(/** @type {unknown} */ args)=>runToolCall({db,engine:fake.engineFor({}),profile:leadProfile,conversation:conversation,run:'run-1'},{id:'call-1',name:'hand_to_agent',arguments:args});
 for(const args of /** @type {unknown[]} */([null,'Ads',{agent:'Ads'},{agent:' ',goal:'Plan'},{agent:'Ads',goal:'  '},{agent:'x'.repeat(101),goal:'Plan'},{agent:'Ads',goal:'y'.repeat(501)},{agent:7,goal:'Plan'}]))
  assert.deepEqual(await call(args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual(await call({agent:' Ads ',goal:' Plan the Meta ads for the March intake\n',context:' EGP 9,000 for 30 days. '}),{state:'created',agent:'Ads'});
 // #354: a context the model left blank is none, and one past its length is cut, so the job still reaches its Agent and
 // Lead never says it handed the job over while nothing was kept.
 assert.deepEqual(await call({agent:'Ads',goal:'Plan the Meta ads',context:''}),{state:'created',agent:'Ads'});
 assert.deepEqual(await call({agent:'Ads',goal:'Plan the Meta ads',context:'   '}),{state:'created',agent:'Ads'});
 assert.deepEqual(await call({agent:'Ads',goal:'Plan the Meta ads',context:` ${'x'.repeat(2500)} `}),{state:'created',agent:'Ads'});
 assert.deepEqual(calls,[['lead_hand_to_agent',{conversation,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads for the March intake',context:'EGP 9,000 for 30 days.'}],
  ['lead_hand_to_agent',{conversation,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads',context:null}],
  ['lead_hand_to_agent',{conversation,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads',context:null}],
  ['lead_hand_to_agent',{conversation,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads',context:`${'x'.repeat(1999)}…`}]]);
 assert.deepEqual(fake.runs,[],'the Target runs later, never during Lead\'s Run');
});

// #514: a leg's start that never reached its Engine (nothing could connect: the Engine is not running), or that found no
// Engine to send it to, is no attempt. The driver hands it back (release_handover_start), so the leg stays due as never
// started until its own time limit, and its next start is a first attempt, which a refusal answers as failed. The
// database half is supabase/tests/unreached_queued_starts.sql.
for(const [what,engineOf] of /** @type {const} */([['a stopped Engine','notReached'],['no Engine to send it to','none']])) {
 test(`${what} leaves a handover's leg due, and its next start is a first attempt`,async()=>{
  const {row,service,calls}=handover();
  const asked=/** @type {any[]} */([]);
  const engineFor=()=>({start:async(/** @type {any} */ args)=>{ asked.push(args); return null; }});
  if(engineOf==='none') engineRecord('10000000-0000-0000-0000-000000000001',null);
  await withEngineContract(engineOf==='none'?/** @type {any} */(engineFor):/** @type {any} */(()=>({start:async(/** @type {any} */ args)=>{ asked.push(args); return {state:'notReached'}; }})),()=>driveHandovers(service,{}));
  engineRecord('10000000-0000-0000-0000-000000000001',hermes);
  assert.deepEqual(calls.filter(([name])=>name==='release_handover_start').map(([,args])=>args),[{h:row.id,attempt:1,leg:'waiting'}],'its attempt is handed back');
  assert.equal(calls.filter(([name])=>name==='answer_handover').length,0,'and the leg is not answered as refused');
  assert.deepEqual([row.state,row.target_attempts],['waiting',0],'so it stays due, as never started');
  await withEngineContract(engineFor,()=>driveHandovers(service,{}));
  assert.deepEqual(asked.map(start=>start.retry),engineOf==='none'?[false]:[false,false],'the next start is a first attempt');
  assert.deepEqual(calls.filter(([name])=>name==='answer_handover').map(([,args])=>args),[{h:row.id,attempt:1,leg:'waiting',run:null}],'so the Engine\'s refusal is answered for the first attempt, which fails the leg');
 });
}
