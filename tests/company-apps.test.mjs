import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile, readApps, readUsage, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from '../lib/hermes.mjs';
import { toolConfig, companyProfile } from '../lib/agent-toolsets.mjs';
import { changeCompanyApp, readCompanyApps, finishCompanyAppSignIn, readAgentApps, readAgentTools, readCompanyUsage } from '../lib/company-apps.mjs';
import { changeCompanyServer } from '../lib/company-servers.mjs';
import { mergedState } from '../lib/app-catalogue.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The service behind /api/company-apps and the vendor's way back (#30): only the Owner changes an app, checked for
// every step, and only for an Agent whose profile is its own; a Member reads each Agent's state; the browser gets the
// vendor's page and states, never the Engine's flow or a profile; the way back is handed on only for the person's own
// open sign-in, in its Agent's profile, and each connect and disconnect is logged once with its Agent.
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
function sessions(fake,{person,isOwner,canManage=isOwner,signIns,agents=[leadRow]}) {
 const asked=[]; const logged=[]; const calls=[];
 const db={rpc:async(name,args)=>{
   asked.push(name); calls.push([name,args]);
   if(name==='can_manage_company') return {data:canManage,error:null};
   if(name==='is_company_owner') return {data:isOwner,error:null};
   if(name==='company_engine_target') return {data:[{profile:companyProfile(args.c)}],error:null};
   if(name==='company_app_agents') return {data:agents,error:null};
   if(!isOwner) return {data:null,error:{code:'42501'}};
   if(name==='start_app_sign_in') { signIns.splice(0,signIns.length,...signIns.filter(row=>row.started_by!==person||row.app!==args.app_key||row.finished_at)); signIns.push({company_id:args.c,agent_id:args.agent,app:args.app_key,flow_id:args.flow,started_by:person,finished_at:null,started_at:signIns.length,companies:{slug:'rs-consultations'}}); return {data:null,error:null}; }
   if(name==='finish_app_sign_in') { const open=signIns.find(row=>row.app===args.app_key&&row.flow_id===args.flow&&row.started_by===person&&!row.finished_at); if(open) { open.finished_at='now'; logged.push(['app_connected',open.app,open.agent_id]); } return {data:open?[{company_id:open.company_id,slug:'rs-consultations'}]:[],error:null}; }
   if(name==='record_app_disconnected') { logged.push(['app_disconnected',args.app_key,args.agent]); return {data:null,error:null}; }
   if(name==='record_app_connected') { logged.push(['app_connected',args.app_key,args.agent]); return {data:null,error:null}; }
   return {data:null,error:{message:'unexpected'}};
  },
  from:table=>{
   assert.equal(table,'company_app_sign_ins');
   const filters=[];
   const chain={select:()=>chain,eq:(column,value)=>{filters.push([column,value]);return chain;},is:(column,value)=>{filters.push([column,value]);return chain;},order:()=>chain,limit:()=>chain,
    maybeSingle:async()=>({data:isOwner?signIns.filter(row=>filters.every(([column,value])=>row[column]===value)).sort((a,b)=>b.started_at-a.started_at)[0]??null:null,error:null})};
   return chain;
  }};
 // The install's Hermes is the fake (#342): the code reaches it as it reaches the bundled one.
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 const service={};
 return {db,service,asked,logged,calls};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
function driverAt(fake) {
 const at=target=>({...target,managementAddress:fake.managementAddress});
 return {read:target=>readApps(at(target)),start:(target,key,back)=>startAppSignIn(at(target),key,back),poll:(target,flow)=>pollAppSignIn(at(target),flow),
  cancel:(target,flow)=>cancelAppSignIn(at(target),flow),finish:(target,signIn)=>finishAppSignIn(at(target),signIn),disconnect:(target,key)=>disconnectApp(at(target),key)};
}
// A profile in the fake Engine, and an app as gtmworks leaves it there after a sign-in: on, with its way back, and no
// tool filter (ADR 0020).
const makeProfile=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
const installed=key=>({url:`https://mcp.${key}.example/mcp`,auth:'oauth',enabled:true,oauth:{redirect_uri:`http://localhost:3000/api/apps/callback/${key}`}});
const serversOf=(fake,name)=>fake.settings.profiles.get(name).config.mcp_servers||{};
const profileOf=path=>new URL(path,'http://management').searchParams.get('profile');

test('only an Owner connects, follows or disconnects an app; a Member reads the states', async () => {
 const fake=await fakeHermes();
 try {
  const install={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
  await provideProfile(install,{name:companyProfile(company),soul:'',config:toolConfig({profile:companyProfile(company)}),forbidden:toolConfig().agent.disabled_toolsets});
  const driver=driverAt(fake);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const signIns=[];
  const someone=sessions(fake,{person:member,isOwner:false,signIns});
  for(const action of ['connect','poll','cancel','disconnect']) {
   assert.deepEqual(await changeCompanyApp(someone.db,{company,agent:lead,person:member,app:'klaviyo',action,driver,hermes}),{status:403,body:{error:'appsNotAllowed'}});
  }
  assert.equal(fake.settings.appFlows.size,0,'a member never reaches the Engine');
  assert.equal((await readCompanyApps(someone.db,{company,driver,hermes}))?.find(app=>app.key==='klaviyo')?.state,'off');

  const omar=sessions(fake,{person:owner,isOwner:true,signIns});
  const change=(action,app='klaviyo')=>changeCompanyApp(omar.db,{company,agent:lead,person:owner,app,action,driver,hermes});
  assert.deepEqual(await change('connect','nope'),{status:400,body:{error:'appsInvalid'}},'a key the catalogue does not hold');
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

  assert.deepEqual(await finishCompanyAppSignIn(someone.db,{person:member,app:'klaviyo',answer:{code:'c',state:vendorState},driver,hermes}),{slug:null,outcome:'failed'});
  assert.equal(fake.settings.appCallbacks.length,0,'nothing reaches the Engine without the person\'s own sign-in');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},driver,hermes}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(await change('poll'),{status:200,body:{status:'connected'}});
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},driver,hermes}),{slug:null,outcome:'failed'},'a finished sign-in\'s answer is never applied to another one');
  assert.equal(fake.settings.appCallbacks.length,1,'the second way back reaches the Engine for no sign-in');
  assert.equal(omar.asked.filter(name=>name==='finish_app_sign_in').length,1);
  assert.equal((await readCompanyApps(omar.db,{company,driver,hermes}))?.find(app=>app.key==='klaviyo')?.state,'connected');

  assert.deepEqual(await change('disconnect'),{status:200,body:{status:'off'}});
  assert.deepEqual(omar.asked.filter(name=>name==='record_app_disconnected'),['record_app_disconnected']);
  assert.deepEqual(omar.logged,[['app_connected','klaviyo',lead],['app_disconnected','klaviyo',lead]]);
  assert.equal((await readCompanyApps(omar.db,{company,driver,hermes}))?.find(app=>app.key==='klaviyo')?.state,'off');
  assert.doesNotMatch(JSON.stringify([started,again]),/flow|hermes|opt\//i);
 } finally { await fake.close(); }
});

