import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { everyAgentGets, noAgentGets, toolConfig, fixedToolsets, toolsDiffer, childToolsets, forbiddenOf, companyProfile } from '../lib/agent-toolsets.mjs';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { provideProfile, configureProfile, readToolsets, readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn, prepareApp, removeProviderKey } from '../lib/hermes.mjs';
import { keepCompanyProfiles, keepAgentProfiles, checkAgentTools, keepLeadSouls, leadSoul, baselineSoul } from '../lib/company-profiles.mjs';
import { engineFor } from '../lib/engine.mjs';
import { changeCompanySignIn, readCompanySignIns } from '../lib/company-sign-in.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { installJob } from './install-job.mjs';

const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const [two,three]=['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];

test('an Agent whose Owner turned sub-agents on offers delegation in the Engine\'s read-back, and nothing no Agent gets', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig({subagents:true});
  const made=await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets});
  assert.equal(made.state,'configured');
  assert.ok(made.toolsets.includes('delegation'));
  for(const off of noAgentGets) assert.ok(!made.toolsets.includes(off),`${off} is off`);
  // The sandbox's tools are in the fixed set now (#393): the terminal, files and code every Agent works with.
  for(const name of ['terminal','file','code_execution']) assert.ok(made.toolsets.includes(name),`${name} is offered`);
  assert.deepEqual(forbiddenOf(made.toolsets),[]);
 } finally { await fake.close(); }
});

test('a company profile is named from the company id, in Hermes profile name form', () => {
 assert.equal(companyProfile(two),'co-10000000000000000000000000000002');
 assert.match(companyProfile('ABCDEF01-2345-4678-9abc-def012345678'),/^[a-z0-9][a-z0-9_-]{0,63}$/);
 assert.notEqual(companyProfile(two),companyProfile(three));
 for(const bad of ['default','',null,'10000000-0000-0000-0000-00000000000']) assert.throws(()=>companyProfile(bad),/companyInvalid/);
 // The database derives the same name and refuses any other (company_engine_profile, record_company_profile).
 assert.match(readFileSync('supabase/migrations/20261210000000_company_profiles.sql','utf8'),/'co-'\|\|replace\(c::text,'-',''\)/);
});

