import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readModelAccess, readProviderModels, changeProviderModel, offeredModels, modelEnabled } from '../lib/provider-models.mjs';
import { readCompanyModels, changeCompanySetting } from '../lib/engine-settings.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
import { setProviderKey } from '../lib/hermes.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #620 (spec #611): each Provider's models are switched on or off by the Owner, and a model choice is offered once while
// at least one eligible Provider of its provider has it on. Two Providers of one provider: the Company's Claude
// subscription (on the Engine's root profile) and its Anthropic key (in its shared space); a third, an OpenRouter key.
const company='10000000-0000-0000-0000-000000000001';
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const main=companyProfile(company);
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const seed=fake=>{
 for(const name of [space,main]) fake.settings.profiles.set(name,{soul:'',provider:'anthropic',model:'claude-opus-4-6',key:fake.settings.key,config:{},credentials:{},
  env:{ANTHROPIC_API_KEY:'sk-ant-test-0123456789abcdef',OPENROUTER_API_KEY:'sk-or-v1-test-0123456789abcdef'}});
 fake.settings.defaultCredentials.anthropic='test-only-claude-oauth';
 fake.settings.subscriptionModels.anthropic=['claude-opus-4-6','claude-sonnet-4-6'];
};
// The person's own session: which profiles are the Company's, whether they are its Owner, and the switches the
// database keeps (company_provider_models), changed only through set_provider_model as the Owner.
function database({owner=true,rows=[],order=[]}={}) {
 const kept=[...rows]; const calls=[];
 const db={
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='is_company_owner') return {data:owner,error:null};
   if(name==='company_engine_target') return {data:[{profile:main,profiles:[main]}],error:null};
   if(name==='company_key_profiles') return {data:[{profile:space,kind:'space',agent:null,name:null},{profile:main,kind:'company',agent:'a1',name:'Lead'}],error:null};
   if(name==='company_agent_models') return {data:[{agent:'a1',name:'Lead',profile:main,own:true,choosable:true,model_choice:null,subagents:false}],error:null};
   if(name==='set_agent_model'||name==='log_engine_setting') return {data:null,error:null};
   if(name==='set_provider_model') {
    if(!owner) return {data:null,error:{code:'42501',message:'providerModelNotAllowed'}};
    const at=kept.findIndex(row=>row.entry===args.provider_entry&&row.model===args.provider_model);
    if(at>=0) kept.splice(at,1);
    kept.push({entry:args.provider_entry,model:args.provider_model,enabled:args.turned_on});
    return {data:args.turned_on,error:null};
   }
   return {data:null,error:{message:`unexpected ${name}`}};
  },
  from:table=>({select:()=>({eq:async(column,value)=>column!=='company_id'||value!==company?{data:null,error:{message:'unexpected'}}
   :table==='company_provider_models'?{data:kept.map(row=>({...row})),error:null}
   // The Owner's switches of whole Providers (#619), none unless the test gives them.
   :table==='provider_order'?{data:order.map(row=>({...row})),error:null}:{data:null,error:{message:'unexpected'}}})}),
 };
 return {db,calls,kept};
}
const pairs=options=>options.map(option=>`${option.provider}/${option.model}`);
const ownerPicks=async(db,fake)=>{
 const read=await readCompanyModels(db,{company,owner:true,hermes:install(fake)});
 return {company:pairs(read.models.default.options),agent:pairs(read.models.agents[0].options)};
};
const access=async(db,fake)=>readModelAccess(db,{company,hermes:install(fake)});