test('each Agent\'s state is read from its own profile: connected, needing attention or off, and an app on before the move is the main Agent\'s', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  for(const name of [companyProfile(company),agentProfile(writer),agentProfile(analyst)]) makeProfile(fake,name);
  // Klaviyo was connected in the Company's profile before any Agent moved; Writer's sign-in never finished.
  fake.settings.profiles.get(companyProfile(company)).config.mcp_servers={klaviyo:installed('klaviyo')};
  fake.settings.appTokens.add(`${companyProfile(company)}:klaviyo`);
  fake.settings.profiles.get(agentProfile(writer)).config.mcp_servers={klaviyo:installed('klaviyo')};
  const missing={agent:'3a000000-0000-0000-0000-000000000051',name:'Designer',connection:'f0000000-0000-0000-0000-000000000051',profile:'ag-3a000000000000000000000000000051',main:false,own:true};
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow,writerRow,analystRow,helperRow,missing]});
  const read=fake.settings.managementRequests.length;
  const apps=await readCompanyApps(someone.db,{company,driver,hermes});
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

// #203: a Conversation's connect card shows the app's state in its Agent's profile now, read from that profile alone.
test('one Agent\'s apps are read from its own profile alone, by key; an Agent the person does not see, or an Engine that cannot be read, gives none', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  fake.settings.profiles.get(companyProfile(company)).config.mcp_servers={amplitude:installed('amplitude')};
  fake.settings.appTokens.add(`${companyProfile(company)}:amplitude`);
  fake.settings.profiles.get(agentProfile(writer)).config.mcp_servers={klaviyo:installed('klaviyo')};
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow,writerRow]});
  const read=fake.settings.managementRequests.length;
  const apps=await readAgentApps(someone.db,{company,agent:writer,driver,hermes});
  assert.equal(apps?.klaviyo,'attention');
  assert.equal(apps?.amplitude,'off','connected for Lead is not connected for Writer');
  assert.deepEqual(fake.settings.managementRequests.slice(read).filter(request=>request.path?.startsWith('/api/mcp/catalog')).map(request=>profileOf(request.path)),[agentProfile(writer)]);
  assert.equal((await readAgentApps(someone.db,{company,agent:lead,driver,hermes}))?.amplitude,'connected');
  assert.equal(await readAgentApps(someone.db,{company,agent:analyst,driver,hermes}),null,'an Agent not listed for the person');
  assert.equal(await readAgentApps(someone.db,{company,agent:writer,hermes:{address:fake.address,key:'test-only-key'},driver:{read:async()=>({state:'unreachable',apps:null})}}),null);
 } finally { await fake.close(); }
});