test('the driver makes a company profile with its key and the fixed tools, and reads back what a Run may use', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const made=await provideProfile(install(fake),{name,soul:'Work for one company.',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  assert.equal(made.state,'configured');
  assert.deepEqual([...made.toolsets].sort(),[...fixedToolsets()].sort());
  assert.deepEqual(forbiddenOf(made.toolsets),[]);
  const profile=fake.settings.profiles.get(name);
  assert.equal(profile.key,'test-only-key');
  assert.deepEqual(profile.config.agent.disabled_toolsets,toolConfig().agent.disabled_toolsets);
  // A new profile is made, never cloned from another one, so it starts with no memory of its own.
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(Object.keys(created.body).sort(),['name','soul']);
  assert.deepEqual(fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),
   ['POST /api/profiles',`PUT /api/env?profile=${name}`,`PUT /api/config?profile=${name}`]);
  // Asking again finishes the same profile (the name is reserved for that company).
  assert.equal((await provideProfile(install(fake),{name,soul:'Again.',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets})).state,'configured');
  // Scheduled work is in the set; the connectors no Agent gets are not.
  const again=await configureProfile(install(fake),{name,config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  assert.equal(again.state,'configured');
  assert.ok(again.toolsets.includes('cronjob')&&!again.toolsets.includes('connections'));
  // A write Hermes answers but does not apply reads back stale: the sub-agent variant is refused while delegation is off.
  fake.settings.staleConfig=true;
  const variant=toolConfig({subagents:true});
  const stale=await configureProfile(install(fake),{name,config:variant,forbidden:variant.agent.disabled_toolsets});
  assert.equal(stale.state,'failed');
  assert.ok(!stale.toolsets.includes('delegation'));
  fake.settings.staleConfig=false;
  assert.deepEqual(forbiddenOf(again.toolsets),[]);
  // A profile that still offers a forbidden toolset (a Hermes that ignored the list) fails closed.
  fake.settings.ignoreDisabled=true;
  const leaky=await configureProfile(install(fake),{name,config:{platform_toolsets:{api_server:['web','browser']}},forbidden:toolConfig().agent.disabled_toolsets});
  assert.equal(leaky.state,'failed');
  fake.settings.ignoreDisabled=false;
  fake.settings.failStep='config';
  assert.equal((await configureProfile(install(fake),{name,config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets})).state,'failed');
  fake.settings.failStep='';
  assert.equal((await readToolsets({address:fake.address,profile:name,key:'wrong'})).state,'refused');
  assert.equal((await provideProfile({...install(fake),key:'wrong'},{name:'co-x',soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets})).state,'refused');
  assert.equal((await provideProfile(install(fake),{name:'Bad Name',soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets})).state,'failed');
 } finally { await fake.close(); }
});

test('a capacity profile can be made without the Engine\'s bundled Skills, as the install job measures (#126)', async () => {
 const fake=await fakeHermes();
 try {
  const without=await provideProfile(install(fake),{name:`ag-${'1'.repeat(32)}`,soul:'Capacity.',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets,noSkills:true});
  assert.equal(without.state,'configured');
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(Object.keys(created.body).sort(),['name','no_skills','soul']);
  assert.equal(created.body.no_skills,true);
  // The default stays as it was: the bundled Skills are copied into every other new profile.
  await provideProfile(install(fake),{name:`ag-${'2'.repeat(32)}`,soul:'Capacity.',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const bodies=fake.settings.managementRequests.filter(request=>request.method==='POST'&&request.path==='/api/profiles').map(request=>request.body);
  assert.ok(!('no_skills' in bodies.at(-1)));
 } finally { await fake.close(); }
});

// A service-role client stand-in for the worker: the work the database lists, and the calls the worker makes.
function workerDatabase(rows,{failRecord=false}={}) {
 const calls=[];
 return {calls,rows,rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='company_profile_work') return {data:rows.filter(row=>row.attach||row.move||!row.tools_confirmed||row.tools_pending).map(row=>({...row})),error:null};
  if(name==='begin_company_tools') { const row=rows.find(found=>found.company_id===args.c); row.tools_pending=true; return {data:null,error:null}; }
  if(name==='record_company_profile') {
   if(failRecord) return {data:null,error:{message:'record failed'}};
   const row=rows.find(found=>found.company_id===args.c); Object.assign(row,{tools_confirmed:true,tools_pending:false}); return {data:null,error:null};
  }
  if(name==='attach_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.attach=false; return {data:true,error:null}; }
  if(name==='move_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.move=false; return {data:1,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const row=(company,extra={})=>({company_id:company,profile:companyProfile(company),tools_confirmed:false,tools_pending:false,attach:true,move:false,...extra});

test('two companies get two different profiles, each with its work tools and every forbidden one off, before either is attached', async () => {
 const fake=await fakeHermes();
 try {
  const db=workerDatabase([row(two),row(three)]);
  const done=await keepCompanyProfiles(db,{hermes:install(fake)});
  assert.deepEqual(done,{provided:2,configured:0,attached:2,moved:0});
  const profiles=[companyProfile(two),companyProfile(three)];
  assert.deepEqual([...fake.settings.profiles.keys()].sort(),profiles.sort());
  for(const name of profiles) {
   const config=fake.settings.profiles.get(name).config;
   for(const off of noAgentGets) assert.ok(config.agent.disabled_toolsets.includes(off),`${off} is off`);
   for(const name of ['terminal','file','code_execution']) assert.ok(config.platform_toolsets.api_server.includes(name),`${name} is offered`);
   assert.deepEqual(config.terminal,{cwd:`/work/${name}`},'every Agent starts in its own folder in the Company\'s work folder');
   assert.deepEqual(config.approvals,{unattended_mode:'approve'},'an Agent\'s code runs with no person to approve each call');
   const read=await readToolsets({address:fake.address,profile:name,key:'test-only-key'});
   assert.equal(toolsDiffer(read.toolsets),false);
  }
  const names=db.calls.map(call=>call.name);
  assert.deepEqual(names,['company_profile_work','record_company_profile','attach_company_profile','record_company_profile','attach_company_profile']);
  const attached=db.calls.filter(call=>call.name==='attach_company_profile');
  assert.deepEqual(attached.map(call=>call.args.c),[two,three]);
  // The attach names the Company only: the key stays in the install's environment (#342).
  for(const call of attached) assert.deepEqual(Object.keys(call.args),['c']);
  // Each company's Runs use its own profile: the attach tested that profile's Run API, not the shared one.
  assert.deepEqual(fake.settings.requests.filter(request=>request.path.endsWith('/health')).map(request=>request.path),profiles.map(name=>`/p/${name}/health`));
  // Nothing is left to do: asking again makes nothing.
  assert.equal(await keepCompanyProfiles(db,{hermes:install(fake)}).then(result=>result.provided),0);
  // #434: a new Company's main Agent starts as the manager of its team.
  for(const name of profiles) assert.equal(fake.settings.profiles.get(name).soul,leadSoul);
 } finally { await fake.close(); }
});

// #434: Lead's identity is the manager's. A main Agent whose profile still holds the old default text gets the new one,
// its team's rules section kept; one whose Owner edited the text, or that already has the new one, is left as it is. Each
// profile read is recorded, so it is read once; one the Engine cannot read is asked again on a later pass.
test('the old default soul of a main Agent becomes the manager identity, an edited one is untouched, each profile is checked once', async () => {
 const fake=await fakeHermes();
 try {
  const [old,edited,current,lost]=['10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007'].map(companyProfile);
  const rules='<!-- gtmworks:rules -->\n## Rules the team gave you\n- Never use emojis\n<!-- /gtmworks:rules -->\n';
  const profile=soul=>({soul,provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}});
  fake.settings.profiles.set(old,profile(`${baselineSoul}\n${rules}`));
  fake.settings.profiles.set(edited,profile('You write for a bakery in Cairo.'));
  fake.settings.profiles.set(current,profile(leadSoul));
  const calls=[]; const work=[old,edited,current,lost].map(name=>({company_id:name,profile:name}));
  const db={rpc:async(name,args)=>{ calls.push([name,args]); return name==='lead_soul_work'?{data:work,error:null}:name==='record_lead_soul'?{data:true,error:null}:{data:null,error:{message:`unexpected ${name}`}}; }};
  assert.deepEqual(await keepLeadSouls(db,{hermes:install(fake)}),{upgraded:1,checked:3});
  assert.equal(fake.settings.profiles.get(old).soul,`${leadSoul}\n${rules}`);
  assert.equal(fake.settings.profiles.get(edited).soul,'You write for a bakery in Cairo.');
  assert.equal(fake.settings.profiles.get(current).soul,leadSoul);
  assert.deepEqual(calls.filter(([name])=>name==='record_lead_soul').map(([,args])=>args),[old,edited,current].map(name=>({c:name,engine_profile:name})));
  assert.notEqual(leadSoul,baselineSoul);
  assert.match(leadSoul,/manage/); assert.match(leadSoul,/hand_to_agent/);
  assert.deepEqual(await keepLeadSouls(db,{hermes:null}),{upgraded:0,checked:0});
 } finally { await fake.close(); }
});

test('a company on the old default profile moves once its Engine holds a sign-in on the root profile, and an unconfirmed change is written and recorded', async () => {
 const fake=await fakeHermes();
 try {
  let clock=0; const waiting=new Map();
  const db=workerDatabase([row(three,{attach:false,move:true})]);
  const options={hermes:install(fake),waiting,now:()=>clock};
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:1,configured:0,attached:0,moved:0});
  assert.ok(!db.calls.some(call=>call.name==='move_company_profile'),'no model sign-in yet: the company keeps running where it was');
  // The Owner's sign-in is on the Engine's root profile (#384), which the Engine lends to the company profile too, so
  // the move never leaves its Agents without a model.
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  clock+=1000;
  assert.equal((await keepCompanyProfiles(db,options)).moved,0,'asked at most once a minute');
  clock+=59000;
  assert.equal((await keepCompanyProfiles(db,options)).moved,1,'the root profile\'s sign-in lets the company move');
  delete fake.settings.defaultCredentials['openai-codex'];
  const name=companyProfile(three);
  // The worker found the tools changing: it writes the fixed set again and records the read-back.
  db.rows[0].tools_confirmed=true; db.rows[0].tools_pending=true;
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:0,configured:1,attached:0,moved:0});
  assert.deepEqual([...fake.settings.profiles.get(name).config.platform_toolsets.api_server].sort(),[...fixedToolsets()].sort());
  assert.equal(db.rows[0].tools_pending,false);
  // A Hermes that refuses keeps the change waiting, recorded nowhere.
  db.rows[0].tools_pending=true;
  fake.settings.managementStatus=503;
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:0,configured:0,attached:0,moved:0});
  assert.equal(db.rows[0].tools_pending,true);
  fake.settings.managementStatus=200;
  assert.deepEqual(await keepCompanyProfiles(db,{...options,hermes:null}),{provided:0,configured:0,attached:0,moved:0});
 } finally { await fake.close(); }
});

test('the profile check has a lost company profile made again and records no tools (#341)', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args});
   return rpc==='engine_tools_due'?{data:[{profile:name},{profile:companyProfile(three)}],error:null}:{data:null,error:null}; }};
  // The Engine lost one company profile (its data was not restored with a backup): the worker has it made again.
  fake.settings.unknownProfiles.push(companyProfile(three));
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.filter(call=>call.rpc==='forget_company_profile').map(call=>call.args),[{engine_profile:companyProfile(three)}]);
  // With no bundled Hermes (a hosted install) nothing is read.
  assert.equal(await checkAgentTools(db,{hermes:null}),0);
  // The Owner's tool warning is gone with engine_tool_checks: nothing is recorded.
  assert.deepEqual(calls.map(call=>call.rpc),['engine_tools_due','forget_company_profile']);
 } finally { await fake.close(); }
});

test('the profile check compares what the Engine reports with the fixed set, corrects it, and leaves a forbidden tool on unconfirmed', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:{platform_toolsets:{api_server:['web','connections']},agent:{disabled_toolsets:[]}},forbidden:[]});
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:false}]:null,error:null}; }};
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.map(call=>call.rpc),['engine_tools_due','begin_profile_tools','record_profile_tools']);
  assert.equal(toolsDiffer((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets),false);
  // A write the Engine does not apply leaves the forbidden tool on: the profile is marked changing, never recorded.
  await provideProfile(install(fake),{name,soul:'',config:{platform_toolsets:{api_server:[...everyAgentGets,'browser']},agent:{disabled_toolsets:[]}},forbidden:[]});
  fake.settings.staleConfig=true;
  calls.length=0;
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.map(call=>call.rpc),['engine_tools_due','begin_profile_tools']);
  assert.ok((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('browser'),'the forbidden tool stays on');
  fake.settings.staleConfig=false;
 } finally { await fake.close(); }
});