test('a model is offered once while either Provider of its provider has it on, and gone once both turned it off', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  const {db}=database();
  const switches=await readProviderModels(db,{company,hermes:install(fake)});
  assert.deepEqual(switches,{
   'sub-anthropic':[{model:'claude-opus-4-6',enabled:true},{model:'claude-sonnet-4-6',enabled:true}],
   'key-anthropic':[{model:'claude-opus-4-6',enabled:true},{model:'claude-sonnet-4-6',enabled:true}],
   'key-openrouter':[{model:'anthropic/claude-opus-4.6',enabled:true},{model:'openai/gpt-5.5',enabled:true}],
  },'every model a Provider offers starts on');
  const all=['anthropic/claude-opus-4-6','anthropic/claude-sonnet-4-6'];
  assert.deepEqual((await ownerPicks(db,fake)).company.filter(pair=>pair.startsWith('anthropic/')),all,'one choice for each model, though two Providers offer it');

  assert.equal((await changeProviderModel(db,{company,entry:'sub-anthropic',model:'claude-sonnet-4-6',enabled:false})).status,200);
  let picks=await ownerPicks(db,fake);
  assert.deepEqual(picks.company.filter(pair=>pair.startsWith('anthropic/')),all,'the key still has it on, so it is still offered');
  assert.deepEqual(picks.agent.filter(pair=>pair.startsWith('anthropic/')),all,'on the Agent too');
  assert.deepEqual((await readProviderModels(db,{company,hermes:install(fake)}))['sub-anthropic'],[{model:'claude-opus-4-6',enabled:true},{model:'claude-sonnet-4-6',enabled:false}],'the switch is kept');

  await changeProviderModel(db,{company,entry:'key-anthropic',model:'claude-sonnet-4-6',enabled:false});
  picks=await ownerPicks(db,fake);
  assert.deepEqual(picks.company,['anthropic/claude-opus-4-6','openrouter/anthropic/claude-opus-4.6','openrouter/openai/gpt-5.5'],'off on both, the Company default no longer offers it');
  assert.ok(!picks.agent.includes('anthropic/claude-sonnet-4-6'),'nor does the Agent');

  await changeProviderModel(db,{company,entry:'key-anthropic',model:'claude-sonnet-4-6',enabled:true});
  assert.ok((await ownerPicks(db,fake)).agent.includes('anthropic/claude-sonnet-4-6'),'turned on again on one, it is back');
 } finally { await fake.close(); }
});

test('a switch of a Provider the Company no longer has offers nothing, and an unread Engine offers no choice', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  // The subscription has the model off; the key is gone, so its default "on" is not a Provider's any more.
  delete fake.settings.profiles.get(space).env.ANTHROPIC_API_KEY;
  const {db}=database({rows:[{entry:'sub-anthropic',model:'claude-opus-4-6',enabled:false},{entry:'key-anthropic',model:'claude-opus-4-6',enabled:true}]});
  const found=await access(db,fake);
  assert.deepEqual(found.entries.map(entry=>entry.id),['sub-anthropic','key-openrouter']);
  assert.equal(modelEnabled(found,{provider:'anthropic',model:'claude-opus-4-6'}),false);
  assert.equal(modelEnabled(found,{provider:'anthropic',model:'claude-sonnet-4-6'}),true);
  assert.equal(modelEnabled(found,{provider:'deepseek',model:'deepseek-chat'}),false,'a provider no Provider serves is never offered');
  assert.deepEqual(offeredModels([{provider:'anthropic',model:'claude-opus-4-6'}],null),[],'unread, nothing is offered');
  fake.settings.modelOptionsFail=true;
  assert.equal(await readProviderModels(db,{company,hermes:install(fake)}),null);
 } finally { await fake.close(); }
});

test('only the Owner changes a switch; a Manager reads them and is refused', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  const manager=database({owner:false,rows:[{entry:'key-openrouter',model:'openai/gpt-5.5',enabled:false}]});
  assert.deepEqual(await changeProviderModel(manager.db,{company,entry:'key-openrouter',model:'openai/gpt-5.5',enabled:true}),{status:403,body:{error:'providerModelNotAllowed'}});
  assert.deepEqual(manager.kept,[{entry:'key-openrouter',model:'openai/gpt-5.5',enabled:false}],'nothing changed');
  assert.deepEqual((await readProviderModels(manager.db,{company,hermes:install(fake)}))['key-openrouter'],[{model:'anthropic/claude-opus-4.6',enabled:true},{model:'openai/gpt-5.5',enabled:false}],'the Manager reads every switch');
  const owner=database();
  for(const change of [{entry:'anthropic',model:'claude-opus-4-6',enabled:false},{entry:'key-anthropic',model:'claude opus',enabled:false},{entry:'key-anthropic',model:'claude-opus-4-6',enabled:'no'}])
   assert.deepEqual(await changeProviderModel(owner.db,{company,...change}),{status:400,body:{error:'providerModelInvalid'}});
  assert.equal(owner.calls.filter(call=>call.name==='set_provider_model').length,0,'an invalid change never reaches the database');
 } finally { await fake.close(); }
});

