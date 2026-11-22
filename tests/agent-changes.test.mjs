import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readProfileModels, writeProfileModel, readModels, readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig,
 readAgentInstructions as readInstructions, writeAgentInstructions as writeInstructions } from '../lib/hermes.mjs';
import { runToolCall, toolSpecTexts } from '../lib/agent-tools.mjs';
import { answerChange, readChangeContext } from '../lib/agent-changes.mjs';
import { engineSettings, changeCompanySetting } from '../lib/engine-settings.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
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

test('an unlisted setting and a toolset other than the Owner\'s sub-agents switch reach the database, which keeps them as refused, and the Engine is not called',async()=>{
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
// The database as the Owner's session: claim_agent_change answers from the proposals it holds and takes a waiting one, or an
// applying one whose lease ran out (`lease:'over'`), with a token; a lease it holds answers busy, and `lost` is a claim
// taken away before the Engine write (renew_agent_change answers false).
let tokens=0;
function owner(proposals,{isOwner=true,answer=null,busy=false,lost=false}={}) {
 const calls=[];
 const db={
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='is_company_owner') return {data:isOwner,error:null};
   if(name==='company_engine_target') return {data:[{profile:companyProfile(company),profiles:[]}],error:null};
   if(name==='company_app_agents') return {data:agents.map(({agent,name,profile,own})=>({agent,name,profile,own})),error:null};
   if(name==='company_agent_models') return {data:agents,error:null};
   if(name==='company_key_profiles') return {data:[{profile:`cs-${company.replaceAll('-','')}`,kind:'space',agent:null,name:null}],error:null};
   if(['log_engine_setting','set_agent_model','check_agent_owner_setting','log_agent_instructions','set_agent_subagents'].includes(name)) return {data:null,error:null};
   if(name==='claim_agent_change') {
    const row=proposals.find(found=>found.id===args.proposal&&args.c===company);
    if(!row) return {data:null,error:{code:'P0002',message:'agentChangeNotFound'}};
    if(row.state!=='waiting'&&row.state!=='applying') return {data:{state:row.state},error:null};
    if(busy||row.state==='applying'&&row.lease!=='over') return {data:{state:'busy'},error:null};
    if(args.edited!==undefined&&(typeof args.edited!==typeof row.value||args.edited===null)) return {data:null,error:{code:'22023',message:'agentChangeEditInvalid'}};
    const retry=row.state==='applying'; row.state='applying'; row.token=`token-${++tokens}`; row.lease='held';
    row.approved=args.edited!==undefined&&args.edited!==row.value?args.edited:undefined;
    return {data:{state:'claimed',token:row.token,retry,agent:row.agent_id,change:row.change,setting:row.setting,value:row.approved??row.value,
     ...(args.edited!==undefined?{edited:row.approved!==undefined}:{})},error:null};
   }
   if(name==='renew_agent_change') { const row=proposals.find(found=>found.id===args.proposal); return {data:!lost&&row?.token===args.claim&&row.lease==='held',error:null}; }
   if(name==='release_agent_change') {
    const row=proposals.find(found=>found.id===args.proposal&&found.token===args.claim);
    if(row) Object.assign(row,args.uncertain?{lease:'over'}:{state:'waiting',token:undefined,lease:undefined});
    return {data:null,error:null};
   }
   if(name==='answer_agent_change') return answer??{data:args.approve?'approved':'declined',error:null};
   return {data:null,error:{message:`unexpected ${name}`}};
  },
 };
 // No Provider has a model switched off (company_provider_models).
 db.from=()=>({select:()=>({eq:async()=>({data:[],error:null})})});
 return {db,calls};
}
// The Company's Providers (#620): its shared space holds an Anthropic, an OpenRouter and an OpenAI key, so a model of
// any of them is one a Provider has on and may be written.
const companyProviders=fake=>{
 if(!fake.settings.envRows.some(row=>row.env==='OPENAI_API_KEY')) fake.settings.envRows.push({env:'OPENAI_API_KEY',provider:'openai',label:'OpenAI',primary:true,password:true,category:'provider'});
 fake.settings.profiles.set(`cs-${company.replaceAll('-','')}`,{soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},
  env:{ANTHROPIC_API_KEY:'sk-ant-test-0123456789abcdef',OPENROUTER_API_KEY:'sk-or-v1-test-0123456789abcdef',OPENAI_API_KEY:'sk-openai-test-0123456789abcdef'}});
};
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},...meta});
const proposalsOf=()=>({model:{id:1,agent_id:ads,change:'model',setting:null,value:'anthropic/claude-sonnet-5-5',state:'waiting'},
 soul:{id:2,agent_id:writer,change:'instructions',setting:null,value:'You write short posts.',state:'waiting'}});

