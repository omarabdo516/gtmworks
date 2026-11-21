import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readProfileModels, writeProfileModel, readModels, readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig,
 readAgentInstructions as readInstructions, writeAgentInstructions as writeInstructions } from '../lib/hermes.mjs';
import { runToolCall, toolSpecTexts } from '../lib/agent-tools.mjs';
import { answerChange } from '../lib/agent-changes.mjs';
import { engineSettings } from '../lib/engine-settings.mjs';
import { companyProfile } from '../lib/agent-levels.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #19: an Agent proposes a change to its own Engine profile, or Lead to another Agent's, and nothing changes until the
// Owner approves it. The propose tool reaches the database alone; approving writes the change through #125's writer to
// that Agent's own profile, reads it back, and only then marks the proposal approved.
const company='10000000-0000-0000-0000-000000000001';
const [lead,ads,writer]=['3c000000-0000-0000-0000-000000000011','3c000000-0000-0000-0000-000000000021','3c000000-0000-0000-0000-000000000031'];
const own=id=>`ag-${id.replaceAll('-','')}`;
const section='<!-- gtmworks:rules -->\n- Be brief\n<!-- /gtmworks:rules -->';

// The propose tool: what the model sends, as the database is asked to keep it.
function proposer(/** @type {unknown} */ answer={state:'proposed',proposal:7}) {
 const fake=fakeEngine(); const rpcs=/** @type {[string,object][]} */([]); const engineCalls=/** @type {string[]} */([]);
 const engine=new Proxy(fake.engineFor({}),{get:(target,key)=>{ engineCalls.push(String(key)); return Reflect.get(target,key); }});
 const db={rpc:async(/** @type {string} */ name,/** @type {object} */ args)=>{ rpcs.push([name,args]); return {data:answer,error:null}; },
  from:()=>{ throw new Error('no table is read when a change is proposed'); }};
 const call=(/** @type {unknown} */ args)=>runToolCall({db,engine,profile:own(ads),conversation:'conversation-1',run:'run-1'},{id:'call-0',name:'propose_change',arguments:args});
 return {rpcs,engineCalls,call};
}
const kept=(/** @type {object} */ args)=>['agent_propose_change',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:null,setting:null,...args}];

test('a proposed change is kept by the database with its reason, and the Engine is not called',async()=>{
 const {rpcs,engineCalls,call}=proposer();
 assert.deepEqual(await call({change:'model',value:' anthropic/claude-sonnet-5-5 ',reason:' Faster on big numbers. '}),{state:'proposed',proposal:7});
 assert.deepEqual(await call({agent:'Ads',change:'instructions',value:'You write short ad copy.\n',reason:'Its copy runs long.'}),{state:'proposed',proposal:7});
 assert.deepEqual(await call({change:'toolset',setting:'delegation',value:'on',reason:'To split the report.'}),{state:'proposed',proposal:7});
 assert.deepEqual(await call({change:'setting',setting:'memory.memory_char_limit',value:'4000',reason:'It forgets.'}),{state:'proposed',proposal:7});
 assert.deepEqual(await call({change:'setting',setting:'memory.memory_enabled',value:'false',reason:'It remembers too much.'}),{state:'proposed',proposal:7});
 // A model may leave the instructions-only parameters blank, as it often sends "" for an optional field.
 assert.deepEqual(await call({agent:'',change:'model',setting:'',value:'openai/gpt-5',reason:'Cheaper.'}),{state:'proposed',proposal:7});
 assert.deepEqual(rpcs,[
  kept({change:'model',value:'anthropic/claude-sonnet-5-5',reason:'Faster on big numbers.'}),
  kept({agent_name:'Ads',change:'instructions',value:'You write short ad copy.\n',reason:'Its copy runs long.'}),
  kept({change:'toolset',setting:'delegation',value:true,reason:'To split the report.'}),
  kept({change:'setting',setting:'memory.memory_char_limit',value:4000,reason:'It forgets.'}),
  kept({change:'setting',setting:'memory.memory_enabled',value:false,reason:'It remembers too much.'}),
  kept({change:'model',value:'openai/gpt-5',reason:'Cheaper.'}),
 ]);
 assert.deepEqual(engineCalls,[],'nothing of the Engine is touched while the proposal waits');
});

