import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withTurnQueue } from './turn-queue.mjs';
import { toolConfig, companyProfile } from '../lib/agent-toolsets.mjs';
import { moveAgentProfiles } from '../lib/company-profiles.mjs';
import { engineFor } from '../lib/engine.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// An Agent still on its Company's profile moves to its own (#121, ADR 0016): the worker asks the Engine only about the
// Agent's own profile, moves the Agent only once that profile can answer, and each Run of a Conversation from
// before the move carries gtmworks's record of it as the Run's history.
const company='10000000-0000-0000-0000-000000000001';
const [writer,critic]=['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'];
const own=agent=>`ag-${agent.replaceAll('-','')}`;
const hermes={address:'http://hermes:8642',profile:'default',key:'test-only-key'};
const row=(agent,extra={})=>({agent_id:agent,company_id:company,profile:own(agent),instructions:`You are ${agent}.`,subagents:false,recorded:false,...extra});

// The worker's database: the work it lists, and every call it gets, in order, in `log`, which the driver shares, with
// its arguments in `calls`. `begun` is what begin_agent_profile_move answers; `fail` names a call refused for one Agent.
function moveDatabase(rows,{log=[],begun=true,fail={}}={}) {
 const calls=[];
 return {log,calls,rpc:async(name,args)=>{
  log.push(`${name}${args?` ${args.agent}`:''}`); calls.push({name,args});
  if(name in fail&&fail[name]===args?.agent) return {data:null,error:{message:`${name} refused`}};
  if(name==='agent_move_work') return {data:rows.map(found=>({...found})),error:null};
  if(name==='begin_agent_profile_move') return {data:begun,error:null};
  if(name==='move_agent_profile') return {data:true,error:null};
  if(name==='record_agent_profile') return {data:null,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const answering=(log,state=()=>'provided')=>({provideAgent:async agent=>{ log.push(`provideAgent ${agent.name}`); return {state:state(agent)}; }});

test('the worker begins, has the Agent\'s own profile provided, records its tools and moves it, one Agent after another',async()=>{
 const db=moveDatabase([row(writer),row(critic,{recorded:true,instructions:null,subagents:true})]);
 const asked=[];
 const driver={provideAgent:async agent=>{ asked.push(agent); db.log.push(`provideAgent ${agent.name}`); return {state:'provided'}; }};
 assert.deepEqual(await moveAgentProfiles(db,{hermes,driver}),{moved:2});
 assert.deepEqual(db.log,['agent_move_work',
  `begin_agent_profile_move ${writer}`,`provideAgent ${own(writer)}`,`record_agent_profile ${writer}`,`move_agent_profile ${writer}`,
  `provideAgent ${own(critic)}`,`record_agent_profile ${critic}`,`move_agent_profile ${critic}`]);
 assert.deepEqual(asked[0],{name:own(writer),instructions:`You are ${writer}.`,subagents:false});
 // An Agent whose Owner turned sub-agents on has its profile made with them, the switch recorded below (#29).
 assert.equal(asked[1].subagents,true);
 assert.match(asked[1].instructions,/^You are a marketing agent working for one company in gtmworks\./,'an Agent with no instructions gets the Company profile\'s soul');
 assert.deepEqual(db.calls.filter(call=>call.name==='record_agent_profile').map(call=>call.args),[[writer,false],[critic,true]].map(([agent,subagents_written])=>({agent,engine_profile:own(agent),subagents_written})));
 assert.deepEqual(await moveAgentProfiles(db,{hermes:null,driver}),{moved:0});
});

test('an Agent whose own profile cannot answer, or was not made as it must be, stays where it is',async()=>{
 for(const state of ['noModel','forbidden','failed','refused','unreachable']) {
  const db=moveDatabase([row(writer)]);
  assert.deepEqual(await moveAgentProfiles(db,{hermes,driver:answering(db.log,()=>state)}),{moved:0},state);
  assert.deepEqual(db.log,['agent_move_work',`begin_agent_profile_move ${writer}`,`provideAgent ${own(writer)}`],state);
 }
 const refused=moveDatabase([row(writer)],{begun:false});
 assert.deepEqual(await moveAgentProfiles(refused,{hermes,driver:answering(refused.log)}),{moved:0});
 assert.deepEqual(refused.log,['agent_move_work',`begin_agent_profile_move ${writer}`],'a move the database will not begin asks the Engine nothing');
});

test('an Agent waiting to move is asked about at most once a minute',async()=>{
 let clock=0; const waiting=new Map();
 const db=moveDatabase([row(writer,{recorded:true})]);
 const options={hermes,waiting,now:()=>clock,driver:answering(db.log,()=>'noModel')};
 await moveAgentProfiles(db,options);
 clock+=59999;
 await moveAgentProfiles(db,options);
 assert.deepEqual(db.log,['agent_move_work',`provideAgent ${own(writer)}`,'agent_move_work']);
 clock+=1;
 await moveAgentProfiles(db,options);
 assert.deepEqual(db.log.slice(3),['agent_move_work',`provideAgent ${own(writer)}`]);
});

test('one Agent that fails never holds back another',async()=>{
 const db=moveDatabase([row(writer),row(critic)],{fail:{record_agent_profile:writer}});
 const logged=[]; const error=console.error; console.error=(...args)=>{ logged.push(args.join(' ')); };
 try { assert.deepEqual(await moveAgentProfiles(db,{hermes,driver:answering(db.log)}),{moved:1}); }
 finally { console.error=error; }
 assert.ok(!db.log.includes(`move_agent_profile ${writer}`));
 assert.ok(db.log.includes(`move_agent_profile ${critic}`));
 assert.deepEqual(logged,[`Agent not moved: ${writer} record_agent_profile refused`]);
});

test('on the Engine server a move asks about the Agent\'s own profile only: nothing names the keeper\'s profile',async()=>{
 const fake=await fakeHermes();
 try {
  const kept=companyProfile(company);
  fake.settings.profiles.set(kept,{soul:'The Company\'s soul.',provider:'openai-codex',model:'gpt-5.5',key:'test-only-key',config:{memory:{memory_enabled:true}},credentials:{'openai-codex':'company-token'}});
  const before=structuredClone(fake.settings.profiles.get(kept));
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  const db=moveDatabase([row(writer)]);
  const bundled={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
  assert.deepEqual(await moveAgentProfiles(db,{hermes:bundled,driver:engineFor(bundled)}),{moved:1});
  const requests=[...fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),...fake.settings.requests.map(request=>`${request.method} ${request.path}`)];
  assert.deepEqual(requests.filter(request=>request.includes(kept)),[],'no request names the keeper\'s profile');
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='DELETE'),[]);
  assert.deepEqual(fake.settings.managementRequests.find(request=>request.method==='POST').body,{name:own(writer),soul:`You are ${writer}.`},'made, never cloned');
  assert.ok(requests.includes(`GET /api/model/options?profile=${own(writer)}`),'the Engine is asked whether the Agent\'s own profile can answer');
  assert.deepEqual(fake.settings.profiles.get(kept),before,'the keeper\'s profile is as it was');
  assert.deepEqual(fake.settings.profiles.get(own(writer)).config,toolConfig({profile:own(writer)}));
 } finally { await fake.close(); }
});

// The run paths as a moved Agent's Conversation sees them: its pinned Connection to the Agent's own profile, and the
// history pin_run_history pinned for the send key (none for the others).
const record=[{role:'user',content:'Write the first post'},{role:'assistant',content:'Here it is.'}];
function runDatabases(fake,{history}) {
 const attempts=new Map();
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',profile:own(writer),note:null},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company,agent:writer,person:'p',send_key:'q',message:'Next draft',connection:'f9000000-0000-0000-0000-000000000001',profile:own(writer),note:null,retry:false}],error:null};
  if(name==='conversation_handover_agents') return {data:[],error:null};
  if(name==='pin_run') return {data:{tools:null,rules:[]},error:null};
  if(name==='pin_run_history') return {data:history,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  // #143: every queued turn asks for the main Agent's brief, which the database answers null for any other Agent.
  if(name==='pin_lead_brief') return {data:null,error:null};
  if(name==='begin_turn_start') { attempts.set(given.message_key,(attempts.get(given.message_key)??0)+1); return {data:attempts.get(given.message_key),error:null}; }
  if(['send_conversation_message','record_conversation_turn','keep_unknown_start'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const queued=withTurnQueue(rpc);
 const db={rpc:queued,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:writer,instructions:null})};
 const service={rpc:queued,from:(/** @type {string} */ table)=>chain(table==='hermes_agents'?{instructions:null}:null)};
 return {db,service};
}

test('a Run of a moved Agent\'s Conversation carries its record as the Run\'s history, sent now or waiting, and its retry the same body',async()=>{
 const fake=await fakeHermes();
 engineRecord(company,fake);
 try {
  const {db,service}=runDatabases(fake,{history:record});
  fake.settings.loseStarts=2;
  const send=()=>sendMessage(db,service,{company,conversation:'c',sendKey:'k',message:'Next draft'});
  assert.deepEqual(await send(),{conversation:'c',queued:true});
  assert.deepEqual(await send(),{conversation:'c'});
  assert.equal(fake.settings.runs.length,1,'the retry sent the same body, so it was the same run');
  assert.deepEqual(fake.settings.runs[0].history,record);
  assert.deepEqual(fake.settings.requests.filter(request=>request.method==='POST').map(request=>request.path),Array(3).fill(`/p/${own(writer)}/v1/runs`));
  assert.equal(await startQueuedTurns(service,{}),1);
  assert.deepEqual(fake.settings.runs[1].history,record);
 } finally { await fake.close(); }
});

test('a Run with no history pinned sends the body it sent before',async()=>{
 const fake=await fakeHermes();
 engineRecord(company,fake);
 try {
  const {db,service}=runDatabases(fake,{history:null});
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k',message:'Next draft'}),{conversation:'c'});
  // No history: the message, and how its Agent hands a file in its reply (#708), as every Run carries.
  assert.deepEqual(JSON.parse(/** @type {string} */(fake.settings.runs[0].body)),{input:'Next draft',instructions:`To give the person a file you made (a PDF, an image, a spreadsheet, a page, any kind of file), save it in your work folder (/work/${own(writer)}) and put its full path on a line of its own in your reply, as MEDIA:/work/${own(writer)}/<path to the file>. gtmworks attaches that file to your reply for the person to open and download, whatever its kind, up to 25 MB; this replaces any other note you have on which files come through. Never convert a file into images to send it, and write no other path to it in your reply. Only files inside your own work folder can be attached.`});
 } finally { await fake.close(); }
});

test('a move reads in the Company\'s log as the Agent getting its own space, in both languages',()=>{
 assert.deepEqual(describeEntry({subject:'agent',action:'agent_own_space',details:{agent_name:'Writer'}}),{act:['logActAgentOwnSpace'],obj:'Writer',from:undefined,to:undefined,note:undefined});
 assert.equal(i18n('en').t('logActAgentOwnSpace'),'got its own space in the agent engine');
 assert.notEqual(i18n('ar').t('logActAgentOwnSpace'),'logActAgentOwnSpace');
});