test('approving a model change and an instructions change writes each to its own Agent\'s profile alone, reads it back, then marks it approved',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
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
  assert.deepEqual(answered.map(({claim,...rest})=>({...rest,claimed:typeof claim==='string'})),[{c:company,proposal:1,approve:true,reason:null,claimed:true},{c:company,proposal:2,approve:true,reason:null,claimed:true}]);
  // Each is claimed before the Engine's write, and marked approved only after it.
  const order=calls.map(call=>call.name);
  assert.ok(order.indexOf('claim_agent_change')<order.indexOf('set_agent_model'));
  assert.ok(order.indexOf('set_agent_model')<order.indexOf('answer_agent_change'));
  assert.ok(order.indexOf('log_agent_instructions')<order.lastIndexOf('answer_agent_change'));
 } finally { await fake.close(); }
});

test('declining writes nothing to the Engine and sends the reason; an Engine that refused leaves the claim for another approval',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(ads),own(writer)]) profileOn(fake,name);
  const {model,soul}=proposalsOf();
  const {db,calls}=owner([model,soul]);
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:false,reason:'Keep it this month.'}),{state:'declined'});
  assert.deepEqual(calls.map(call=>call.name),['is_company_owner','answer_agent_change']);
  assert.deepEqual(calls.at(-1).args,{c:company,proposal:1,approve:false,reason:'Keep it this month.',claim:null});
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
  // The Engine refuses the write: nothing is marked approved, and the proposal stays applying with its lease ended, so the
  // next approval takes it over at once, writes again and finishes it.
  fake.settings.managementStatus=401;
  const again=proposalsOf().model;
  const refused=owner([again]);
  assert.deepEqual(await answerChange(refused.db,{...options,proposal:1,approve:true}),{state:'notApplied',applied:'refused'});
  assert.equal(refused.calls.some(call=>call.name==='answer_agent_change'),false);
  assert.deepEqual(refused.calls.filter(call=>call.name==='release_agent_change').map(call=>call.args.uncertain),[true]);
  assert.deepEqual([again.state,again.lease],['applying','over']);
  fake.settings.managementStatus=200;
  assert.deepEqual(await answerChange(refused.db,{...options,proposal:1,approve:true}),{state:'approved'});
 } finally { await fake.close(); }
});

test('a change the writer refuses before any Engine write gives the claim back and says it cannot be made as the Agent is now',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  // Sub-agents are off for Ads, so its sub-agent settings cannot be written.
  const depth={id:3,agent_id:ads,change:'setting',setting:'delegation.max_spawn_depth',value:2,state:'waiting'};
  const {db,calls}=owner([depth]);
  assert.deepEqual(await answerChange(db,{company,proposal:3,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)}),{state:'cannotApply',applied:'subagentsOff'});
  assert.equal(depth.state,'waiting');
  assert.deepEqual(calls.filter(call=>call.name.endsWith('_agent_change')).map(call=>call.name),['claim_agent_change','renew_agent_change','release_agent_change']);
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
 } finally { await fake.close(); }
});