test('an unlisted setting and a toolset above the Agent level reach the database, which keeps them as refused, and the Engine is not called',async()=>{
 const {rpcs,engineCalls,call}=proposer({state:'refused',proposal:8});
 assert.deepEqual(await call({change:'setting',setting:'terminal.backend',value:'local',reason:'I need a shell.'}),{state:'refused',proposal:8});
 assert.deepEqual(await call({change:'toolset',setting:'terminal',value:'on',reason:'I need a shell.'}),{state:'refused',proposal:8});
 assert.deepEqual(rpcs,[kept({change:'setting',setting:'terminal.backend',value:'local',reason:'I need a shell.'}),kept({change:'toolset',setting:'terminal',value:true,reason:'I need a shell.'})]);
 assert.deepEqual(engineCalls,[]);
});

test('arguments that do not read are ignored, and nothing is asked of the database or the Engine',async()=>{
 const {rpcs,engineCalls,call}=proposer();
 for(const args of /** @type {unknown[]} */([null,{},{change:'app',value:'canva',reason:'x'},{change:'model',value:'openai/gpt-5'},{change:'model',value:'openai/gpt-5',reason:' '},
  {change:'model',value:'openai/gpt-5',reason:'x'.repeat(501)},{change:'model',value:'',reason:'x'},{change:'instructions',value:'a\u0000b',reason:'x'},
  {change:'instructions',value:'x'.repeat(20001),reason:'x'},{change:'model',value:'openai/gpt-5',reason:'x',agent:'x'.repeat(101)},{change:'setting',setting:'x'.repeat(121),value:'1',reason:'x'}]))
  assert.deepEqual(await call(args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual([rpcs,engineCalls],[[],[]]);
 const {description,parameters}=JSON.parse(toolSpecTexts().propose_change);
 assert.match(description,/Nothing changes until the Owner approves it/);
 assert.match(description,/ask_for_app/,'an app is asked for with its own tool');
 assert.deepEqual(parameters.properties.change.enum,['model','instructions','toolset','setting']);
});

test('the database\'s list of settings is #125\'s list, so nothing outside it can wait for an Owner',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20270415000000_agent_change_proposals.sql',import.meta.url),'utf8');
 const listed=/when 'setting' then setting in \(([^)]*)\)/.exec(migration)?.[1]?.match(/'[^']+'/g)?.map(value=>value.slice(1,-1));
 assert.deepEqual(listed,engineSettings.map(entry=>entry.key).filter(key=>key!=='model'));
});

// Approving, against the fake Engine server: the database as the Owner's session reaches it.
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=fake=>target=>({...target,managementAddress:fake.managementAddress});
const settingDriver=fake=>({
 config:target=>readConfig(at(fake)(target)),saved:target=>readSavedConfig(at(fake)(target)),schema:target=>readConfigSchema(at(fake)(target)),
 defaults:target=>readConfigDefaults(at(fake)(target)),write:(target,config)=>writeConfig(at(fake)(target),config),
 writeModel:(target,change)=>writeProfileModel(at(fake)(target),change),profileModels:(target,profiles)=>readProfileModels(at(fake)(target),profiles),
 options:target=>readModels(at(fake)(target)),
});
const instructionsDriver=fake=>({read:(target,name)=>readInstructions(at(fake)(target),name),instructions:(target,change)=>writeInstructions(at(fake)(target),change)});
const agents=[
 {agent:lead,name:'Lead',profile:companyProfile(company),own:true,choosable:true,model_choice:null,subagents:false},
 {agent:ads,name:'Ads',profile:own(ads),own:true,choosable:true,model_choice:null,subagents:false},
 {agent:writer,name:'Writer',profile:own(writer),own:true,choosable:true,model_choice:null,subagents:false},
];
// The database as the Owner's session: claim_agent_change answers from the proposals it holds and takes a waiting one.
function owner(proposals,{isOwner=true,answer=null,busy=false}={}) {
 const calls=[];
 const db={
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='is_company_owner') return {data:isOwner,error:null};
   if(name==='company_engine_target') return {data:[{profile:companyProfile(company),profiles:[]}],error:null};
   if(name==='company_app_agents') return {data:agents.map(({agent,name,profile,own})=>({agent,name,profile,own})),error:null};
   if(name==='company_agent_models') return {data:agents,error:null};
   if(['log_engine_setting','set_agent_model','check_agent_owner_setting','log_agent_instructions','set_agent_subagents'].includes(name)) return {data:null,error:null};
   if(name==='claim_agent_change') {
    const row=proposals.find(found=>found.id===args.proposal&&args.c===company);
    if(!row) return {data:null,error:{code:'P0002',message:'agentChangeNotFound'}};
    if(row.state!=='waiting'&&row.state!=='applying') return {data:{state:row.state},error:null};
    if(busy) return {data:{state:'busy'},error:null};
    const retry=row.state==='applying'; row.state='applying';
    return {data:{state:'claimed',retry,agent:row.agent_id,change:row.change,setting:row.setting,value:row.value},error:null};
   }
   if(name==='release_agent_change') { const row=proposals.find(found=>found.id===args.proposal); if(row) row.state='waiting'; return {data:null,error:null}; }
   if(name==='answer_agent_change') return answer??{data:args.approve?'approved':'declined',error:null};
   return {data:null,error:{message:`unexpected ${name}`}};
  },
 };
 return {db,calls};
}
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},...meta});
const proposalsOf=()=>({model:{id:1,agent_id:ads,change:'model',setting:null,value:'anthropic/claude-sonnet-5-5',state:'waiting'},
 soul:{id:2,agent_id:writer,change:'instructions',setting:null,value:'You write short posts.',state:'waiting'}});