// #204: an Agent's details list its apps: those in its own profile (connected, needing attention, or turned off for it)
// and those it was made to use (hermes_agents.apps, by name) that it does not have yet. Another Agent's profile, an app
// not on gtmworks's list, and an Engine that cannot be read give none of them.
test('an Agent\'s connected tools are its own profile\'s apps with their states, plus the listed apps it was made to use and lacks', async () => {
 const fake=await fakeHermes();
 try {
  const driver=driverAt(fake);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  fake.settings.profiles.get(companyProfile(company)).config.mcp_servers={amplitude:installed('amplitude')};
  fake.settings.appTokens.add(`${companyProfile(company)}:amplitude`);
  fake.settings.profiles.get(agentProfile(writer)).config.mcp_servers={canva:installed('canva'),klaviyo:installed('klaviyo'),notion:{...installed('notion'),enabled:false}};
  fake.settings.appTokens.add(`${agentProfile(writer)}:canva`);
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow,writerRow]});
  const made={[writer]:['Mixpanel','Canva','Meta Ads','Something else'],[lead]:null};
  const db={...someone.db,from:table=>{
   assert.equal(table,'hermes_agents');
   let id=''; const chain={select:()=>chain,eq:(column,value)=>{ if(column==='id') id=value; return chain; },maybeSingle:async()=>({data:{apps:made[id]},error:null})};
   return chain;
  }};
  const tools=agent=>readAgentTools(db,{company,agent,driver,hermes});
  assert.deepEqual(await tools(writer),[
   {key:'canva',name:'Canva',mark:'C',state:'connected'},
   {key:'klaviyo',name:'Klaviyo',mark:'K',state:'attention'},
   {key:'mixpanel',name:'Mixpanel',mark:'M',state:'missing'},
   {key:'notion',name:'Notion',mark:'N',state:'turnedOff'},
   {key:'meta-ads',name:'Meta Ads',mark:'M',state:'missing'},
  ]);
  assert.deepEqual(await tools(lead),[{key:'amplitude',name:'Amplitude',mark:'A',state:'connected'}],'two Agents of one Company, two lists');
  assert.equal(await tools(analyst),null,'an Agent not listed for the person');
  assert.equal(await readAgentTools(db,{company,agent:writer,hermes:{address:fake.address,key:'test-only-key'},driver:{read:async()=>({state:'unreachable',apps:null})}}),null);
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
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const signIns=[];
  const omar=sessions(fake,{person:owner,isOwner:true,signIns,agents:[leadRow,writerRow,helperRow]});
  const change=(action,agent)=>changeCompanyApp(omar.db,{company,agent,person:owner,app:'klaviyo',action,driver,hermes});
  const mark=fake.settings.managementRequests.length;
  const started=await change('connect',writer);
  assert.equal(started.status,200);
  const vendorState=new URL(String(started.body.url)).searchParams.get('state');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},driver,hermes}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(await change('poll',writer),{status:200,body:{status:'connected'}});
  const scoped=fake.settings.managementRequests.slice(mark).filter(request=>/^\/api\/(config|mcp\/(catalog|servers))/.test(request.path||''));
  assert.ok(scoped.length>=4,'the catalogue, the config and the sign-in were asked');
  assert.deepEqual([...new Set(scoped.map(request=>profileOf(request.path)))],[agentProfile(writer)],'every request names Writer\'s profile');
  assert.equal('tools' in serversOf(fake,agentProfile(writer)).klaviyo,false,'connecting writes no tool filter');
  assert.equal(serversOf(fake,companyProfile(company)).klaviyo,undefined,'Lead\'s profile has none of it');
  assert.ok(fake.settings.appTokens.has(`${agentProfile(writer)}:klaviyo`));
  assert.deepEqual((await readCompanyApps(omar.db,{company,driver,hermes}))?.find(app=>app.key==='klaviyo')?.agents.map(agent=>[agent.name,agent.state]),
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
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  makeProfile(fake,companyProfile(company));
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,helperRow]});
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow]});
  const mark=fake.settings.managementRequests.length;
  for(const action of ['connect','poll','cancel','disconnect']) {
   assert.deepEqual(await changeCompanyApp(omar.db,{company,agent:helper,person:owner,app:'klaviyo',action,driver,hermes}),{status:409,body:{error:'appsAgentNotOwn'}},`${action}: Helper shares Lead's profile`);
   assert.deepEqual(await changeCompanyApp(omar.db,{company,agent:writer,person:owner,app:'klaviyo',action,driver,hermes}),{status:409,body:{error:'appsAgentNotOwn'}},`${action}: an Agent not listed`);
   assert.deepEqual(await changeCompanyApp(someone.db,{company,agent:lead,person:member,app:'klaviyo',action,driver,hermes}),{status:403,body:{error:'appsNotAllowed'}},`${action}: a Member`);
  }
  for(const agent of ['not-an-id',42,null]) assert.deepEqual(await changeCompanyApp(omar.db,{company,agent,person:owner,app:'klaviyo',action:'connect',driver,hermes}),{status:400,body:{error:'appsInvalid'}});
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,app:'klaviyo',action:'connect',driver,hermes}),{status:400,body:{error:'appsInvalid'}},'a connect names its Agent');
  assert.equal(fake.settings.managementRequests.length,mark,'the Engine was never asked');
  assert.deepEqual([omar.logged,someone.asked.filter(name=>name!=='is_company_owner')],[[],[]]);
 } finally { await fake.close(); }
});