test('a claim taken again after an unconfirmed write is never given back, even when the next write is refused before the Engine',async()=>{
 // The first approval reached the Engine but was never confirmed, so the proposal is still applying with its lease over;
 // now the Company has no Engine at all. The earlier write may hold, so it stays applying and is never sent back to waiting.
 const pending={id:4,agent_id:ads,change:'model',setting:null,value:'openai/gpt-5',state:'applying',lease:'over'};
 const {db,calls}=owner([pending]);
 const noEngine={...db,rpc:async(name,args)=>name==='company_engine_target'?{data:[],error:null}:db.rpc(name,args)};
 assert.deepEqual(await answerChange(noEngine,{company,proposal:4,approve:true,hermes:null}),{state:'notApplied',applied:'noEngine'});
 assert.equal(pending.state,'applying');
 assert.deepEqual(calls.filter(call=>call.name==='release_agent_change').map(call=>call.args.uncertain),[true]);
});

test('a lease another request holds answers busy, and a claim lost before the Engine write writes nothing',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  // The same Owner's other tab holds the lease: this request is busy and never reaches the Engine.
  const held={id:5,agent_id:ads,change:'model',setting:null,value:'openai/gpt-5',state:'applying',lease:'held',token:'other'};
  const tab=owner([held]);
  assert.deepEqual(await answerChange(tab.db,{company,proposal:5,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)}),{state:'busy'});
  // The claim is taken away (its lease ran out and it was declined) between the claim and the write: nothing is written.
  const paused=owner([proposalsOf().model],{lost:true});
  assert.deepEqual(await answerChange(paused.db,{company,proposal:1,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)}),{state:'busy'});
  assert.equal(paused.calls.some(call=>call.name==='answer_agent_change'),false);
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
 } finally { await fake.close(); }
});

// The two windows Hermes leaves open: an approval that stalls after renewing its lease (another Owner declines once the lease
// runs out), and an Engine write that lands after its request timed out. The Engine has no compare-and-set, so neither can
// be stopped; the decline is recorded as maybe applied (agent_change_proposals.sql), and the Owner whose write landed late
// is told so rather than "already answered".
test('a write that lands after the proposal was declined meanwhile says so to the Owner who wrote it',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  const {model}=proposalsOf();
  const declinedMeanwhile=owner([model],{answer:{data:null,error:{code:'22023',message:'agentChangeAnswered'}}});
  assert.deepEqual(await answerChange(declinedMeanwhile.db,{company,proposal:1,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)}),{state:'writtenLate'});
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT').map(request=>request.path),[`/api/profiles/${own(ads)}/model`]);
  // A write whose request timed out but which the Engine still completes afterwards: the approval reads it as unknown,
  // ends its lease and keeps the proposal applying, so a decline then is recorded as maybe applied while the write lands.
  profileOn(fake,own(ads));
  const late=proposalsOf().model;
  const pendingWrites=[];
  const slow={...settingDriver(fake),writeModel:async(target,change)=>{ pendingWrites.push(()=>settingDriver(fake).writeModel(target,change)); return {state:'unreachable'}; }};
  const timedOutLate=owner([late]);
  assert.deepEqual(await answerChange(timedOutLate.db,{company,proposal:1,approve:true,hermes:install(fake),settingDriver:slow}),{state:'notApplied',applied:'unreachable'});
  assert.deepEqual([late.state,late.lease],['applying','over'],'the proposal is never sent back to waiting while the write may still land');
  assert.equal(fake.settings.profiles.get(own(ads)).model,'openai/gpt-5.5','nothing had landed when the approval answered');
  await Promise.all(pendingWrites.map(write=>write()));
  assert.equal(fake.settings.profiles.get(own(ads)).model,'claude-sonnet-5-5','the write lands after its request timed out');
  // A write that timed out is uncertain: the lease ends, the proposal stays applying, and a decline then is maybe applied.
  fake.settings.managementStatus=504;
  const timedOut=owner([proposalsOf().model]);
  assert.deepEqual((await answerChange(timedOut.db,{company,proposal:1,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)})).state,'notApplied');
  assert.deepEqual(timedOut.calls.filter(call=>call.name==='release_agent_change').map(call=>call.args.uncertain),[true]);
 } finally { await fake.close(); }
});

