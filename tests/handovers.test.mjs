import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveHandovers } from '../lib/handovers.mjs';
import { runToolCall } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #317 on the fake engine: Lead hands a job to another Agent, and gtmworks moves the two Runs itself. The database is a
// small stand-in for the handover functions (supabase/tests/handovers.sql proves the real ones) that records what the
// driver asked of it.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const leadProfile='co-10000000000000000000000000000001';
const targetProfile='ag-01000000000000000000000000000001';
const conversation='c1000000-0000-0000-0000-000000000001';
const targetSession='d1000000-0000-0000-0000-000000000001';

/** The one handover as the database keeps it, and what the driver asked of it. */
function handover(overrides = {}) {
 const row={id:7,state:'waiting',conversation,goal:'Plan the Meta ads for the March intake',context:'EGP 9,000 for 30 days.',target:'Ads',
  target_attempts:0,return_attempts:0,target_run:null,follow_up_run:null,target_outcome:null,summary:null,follow_up_outcome:null,...overrides};
 const calls=/** @type {[string,any][]} */([]); const messages=/** @type {{author:string,body:string,run:string}[]} */([]); const ends=/** @type {{run:string,outcome:string}[]} */([]);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const input=()=>{
  if(row.state==='waiting') return `hand this to Ads: ${row.goal}\n\nWhat Lead knows: ${row.context}`;
  return row.target_outcome==='completed'?`The job Ads was given: ${row.goal}\n\nWhat Ads reported:\n${row.summary}`:`The job Ads was given did not finish: ${row.goal}`;
 };
 const service={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   if(name==='handovers_due') return ok(row.state==='done'||row.state==='failed'||row.id<=args.after?[]:[{id:row.id,state:row.state,
    conversation:row.conversation,run:row.state==='target'?row.target_run:row.state==='follow_up'?row.follow_up_run:null,
    profile:row.state==='waiting'||row.state==='target'?targetProfile:leadProfile,
    attempt:row.state==='returning'?row.return_attempts:row.target_attempts}]);
   if(name==='begin_handover') {
    if(row.state==='waiting') { row.target_attempts+=1; return ok([{state:'waiting',attempt:row.target_attempts,company:'10000000-0000-0000-0000-000000000001',profile:targetProfile,session:targetSession,input:input(),instructions:'Run the Meta ads.'}]); }
    if(row.state==='returning') { row.return_attempts+=1; return ok([{state:'returning',attempt:row.return_attempts,company:'10000000-0000-0000-0000-000000000001',profile:leadProfile,session:conversation,input:input(),instructions:'Lead the team.'}]); }
    return ok([]);
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
 for(let pass=0;pass<most&&row.state!=='done'&&row.state!=='failed';pass++) await driveHandovers(service,{hermes,engineFor});
};

test('Lead\'s handover runs the job on the target\'s own profile with no tools, then a follow-up Lead Run in the conversation\'s session reports what came of it',async()=>{
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
 assert.deepEqual(targetRuns[0].tools,[],'the Target is offered no gtmworks tools: it cannot ask, write shared memory, schedule work or hand on');
 assert.equal(targetRuns[0].instructions,null,'its instructions are its own profile\'s soul, never the Company\'s Agent instructions');
 assert.match(targetRuns[0].input,/Plan the Meta ads for the March intake/);
 assert.match(targetRuns[0].input,/EGP 9,000 for 30 days\./);
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

test('a start whose answer was lost is asked again with the same key, never failed, and nothing is reported to Lead yet',async()=>{
 const {row,service,calls}=handover();
 const lost=()=>({start:async()=>({state:'unknown'}),read:async()=>({state:'lost'})});
 await driveHandovers(service,{hermes,engineFor:lost});
 assert.equal(row.state,'waiting','the next pass asks again');
 assert.equal(row.target_attempts,1);
 assert.equal(calls.filter(([name])=>name==='answer_handover').length,0,'an unknown start is neither recorded nor failed');
});

test('hand_to_agent reads the Agent, the job and the context, asks the database, and asks the Engine nothing',async()=>{
 const fake=fakeEngine(); const calls=/** @type {[string,any][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]); return {data:{state:'created',agent:'Ads'},error:null}; }};
 const call=(/** @type {unknown} */ args)=>runToolCall({db,engine:fake.engineFor({}),profile:leadProfile,conversation:conversation,run:'run-1'},{id:'call-1',name:'hand_to_agent',arguments:args});
 for(const args of /** @type {unknown[]} */([null,'Ads',{agent:'Ads'},{agent:' ',goal:'Plan'},{agent:'Ads',goal:'  '},{agent:'x'.repeat(101),goal:'Plan'},{agent:'Ads',goal:'y'.repeat(501)},{agent:7,goal:'Plan'}]))
  assert.deepEqual(await call(args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual(await call({agent:' Ads ',goal:' Plan the Meta ads for the March intake\n',context:' EGP 9,000 for 30 days. '}),{state:'created',agent:'Ads'});
 assert.deepEqual(calls,[['lead_hand_to_agent',{conversation,run:'run-1',call:'call-1',agent_name:'Ads',goal:'Plan the Meta ads for the March intake',context:'EGP 9,000 for 30 days.'}]]);
 assert.deepEqual(fake.runs,[],'the Target runs later, never during Lead\'s Run');
});