test('every profile a Company serves, its main Agent and each made Agent included, offers the terminal, files and code', async () => {
 const fake=await fakeHermes();
 try {
  const db=workerDatabase([row(two)]);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake)})).provided,1);
  const agent='a5000000-0000-4000-8000-000000000001';
  const own=`ag-${agent.replaceAll('-','')}`;
  const agents={rows:[{agent_id:agent,company_id:two,profile:own,instructions:'Writes.',subagents:false,tools_confirmed:false,tools_pending:false}],
   rpc:async(name,args)=>{
    if(name==='agent_profile_work') return {data:agents.rows.filter(item=>!item.tools_confirmed||item.tools_pending),error:null};
    if(name==='begin_agent_tools') { agents.rows[0].tools_pending=true; return {data:null,error:null}; }
    if(name==='record_agent_profile') { Object.assign(agents.rows[0],{tools_confirmed:true,tools_pending:false}); return {data:null,error:null}; }
    return {data:null,error:{message:`unexpected ${name}`}};
   }};
  assert.deepEqual(await keepAgentProfiles(agents,{hermes:install(fake)}),{provided:1,configured:0});
  for(const profile of [companyProfile(two),own]) {
   const read=await readToolsets({address:fake.address,profile,key:'test-only-key'});
   for(const name of ['terminal','file','code_execution']) assert.ok(read.toolsets.includes(name),`${profile} offers ${name}`);
   assert.deepEqual(fake.settings.profiles.get(profile).config.terminal,{cwd:`/work/${profile}`});
  }
 } finally { await fake.close(); }
});

test('the profile check corrects a profile with the sub-agents variant its Owner set', async () => {
 const fake=await fakeHermes();
 try {
  const name=`ag-${'a'.repeat(32)}`;
  await provideProfile(install(fake),{name,soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:true}]:null,error:null}; }};
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.filter(call=>call.rpc==='record_profile_tools').map(call=>call.args),[{profile:name,subagents_written:true}]);
  assert.ok((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('delegation'));
 } finally { await fake.close(); }
});

test('an App the Company connected sits beside the fixed set: the write-back and the check leave the profile confirmed', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig();
  assert.equal((await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets})).state,'configured');
  // #30: the Owner connected Klaviyo, so its MCP server is in the profile's config, and an Engine that lists it beside the
  // fixed set names it `mcp-klaviyo` (the registry's toolset for a server, toolsets.py, mcp_tool_registration.py).
  assert.equal(await prepareApp({...install(fake),profile:name},'klaviyo','https://app.test/api/apps/callback/klaviyo'),null);
  const written=await configureProfile(install(fake),{name,config,forbidden:config.agent.disabled_toolsets});
  assert.equal(written.state,'configured','the fixed set with its App beside it is the fixed set');
  assert.ok(written.toolsets.includes('mcp-klaviyo'),'the App\'s server is on');
  // The worker reads the same and leaves the profile confirmed: it is not marked as changing and nothing is written.
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:false}]:null,error:null}; }};
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.map(call=>call.rpc),['engine_tools_due']);
 } finally { await fake.close(); }
});

test('a toolset beside the fixed set whose Apps cannot be read is a difference, never let by', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig();
  assert.equal((await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets})).state,'configured');
  const held=fake.settings.profiles.get(name);
  held.config={...held.config,mcp_servers:{Acme:{url:'https://mcp.acme.invalid/mcp',enabled:true}}};
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:false}]:null,error:null}; }};
  // The Engine answers for the toolsets but not for the profile's config, so which servers are Apps is unknown.
  await checkAgentTools(db,{hermes:install(fake),apps:async()=>({state:'unreachable',apps:null})});
  assert.ok(calls.some(call=>call.rpc==='begin_profile_tools'),'the profile is marked changing');
  assert.ok(!calls.some(call=>call.rpc==='record_profile_tools'));
 } finally { await fake.close(); }
});

test('a toolset no gtmworks App put there is a difference: the profile is marked changing and never recorded', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig();
  assert.equal((await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets})).state,'configured');
  // A server someone added to the Engine by hand under a key no App and no Owner's own server can have (#458 keys are
  // lowercase): not one gtmworks wrote, so not let by.
  const held=fake.settings.profiles.get(name);
  held.config={...held.config,mcp_servers:{Acme:{url:'https://mcp.acme.invalid/mcp',enabled:true}}};
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:false}]:null,error:null}; }};
  assert.equal(await checkAgentTools(db,{hermes:install(fake)}),1);
  assert.deepEqual(calls.map(call=>call.rpc),['engine_tools_due','begin_profile_tools'],'written, never recorded while the unknown toolset stays on');
  assert.ok(!calls.some(call=>call.rpc==='record_profile_tools'));
 } finally { await fake.close(); }
});

test('a server an Owner added by address (#458) is one of the Company\'s Apps: the tool check lets it by', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig();
  assert.equal((await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets})).state,'configured');
  const held=fake.settings.profiles.get(name);
  held.config={...held.config,mcp_servers:{acme:{url:'https://mcp.acme.invalid/mcp',enabled:true}}};
  const calls=[];
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args}); return {data:rpc==='engine_tools_due'?[{profile:name,company_id:two,subagents:false}]:null,error:null}; }};
  await checkAgentTools(db,{hermes:install(fake)});
  assert.ok(!calls.some(call=>call.rpc==='begin_profile_tools'),'the profile is not rewritten');
 } finally { await fake.close(); }
});