test('a model no Provider has on is never written, as the Company default or an Agent\'s own', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  const {db}=database({rows:[{entry:'sub-anthropic',model:'claude-sonnet-4-6',enabled:false},{entry:'key-anthropic',model:'claude-sonnet-4-6',enabled:false}]});
  for(const agent of [null,'a1'])
   assert.deepEqual(await changeCompanySetting(db,{company,agent,setting:'model',value:'anthropic/claude-sonnet-4-6',hermes:install(fake)}),{state:'notEnabled'});
  assert.equal(fake.settings.profiles.get(main).model,'claude-opus-4-6','the Engine holds the model it had');
  assert.ok(!fake.settings.managementRequests.some(request=>request.method==='PUT'&&request.path.endsWith('/model')),'nothing was asked of the Engine');
  const written=await changeCompanySetting(db,{company,agent:'a1',setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake)});
  assert.equal(written.state,'written',JSON.stringify(written));
 } finally { await fake.close(); }
});

test('a subscription signed in only on an Agent\'s profile lists its models from that profile, so the Owner can switch each one', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  // An older version left the Claude sign-in on the Company's own profile only ("Partly connected"): the shared space
  // holds no sign-in, and its Anthropic key is gone, so it lists no Anthropic model.
  delete fake.settings.defaultCredentials.anthropic;
  delete fake.settings.profiles.get(space).env.ANTHROPIC_API_KEY;
  fake.settings.profiles.get(main).credentials.anthropic='test-only-claude-oauth';
  const {db}=database();
  const switches=await readProviderModels(db,{company,hermes:install(fake)});
  assert.deepEqual(switches['sub-anthropic'],[{model:'claude-opus-4-6',enabled:true},{model:'claude-sonnet-4-6',enabled:true}]);
  assert.equal(switches['key-anthropic'],undefined);
 } finally { await fake.close(); }
});

test('a Provider the Owner switched off offers nothing, and a subscription goes only once every account of it is off (#619)', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  fake.settings.defaultPool.anthropic=[{id:'c1aude',label:'',auth_type:'oauth',source:'manual:hermes_pkce',priority:0,access_token:'test-only-claude-a'},
   {id:'c2aude',label:'',auth_type:'oauth',source:'manual:hermes_pkce',priority:1,access_token:'test-only-claude-b'}];
  const off=(provider,account)=>({provider,account,place:null,enabled:false});
  const ids=async order=>(await access(database({order}).db,fake)).entries.map(entry=>entry.id).sort();
  assert.deepEqual(await ids([]),['key-anthropic','key-openrouter','sub-anthropic'],'every Provider on by default');
  assert.deepEqual(await ids([off('openrouter','key')]),['key-anthropic','sub-anthropic'],'a key switched off offers nothing');
  assert.deepEqual(await ids([off('anthropic','c1aude')]),['key-anthropic','key-openrouter','sub-anthropic'],'one Claude account off: the other still serves');
  const found=await access(database({order:[off('anthropic','c1aude'),off('anthropic','c2aude'),off('anthropic','key')]}).db,fake);
  assert.deepEqual(found.entries.map(entry=>entry.id),['key-openrouter'],'both accounts and the key off: no Claude choice is offered');
  assert.equal(modelEnabled(found,{provider:'anthropic',model:'claude-opus-4-6'}),false);
  // The details still list every Provider's models, switched off or not, so the Owner can switch it on again.
  assert.deepEqual(Object.keys(await readProviderModels(database({order:[off('anthropic','key')]}).db,{company,hermes:install(fake)})).sort(),['key-anthropic','key-openrouter','sub-anthropic']);
 } finally { await fake.close(); }
});

test('an order that could not be read offers nothing, and an unlisted subscription is offered only while none of its accounts is off (#619)', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  const broken=database(); const from=broken.db.from;
  broken.db.from=table=>table==='provider_order'?{select:()=>({eq:async()=>({data:null,error:{message:'down'}})})}:from(table);
  assert.equal(await access(broken.db,fake),null,'a switch that cannot be read never reads as on');
  // The Engine answers whether Claude is signed in but does not list its accounts.
  fake.settings.poolNamedFail=true;
  const ids=async order=>(await access(database({order}).db,fake)).entries.map(entry=>entry.id).sort();
  assert.deepEqual(await ids([]),['key-anthropic','key-openrouter','sub-anthropic'],'with nothing switched off it is offered');
  assert.deepEqual(await ids([{provider:'anthropic',account:'c1aude',place:null,enabled:false}]),['key-anthropic','key-openrouter'],
   'with an account of its kind off, which ones it holds is unknown: not offered');
  assert.deepEqual(await ids([{provider:'anthropic',account:'key',place:null,enabled:false}]),['key-openrouter','sub-anthropic'],'a key switched off says nothing of the subscription');
 } finally { await fake.close(); }
});

