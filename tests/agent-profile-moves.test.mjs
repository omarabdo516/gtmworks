import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { engineRecord, engineServing, withNoEngine } from './engine-records.mjs';
import { toolConfig, companyProfile } from '../lib/agent-toolsets.mjs';
import { moveAgentProfiles } from '../lib/company-profiles.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';

// An Agent still on its Company's profile moves to its own (#121, ADR 0016): the worker asks the Engine only about the
// Agent's own profile, and moves the Agent only once that profile can answer.
const company='10000000-0000-0000-0000-000000000001';
const [writer,critic]=['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'];
const own=agent=>`ag-${agent.replaceAll('-','')}`;
const hermes={address:'http://hermes:8642',profile:'default',key:'test-only-key'};
// The Company's Engine record; the fake of the contract answers each move.
engineRecord(company,hermes);
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
 assert.deepEqual(await withEngineContract(()=>driver,()=>moveAgentProfiles(db)),{moved:2});
 assert.deepEqual(db.log,['agent_move_work',
  `begin_agent_profile_move ${writer}`,`provideAgent ${own(writer)}`,`record_agent_profile ${writer}`,`move_agent_profile ${writer}`,
  `provideAgent ${own(critic)}`,`record_agent_profile ${critic}`,`move_agent_profile ${critic}`]);
 assert.deepEqual(asked[0],{name:own(writer),instructions:`You are ${writer}.`,subagents:false});
 // An Agent whose Owner turned sub-agents on has its profile made with them, the switch recorded below (#29).
 assert.equal(asked[1].subagents,true);
 assert.match(asked[1].instructions,/^You are a marketing agent working for one company in gtmworks\./,'an Agent with no instructions gets the Company profile\'s soul');
 assert.deepEqual(db.calls.filter(call=>call.name==='record_agent_profile').map(call=>call.args),[[writer,false],[critic,true]].map(([agent,subagents_written])=>({agent,engine_profile:own(agent),subagents_written})));
 assert.deepEqual(await withNoEngine(company,()=>withEngineContract(()=>driver,()=>moveAgentProfiles(db))),{moved:0});
});

test('an Agent whose own profile cannot answer, or was not made as it must be, stays where it is',async()=>{
 for(const state of ['noModel','forbidden','failed','refused','unreachable']) {
  const db=moveDatabase([row(writer)]);
  assert.deepEqual(await withEngineContract(()=>answering(db.log,()=>state),()=>moveAgentProfiles(db)),{moved:0},state);
  assert.deepEqual(db.log,['agent_move_work',`begin_agent_profile_move ${writer}`,`provideAgent ${own(writer)}`],state);
 }
 const refused=moveDatabase([row(writer)],{begun:false});
 assert.deepEqual(await withEngineContract(()=>answering(refused.log),()=>moveAgentProfiles(refused)),{moved:0});
 assert.deepEqual(refused.log,['agent_move_work',`begin_agent_profile_move ${writer}`],'a move the database will not begin asks the Engine nothing');
});

test('an Agent waiting to move is asked about at most once a minute',async()=>{
 let clock=0; const waiting=new Map();
 const db=moveDatabase([row(writer,{recorded:true})]);
 const driver=answering(db.log,()=>'noModel'); const options={waiting,now:()=>clock};
 const move=()=>withEngineContract(()=>driver,()=>moveAgentProfiles(db,options));
 await move();
 clock+=59999;
 await move();
 assert.deepEqual(db.log,['agent_move_work',`provideAgent ${own(writer)}`,'agent_move_work']);
 clock+=1;
 await move();
 assert.deepEqual(db.log.slice(3),['agent_move_work',`provideAgent ${own(writer)}`]);
});

test('one Agent that fails never holds back another',async()=>{
 const db=moveDatabase([row(writer),row(critic)],{fail:{record_agent_profile:writer}});
 const logged=[]; const error=console.error; console.error=(...args)=>{ logged.push(args.join(' ')); };
 try { assert.deepEqual(await withEngineContract(()=>answering(db.log),()=>moveAgentProfiles(db)),{moved:1}); }
 finally { console.error=error; }
 assert.ok(!db.log.includes(`move_agent_profile ${writer}`));
 assert.ok(db.log.includes(`move_agent_profile ${critic}`));
 assert.deepEqual(logged,[`Agent not moved: ${writer} record_agent_profile refused`]);
});

test('on the Engine server a move asks about the Agent\'s own profile only: nothing names the keeper\'s profile',async()=>{
 const fake=await engineServing(company);
 try {
  const kept=companyProfile(company);
  fake.settings.profiles.set(kept,{soul:'The Company\'s soul.',provider:'openai-codex',model:'gpt-5.5',key:'test-only-key',config:{memory:{memory_enabled:true}},credentials:{'openai-codex':'company-token'}});
  const before=structuredClone(fake.settings.profiles.get(kept));
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  const db=moveDatabase([row(writer)]);
  assert.deepEqual(await moveAgentProfiles(db),{moved:1});
  const requests=[...fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),...fake.settings.requests.map(request=>`${request.method} ${request.path}`)];
  assert.deepEqual(requests.filter(request=>request.includes(kept)),[],'no request names the keeper\'s profile');
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='DELETE'),[]);
  assert.deepEqual(fake.settings.managementRequests.find(request=>request.method==='POST').body,{name:own(writer),soul:`You are ${writer}.`},'made, never cloned');
  assert.ok(requests.includes(`GET /api/model/options?profile=${own(writer)}`),'the Engine is asked whether the Agent\'s own profile can answer');
  assert.deepEqual(fake.settings.profiles.get(kept),before,'the keeper\'s profile is as it was');
  assert.deepEqual(fake.settings.profiles.get(own(writer)).config,toolConfig({profile:own(writer)}));
 } finally { await fake.close(); }
});

test('a move reads in the Company\'s log as the Agent getting its own space, in both languages',()=>{
 assert.deepEqual(describeEntry({subject:'agent',action:'agent_own_space',details:{agent_name:'Writer'}}),{act:['logActAgentOwnSpace'],obj:'Writer',from:undefined,to:undefined,note:undefined});
 assert.equal(i18n('en').t('logActAgentOwnSpace'),'got its own space in the agent engine');
 assert.notEqual(i18n('ar').t('logActAgentOwnSpace'),'logActAgentOwnSpace');
});