test('the sign-in driver passes on states, a code and an https link, never a credential', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const target={...install(fake),profile:name};
  // Hermes lets a profile with no credential of its own use the default profile's: `root` says so, and it is never
  // reported as a sign-in of the profile's own.
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  assert.deepEqual((await readSignIns(target)).signIns['openai-codex'],{connected:false,root:true,flow:'device_code'});
  delete fake.settings.defaultCredentials['openai-codex'];
  assert.deepEqual(await readSignIns(target),{state:'found',signIns:{'openai-codex':{connected:false,root:false,flow:'device_code'},anthropic:{connected:false,root:false,flow:'external'}}});
  const started=await startSignIn(target,'openai-codex');
  assert.equal(started.state,'started');
  assert.equal(started.code,'ABCD-1234');
  assert.equal(started.link,'https://auth.provider.test/codex/device');
  assert.deepEqual(await pollSignIn(target,'openai-codex',started.session),{state:'pending'});
  // Another company's profile cannot follow this sign-in.
  await provideProfile(install(fake),{name:companyProfile(three),soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  assert.equal((await pollSignIn({...target,profile:companyProfile(three)},'openai-codex',started.session)).state,'failed');
  fake.settings.approve(started.session);
  assert.deepEqual(await pollSignIn(target,'openai-codex',started.session),{state:'approved'});
  const read=await readSignIns(target);
  assert.equal(read.signIns['openai-codex'].connected,true);
  const credential=fake.settings.profiles.get(name).credentials['openai-codex'];
  assert.ok(credential);
  // The credential is stored in that company's profile only, and no answer carries it or its preview.
  assert.equal(fake.settings.defaultCredentials['openai-codex'],undefined);
  assert.doesNotMatch(JSON.stringify([started,read]),new RegExp(credential.slice(-6)));
  assert.deepEqual(await startSignIn(target,'anthropic'),{state:'terminal_only',session:null,code:null,link:null,expiresIn:null,interval:null});
  assert.deepEqual(await disconnectSignIn(target,'openai-codex'),{state:'disconnected'});
  assert.equal((await readSignIns(target)).signIns['openai-codex'].connected,false);
  assert.equal(fake.settings.profiles.get(name).credentials['openai-codex'],undefined);
  // Nothing of the profile's own left to remove, or a profile the Engine does not serve, is not a failure.
  assert.deepEqual(await disconnectSignIn(target,'openai-codex'),{state:'nothing'});
  assert.deepEqual(await disconnectSignIn({...target,profile:'ag-a0000000000000000000000000000009'},'openai-codex'),{state:'nothing'});
  const again=await startSignIn(target,'openai-codex');
  assert.deepEqual(await cancelSignIn(target,again.session),{state:'cancelled'});
  assert.deepEqual(await pollSignIn(target,'openai-codex',again.session),{state:'expired'});
  assert.equal((await startSignIn(target,'gemini')).state,'failed');
  assert.equal((await startSignIn({...target,key:'wrong'},'openai-codex')).state,'refused');
  fake.settings.managementStatus=503;
  assert.deepEqual(await disconnectSignIn(target,'openai-codex'),{state:'failed'});
  fake.settings.managementStatus=200;
  // The root profile, given as `default`, is asked with no profile at all, and its sign-in lands there.
  const root=install(fake);
  fake.settings.managementRequests.length=0;
  const atRoot=await startSignIn(root,'openai-codex');
  assert.deepEqual(await pollSignIn(target,'openai-codex',atRoot.session),{state:'failed'},'a company profile cannot follow the root\'s sign-in');
  fake.settings.approve(atRoot.session);
  assert.deepEqual(await pollSignIn(root,'openai-codex',atRoot.session),{state:'approved'});
  const readRoot=await readSignIns(root);
  assert.deepEqual([readRoot.signIns['openai-codex'].connected,readRoot.signIns['openai-codex'].root],[true,true],'the root profile itself holds the sign-in');
  assert.ok(fake.settings.defaultCredentials['openai-codex']);
  assert.deepEqual(await disconnectSignIn(root,'openai-codex'),{state:'disconnected'});
  assert.deepEqual(await disconnectSignIn(root,'openai-codex'),{state:'nothing'});
  const cancelled=await startSignIn(root,'openai-codex');
  assert.deepEqual(await cancelSignIn(root,cancelled.session),{state:'cancelled'});
  assert.deepEqual(fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),[
   'POST /api/providers/oauth/openai-codex/start',`GET /api/providers/oauth/openai-codex/poll/${atRoot.session}?profile=${name}`,
   `GET /api/providers/oauth/openai-codex/poll/${atRoot.session}`,'GET /api/providers/oauth','GET /api/credentials/pool','DELETE /api/providers/oauth/openai-codex','DELETE /api/providers/oauth/openai-codex',
   'POST /api/providers/oauth/openai-codex/start',`DELETE /api/providers/oauth/sessions/${cancelled.session}`]);
 } finally { await fake.close(); }
});

// The person's own session (is_company_owner, company_engine_target, record_subscription_change) and the service role
// reading the key. `agents` are the Company's Agent profiles, the Company's own profile is always named, and `logged`
// is each change the Company's log was asked to record.
function sessions(fake,{owner,agents=[],logFails=false}) {
 const asked=[]; const logged=[];
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:companyProfile(args.c),profiles:[companyProfile(args.c),...agents]}],error:null};
  if(name==='record_subscription_change') { logged.push(args); return logFails?{data:null,error:{code:'XX000',message:'the database is down'}}:{data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}}; }};
 // The install's Hermes is the fake (#342): the code reaches it as it reaches the bundled one.
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 return {db,service:{},asked,logged};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
const pointedAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress});
 return {hermes:{address:fake.address,key:'test-only-key'},start:(target,provider)=>startSignIn(at(target),provider),poll:(target,provider,session)=>pollSignIn(at(target),provider,session),
  cancel:(target,session)=>cancelSignIn(at(target),session),disconnect:(target,provider)=>disconnectSignIn(at(target),provider),read:target=>readSignIns(at(target))}; };
const ask=(person,driver,change)=>changeCompanySignIn(person.db,{company:two,provider:'openai-codex',driver,hermes:driver.hermes,...change});
const states=read=>read.signIns&&Object.fromEntries(Object.entries(read.signIns).map(([id,found])=>[id,found.state]));
const signInPaths=fake=>fake.settings.managementRequests.filter(request=>request.path.startsWith('/api/providers/oauth/')).map(request=>`${request.method} ${request.path}`);

test('only an Owner starts, follows or removes a company sign-in, checked on the server for every step', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const member=sessions(fake,{owner:false});
  for(const intent of ['start','poll','cancel','disconnect']) assert.deepEqual(await ask(member,driver,{intent,session:'abcdefgh'}),{status:403,body:{error:'signInNotAllowed'}});
  assert.deepEqual(member.logged,[]);
  assert.equal(fake.settings.signInSessions.size,0,'a member never reaches Hermes');
  // A member still reads whether the company is connected.
  assert.deepEqual(await readCompanySignIns(member.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}}),{profile:companyProfile(two),profiles:[companyProfile(two)],signIns:{'openai-codex':{state:'notConnected',flow:'device_code'},anthropic:{state:'notConnected',flow:'external'}}});
  const owner=sessions(fake,{owner:true});
  const started=await ask(owner,driver,{intent:'start'});
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body).sort(),['code','expiresIn','interval','link','session']);
  const poll=()=>ask(owner,driver,{intent:'poll',session:started.body.session});
  assert.deepEqual(await poll(),{status:200,body:{status:'pending'}});
  fake.settings.approve(started.body.session);
  assert.deepEqual(await poll(),{status:200,body:{status:'approved'}});
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.equal(fake.settings.defaultCredentials['openai-codex'],undefined);
  assert.deepEqual(owner.logged,[{c:two,provider:'openai-codex',connected:true,session:started.body.session},{c:two,provider:'openai-codex',connected:false,session:null}],'one log row asked for per connect and disconnect');
  assert.deepEqual(await ask(owner,driver,{provider:'anthropic',intent:'start'}),{status:409,body:{error:'signInTerminalOnly'}});
  assert.deepEqual(await ask(owner,driver,{provider:'gemini',intent:'start'}),{status:400,body:{error:'signInInvalid'}});
 } finally { await fake.close(); }
});