// #347: the usage screen's numbers are each Agent's Hermes profile's own, read for an Owner or a Manager (#32, the
// database checks can_manage_company); a profile two Agents still share is one row with both names, so nothing is
// counted twice, a profile Hermes cannot answer for has unknown usage, never zero, and the per-model rows come with
// each profile and no price.
test('an Owner or a Manager reads each Agent\'s token use from its own profile with its per-model rows, and anyone else reads none',async()=>{
 const fake=await fakeHermes();
 try {
  const now=Date.now()/1000;
  fake.settings.sessions.set('s-lead',{profile:companyProfile(company),messages:[],input_tokens:1200,output_tokens:34,model:'anthropic/claude-opus-4.6',started_at:now-60});
  fake.settings.sessions.set('s-writer',{profile:agentProfile(writer),messages:[],input_tokens:5000,output_tokens:60,model:'openai/gpt-5.5',started_at:now-60});
  fake.settings.sessions.set('s-old',{profile:agentProfile(writer),messages:[],input_tokens:9,output_tokens:9,model:'openai/gpt-5.5',started_at:now-40*86400});
  const driver={usage:(target,days)=>readUsage({...target,managementAddress:target.profile===agentProfile(analyst)?'http://8.8.8.8:2':fake.managementAddress},days)};
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const agents=[leadRow,writerRow,analystRow,helperRow];
  const owner_=sessions(fake,{person:owner,isOwner:true,signIns:[],agents});
  const expected=[
   {agents:[{id:lead,name:'Lead'},{id:helper,name:'Helper'}],input:1200,output:34,sessions:1,models:[{model:'anthropic/claude-opus-4.6',input:1200,output:34,sessions:1}]},
   {agents:[{id:writer,name:'Writer'}],input:5000,output:60,sessions:1,models:[{model:'openai/gpt-5.5',input:5000,output:60,sessions:1}]},
   {agents:[{id:analyst,name:'Analyst'}],input:null,output:null,sessions:null,models:null}];
  assert.deepEqual(await readCompanyUsage(owner_.db,{company,days:30,driver,hermes}),expected);
  // The database function is named by its own parameter: a call it cannot resolve answers no role at all (#32).
  assert.deepEqual(owner_.calls.find(([name])=>name==='can_manage_company')?.[1],{target:company});
  const manager=sessions(fake,{person:member,isOwner:false,canManage:true,signIns:[],agents});
  assert.deepEqual(await readCompanyUsage(manager.db,{company,days:30,driver,hermes}),expected,'a Manager reads their Company\'s usage');
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents});
  assert.equal(await readCompanyUsage(someone.db,{company,days:30,driver,hermes}),null);
  assert.ok(!someone.asked.includes('company_app_agents'),'nothing is read for someone who is neither Owner nor Manager');
 } finally { await fake.close(); }
});

