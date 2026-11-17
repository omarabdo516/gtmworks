import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile, readApps, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from '../lib/hermes.mjs';
import { levelConfig, alwaysOff, companyProfile } from '../lib/agent-levels.mjs';
import { changeCompanyApp, readCompanyApps, finishCompanyAppSignIn } from '../lib/company-apps.mjs';
import { appByKey, appConfig, mergedState } from '../lib/app-catalogue.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The service behind /api/company-apps and the vendor's way back (#30): only the Owner changes an app, checked for
// every step, and only for an Agent whose profile is its own; a Member reads each Agent's state; the browser gets the
// vendor's page and states, never the Engine's flow or a profile; the way back is handed on only for the person's own
// open sign-in, in its Agent's profile, and each connect and disconnect is logged once with its Agent.
const encryptionKey=Buffer.alloc(32,9).toString('base64');
const company='10000000-0000-0000-0000-000000000002';
const [owner,member]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005'];
const [lead,writer,analyst,helper]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021','3a000000-0000-0000-0000-000000000031','3a000000-0000-0000-0000-000000000041'];
const agentProfile=id=>`ag-${id.replaceAll('-','')}`;
// company_app_agents as the database answers the Owner: Lead keeps the Company's profile; Writer and Analyst moved to
// their own; Helper has not moved yet and shares Lead's.
const leadRow={agent:lead,name:'Lead',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true};
const writerRow={agent:writer,name:'Writer',connection:'f0000000-0000-0000-0000-000000000021',profile:agentProfile(writer),main:false,own:true};
const analystRow={agent:analyst,name:'Analyst',connection:'f0000000-0000-0000-0000-000000000031',profile:agentProfile(analyst),main:false,own:true};
const helperRow={agent:helper,name:'Helper',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false};

// The person's own session as the database answers it: is_company_owner, company_engine_target, the three app
// functions, and the sign-ins row-level security shows an Owner. The service role only reads the Connection's key.
function sessions(fake,{person,isOwner,signIns,agents=[leadRow]}) {
 const asked=[]; const logged=[];
 const db={rpc:async(name,args)=>{
   asked.push(name);
   if(name==='is_company_owner') return {data:isOwner,error:null};
   if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:companyProfile(args.c)}],error:null};
   if(name==='company_app_agents') return {data:agents,error:null};
   if(!isOwner) return {data:null,error:{code:'42501'}};
   if(name==='start_app_sign_in') { signIns.splice(0,signIns.length,...signIns.filter(row=>row.started_by!==person||row.app!==args.app_key||row.finished_at)); signIns.push({company_id:args.c,agent_id:args.agent,app:args.app_key,flow_id:args.flow,started_by:person,finished_at:null,started_at:signIns.length,companies:{slug:'rs-consultations'}}); return {data:null,error:null}; }
   if(name==='finish_app_sign_in') { const open=signIns.find(row=>row.app===args.app_key&&row.flow_id===args.flow&&row.started_by===person&&!row.finished_at); if(open) { open.finished_at='now'; logged.push(['app_connected',open.app,open.agent_id]); } return {data:open?[{company_id:open.company_id,slug:'rs-consultations'}]:[],error:null}; }
   if(name==='record_app_disconnected') { logged.push(['app_disconnected',args.app_key,args.agent]); return {data:null,error:null}; }
   return {data:null,error:{message:'unexpected'}};
  },
  from:table=>{
   assert.equal(table,'company_app_sign_ins');
   const filters=[];
   const chain={select:()=>chain,eq:(column,value)=>{filters.push([column,value]);return chain;},is:(column,value)=>{filters.push([column,value]);return chain;},order:()=>chain,limit:()=>chain,
    maybeSingle:async()=>({data:isOwner?signIns.filter(row=>filters.every(([column,value])=>row[column]===value)).sort((a,b)=>b.started_at-a.started_at)[0]??null:null,error:null})};
   return chain;
  }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})})};
 return {db,service,asked,logged};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