const agentProfile='ag-a0000000000000000000000000000001';
test('the Owner signs the Company in once on the root profile of its own Engine, and an Agent profile with none of its own can then answer', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const engine=engineFor(install(fake));
  const provideWriter=()=>engine.provideAgent({name:agentProfile,instructions:'Write.',level:1});
  assert.deepEqual(await provideWriter(),{state:'noModel'},'no sign-in yet');
  const owner=sessions(fake,{owner:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}});
  assert.deepEqual(await read(),{profile:companyProfile(two),profiles:[companyProfile(two),agentProfile],signIns:{'openai-codex':{state:'notConnected',flow:'device_code'},anthropic:{state:'notConnected',flow:'external'}}});
  fake.settings.managementRequests.length=0;
  const started=await ask(owner,driver,{intent:'start'});
  assert.equal(started.status,200);
  const {session}=started.body;
  assert.equal(fake.settings.signInSessions.get(session).profile,'default');
  assert.deepEqual(await ask(owner,driver,{intent:'poll',session}),{status:200,body:{status:'pending'}});
  fake.settings.approve(session);
  assert.deepEqual(await ask(owner,driver,{intent:'poll',session}),{status:200,body:{status:'approved'}});
  assert.deepEqual(signInPaths(fake),['POST /api/providers/oauth/openai-codex/start',`GET /api/providers/oauth/openai-codex/poll/${session}`,`GET /api/providers/oauth/openai-codex/poll/${session}`],'every sign-in request names no profile: the root');
  assert.ok(fake.settings.defaultCredentials['openai-codex']);
  assert.equal(fake.settings.profiles.get(companyProfile(two)).credentials['openai-codex'],undefined);
  assert.deepEqual(states(await read()),{'openai-codex':'connected',anthropic:'notConnected'});
  assert.deepEqual(owner.logged,[{c:two,provider:'openai-codex',connected:true,session}]);
  // The Engine lends the root's sign-in to a profile with none of its own.
  assert.deepEqual(await provideWriter(),{state:'provided'});
  assert.deepEqual(fake.settings.profiles.get(agentProfile).credentials,{});
  // Claude is the install's command, run on the root profile.
  assert.deepEqual(await ask(owner,driver,{provider:'anthropic',intent:'start'}),{status:409,body:{error:'signInTerminalOnly'}});
  const cancelled=await ask(owner,driver,{intent:'start'});
  assert.deepEqual(await ask(owner,driver,{intent:'cancel',session:cancelled.body.session}),{status:200,body:{status:'cancelled'}});
  assert.equal(fake.settings.signInSessions.has(cancelled.body.session),false);
 } finally { await fake.close(); }
});

test('a Claude subscription in the root profile\'s credential pool is the Company\'s; an API key is never a sign-in, and each outlives the other\'s removal (#438)', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  const config=toolConfig();
  for(const name of [companyProfile(two),agentProfile]) await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets});
  const owner=sessions(fake,{owner:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}});
  // The API key the Owner gave first: the Engine reports Claude logged in on the Agents' profiles, from env_var.
  const key='sk-ant-api03-known-key-0123456789';
  for(const name of [companyProfile(two),agentProfile]) fake.settings.profiles.get(name).env={ANTHROPIC_API_KEY:key};
  assert.deepEqual(states(await read()),{'openai-codex':'notConnected',anthropic:'notConnected'},'a key is not a subscription');
  // `gtmworks sign-in claude`: an OAuth row in the root's pool, which the Engine's own Claude status does not see.
  const token='sk-ant-oat01-known-subscription-0123456789';
  fake.settings.defaultPool.anthropic=[{id:'a1b2c3',label:'anthropic-oauth-1',auth_type:'oauth',source:'manual:hermes_pkce',priority:0,access_token:token}];
  const both=await read();
  assert.deepEqual(states(both),{'openai-codex':'notConnected',anthropic:'connected'});
  assert.doesNotMatch(JSON.stringify(both),new RegExp(`${token.slice(-4)}|${key.slice(-4)}|hermes_pkce|env_var`),'no credential, preview or source leaves the read');
  // Removing the key, as Settings removes it, leaves the subscription.
  const space=`cs-${companyProfile(two).slice(3)}`;
  fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{},env:{ANTHROPIC_API_KEY:key}});
  assert.equal((await removeProviderKey(install(fake),{space,profiles:[companyProfile(two),agentProfile],provider:'anthropic'})).state,'removed');
  for(const name of [space,companyProfile(two),agentProfile]) assert.equal(fake.settings.profiles.get(name).env.ANTHROPIC_API_KEY,undefined,name);
  assert.ok(fake.settings.defaultPool.anthropic);
  assert.equal((await read()).signIns.anthropic.state,'connected');
  // Disconnect removes the subscription and leaves the key: a profile whose Claude is its key has nothing to remove.
  for(const name of [companyProfile(two),agentProfile]) fake.settings.profiles.get(name).env={ANTHROPIC_API_KEY:key};
  assert.deepEqual(await ask(owner,driver,{provider:'anthropic',intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.equal(fake.settings.defaultPool.anthropic,undefined);
  assert.equal(fake.settings.profiles.get(companyProfile(two)).env.ANTHROPIC_API_KEY,key);
  assert.deepEqual(states(await read()),{'openai-codex':'notConnected',anthropic:'notConnected'});
  assert.deepEqual(owner.logged.map(change=>[change.provider,change.connected]),[['anthropic',false]]);
  // A token the Engine seeded from outside its own store is no sign-in the Company can remove, so it is not one.
  fake.settings.defaultPool.anthropic=[{id:'d4e5f6',label:'claude_code',auth_type:'oauth',source:'claude_code',priority:0,access_token:token}];
  assert.equal((await read()).signIns.anthropic.state,'notConnected');
  // A root whose Claude reads as a key refuses the Disconnect: that is a failure, never a removal (the sign-in may stay).
  fake.settings.defaultPool.anthropic=[{id:'a1b2c3',label:'anthropic-oauth-1',auth_type:'oauth',source:'manual:hermes_pkce',priority:0,access_token:token}];
  fake.settings.defaultEnv.ANTHROPIC_API_KEY=key;
  assert.deepEqual(await ask(owner,driver,{provider:'anthropic',intent:'disconnect'}),{status:502,body:{error:'signInFailed'}});
  assert.ok(fake.settings.defaultPool.anthropic);
  delete fake.settings.defaultEnv.ANTHROPIC_API_KEY;
  // A pool the Engine cannot read is not taken as no subscription.
  fake.settings.poolFail=true;
  assert.equal((await read()).signIns,null);
 } finally { await fake.close(); }
});

test('an older sign-in in the Company profile serves the main Agent only; Disconnect removes it, the root\'s and its Agents\', and no other Company\'s', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  for(const name of [companyProfile(two),agentProfile,companyProfile(three)]) await provideProfile(install(fake),{name,soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const credentials=name=>fake.settings.profiles.get(name).credentials;
  credentials(companyProfile(two))['openai-codex']='company-codex-token';
  credentials(agentProfile)['openai-codex']='agent-codex-token';
  credentials(companyProfile(three))['openai-codex']='other-company-token';
  const owner=sessions(fake,{owner:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}});
  assert.deepEqual(states(await read()),{'openai-codex':'mainAgentOnly',anthropic:'notConnected'});
  const started=await ask(owner,driver,{intent:'start'});
  fake.settings.approve(started.body.session);
  assert.deepEqual(await ask(owner,driver,{intent:'poll',session:started.body.session}),{status:200,body:{status:'approved'}});
  assert.deepEqual(states(await read()),{'openai-codex':'connected',anthropic:'notConnected'});
  assert.equal(credentials(companyProfile(two))['openai-codex'],'company-codex-token','the older sign-in is kept until the Owner disconnects');
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.deepEqual(signInPaths(fake),['DELETE /api/providers/oauth/openai-codex',`DELETE /api/providers/oauth/openai-codex?profile=${companyProfile(two)}`,`DELETE /api/providers/oauth/openai-codex?profile=${agentProfile}`]);
  assert.deepEqual([fake.settings.defaultCredentials['openai-codex'],credentials(companyProfile(two))['openai-codex'],credentials(agentProfile)['openai-codex']],[undefined,undefined,undefined]);
  assert.equal(credentials(companyProfile(three))['openai-codex'],'other-company-token');
  assert.deepEqual(states(await read()),{'openai-codex':'notConnected',anthropic:'notConnected'});
  assert.deepEqual(owner.logged.map(change=>[change.provider,change.connected]),[['openai-codex',true],['openai-codex',false]]);
  // Nothing left anywhere: Disconnect still answers, and logs nothing more.
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.equal(owner.logged.length,2);
  // A profile the Engine cannot reach makes the answer an error, and what the others removed is still logged.
  credentials(companyProfile(two))['openai-codex']='company-codex-token';
  const unreachableAgent={...driver,disconnect:(target,provider)=>target.profile===agentProfile?Promise.resolve({state:'unreachable'}):driver.disconnect(target,provider)};
  credentials(agentProfile)['openai-codex']='agent-codex-token';
  assert.deepEqual(await ask(owner,unreachableAgent,{intent:'disconnect'}),{status:503,body:{error:'signInFailed'}});
  assert.equal(credentials(companyProfile(two))['openai-codex'],undefined);
  assert.deepEqual(owner.logged.map(change=>change.connected),[true,false,false]);
  // The Agent's sign-in that the stopped Disconnect left is still shown, so the Owner can remove it from Settings.
  assert.deepEqual(states(await read()),{'openai-codex':'someAgentsOnly',anthropic:'notConnected'});
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.equal(credentials(agentProfile)['openai-codex'],undefined);
  assert.deepEqual(states(await read()),{'openai-codex':'notConnected',anthropic:'notConnected'});
 } finally { await fake.close(); }
});