// #436: an approval of a setting waits its turn behind the Company's other setting writes. Its claim is renewed once that
// turn has come, not before the wait, so a claim another Owner declined while it waited writes nothing.
test('an approval waiting behind a Company-wide write renews its claim only once that write ends, and a claim lost meanwhile writes nothing',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  // The shared space is companyProviders' own, with its keys.
  for(const name of [companyProfile(company),own(ads),own(writer)]) profileOn(fake,name);
  const {model}=proposalsOf();
  const {db,calls}=owner([model]);
  let open=()=>{};
  const gate=new Promise(resolve=>{ open=resolve; });
  let held=false;
  const slow={...settingDriver(fake),writeModel:async(target,change)=>{ held=true; await gate; return settingDriver(fake).writeModel(target,change); }};
  const companyWide=changeCompanySetting(db,{company,setting:'model',value:'openrouter/openai/gpt-5.4',hermes:install(fake),driver:slow});
  while(!held) await new Promise(resolve=>setTimeout(resolve,5));
  const approval=answerChange(db,{company,proposal:1,approve:true,hermes:install(fake),settingDriver:settingDriver(fake)});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(calls.some(call=>call.name==='claim_agent_change'),'the proposal is claimed at once');
  assert.equal(calls.some(call=>call.name==='renew_agent_change'),false,'the claim is not renewed while the Company-wide write holds the turn');
  // Its lease runs out while it waits and another Owner declines it.
  Object.assign(model,{state:'declined',lease:'over'});
  open();
  const [wide,answer]=await Promise.all([companyWide,approval]);
  assert.equal(wide.state,'written',JSON.stringify(wide));
  assert.deepEqual(answer,{state:'busy'});
  const renewedAt=calls.findIndex(call=>call.name==='renew_agent_change');
  assert.ok(renewedAt>calls.findLastIndex(call=>call.name==='log_engine_setting'),'renewed only after the Company-wide write ended');
  assert.equal(calls.some(call=>call.name==='answer_agent_change'||call.name==='release_agent_change'||call.name==='set_agent_model'),false,'the lost claim is neither answered nor released');
  assert.equal(fake.settings.profiles.get(own(ads)).model,'openai/gpt-5.4','Ads keeps the Company default: the declined change is never written');
 } finally { await fake.close(); }
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

// #484: "Edit, then approve". The Owner's value goes with the claim, which the database checks and answers as the value
// to write; the writer then writes that value, not the proposed one, to the Agent's own profile.
test('approving with an edit claims the Owner\'s value and writes it, not the proposed one, to the Agent\'s own profile',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(ads)]) profileOn(fake,name);
  profileOn(fake,own(writer),{soul:`You write long posts.\n${section}\n`});
  const {model,soul}=proposalsOf();
  const {db,calls}=owner([model,soul]);
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:true,edited:'openai/gpt-5'}),{state:'approved'});
  assert.deepEqual(await answerChange(db,{...options,proposal:2,approve:true,edited:'You write posts of three lines.'}),{state:'approved'});
  assert.deepEqual(calls.filter(call=>call.name==='claim_agent_change').map(call=>call.args),
   [{c:company,proposal:1,edited:'openai/gpt-5'},{c:company,proposal:2,edited:'You write posts of three lines.'}]);
  assert.equal(fake.settings.profiles.get(own(ads)).provider,'openai');
  assert.equal(fake.settings.profiles.get(own(ads)).model,'gpt-5');
  assert.equal(fake.settings.profiles.get(own(writer)).soul,`You write posts of three lines.\n${section}\n`);
  // Approving as proposed sends no edit at all, as the previous app's claim does.
  const plain=owner([proposalsOf().model]);
  assert.deepEqual(await answerChange(plain.db,{...options,proposal:1,approve:true}),{state:'approved'});
  assert.deepEqual(plain.calls.find(call=>call.name==='claim_agent_change')?.args,{c:company,proposal:1});
 } finally { await fake.close(); }
});