test('approving a model change and an instructions change writes each to its own Agent\'s profile alone, reads it back, then marks it approved',async()=>{
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  profileOn(fake,own(writer),{soul:`You write long posts.\n${section}\n`});
  const {model,soul}=proposalsOf();
  const {db,calls}=owner([model,soul]);
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:true}),{state:'approved'});
  assert.deepEqual(await answerChange(db,{...options,proposal:2,approve:true}),{state:'approved'});
  const writes=fake.settings.managementRequests.filter(request=>request.method==='PUT');
  assert.deepEqual(writes.map(request=>request.path),[`/api/profiles/${own(ads)}/model`,`/api/profiles/${own(writer)}/soul`],'one write each, to that Agent\'s own profile');
  // The read-back: the Engine holds each change, the rules section kept, and no other profile changed.
  assert.equal(fake.settings.profiles.get(own(ads)).provider,'anthropic');
  assert.equal(fake.settings.profiles.get(own(ads)).model,'claude-sonnet-5-5');
  assert.equal(fake.settings.profiles.get(own(writer)).soul,`You write short posts.\n${section}\n`);
  assert.equal(fake.settings.profiles.get(companyProfile(company)).model,'openai/gpt-5.5');
  assert.equal(fake.settings.profiles.get(own(writer)).model,'openai/gpt-5.5');
  const answered=calls.filter(call=>call.name==='answer_agent_change').map(call=>call.args);
  assert.deepEqual(answered,[{c:company,proposal:1,approve:true,reason:null},{c:company,proposal:2,approve:true,reason:null}]);
  // Each is claimed before the Engine's write, and marked approved only after it.
  const order=calls.map(call=>call.name);
  assert.ok(order.indexOf('claim_agent_change')<order.indexOf('set_agent_model'));
  assert.ok(order.indexOf('set_agent_model')<order.indexOf('answer_agent_change'));
  assert.ok(order.indexOf('log_agent_instructions')<order.lastIndexOf('answer_agent_change'));
 } finally { await fake.close(); }
});

test('declining writes nothing to the Engine and sends the reason; an Engine that refused leaves the claim for another approval',async()=>{
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),own(ads),own(writer)]) profileOn(fake,name);
  const {model,soul}=proposalsOf();
  const {db,calls}=owner([model,soul]);
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:false,reason:'Keep it this month.'}),{state:'declined'});
  assert.deepEqual(calls.map(call=>call.name),['is_company_owner','answer_agent_change']);
  assert.deepEqual(calls.at(-1).args,{c:company,proposal:1,approve:false,reason:'Keep it this month.'});
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
  // The Engine refuses the write: nothing is marked approved, and the claim stays, so a decline cannot land while the
  // Engine's state is unknown; the next approval writes again and finishes it.
  fake.settings.managementStatus=401;
  const again=proposalsOf().model;
  const refused=owner([again]);
  assert.deepEqual(await answerChange(refused.db,{...options,proposal:1,approve:true}),{state:'notApplied',applied:'refused'});
  assert.equal(refused.calls.some(call=>call.name==='answer_agent_change'||call.name==='release_agent_change'),false);
  assert.equal(again.state,'applying');
  fake.settings.managementStatus=200;
  assert.deepEqual(await answerChange(refused.db,{...options,proposal:1,approve:true}),{state:'approved'});
 } finally { await fake.close(); }
});