test('no credential reaches an answer, a log row or the console, and a log that cannot be written fails no step', async () => {
 const fake=await fakeHermes({managementPort:0});
 const printed=[]; const kept={};
 for(const level of ['log','info','warn','error','debug']) { kept[level]=console[level]; console[level]=(...args)=>{ printed.push(args.map(String).join(' ')); }; }
 try {
  const driver=pointedAt(fake);
  const token='codex-token-known-0123456789abcdef';
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  fake.settings.defaultCredentials['openai-codex']=token;
  fake.settings.profiles.get(companyProfile(two)).credentials['openai-codex']=token;
  const owner=sessions(fake,{owner:true,logFails:true});
  const answers=[await readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}})];
  const started=await ask(owner,driver,{intent:'start'});
  fake.settings.approve(started.body.session);
  answers.push(started,await ask(owner,driver,{intent:'poll',session:started.body.session}));
  const approved=fake.settings.defaultCredentials['openai-codex'];
  answers.push(await readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}}),await ask(owner,driver,{intent:'disconnect'}),
   await readCompanySignIns(owner.db,{company:two,driver,hermes:{address:fake.address,key:'test-only-key'}}));
  assert.deepEqual(answers.slice(1,3).map(answer=>answer.status),[200,200]);
  assert.deepEqual(answers[4],{status:200,body:{status:'disconnected'}});
  assert.equal(owner.logged.length,2,'both changes were asked to be logged');
  assert.ok(printed.length>0,'the failed log writes are reported');
  const seen=JSON.stringify([answers,owner.asked,printed]);
  for(const secret of [token,token.slice(-6),approved,approved.slice(-6)]) assert.ok(!seen.includes(secret),secret);
 } finally {
  for(const level of Object.keys(kept)) console[level]=kept[level];
  await fake.close();
 }
});

test('a level change and a move read in the company log in both languages', () => {
 const changed=describeEntry({subject:'company',action:'agent_level_changed',details:{old_level:1,new_level:3}});
 assert.deepEqual(changed,{act:['logActAgentLevel'],obj:undefined,from:{key:'agentLevel1'},to:{key:'agentLevel3'},note:undefined});
 assert.deepEqual(describeEntry({subject:'agent',action:'agent_own_profile',details:{agent_name:'Lead'}}).act,['logActAgentOwnProfile']);
 for(const language of ['en','ar']) for(const key of ['logActAgentLevel','logActAgentOwnProfile','agentLevel1','agentLevel3','signInTerminalOnly'])
  assert.notEqual(i18n(language).t(key),key,`${language}:${key}`);
});

test('the install job proves profiles per company on the pinned release, after the bundled Engine checks', async () => {
 const { load } = await import('js-yaml');
 const install=installJob().steps.map(step=>step.run||'').join('\n');
 const at=text=>{ const found=install.indexOf(text); assert.ok(found>=0,text); return found; };
 assert.ok(at('scripts/check-install-agent.mjs')<at('- prepare < scripts/check-install-profiles.mjs'));
 // The memory the agents area writes after its prepare step (the release areas' own helper, tell_engine, is in the lib).
 const prepare=at('- prepare < scripts/check-install-profiles.mjs');
 const memory=install.indexOf('/opt/data/profiles/$1/memories/MEMORY.md',prepare);
 assert.ok(memory>prepare,'the agents area writes a memory after its prepare step');
 assert.ok(memory<at('- verify "$marker" < scripts/check-install-profiles.mjs'));
 // The work sandbox proof (#393) runs after the Agents it reads exist, and the job reads the host's Docker for where the
 // markers a tool wrote landed: the sandbox's work folder holds them, the Engine's disk does not.
 const sandbox=at('- sandbox "$sandbox_marker" < scripts/check-install-profiles.mjs');
 assert.ok(at('- verify "$marker" < scripts/check-install-profiles.mjs')<sandbox);
 assert.match(install,/docker exec "\$sandbox" cat "\/work\/\$sandbox_marker-file\.txt"/);
 assert.match(install,/docker exec "\$engine_id" sh -ec "test -e \/work\/\$sandbox_marker-/);
 assert.match(install,/an Agent's command runs in the work sandbox/);
 const script=readFileSync('scripts/check-install-profiles.mjs','utf8');
 for(const name of ['noAgentGets','forbiddenOf','fixedToolsets','toolConfig','profileSettingsDiffer']) assert.ok(script.includes(name),name);
 assert.match(script,/assert\.deepEqual\(forbiddenOf\(enabled\),\[\]/);
 assert.match(script,/own_profile:true/);
 assert.match(script,/assert\.deepEqual\(seen,\[true,false\]\)/);
 // #121: an Agent made on the company profile as the previous version made one moves out, and the memory stays with the main Agent.
 assert.match(script,/service\.rpc\('lead_create_agent',\{conversation:first\.conversation,run,call:'install-check',agent_name:'Install writer',job:'Writes the install check\.',apps:\[\]\}\)/);
 assert.match(script,/assert\.deepEqual\(after,\[true,false\]\)/);
 // #122: the Owner approves a Contributor's suggestion; it reaches the first company's Agents only, locked against their edits.
 assert.match(script,/personOf\(first\)\.rpc\('decide_agent_rule',\{c:first\.company,item:item\.id,approve:true\}\)/);
 assert.match(script,/assert\.deepEqual\(lessons,\[true,true,false,false\]\)/);
 assert.match(script,/assert\.equal\(await skill\(firstEngine,spaceOf\(first\)\),written,'team-lessons is unchanged'\)/);
 // #126: four Agents in two Companies, each on its own profile, and the marker reaches only the first Company's main Agent.
 assert.match(script,/assert\.equal\(new Set\(profiles\)\.size,4,'each of the four Agents has a profile of its own'\)/);
 assert.match(script,/assert\.deepEqual\(memory,\[true,false,false,false\]\)/);
 assert.match(script,/assert\.deepEqual\(\[await listsSkill\(otherEngine,other\.profile\),await listsSkill\(otherEngine,other\.secondProfile\)\],\[false,false\]/);
});

// The person's session and the service role, as sendMessage sees them; every call is recorded in order.
function conversationDatabases({profile,reserve=null,record=null}) {
 const order=[];
 const db={order,args:{},rpc:async(name,args)=>{ order.push(name); db.args[name]=args;
   if(name==='conversation_agent') return {data:null,error:null};
   // The sender's one entry point reserves the run when the Agent is free (reserve_conversation_turn, #team-work).
   if(name==='reserve_conversation_turn') return reserve||{data:{state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',profile,note:null},error:null};
   if(name==='send_conversation_message') return record||{data:true,error:null};
   if(name==='release_conversation_run') return {data:true,error:null};
   return {data:null,error:{message:'unexpected'}}; },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{id:'a9000000-0000-0000-0000-000000000001'},error:null})}; return chain; }};
 const service={rpc:async(name)=>{ order.push(`service ${name}`); return name==='begin_start'?{data:1,error:null}:name==='pin_run'?{data:{tools:null,rules:[]},error:null}:name==='pin_run_history'?{data:null,error:null}:name==='pin_run_model'?{data:null,error:null}:{data:null,error:{message:'unexpected'}}; }};
 return {db,service,order};
}
const engine=order=>({engineFor:connection=>({start:async()=>{ order.push(`start ${connection.profile}`); return 'run_1'; }})});

test('a run is reserved on its pinned profile before Hermes is called, and recorded after', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const {db,service,order}=conversationDatabases({profile:companyProfile(two)});
 const sent=await sendMessage(db,service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(order)});
 assert.deepEqual(sent,{conversation:'c'});
 // The reservation keeps the message for the record.
 assert.equal(db.args.reserve_conversation_turn.message,'Hi');
 // The record names the pin the run started on, the one the reservation made.
 assert.equal(db.args.send_conversation_message.started_on,'f9000000-0000-0000-0000-000000000001');
 assert.deepEqual(order,['conversation_agent','reserve_conversation_turn','service pin_run','service pin_run_history','service pin_run_model','service begin_start',`start ${companyProfile(two)}`,'send_conversation_message']);
});