test('an edit the database refuses writes nothing, and an edit sent with a decline is never sent',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  profileOn(fake,own(ads));
  const {db,calls}=owner([proposalsOf().model]);
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake)};
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:true,edited:7}),{state:'editInvalid'});
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='PUT'),[]);
  assert.deepEqual(await answerChange(db,{...options,proposal:1,approve:false,reason:'No',edited:'openai/gpt-5'}),{state:'declined'});
  assert.equal(calls.filter(call=>call.name==='claim_agent_change').length,1,'a decline claims nothing');
 } finally { await fake.close(); }
});

// #484: what the card reads when it is drawn: the value the Agent has now, read from its Engine profile as Settings reads
// it, and, for an Owner, the field to edit the proposed value in: the models the profile's Engine lists, the instructions
// with the Engine's limit, the sub-agents switch, or the listed setting's own type, choices and limits.
function reader(proposals,{isOwner=true}={}) {
 const base=owner([],{isOwner});
 const db={...base.db,from:table=>{
  if(table==='company_provider_models') return base.db.from(table);
  assert.equal(table,'agent_change_proposals');
  const filters={};
  const query={select:()=>query,eq:(key,value)=>{ filters[key]=value; return query; },
   maybeSingle:async()=>({data:proposals.find(row=>row.id===filters.id&&filters.company_id===company)??null,error:null})};
  return query;
 }};
 return db;
}
test('the card reads the Agent\'s current value from its own profile, and an Owner gets the field to edit the proposal in',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(writer)]) profileOn(fake,name);
  profileOn(fake,own(ads),{soul:`You write long ads.\n${section}\n`,provider:'anthropic',model:'claude-sonnet-5-5',credentials:{anthropic:{}},config:{memory:{memory_char_limit:2200}}});
  const rows=[{id:1,agent_id:ads,change:'model',setting:null,state:'waiting'},{id:2,agent_id:ads,change:'instructions',setting:null,state:'waiting'},
   {id:3,agent_id:ads,change:'toolset',setting:'delegation',state:'waiting'},{id:4,agent_id:ads,change:'setting',setting:'memory.memory_char_limit',state:'waiting'},
   {id:5,agent_id:ads,change:'model',setting:null,state:'approved'}];
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  const model=await readChangeContext(reader(rows),{...options,proposal:1});
  assert.equal(model.state,'found');
  assert.equal(model.now,'anthropic/claude-sonnet-5-5');
  assert.equal(model.edit?.kind,'model');
  assert.ok(model.edit.options.length>0&&model.edit.options.every(option=>typeof option.provider==='string'&&typeof option.providerName==='string'&&typeof option.model==='string'),'the Engine\'s model list for that profile');
  const soul=await readChangeContext(reader(rows),{...options,proposal:2});
  assert.deepEqual({state:soul.state,now:soul.now,edit:soul.edit},{state:'found',now:'You write long ads.',edit:{kind:'instructions',limit:soul.edit.limit}});
  // The team's rules section stays in the file, so the field takes what is left of the limit beside it.
  assert.equal(soul.edit.limit,20000-section.length);
  // An Engine that takes longer instructions still edits them only within what the database takes for a proposal.
  fake.settings.profiles.get(own(ads)).config.context_file_max_chars=30000;
  assert.equal((await readChangeContext(reader(rows),{...options,proposal:2})).edit?.limit,20000);
  // An approval whose write was never confirmed is finished, not edited again: no field, and the value it is writing.
  const retry=await readChangeContext(reader([{...rows[0],id:6,state:'applying',approved_value:'openai/gpt-5'}]),{...options,proposal:6});
  assert.deepEqual({state:retry.state,edit:retry.edit,approved:retry.approved},{state:'found',edit:null,approved:'openai/gpt-5'});
  assert.deepEqual(await readChangeContext(reader(rows),{...options,proposal:3}),{state:'found',now:false,edit:{kind:'switch'}});
  const limit=await readChangeContext(reader(rows),{...options,proposal:4});
  assert.equal(limit.state,'found');
  assert.equal(limit.edit.kind,'setting');
  assert.equal(limit.edit.type,'number');
  assert.deepEqual(limit.edit.limits,{integer:true},'its limits, without the Engine source line beside them');
  assert.equal(limit.now,2200);
  assert.deepEqual(await readChangeContext(reader(rows),{...options,proposal:5}),{state:'answered'},'an answered proposal has no "Now": the value then is gone');
  assert.deepEqual(await readChangeContext(reader(rows),{...options,proposal:9}),{state:'notFound'});
  // Anyone else who reads the card reads the value now, and no field to edit it in.
  const member=await readChangeContext(reader(rows,{isOwner:false}),{...options,proposal:1});
  assert.deepEqual({state:member.state,now:member.now,edit:member.edit},{state:'found',now:'anthropic/claude-sonnet-5-5',edit:null});
  // An Engine that cannot be read draws the card without its "Now" row.
  assert.deepEqual(await readChangeContext(reader(rows),{company,hermes:null,proposal:1}),{state:'found',now:null,edit:null});
 } finally { await fake.close(); }
});