// #458: an Owner adds a server by address. A Manager changes nothing; a command is refused before the Engine is asked; a
// token goes only to the Engine, never to a database call, a log row or a response; a no-sign-in server is on at once; an
// OAuth one comes back through gtmworks; and Remove takes a made server off every Agent profile it was on.
test('only an Owner adds or tests an own server, and a command beside an address or not one program is refused before any Engine call', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const someone=sessions(fake,{person:member,isOwner:false,signIns:[],agents:[leadRow]});
  const mark=fake.settings.managementRequests.length;
  for(const action of ['add','test']) assert.deepEqual(await changeCompanyServer(someone.db,{company,person:member,agent:lead,action,name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes}),{status:403,body:{error:'appsNotAllowed'}},action);
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const add=(extra={})=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes,...extra});
  // A command comes only as the sandbox kind (#459), never beside an address, so nothing can reach the Engine's container.
  assert.deepEqual(await add({command:'node',args:['server.js']}),{status:400,body:{error:'appsServerInvalid'}});
  assert.deepEqual(await add({kind:'command',command:'node',args:['server.js']}),{status:400,body:{error:'appsServerInvalid'}},'a command server has no address');
  for(const [command,args] of [['',[]],['node server.js',[]],['node','server.js'],['node',['a\nb']],[undefined,[]]]) {
   assert.deepEqual(await add({kind:'command',url:undefined,command,args}),{status:400,body:{error:'appsServerInvalid'}},String(command));
  }
  assert.deepEqual(await add({name:'Stripe'}),{status:400,body:{error:'appsServerInvalid'}},'a catalogue name is never a made server');
  assert.deepEqual(await add({url:'ftp://crm.example/mcp'}),{status:400,body:{error:'appsServerInvalid'}});
  assert.deepEqual(await add({url:'https://user:pass@crm.example/mcp'}),{status:400,body:{error:'appsServerInvalid'}});
  assert.deepEqual(await add({kind:'header'}),{status:400,body:{error:'appsTokenInvalid'}});
  assert.equal(fake.settings.managementRequests.length,mark,'the Engine was never asked');
 } finally { await fake.close(); }
});

test('a command server is handed to the Engine as ssh into the work sandbox, from the Agent\'s own folder, and reads back as typed', async () => {
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,writerRow]});
  const result=await changeCompanyServer(omar.db,{company,person:owner,agent:writer,action:'add',name:'Design tool',kind:'command',command:'node',args:['/work/tools/server.mjs','--quiet'],hermes});
  assert.deepEqual(result,{status:200,body:{key:'design-tool',state:'connected'}});
  const server=serversOf(fake,agentProfile(writer))['design-tool'];
  assert.equal(server.command,'ssh','the Engine starts ssh, never the Owner\'s command in its own container');
  assert.ok(server.args.includes('pn@sandbox'));
  assert.equal(server.args.at(-1),`builtin cd -- /work/${agentProfile(writer)} || exit 126; exec 'node' '/work/tools/server.mjs' '--quiet'`);
  assert.equal(serversOf(fake,companyProfile(company))['design-tool'],undefined,'only the Agent it was added for');
  assert.deepEqual(omar.logged,[['app_connected','design-tool',writer]]);
  const read=target=>readApps({...target,managementAddress:fake.managementAddress});
  const card=(await readCompanyApps(omar.db,{company,hermes,driver:{read}}))?.find(app=>app.key==='design-tool');
  assert.deepEqual({source:card?.source,auth:card?.auth,command:card?.command,args:card?.args,url:card?.url},{source:'custom',auth:'command',command:'node',args:['/work/tools/server.mjs','--quiet'],url:undefined});
  assert.deepEqual(card?.agents.map(agent=>[agent.name,agent.state]),[['Lead','off'],['Writer','connected']]);

  // On for Lead too: Lead's copy starts in Lead's own folder, from the command Writer's profile records.
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:lead,app:'design-tool',action:'connect',hermes,driver:{read}}),{status:200,body:{status:'connected'}});
  assert.equal(serversOf(fake,companyProfile(company))['design-tool'].args.at(-1),`builtin cd -- /work/${companyProfile(company)} || exit 126; exec 'node' '/work/tools/server.mjs' '--quiet'`);
 } finally { await fake.close(); }
});