test('a run never starts on another company\'s profile, nor while the profile\'s tools are not the fixed set', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const borrowed=conversationDatabases({profile:companyProfile(three)});
 assert.deepEqual(await sendMessage(borrowed.db,borrowed.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(borrowed.order)}),{error:'conversationNotFound',status:404});
 assert.ok(!borrowed.order.some(step=>step.startsWith('start')));
 const pending=conversationDatabases({profile:companyProfile(two),reserve:{data:null,error:{code:'55000',message:'agentToolsPending'}}});
 assert.deepEqual(await sendMessage(pending.db,pending.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(pending.order)}),{error:'conversationAgentToolsPending',status:409});
 assert.ok(!pending.order.some(step=>step.startsWith('start')));
});

test('a profile the Engine reports with other tools is marked as changing, written the fixed set and recorded', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:{platform_toolsets:{api_server:['web','connections']},agent:{disabled_toolsets:[]}},forbidden:[]});
  const db=workerDatabase([row(two,{attach:false,tools_confirmed:true,tools_pending:true})]);
  assert.deepEqual(await keepCompanyProfiles(db,{hermes:install(fake)}),{provided:0,configured:1,attached:0,moved:0});
  assert.deepEqual(db.calls.map(call=>call.name),['company_profile_work','begin_company_tools','record_company_profile']);
  const read=await readToolsets({address:fake.address,profile:name,key:'test-only-key'});
  assert.equal(toolsDiffer(read.toolsets),false,'the connectors no Agent gets are gone');
 } finally { await fake.close(); }
});

test('the main Agent\'s sub-agents switch on its Company profile writes the delegation variant there, and names it on the read-back', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=toolConfig();
  await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets});
  // #425: the Owner turned sub-agents on for the main Agent, so set_agent_subagents marked its `co-` profile pending.
  const db=workerDatabase([row(two,{attach:false,tools_confirmed:true,tools_pending:true,subagents:true})]);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake)})).configured,1);
  assert.ok((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('delegation'));
  assert.deepEqual(db.calls.at(-1),{name:'record_company_profile',args:{c:two,engine_profile:name,subagents_written:true}});
 } finally { await fake.close(); }
});

test('a write that cannot be recorded keeps the profile pending until a later read-back is recorded', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  const failing=workerDatabase([row(two,{attach:false,tools_confirmed:true,tools_pending:true})],{failRecord:true});
  await keepCompanyProfiles(failing,{hermes:install(fake)});
  assert.equal(failing.rows[0].tools_pending,true,'marked before writing, never cleared');
  const db=workerDatabase(failing.rows);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake)})).configured,1);
  assert.deepEqual(db.calls.map(call=>call.name),['company_profile_work','begin_company_tools','record_company_profile']);
  assert.equal(db.rows[0].tools_pending,false);
  assert.equal(toolsDiffer((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets),false);
 } finally { await fake.close(); }
});

test('the worker abandons unrecorded reservations in one database update and never calls the engine', async () => {
 const {abandonConversationReservations}=await import('../lib/company-profiles.mjs');
 const calls=[];
 const db={rpc:async name=>{ calls.push(name); return {data:3,error:null}; }};
 assert.equal(await abandonConversationReservations(db),3);
 assert.deepEqual(calls,['abandon_conversation_reservations']);
 const source=readFileSync('lib/company-profiles.mjs','utf8');
 assert.doesNotMatch(source,/settle|engineFor|\.start\(/,'no replay path is left');
});

test('a late record of an abandoned reservation asks the person to send again', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const late=conversationDatabases({profile:companyProfile(two),record:{data:null,error:{code:'55000',message:'conversationSendAgain'}}});
 assert.deepEqual(await sendMessage(late.db,late.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(late.order)}),{error:'conversationSendAgain',status:409});
 for(const language of ['en','ar']) assert.notEqual(i18n(language).t('conversationSendAgain'),'conversationSendAgain');
});

test('a run that never started releases its reservation at once; a started one leaves it to the record', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const refused=conversationDatabases({profile:companyProfile(two)});
 const refusing={engineFor:connection=>({start:async()=>{ refused.order.push(`start ${connection.profile}`); return null; }})};
 assert.deepEqual(await sendMessage(refused.db,refused.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...refusing}),{error:'conversationHermesFailed',status:502});
 assert.deepEqual(refused.order.slice(-2),[`start ${companyProfile(two)}`,'release_conversation_run']);
 assert.deepEqual(refused.db.args.release_conversation_run,{conversation:'c',c:two,message_key:'k',attempt:1});
 // A Connection that cannot be used never reaches the engine, and its reservation is released too.
 const borrowed=conversationDatabases({profile:companyProfile(three)});
 assert.deepEqual(await sendMessage(borrowed.db,borrowed.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(borrowed.order)}),{error:'conversationNotFound',status:404});
 assert.equal(borrowed.order.at(-1),'release_conversation_run');
 // A run that started is recorded, never released: the record ends its reservation.
 const started=conversationDatabases({profile:companyProfile(two)});
 assert.deepEqual(await sendMessage(started.db,started.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(started.order)}),{conversation:'c'});
 assert.ok(!started.order.includes('release_conversation_run'));
});