test('a change the writer refuses before any Engine write gives the claim back and says it cannot be made as the Agent is now',async()=>{
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  // Sub-agents are off for Ads, so its sub-agent settings cannot be written.
  const depth={id:3,agent_id:ads,change:'setting',setting:'delegation.max_spawn_depth',value:2,state:'waiting'};
  const {db,calls}=owner([depth]);
  assert.deepEqual(await answerChange(db,{company,proposal:3,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)}),{state:'cannotApply',applied:'subagentsOff'});
  assert.equal(depth.state,'waiting');
  assert.deepEqual(calls.filter(call=>call.name.endsWith('_agent_change')).map(call=>call.name),['claim_agent_change','release_agent_change']);
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
 } finally { await fake.close(); }
});

test('a claim taken again after an unconfirmed write is never given back, even when the next write is refused before the Engine',async()=>{
 // The first approval reached the Engine but was never confirmed, so the proposal is still applying; now the Company has
 // no Engine at all. The earlier write may hold, so the claim stays and a decline cannot say that nothing changed.
 const pending={id:4,agent_id:ads,change:'model',setting:null,value:'openai/gpt-5',state:'applying'};
 const {db,calls}=owner([pending]);
 const noEngine={...db,rpc:async(name,args)=>name==='company_engine_target'?{data:[],error:null}:db.rpc(name,args)};
 assert.deepEqual(await answerChange(noEngine,{company,proposal:4,approve:true,hermes:null}),{state:'notApplied',applied:'noEngine'});
 assert.equal(pending.state,'applying');
 assert.equal(calls.some(call=>call.name==='release_agent_change'),false);
});

test('only an Owner answers, an unknown proposal is not found, and an answered or busy one is never written again',async()=>{
 const engineless={company,hermes:null};
 const {model}=proposalsOf();
 const member=owner([model],{isOwner:false});
 assert.deepEqual(await answerChange(member.db,{...engineless,proposal:1,approve:true}),{state:'notAllowed'});
 assert.deepEqual(member.calls.map(call=>call.name),['is_company_owner']);
 assert.deepEqual(await answerChange(owner([model]).db,{...engineless,proposal:9,approve:true}),{state:'notFound'});
 assert.deepEqual(await answerChange(owner([model]).db,{...engineless,proposal:0,approve:true}),{state:'notFound'});
 const done=owner([{...model,state:'approved'}]);
 assert.deepEqual(await answerChange(done.db,{...engineless,proposal:1,approve:true}),{state:'approved'});
 assert.deepEqual(done.calls.map(call=>call.name),['is_company_owner','claim_agent_change'],'the Engine is not asked again');
 for(const [code,message,state] of [['42501','agentChangeNotAllowed','notAllowed'],['P0002','agentChangeNotFound','notFound'],['22023','agentChangeAnswered','answered'],
  ['22023','agentChangeReasonLong','reasonLong'],['22023','agentChangeReasonMissing','reasonMissing'],['22023','agentChangeApplying','applying'],['22023','agentChangeBusy','busy'],['22023','agentChangeAnswerMissing','failed'],['XX000','boom','failed']])
  assert.deepEqual(await answerChange(owner([model],{answer:{data:null,error:{code,message}}}).db,{...engineless,proposal:1,approve:false,reason:'No'}),{state},`${code} ${message}`);
 const busy=owner([proposalsOf().model],{busy:true});
 assert.deepEqual(await answerChange(busy.db,{...engineless,proposal:1,approve:true}),{state:'busy'});
 assert.equal(busy.calls.some(call=>call.name==='answer_agent_change'),false,'another Owner\'s approval is being written');
 assert.deepEqual(await answerChange(owner([{...model,state:'declined'}]).db,{...engineless,proposal:1,approve:true}),{state:'answered'});
});