test('Test probes a command server without leaving it, and a changed command replaces the server', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const ask=(action,args)=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action,name:'Design tool',kind:'command',command:'od',args,hermes});
  const tested=await ask('test',['mcp']);
  assert.equal(tested.status,200);
  assert.equal(tested.body.state,'connected');
  assert.deepEqual(serversOf(fake,companyProfile(company)),{},'the profile is unchanged');
  assert.equal((await ask('add',['mcp'])).status,200);
  assert.equal((await ask('add',['mcp','--daemon-url','http://127.0.0.1:7456'])).status,200);
  assert.match(serversOf(fake,companyProfile(company))['design-tool'].args.at(-1),/exec 'od' 'mcp' '--daemon-url' 'http:\/\/127\.0\.0\.1:7456'$/);
 } finally { await fake.close(); }
});

test('a token goes only to the Engine: never a database argument, a log row or a response', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const token='header.payload.signature-value';
  const result=await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'header',token,hermes});
  assert.deepEqual(result,{status:200,body:{key:'my-crm',state:'connected'}});
  assert.equal(fake.settings.serverTokens.get(`${companyProfile(company)}:my-crm`),token,'the Engine got it');
  const server=serversOf(fake,companyProfile(company))['my-crm'];
  assert.equal(JSON.stringify(server).includes(token),false,'the profile config holds a reference, not the token');
  assert.equal(JSON.stringify([result,omar.calls,omar.logged]).includes(token),false,'never a database call, a log row or the answer');
  assert.deepEqual(omar.logged,[['app_connected','my-crm',lead]]);
 } finally { await fake.close(); }
});

test('a no-sign-in server is on at once, and an OAuth server comes back through gtmworks like every app', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const signIns=[];
  const omar=sessions(fake,{person:owner,isOwner:true,signIns,agents:[leadRow]});
  const add=extra=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes,...extra});
  assert.deepEqual(await add({name:'No sign-in'}),{status:200,body:{key:'no-sign-in',state:'connected'}});
  assert.equal(fake.settings.appFlows.size,0,'no vendor window');
  const started=await add({name:'My OAuth',url:'https://oauth.example/mcp',kind:'oauth'});
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body).sort(),['key','url']);
  assert.equal(started.body.key,'my-oauth');
  assert.equal(signIns.length,1,'the sign-in is kept as this person\'s');
  const state=new URL(String(started.body.url)).searchParams.get('state');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,{person:owner,app:'my-oauth',answer:{code:'c',state},driver:{},hermes}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(omar.logged,[['app_connected','no-sign-in',lead],['app_connected','my-oauth',lead]]);
 } finally { await fake.close(); }
});

test('a server the Owner added is one card across the profiles it is on, and Remove takes it off every one', async () => {
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,writerRow]});
  for(const agent of [lead,writer]) {
   assert.equal((await changeCompanyServer(omar.db,{company,person:owner,agent,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes})).status,200);
  }
  const card=(await readCompanyApps(omar.db,{company,hermes,driver:{read:target=>readApps({...target,managementAddress:fake.managementAddress})}}))?.find(app=>app.key==='my-crm');
  assert.equal(card?.source,'custom');
  assert.equal(card?.state,'connected');
  assert.deepEqual(card?.agents.map(agent=>[agent.name,agent.state]),[['Lead','connected'],['Writer','connected']]);
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,app:'my-crm',action:'disconnect',hermes,driver:{read:target=>readApps({...target,managementAddress:fake.managementAddress}),disconnect:(target,key)=>disconnectApp({...target,managementAddress:fake.managementAddress},key)}}),{status:200,body:{status:'off'}});
  assert.equal(serversOf(fake,companyProfile(company))['my-crm'],undefined);
  assert.equal(serversOf(fake,agentProfile(writer))['my-crm'],undefined);
  assert.deepEqual(omar.logged,[['app_connected','my-crm',lead],['app_connected','my-crm',writer],['app_disconnected','my-crm',lead],['app_disconnected','my-crm',writer]]);
 } finally { await fake.close(); }
});