// Each Agent's own profile (ADR 0016), as the worker sees it: the profiles it never confirmed and those marked as
// changing, the mark before a change, the recorded read-back, and tool health forgetting a lost profile. `log` is shared
// with the driver, so the order of marks, writes and records shows.
function agentWorkerDatabase(rows,{log=[],failRecord=false}={}) {
 const lags=row=>!row.tools_confirmed||row.tools_pending;
 return {log,rows,rpc:async(name,args)=>{
  log.push({name,args});
  const row=rows.find(found=>found.agent_id===(args?.agent));
  if(name==='agent_profile_work') return {data:rows.filter(lags).sort((a,b)=>Number(a.tools_confirmed)-Number(b.tools_confirmed)).map(found=>({...found})),error:null};
  if(name==='begin_agent_tools') { row.tools_pending=true; return {data:null,error:null}; }
  if(name==='record_agent_profile') {
   if(failRecord||args.engine_profile!==row.profile||args.subagents_written!==row.subagents) return {data:null,error:{message:'agentProfileInvalid'}};
   Object.assign(row,{tools_confirmed:true,tools_pending:false}); return {data:null,error:null};
  }
  if(name==='forget_company_profile') { const lost=rows.find(found=>found.profile===args.engine_profile); Object.assign(lost,{tools_confirmed:false,tools_pending:false}); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const [writer,critic]=['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'];
const agentRow=(agent,extra={})=>({agent_id:agent,profile:`ag-${agent.replaceAll('-','')}`,tools_confirmed:true,tools_pending:false,subagents:false,instructions:`You are ${agent}.`,...extra});
// A driver that records what it is asked in the database's log, and answers as `answer` says.
const recordingDriver=(log,answer=()=>({state:'configured',toolsets:[]}))=>({
 provide:async(hermes,profile)=>{ log.push({name:'provide',args:profile}); return answer('provide',profile); },
 configure:async(hermes,profile)=>{ log.push({name:'configure',args:profile}); return answer('configure',profile); }});
const hermesOf={address:'http://hermes:8642',profile:'default',key:'test-only-key'};

test('every Agent profile the database lists is written the fixed set, each marked before the write and recorded after its read-back', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{tools_pending:true}),agentRow(critic,{tools_pending:true})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:2});
 assert.deepEqual(db.log.map(({name,args})=>`${name} ${args?.agent||args?.name||''}`.trim()),['agent_profile_work',
  `begin_agent_tools ${writer}`,`configure ag-${writer.replaceAll('-','')}`,`record_agent_profile ${writer}`,
  `begin_agent_tools ${critic}`,`configure ag-${critic.replaceAll('-','')}`,`record_agent_profile ${critic}`]);
 for(const call of db.log.filter(({name})=>name==='configure')) assert.deepEqual(call.args,{name:call.args.name,config:toolConfig({profile:call.args.name}),forbidden:toolConfig().agent.disabled_toolsets});
 assert.deepEqual(db.log.filter(({name})=>name==='record_agent_profile').map(({args})=>args),[writer,critic].map(agent=>({agent,engine_profile:`ag-${agent.replaceAll('-','')}`,subagents_written:false})));
 assert.ok(db.rows.every(row=>row.tools_confirmed&&!row.tools_pending));
 db.log.length=0;
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:0});
 assert.deepEqual(db.log.map(({name})=>name),['agent_profile_work']);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:null}),{provided:0,configured:0});
});

test('the worker writes an Agent\'s sub-agents choice with the delegation variant and records the read-back with it', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{tools_pending:true,subagents:true})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:1});
 const written=db.log.find(({name})=>name==='configure');
 assert.deepEqual(written.args.config,toolConfig({subagents:true,profile:written.args.name}));
 assert.ok(written.args.config.platform_toolsets.api_server.includes('delegation'));
 assert.deepEqual(db.log.find(({name})=>name==='record_agent_profile').args,{agent:writer,engine_profile:`ag-${writer.replaceAll('-','')}`,subagents_written:true});
});

test('a write the Engine did not apply leaves its profile marked and unrecorded, so no Run starts on it, and the next profile is still kept', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{tools_pending:true}),agentRow(critic,{tools_pending:true})]);
 const driver=recordingDriver(db.log,(step,profile)=>({state:profile.name===agentRow(writer).profile?'failed':'configured',toolsets:null}));
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver}),{provided:0,configured:1});
 assert.deepEqual(db.rows.map(row=>[row.tools_confirmed,row.tools_pending]),[[true,true],[true,false]]);
 assert.ok(!db.log.some(({name,args})=>name==='record_agent_profile'&&args.agent===writer));
 const refusing=agentWorkerDatabase([agentRow(writer,{tools_pending:true})],{failRecord:true});
 const logged=[]; const error=console.error; console.error=(...args)=>{ logged.push(args.join(' ')); };
 try { assert.deepEqual(await keepAgentProfiles(refusing,{hermes:hermesOf,driver:recordingDriver(refusing.log)}),{provided:0,configured:0}); }
 finally { console.error=error; }
 assert.equal(refusing.rows[0].tools_pending,true);
 assert.deepEqual(logged,[`Agent profile not kept: ${writer} agentProfileInvalid`]);
});

test('a lost Agent profile is made again first, empty, with the Agent\'s instructions as its soul, or the Company profile\'s', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{tools_pending:true}),agentRow(critic,{tools_confirmed:false,instructions:null})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:1,configured:1});
 assert.deepEqual(db.log.map(({name})=>name),['agent_profile_work','provide','record_agent_profile','begin_agent_tools','configure','record_agent_profile']);
 const made=db.log.find(({name})=>name==='provide').args;
 assert.deepEqual(made,{name:`ag-${critic.replaceAll('-','')}`,config:toolConfig({profile:made.name}),forbidden:toolConfig().agent.disabled_toolsets,soul:made.soul});
 assert.match(made.soul,/^You are a marketing agent working for one company in gtmworks\./);
 db.rows[1].tools_confirmed=false; db.rows[1].tools_pending=false; db.rows[1].instructions='You are the ad critic.'; db.log.length=0;
 await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)});
 assert.equal(db.log.find(({name})=>name==='provide').args.soul,'You are the ad critic.');
});

test('an Agent profile the Engine no longer serves is forgotten by tool health and made again, empty, with its soul and the install key', async () => {
 const fake=await fakeHermes();
 try {
  const name=`ag-${writer.replaceAll('-','')}`;
  await provideProfile(install(fake),{name,soul:'You are the writer.',config:toolConfig(),forbidden:toolConfig().agent.disabled_toolsets});
  fake.settings.profiles.get(name).credentials['openai-codex']='its-own-sign-in';
  assert.deepEqual(await engineFor(install(fake)).removeAgent(name),{state:'removed'});
  const db=agentWorkerDatabase([agentRow(writer,{instructions:'You are the writer.'})]);
  const tools={rpc:async(rpc,args)=>rpc==='engine_tools_due'?{data:[{profile:name}],error:null}:db.rpc(rpc,args)};
  assert.equal(await checkAgentTools(tools,{hermes:install(fake)}),0);
  assert.deepEqual(db.log.map(({name:called,args})=>[called,args]),[['forget_company_profile',{engine_profile:name}]]);
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await keepAgentProfiles(db,{hermes:install(fake)}),{provided:1,configured:0});
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(created.body,{name,soul:'You are the writer.'},'made, never cloned from another profile');
  const profile=fake.settings.profiles.get(name);
  assert.deepEqual([profile.key,profile.credentials,profile.config],['test-only-key',{},toolConfig({profile:name})]);
  assert.deepEqual(db.rows[0],{...agentRow(writer,{instructions:'You are the writer.'})});
 } finally { await fake.close(); }
});