function driverAt(fake) {
 const at=target=>({...target,managementAddress:fake.managementAddress});
 return {read:target=>readApps(at(target)),start:(target,key,back)=>startAppSignIn(at(target),key,back),poll:(target,flow)=>pollAppSignIn(at(target),flow),
  cancel:(target,flow)=>cancelAppSignIn(at(target),flow),finish:(target,signIn)=>finishAppSignIn(at(target),signIn),disconnect:(target,key)=>disconnectApp(at(target),key)};
}
// A profile in the fake Engine, and an app as gtmworks leaves it there after a sign-in.
const makeProfile=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
const installed=key=>({url:`https://mcp.${key}.example/mcp`,auth:'oauth',...appConfig(appByKey(key),`http://localhost:3000/api/apps/callback/${key}`).mcp_servers[key]});
const serversOf=(fake,name)=>fake.settings.profiles.get(name).config.mcp_servers||{};
const profileOf=path=>new URL(path,'http://management').searchParams.get('profile');

test('only an Owner connects, follows or disconnects an app; a Member reads the states', async () => {
 const fake=await fakeHermes();
 try {
  const install={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
  await provideProfile(install,{name:companyProfile(company),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const driver=driverAt(fake);
  const signIns=[];
  const someone=sessions(fake,{person:member,isOwner:false,signIns});
  for(const action of ['connect','poll','cancel','disconnect']) {
   assert.deepEqual(await changeCompanyApp(someone.db,someone.service,{company,agent:lead,person:member,app:'klaviyo',action,encryptionKey,driver}),{status:403,body:{error:'appsNotAllowed'}});
  }
  assert.equal(fake.settings.appFlows.size,0,'a member never reaches the Engine');
  assert.equal((await readCompanyApps(someone.db,someone.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'off');

  const omar=sessions(fake,{person:owner,isOwner:true,signIns});
  const change=(action,app='klaviyo')=>changeCompanyApp(omar.db,omar.service,{company,agent:lead,person:owner,app,action,encryptionKey,driver});
  assert.deepEqual(await change('connect','figma'),{status:400,body:{error:'appsInvalid'}});
  const started=await change('connect');
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body),['url']);
  const url=new URL(String(started.body.url));
  assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/apps/callback/klaviyo');
  assert.deepEqual(await change('poll'),{status:200,body:{status:'waiting'}});
  const again=await change('connect');
  assert.equal(again.status,200);
  assert.equal([...fake.settings.appFlows.values()].filter(flow=>flow.status==='authorization_required').length,1,'a sign-in left open gives way to the new one');
  const vendorState=new URL(String(again.body.url)).searchParams.get('state');

  assert.deepEqual(await finishCompanyAppSignIn(someone.db,someone.service,{person:member,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:null,outcome:'failed'});
  assert.equal(fake.settings.appCallbacks.length,0,'nothing reaches the Engine without the person\'s own sign-in');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,omar.service,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(await change('poll'),{status:200,body:{status:'connected'}});
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,omar.service,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:null,outcome:'failed'},'a finished sign-in\'s answer is never applied to another one');
  assert.equal(fake.settings.appCallbacks.length,1,'the second way back reaches the Engine for no sign-in');
  assert.equal(omar.asked.filter(name=>name==='finish_app_sign_in').length,1);
  assert.equal((await readCompanyApps(omar.db,omar.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'connected');

  assert.deepEqual(await change('disconnect'),{status:200,body:{status:'off'}});
  assert.deepEqual(omar.asked.filter(name=>name==='record_app_disconnected'),['record_app_disconnected']);
  assert.deepEqual(omar.logged,[['app_connected','klaviyo',lead],['app_disconnected','klaviyo',lead]]);
  assert.equal((await readCompanyApps(omar.db,omar.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'off');
  assert.doesNotMatch(JSON.stringify([started,again]),/flow|hermes|opt\//i);
 } finally { await fake.close(); }
});

test('each Agent\'s state is read from its own profile: connected, needing attention or off, and an app on before the move is the main Agent\'s', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  for(const name of [companyProfile(company),agentProfile(writer),agentProfile(analyst)]) makeProfile(fake,name);
  // Klaviyo was connected in the Company's profile before any Agent moved; Writer's sign-in never finished.
  fake.settings.profiles.get(companyProfile(company)).config.mcp_servers={klaviyo:installed('klaviyo')};
  fake.settings.appTokens.add(`${companyProfile(company)}:klaviyo`);
  fake.settings.profiles.get(agentProfile(writer)).config.mcp_servers={klaviyo:installed('klaviyo')};
  const missing={agent:'3a000000-0000-0000-0000-000000000051',name:'Designer',connection:'f0000000-0000-0000-0000-000000000051',profile:'ag-3a000000000000000000000000000051',main:false,own:true};
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow,writerRow,analystRow,helperRow,missing]});
  const read=fake.settings.managementRequests.length;
  const apps=await readCompanyApps(someone.db,someone.service,{company,encryptionKey,driver});
  const klaviyo=apps?.find(app=>app.key==='klaviyo');
  assert.deepEqual(klaviyo?.agents.map(agent=>[agent.name,agent.state]),[['Lead','connected'],['Writer','attention'],['Analyst','off'],['Helper','connected'],['Designer',null]]);
  assert.equal(klaviyo?.state,'connected');
  assert.deepEqual(klaviyo?.agents[0],{id:lead,name:'Lead',connection:leadRow.connection,main:true,own:true,state:'connected'},'nothing but the Agent and its state, never its profile');
  assert.deepEqual(apps?.find(app=>app.key==='canva')?.agents.map(agent=>agent.state),['off','off','off','off',null]);
  assert.equal(apps?.find(app=>app.key==='canva')?.state,'off');
  assert.doesNotMatch(JSON.stringify(apps),/profile|co-|ag-|hermes|opt\//i);
  const catalogueReads=fake.settings.managementRequests.slice(read).filter(request=>request.path?.startsWith('/api/mcp/catalog'));
  assert.deepEqual(catalogueReads.map(request=>profileOf(request.path)).sort(),[companyProfile(company),agentProfile(analyst),agentProfile(writer),missing.profile].sort(),'each profile is read once, the shared one too');
 } finally { await fake.close(); }
});

test('the card\'s state is connected when any Agent of its own is, else attention when any is, else off', () => {
 const of=(...states)=>states.map(([own,state])=>({own,state}));
 assert.equal(mergedState(of([true,'off'],[true,'attention'],[true,'connected'])),'connected');
 assert.equal(mergedState(of([true,'off'],[true,'attention'],[true,null])),'attention');
 assert.equal(mergedState(of([true,'off'],[true,null],[false,'connected'])),'off','an Agent on the main profile adds nothing of its own');
 assert.equal(mergedState([]),'off');
});

test('an app turned on for one Agent is in that Agent\'s profile and no other, and off removes it from there', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const signIns=[];
  const omar=sessions(fake,{person:owner,isOwner:true,signIns,agents:[leadRow,writerRow,helperRow]});
  const change=(action,agent)=>changeCompanyApp(omar.db,omar.service,{company,agent,person:owner,app:'klaviyo',action,encryptionKey,driver});
  const mark=fake.settings.managementRequests.length;
  const started=await change('connect',writer);
  assert.equal(started.status,200);
  const vendorState=new URL(String(started.body.url)).searchParams.get('state');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,omar.service,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(await change('poll',writer),{status:200,body:{status:'connected'}});
  const scoped=fake.settings.managementRequests.slice(mark).filter(request=>/^\/api\/(config|mcp\/(catalog|servers))/.test(request.path||''));
  assert.ok(scoped.length>=4,'the catalogue, the config and the sign-in were asked');
  assert.deepEqual([...new Set(scoped.map(request=>profileOf(request.path)))],[agentProfile(writer)],'every request names Writer\'s profile');
  assert.deepEqual(serversOf(fake,agentProfile(writer)).klaviyo.tools,{include:[...appByKey('klaviyo').readTools],prompts:false,resources:false});
  assert.equal(serversOf(fake,companyProfile(company)).klaviyo,undefined,'Lead\'s profile has none of it');
  assert.ok(fake.settings.appTokens.has(`${agentProfile(writer)}:klaviyo`));
  assert.deepEqual((await readCompanyApps(omar.db,omar.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.agents.map(agent=>[agent.name,agent.state]),
   [['Lead','off'],['Writer','connected'],['Helper','off']]);

  const off=fake.settings.managementRequests.length;
  assert.deepEqual(await change('disconnect',writer),{status:200,body:{status:'off'}});
  assert.deepEqual(fake.settings.managementRequests.slice(off).map(request=>[request.method,profileOf(request.path)]),[['DELETE',agentProfile(writer)]]);
  assert.equal(serversOf(fake,agentProfile(writer)).klaviyo,undefined,'Writer\'s next Run is offered none of its tools');
  assert.deepEqual(omar.logged,[['app_connected','klaviyo',writer],['app_disconnected','klaviyo',writer]]);

  // Disconnect with no Agent: off for every Agent that has it, each logged with its Agent.
  fake.settings.profiles.get(companyProfile(company)).config.mcp_servers={klaviyo:installed('klaviyo')};
  fake.settings.profiles.get(agentProfile(writer)).config.mcp_servers={klaviyo:installed('klaviyo'),notion:installed('notion')};
  assert.deepEqual(await change('disconnect',undefined),{status:200,body:{status:'off'}});
  assert.deepEqual([serversOf(fake,companyProfile(company)),Object.keys(serversOf(fake,agentProfile(writer)))],[{},['notion']]);
  assert.deepEqual(omar.logged.slice(2),[['app_disconnected','klaviyo',lead],['app_disconnected','klaviyo',writer]]);
 } finally { await fake.close(); }
});

test('only an Agent whose profile is its own is changed: one on the main profile or not listed is refused before the Engine is asked', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  makeProfile(fake,companyProfile(company));
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,helperRow]});
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow]});
  const mark=fake.settings.managementRequests.length;
  for(const action of ['connect','poll','cancel','disconnect']) {
   assert.deepEqual(await changeCompanyApp(omar.db,omar.service,{company,agent:helper,person:owner,app:'klaviyo',action,encryptionKey,driver}),{status:409,body:{error:'appsAgentNotOwn'}},`${action}: Helper shares Lead's profile`);
   assert.deepEqual(await changeCompanyApp(omar.db,omar.service,{company,agent:writer,person:owner,app:'klaviyo',action,encryptionKey,driver}),{status:409,body:{error:'appsAgentNotOwn'}},`${action}: an Agent not listed`);
   assert.deepEqual(await changeCompanyApp(someone.db,someone.service,{company,agent:lead,person:member,app:'klaviyo',action,encryptionKey,driver}),{status:403,body:{error:'appsNotAllowed'}},`${action}: a Member`);
  }
  for(const agent of ['not-an-id',42,null]) assert.deepEqual(await changeCompanyApp(omar.db,omar.service,{company,agent,person:owner,app:'klaviyo',action:'connect',encryptionKey,driver}),{status:400,body:{error:'appsInvalid'}});
  assert.deepEqual(await changeCompanyApp(omar.db,omar.service,{company,person:owner,app:'klaviyo',action:'connect',encryptionKey,driver}),{status:400,body:{error:'appsInvalid'}},'a connect names its Agent');
  assert.equal(fake.settings.managementRequests.length,mark,'the Engine was never asked');
  assert.deepEqual([omar.logged,someone.asked.filter(name=>name!=='is_company_owner')],[[],[]]);
 } finally { await fake.close(); }
});