test('Test probes a new server without leaving it in the profile', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const before=JSON.stringify(serversOf(fake,companyProfile(company)));
  const result=await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'test',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes});
  assert.equal(result.status,200);
  assert.equal(result.body.state,'connected');
  assert.equal(JSON.stringify(serversOf(fake,companyProfile(company))),before,'the profile is unchanged');
  assert.deepEqual(omar.logged,[],'a probe is not a connect');
 } finally { await fake.close(); }
});

test('adding the same OAuth server again cancels its open sign-in and starts a new one, through the real drivers', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const signIns=[];
  const omar=sessions(fake,{person:owner,isOwner:true,signIns,agents:[leadRow]});
  const add=()=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My OAuth',url:'https://oauth.example/mcp',kind:'oauth',hermes});
  const first=await add();
  assert.equal(first.status,200);
  const second=await add();
  assert.equal(second.status,200);
  assert.equal(signIns.length,1,'the old sign-in gave way to the new one');
  assert.equal([...fake.settings.appFlows.values()].filter(flow=>flow.status==='authorization_required').length,1);
 } finally { await fake.close(); }
});

test('a made server is turned on for another Agent from the address its own profile records, and a token server asks for the token again', async () => {
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,writerRow]});
  const add=extra=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:extra.name,url:extra.url,kind:extra.kind,token:extra.token,hermes});
  assert.equal((await add({name:'My CRM',url:'https://crm.example/mcp',kind:'none'})).status,200);
  const onWriter=extra=>changeCompanyApp(omar.db,{company,person:owner,agent:writer,app:'my-crm',action:'connect',hermes,...extra});
  assert.deepEqual(await onWriter({}),{status:200,body:{status:'connected'}});
  assert.equal(serversOf(fake,agentProfile(writer))['my-crm'].url,'https://crm.example/mcp','the address comes from the Engine record');

  assert.equal((await add({name:'Token CRM',url:'https://token-crm.example/mcp',kind:'header',token:'token-one'})).status,200);
  const tokenWriter=extra=>changeCompanyApp(omar.db,{company,person:owner,agent:writer,app:'token-crm',action:'connect',hermes,...extra});
  assert.deepEqual(await tokenWriter({}),{status:200,body:{needs:'details'}},'the token is typed in the app page');
  assert.deepEqual(await tokenWriter({token:'token-two'}),{status:200,body:{status:'connected'}});
  assert.equal(fake.settings.serverTokens.get(`${agentProfile(writer)}:token-crm`),'token-two');
 } finally { await fake.close(); }
});

test('Remove takes a switched-off copy off its Agent too', async () => {
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),agentProfile(writer)]) makeProfile(fake,name);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,writerRow]});
  for(const agent of [lead,writer]) assert.equal((await changeCompanyServer(omar.db,{company,person:owner,agent,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes})).status,200);
  serversOf(fake,agentProfile(writer))['my-crm'].enabled=false;
  const driver={read:target=>readApps({...target,managementAddress:fake.managementAddress}),disconnect:(target,key)=>disconnectApp({...target,managementAddress:fake.managementAddress},key)};
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,app:'my-crm',action:'disconnect',hermes,driver}),{status:200,body:{status:'off'}});
  assert.equal(serversOf(fake,agentProfile(writer))['my-crm'],undefined,'the switched-off copy is gone');
 } finally { await fake.close(); }
});

test('an app with a declared field asks the browser for the app page instead of connecting without it', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  fake.settings.catalog.push('asana');
  fake.settings.catalogEnv.asana=[{name:'ASANA_CLIENT_ID',prompt:'Client ID',required:true}];
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:lead,app:'asana',action:'connect',hermes}),{status:200,body:{needs:'details'}});
  assert.equal(serversOf(fake,companyProfile(company)).asana,undefined,'nothing was installed without its field');
 } finally { await fake.close(); }
});