// A proposed sub-agent model is written alone (delegation.model), so the Owner's choices are only the models of the
// provider the sub-agents run on: their own provider, else the Agent's. A model of another provider would be approved
// into a pair the Engine cannot run (Settings writes both keys together for that reason).
test('the sub-agents\' model is edited among the models of the provider they run on, never another provider\'s',async()=>{
 const fake=await fakeHermes(); companyProviders(fake);
 try {
  for(const name of [companyProfile(company),own(writer)]) profileOn(fake,name);
  fake.settings.providerModels.openai=['gpt-5.5','gpt-5-mini'];
  const base={soul:'',provider:'anthropic',model:'claude-sonnet-5-5',key:fake.settings.key,credentials:{anthropic:{}},env:{OPENAI_API_KEY:'test-only-key'}};
  const rows=[{id:1,agent_id:ads,change:'setting',setting:'delegation.model',state:'waiting'}];
  const options={company,hermes:install(fake),settingDriver:settingDriver(fake),instructionsDriver:instructionsDriver(fake)};
  const subagents=agents.map(row=>row.agent===ads?{...row,subagents:true}:row);
  const db=()=>{ const read=reader(rows); return {...read,rpc:(name,args)=>name==='company_agent_models'?Promise.resolve({data:subagents,error:null}):read.rpc(name,args)}; };
  // Its own provider is OpenAI: only OpenAI's models.
  fake.settings.profiles.set(own(ads),{...base,config:{delegation:{provider:'openai',model:'gpt-5.5'}}});
  const openai=await readChangeContext(db(),{...options,proposal:1});
  assert.deepEqual(openai.edit,{kind:'setting',type:'select',choices:['gpt-5.5','gpt-5-mini'],limits:null,default:openai.edit.default});
  // No provider of its own: it runs on the Agent's, Anthropic.
  fake.settings.profiles.set(own(ads),{...base,config:{delegation:{provider:'',model:''}}});
  const anthropic=await readChangeContext(db(),{...options,proposal:1});
  assert.deepEqual(anthropic.edit?.choices,['claude-sonnet-5-5']);
  // A proposed provider is written alone too: only the providers that list the sub-agents' own model, else every one.
  fake.settings.providerModels.anthropic=['claude-sonnet-5-5','gpt-5.5'];
  const providerRows=[{id:2,agent_id:ads,change:'setting',setting:'delegation.provider',state:'waiting'}];
  const providerDb=()=>{ const read=reader(providerRows); return {...read,rpc:(name,args)=>name==='company_agent_models'?Promise.resolve({data:subagents,error:null}):read.rpc(name,args)}; };
  fake.settings.profiles.set(own(ads),{...base,config:{delegation:{provider:'openai',model:'gpt-5-mini'}}});
  assert.deepEqual((await readChangeContext(providerDb(),{...options,proposal:2})).edit?.choices,['openai']);
  fake.settings.profiles.set(own(ads),{...base,config:{delegation:{provider:'',model:''}}});
  assert.deepEqual([...(await readChangeContext(providerDb(),{...options,proposal:2})).edit?.choices??[]].sort(),['anthropic','openai']);
 } finally { await fake.close(); }
});