// #643: OpenCode Go serves its key only part of the Engine's catalogue; the Engine merges its own older ids into the list,
// and OpenCode refuses each of those. A fake OpenCode Go, which the profile's OPENCODE_GO_BASE_URL points at as the
// Engine's own route does, lists what the key is served.
async function fakeOpenCode({served,status=200}) {
 const { createServer }=await import('node:http');
 const asked=[];
 const server=createServer((request,response)=>{
  asked.push({path:request.url,authorization:request.headers.authorization});
  response.writeHead(status,{'Content-Type':'application/json'});
  response.end(JSON.stringify(status===200?{object:'list',data:served.map(id=>({id,object:'model',owned_by:'opencode'}))}:{error:'down'}));
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {base:`http://127.0.0.1:${server.address().port}/zen/go/v1`,asked,close:()=>new Promise(done=>server.close(done))};
}
const goKey='sk-go-test-0123456789abcdef';
const seedGo=(fake,base)=>{
 seed(fake);
 fake.settings.envRows.push({env:'OPENCODE_GO_API_KEY',provider:'opencode-go',label:'OpenCode Go',primary:true,password:true,category:'provider'});
 fake.settings.providerModels['opencode-go']=['mimo-v2-omni','glm-5.3','kimi-k2.5','gemini-4-argon'];
 for(const name of [space,main]) Object.assign(fake.settings.profiles.get(name).env,{OPENCODE_GO_API_KEY:goKey,OPENCODE_GO_BASE_URL:base});
};

test('an OpenCode Go key offers only the models OpenCode serves it, in Settings and in the pickers', async () => {
 const fake=await fakeHermes(); const go=await fakeOpenCode({served:['glm-5.3','gemini-4-argon','qwen-4']});
 try {
  seedGo(fake,go.base);
  const {db}=database();
  const switches=await readProviderModels(db,{company,hermes:install(fake)});
  assert.deepEqual(switches['key-opencode-go'],[{model:'glm-5.3',enabled:true},{model:'gemini-4-argon',enabled:true}],'the Engine\'s ids OpenCode does not serve are gone');
  assert.deepEqual(switches['key-openrouter'].map(row=>row.model),['anthropic/claude-opus-4.6','openai/gpt-5.5'],'another provider keeps the Engine\'s list');
  const picks=await ownerPicks(db,fake);
  assert.deepEqual(picks.company.filter(pair=>pair.startsWith('opencode-go/')),['opencode-go/glm-5.3','opencode-go/gemini-4-argon']);
  assert.deepEqual(picks.agent.filter(pair=>pair.startsWith('opencode-go/')),['opencode-go/glm-5.3','opencode-go/gemini-4-argon']);
  assert.ok(go.asked.every(request=>request.path==='/zen/go/v1/models'&&request.authorization===`Bearer ${goKey}`),'asked with the key the profile holds');
 } finally { await go.close(); await fake.close(); }
});

test('an OpenCode Go list that cannot be read leaves the Engine\'s list', async () => {
 const fake=await fakeHermes(); const go=await fakeOpenCode({served:[],status:503});
 try {
  seedGo(fake,go.base);
  const {db}=database();
  const switches=await readProviderModels(db,{company,hermes:install(fake)});
  assert.deepEqual(switches['key-opencode-go'].map(row=>row.model),['mimo-v2-omni','glm-5.3','kimi-k2.5','gemini-4-argon']);
 } finally { await go.close(); await fake.close(); }
});

test('giving an OpenCode Go key sets the Company\'s model to one OpenCode serves, and to the Engine\'s first when OpenCode cannot say', async () => {
 for(const [status,expected] of [[200,'glm-5.3'],[503,'mimo-v2-omni']]) {
  const fake=await fakeHermes(); const go=await fakeOpenCode({served:['gemini-4-argon','glm-5.3'],status});
  try {
   seedGo(fake,go.base);
   for(const name of [space,main]) { delete fake.settings.profiles.get(name).env.OPENCODE_GO_API_KEY; }
   const set=await setProviderKey(install(fake),{space,profiles:[main],provider:'opencode-go',value:goKey});
   assert.equal(set.state,'written');
   assert.equal(set.model,expected,'the first of the Engine\'s list that OpenCode serves');
   assert.deepEqual(set.profiles,{[main]:'written'});
   const profile=fake.settings.profiles.get(main);
   assert.deepEqual([profile.provider,profile.model],['opencode-go',expected]);
  } finally { await go.close(); await fake.close(); }
 }
});