test('Test probes under a temporary key, leaving an existing server of that name byte-for-byte unchanged', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My CRM',url:'https://one.example/mcp',kind:'none',hermes});
  const before=JSON.stringify(serversOf(fake,companyProfile(company)));
  const probe=url=>changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'test',name:'My CRM',url,kind:'none',hermes});
  assert.equal((await probe('https://two.example/mcp')).body.state,'connected');
  assert.equal(JSON.stringify(serversOf(fake,companyProfile(company))),before,'the real server is untouched');
  assert.equal(serversOf(fake,companyProfile(company))['my-crm_probe'],undefined,'the probe key is removed');
  fake.settings.appsUnreachable.add('my-crm_probe');
  assert.equal((await probe('https://two.example/mcp')).body.state,'attention');
  assert.equal(JSON.stringify(serversOf(fake,companyProfile(company))),before,'a failed probe leaves it untouched too');
 } finally { await fake.close(); }
});

test('Test never removes another server: one named like the old probe, or a 64-character key, stays', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const long='a'.repeat(64);
  for(const name of ['CRM test',long]) await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name,url:'https://one.example/mcp',kind:'none',hermes});
  const before=JSON.stringify(serversOf(fake,companyProfile(company)));
  for(const name of ['CRM',long]) assert.equal((await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'test',name,url:'https://two.example/mcp',kind:'none',hermes})).body.state,'connected');
  assert.equal(JSON.stringify(serversOf(fake,companyProfile(company))),before,'crm-test and the 64-character server are untouched');
 } finally { await fake.close(); }
});

test('a Test whose temporary server cannot be removed answers a failure, not its tools', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  const driver={disconnect:async()=>({state:'failed'})};
  assert.deepEqual(await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'test',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes,driver}),{status:502,body:{error:'appsFailed'}});
 } finally { await fake.close(); }
});

test('an own server switched off for its only Agent keeps its address and card, comes back on, and Remove deletes it', async () => {
 const fake=await fakeHermes();
 try {
  makeProfile(fake,companyProfile(company));
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow]});
  await changeCompanyServer(omar.db,{company,person:owner,agent:lead,action:'add',name:'My CRM',url:'https://crm.example/mcp',kind:'none',hermes});
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:lead,app:'my-crm',action:'disconnect',hermes}),{status:200,body:{status:'off'}});
  assert.deepEqual(serversOf(fake,companyProfile(company))['my-crm'],{url:'https://crm.example/mcp',enabled:false},'kept, switched off');
  const card=(await readCompanyApps(omar.db,{company,hermes}))?.find(app=>app.key==='my-crm');
  assert.equal(card?.state,'off','its card stays, off');
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:lead,app:'my-crm',action:'connect',hermes}),{status:200,body:{status:'connected'}});
  assert.equal(serversOf(fake,companyProfile(company))['my-crm'].url,'https://crm.example/mcp','back on at the same address');
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,app:'my-crm',action:'disconnect',hermes}),{status:200,body:{status:'off'}});
  assert.equal(serversOf(fake,companyProfile(company))['my-crm'],undefined,'Remove deletes it');
 } finally { await fake.close(); }
});

test('connecting a made server uses its target Agent\'s own address, and refuses when the other profiles disagree', async () => {
 const fake=await fakeHermes();
 try {
  for(const name of [companyProfile(company),agentProfile(writer),agentProfile(analyst)]) makeProfile(fake,name);
  const hermes={address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'};
  const omar=sessions(fake,{person:owner,isOwner:true,signIns:[],agents:[leadRow,writerRow,analystRow]});
  for(const [agent,url] of [[lead,'https://one.example/mcp'],[writer,'https://two.example/mcp']]) assert.equal((await changeCompanyServer(omar.db,{company,person:owner,agent,action:'add',name:'My CRM',url,kind:'none',hermes})).status,200);
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:writer,app:'my-crm',action:'connect',hermes}),{status:200,body:{status:'connected'}});
  assert.equal(serversOf(fake,agentProfile(writer))['my-crm'].url,'https://two.example/mcp','its own address, not the other profile\'s');
  assert.deepEqual(await changeCompanyApp(omar.db,{company,person:owner,agent:analyst,app:'my-crm',action:'connect',hermes}),{status:400,body:{error:'appsServerInvalid'}},'the other profiles disagree');
 } finally { await fake.close(); }
});
