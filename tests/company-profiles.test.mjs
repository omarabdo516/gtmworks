import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentLevels, levelToolsets, alwaysOff, riskyToolsets, levelConfig, childToolsets, forbiddenOf, riskyOf, companyProfile, toolPolicy } from '../lib/agent-levels.mjs';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { provideProfile, configureProfile, readToolsets, readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn } from '../lib/hermes.mjs';
import { keepCompanyProfiles, keepAgentProfiles, checkAgentTools } from '../lib/company-profiles.mjs';
import { engineFor } from '../lib/engine.mjs';
import { changeCompanySignIn, readCompanySignIns } from '../lib/company-sign-in.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { installJob } from './install-job.mjs';

const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const [two,three]=['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];

// Every toolset name the pinned release defines (toolsets.py, TOOLSETS keys of v0.23.0), so a misspelt name in the
// level table fails here instead of being ignored by Hermes.
const pinnedToolsets=['web','search','x_search','vision','video','image_gen','video_gen','computer_use','terminal','skills','browser','cronjob','file','tts','todo','memory','context_engine',
 'session_search','connections','project','bot_room','desktop_ui','onboarding','catalog','clarify','code_execution','delegation','kanban','debugging','safe','coding'];

test('the level table: three levels, each adding to the one below, none ever offering what must stay off', () => {
 assert.deepEqual(agentLevels,[1,2,3]);
 for(const name of [...Object.values(levelToolsets).flat(),...alwaysOff]) assert.ok(pinnedToolsets.includes(name),name);
 for(const level of agentLevels) {
  const config=levelConfig(level);
  assert.deepEqual(config.platform_toolsets.api_server,levelToolsets[level]);
  assert.deepEqual(forbiddenOf(config.platform_toolsets.api_server),[]);
  // terminal, files, code and the rest are always in the list Hermes applies last.
  for(const name of alwaysOff) assert.ok(config.agent.disabled_toolsets.includes(name),`${name} off at level ${level}`);
  for(const name of riskyToolsets) assert.ok(config.agent.disabled_toolsets.includes(name));
  assert.equal(config.platform_toolsets.api_server.some(name=>config.agent.disabled_toolsets.includes(name)),false);
 }
 assert.ok(levelToolsets[1].includes('web')&&levelToolsets[1].includes('memory'));
 assert.ok(!levelToolsets[1].includes('connections')&&!levelToolsets[1].includes('cronjob'));
 assert.ok(levelConfig(1).agent.disabled_toolsets.includes('connections')&&levelConfig(1).agent.disabled_toolsets.includes('cronjob'));
 // Until gtmworks has an approval-gated action path, level 2 offers nothing beyond level 1 (lead's decision, ADR 0014),
 // and Hermes's connectors (actions in connected accounts) stay off at every level.
 assert.deepEqual(levelToolsets[2],levelToolsets[1]);
 assert.deepEqual(levelConfig(2),levelConfig(1));
 for(const level of agentLevels) assert.ok(!levelToolsets[level].includes('connections')&&levelConfig(level).agent.disabled_toolsets.includes('connections'));
 assert.ok(levelToolsets[3].includes('cronjob'));
 // The Engine's question tool (#138) at every level: a Run may ask its person and wait.
 for(const level of agentLevels) assert.ok(levelToolsets[level].includes('clarify')&&!levelConfig(level).agent.disabled_toolsets.includes('clarify'),`clarify at level ${level}`);
 for(const level of agentLevels.slice(1)) assert.ok(levelToolsets[level-1].every(name=>levelToolsets[level].includes(name)));
 // Disabling these composites would strip web search too (Hermes removes every tool of a disabled composite).
 for(const composite of ['debugging','safe']) assert.ok(!levelConfig(1).agent.disabled_toolsets.includes(composite));
 for(const bad of [0,4,'1',null]) assert.throws(()=>levelConfig(bad),/agentLevelInvalid/);
 assert.deepEqual(riskyOf(['web','file','terminal','memory']),['terminal','file']);
 // Sub-agents are a per-Agent choice (#29): off, the delegation toolset stays disabled at every level; on, it is offered
 // and only it leaves the disabled list, while terminal, files and code execution stay off for the Agent and its children.
 for(const level of agentLevels) {
  assert.ok(!levelConfig(level).platform_toolsets.api_server.includes('delegation'));
  assert.ok(levelConfig(level).agent.disabled_toolsets.includes('delegation'));
  const withSubagents=levelConfig(level,{subagents:true});
  assert.deepEqual(withSubagents.platform_toolsets.api_server,[...levelToolsets[level],'delegation']);
  assert.ok(!withSubagents.agent.disabled_toolsets.includes('delegation'));
  for(const off of ['terminal','file','code_execution']) assert.ok(withSubagents.agent.disabled_toolsets.includes(off),`${off} stays off`);
  assert.deepEqual(alwaysOff.filter(name=>name!=='delegation').filter(name=>!withSubagents.agent.disabled_toolsets.includes(name)),[]);
  // What a child of that Agent is offered, from the Engine's own rule: the parent's tools without delegation or kanban,
  // with the parent's disabled list inherited, so terminal, files and code execution never arrive from a parent below.
  const child=childToolsets(withSubagents);
  assert.ok(!child.toolsets.includes('delegation')&&!child.toolsets.includes('kanban'));
  for(const off of ['terminal','file','code_execution']) {
   assert.ok(!child.toolsets.includes(off),`a child is not offered ${off}`);
   assert.ok(child.disabled.includes(off),`a child keeps ${off} disabled`);
  }
  assert.ok(childToolsets(levelConfig(level)).disabled.includes('delegation'));
 }
});

test('an Agent whose Owner turned sub-agents on offers delegation in the Engine\'s read-back, never terminal, files or code', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const config=levelConfig(2,{subagents:true});
  const made=await provideProfile(install(fake),{name,soul:'',config,forbidden:config.agent.disabled_toolsets});
  assert.equal(made.state,'configured');
  assert.ok(made.toolsets.includes('delegation'));
  for(const off of alwaysOff.filter(toolset=>toolset!=='delegation')) assert.ok(!made.toolsets.includes(off),`${off} is off`);
  for(const off of riskyToolsets) assert.ok(!made.toolsets.includes(off),`${off} is off`);
  assert.deepEqual(made.toolsets.filter(toolset=>toolset==='terminal'||toolset==='file'||toolset==='code_execution'),[]);
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

test('the driver makes a company profile with its key and level-1 tools, and reads back what a Run may use', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  const made=await provideProfile(install(fake),{name,soul:'Work for one company.',config:levelConfig(1),forbidden:alwaysOff});
  assert.equal(made.state,'configured');
  assert.deepEqual([...made.toolsets].sort(),[...levelToolsets[1]].sort());
  for(const name of riskyToolsets) assert.ok(!made.toolsets.includes(name));
  const profile=fake.settings.profiles.get(name);
  assert.equal(profile.key,'test-only-key');
  assert.deepEqual(profile.config.agent.disabled_toolsets,levelConfig(1).agent.disabled_toolsets);
  // A new profile is made, never cloned from another one, so it starts with no memory of its own.
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(Object.keys(created.body).sort(),['name','soul']);
  assert.deepEqual(fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),
   ['POST /api/profiles',`PUT /api/env?profile=${name}`,`PUT /api/config?profile=${name}`]);
  // Asking again finishes the same profile (the name is reserved for that company).
  assert.equal((await provideProfile(install(fake),{name,soul:'Again.',config:levelConfig(1),forbidden:alwaysOff})).state,'configured');
  // Level 3 adds scheduled work; terminal, files and code stay off.
  const three=await configureProfile(install(fake),{name,config:levelConfig(3),forbidden:alwaysOff});
  assert.equal(three.state,'configured');
  assert.ok(three.toolsets.includes('cronjob')&&!three.toolsets.includes('connections'));
  // A downgrade whose write Hermes answers but does not apply reads back stale: level 1 is refused while cron jobs stay on.
  fake.settings.staleConfig=true;
  const stale=await configureProfile(install(fake),{name,config:levelConfig(1),forbidden:levelConfig(1).agent.disabled_toolsets});
  assert.equal(stale.state,'failed');
  assert.ok(stale.toolsets.includes('cronjob'));
  fake.settings.staleConfig=false;
  assert.deepEqual(riskyOf(three.toolsets),[]);
  // A profile that still offers a forbidden toolset (a Hermes that ignored the list) fails closed.
  fake.settings.ignoreDisabled=true;
  const leaky=await configureProfile(install(fake),{name,config:{platform_toolsets:{api_server:['web','terminal']}},forbidden:alwaysOff});
  assert.equal(leaky.state,'failed');
  fake.settings.ignoreDisabled=false;
  fake.settings.failStep='config';
  assert.equal((await configureProfile(install(fake),{name,config:levelConfig(1),forbidden:alwaysOff})).state,'failed');
  fake.settings.failStep='';
  assert.equal((await readToolsets({address:fake.address,profile:name,key:'wrong'})).state,'refused');
  assert.equal((await provideProfile({...install(fake),key:'wrong'},{name:'co-x',soul:'',config:levelConfig(1),forbidden:alwaysOff})).state,'refused');
  assert.equal((await provideProfile(install(fake),{name:'Bad Name',soul:'',config:levelConfig(1),forbidden:alwaysOff})).state,'failed');
 } finally { await fake.close(); }
});

test('a capacity profile can be made without the Engine\'s bundled Skills, as the install job measures (#126)', async () => {
 const fake=await fakeHermes();
 try {
  const without=await provideProfile(install(fake),{name:`ag-${'1'.repeat(32)}`,soul:'Capacity.',config:levelConfig(1),forbidden:alwaysOff,noSkills:true});
  assert.equal(without.state,'configured');
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(Object.keys(created.body).sort(),['name','no_skills','soul']);
  assert.equal(created.body.no_skills,true);
  // The default stays as it was: the bundled Skills are copied into every other new profile.
  await provideProfile(install(fake),{name:`ag-${'2'.repeat(32)}`,soul:'Capacity.',config:levelConfig(1),forbidden:alwaysOff});
  const bodies=fake.settings.managementRequests.filter(request=>request.method==='POST'&&request.path==='/api/profiles').map(request=>request.body);
  assert.ok(!('no_skills' in bodies.at(-1)));
 } finally { await fake.close(); }
});

// A service-role client stand-in for the worker: the work the database lists, and the calls the worker makes.
function workerDatabase(rows,{failRecord=false}={}) {
 const calls=[];
 return {calls,rows,rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='company_profile_work') return {data:rows.filter(row=>row.attach||row.move||row.tools_level!=null&&(row.tools_level!==row.agent_level||row.tools_policy!==toolPolicy||row.tools_pending)).map(row=>({...row})),error:null};
  if(name==='begin_company_tools') { const row=rows.find(found=>found.company_id===args.c); row.tools_pending=true; return {data:null,error:null}; }
  if(name==='record_company_profile') {
   if(failRecord||args.policy!==toolPolicy) return {data:null,error:{message:'record failed'}};
   const row=rows.find(found=>found.company_id===args.c); Object.assign(row,{tools_level:args.level,tools_policy:args.policy,tools_pending:false}); return {data:null,error:null};
  }
  if(name==='attach_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.attach=false; return {data:true,error:null}; }
  if(name==='move_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.move=false; return {data:1,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const row=(company,extra={})=>({company_id:company,profile:companyProfile(company),agent_level:1,tools_level:null,tools_policy:null,tools_pending:false,attach:true,move:false,...extra});

test('two companies get two different profiles, each with terminal, files and code turned off, before either is attached', async () => {
 const fake=await fakeHermes();
 try {
  const db=workerDatabase([row(two),row(three)]);
  const done=await keepCompanyProfiles(db,{hermes:install(fake)});
  assert.deepEqual(done,{provided:2,configured:0,attached:2,moved:0});
  const profiles=[companyProfile(two),companyProfile(three)];
  assert.deepEqual([...fake.settings.profiles.keys()].sort(),profiles.sort());
  for(const name of profiles) {
   const config=fake.settings.profiles.get(name).config;
   for(const off of ['terminal','file','code_execution']) assert.ok(config.agent.disabled_toolsets.includes(off));
   const read=await readToolsets({address:fake.address,profile:name,key:'test-only-key'});
   assert.deepEqual(riskyOf(read.toolsets),[]);
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
 } finally { await fake.close(); }
});

test('a company on the old default profile moves once its Engine holds a sign-in on the root profile; a level change rewrites the tools', async () => {
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
  // The Owner sets level 3: the worker writes the tools again, with scheduled work and still no terminal.
  db.rows[0].agent_level=3;
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:0,configured:1,attached:0,moved:0});
  assert.ok(fake.settings.profiles.get(name).config.platform_toolsets.api_server.includes('cronjob'));
  assert.equal(db.rows[0].tools_level,3);
  // Back to level 1 with a stale read-back: the worker records nothing, so no new run starts (reserve_conversation_run).
  db.rows[0].agent_level=1;
  fake.settings.staleConfig=true;
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:0,configured:0,attached:0,moved:0});
  assert.equal(db.rows[0].tools_level,3);
  fake.settings.staleConfig=false;
  // A Hermes that refuses keeps the level waiting, recorded nowhere.
  db.rows[0].agent_level=2;
  fake.settings.managementStatus=503;
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:0,configured:0,attached:0,moved:0});
  assert.equal(db.rows[0].tools_level,3);
  assert.deepEqual(await keepCompanyProfiles(db,{...options,hermes:null}),{provided:0,configured:0,attached:0,moved:0});
 } finally { await fake.close(); }
});

test('the profile check has a lost company profile made again and records no tools (#341)', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
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

test('the sign-in driver passes on states, a code and an https link, never a credential', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  await provideProfile(install(fake),{name:companyProfile(three),soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  for(const name of [companyProfile(two),agentProfile]) await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  // Removing the key leaves the subscription.
  for(const name of [companyProfile(two),agentProfile]) fake.settings.profiles.get(name).env={};
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
  for(const name of [companyProfile(two),agentProfile,companyProfile(three)]) await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
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
 assert.ok(at('- prepare < scripts/check-install-profiles.mjs')<at('/opt/data/profiles/$1/memories/MEMORY.md'));
 assert.ok(at('/opt/data/profiles/$1/memories/MEMORY.md')<at('- verify "$marker" < scripts/check-install-profiles.mjs'));
 const script=readFileSync('scripts/check-install-profiles.mjs','utf8');
 for(const off of ['terminal','file','code_execution']) assert.ok(script.includes(`'${off}'`),off);
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

test('a run never starts on another company\'s profile, nor while the profile\'s tools lag behind the level', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const borrowed=conversationDatabases({profile:companyProfile(three)});
 assert.deepEqual(await sendMessage(borrowed.db,borrowed.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(borrowed.order)}),{error:'conversationNotFound',status:404});
 assert.ok(!borrowed.order.some(step=>step.startsWith('start')));
 const pending=conversationDatabases({profile:companyProfile(two),reserve:{data:null,error:{code:'55000',message:'agentLevelPending'}}});
 assert.deepEqual(await sendMessage(pending.db,pending.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',hermes:{address:'http://hermes:8642',key:'test-only-key'},...engine(pending.order)}),{error:'conversationAgentLevelPending',status:409});
 assert.ok(!pending.order.some(step=>step.startsWith('start')));
});

test('the level table is versioned: any change to it needs a new policy, in the code and in the database', () => {
 // The fingerprint of each policy's table. Changing the table without a new toolPolicy (and its migration) fails here.
 // Policy 4 adds the sub-agent variant an Agent takes only when its Owner turned sub-agents on (#29).
 const fingerprints={2:'863aa8ac90a8fce674cf7880e0e63444c107d9051d7b95f9e861a58ac437da4d',3:'06888790e0994ba07a8ad5c2c6a2bd8000f2842362ab1e553be595e77da53354',
  4:'bddb8d0dbaeefd90cb3925ec65c036c258d8a0763c4ec2fd634d3c66721328fb'};
 const table=JSON.stringify(agentLevels.flatMap(level=>[levelConfig(level),levelConfig(level,{subagents:true})]));
 assert.equal(createHash('sha256').update(table).digest('hex'),fingerprints[toolPolicy]);
 const latest=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort()
  .map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).filter(sql=>/function public\.engine_tool_policy\(\)/.test(sql)).at(-1);
 assert.equal(Number(/engine_tool_policy\(\)[^$]*\$\$ select (\d+) \$\$/.exec(latest)?.[1]),toolPolicy);
});

test('a profile applied under an older policy is applied again at the same level, and a change is marked before it is written', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:{platform_toolsets:{api_server:['web','connections']},agent:{disabled_toolsets:[]}},forbidden:[]});
  const db=workerDatabase([row(two,{attach:false,agent_level:2,tools_level:2,tools_policy:1})]);
  assert.deepEqual(await keepCompanyProfiles(db,{hermes:install(fake)}),{provided:0,configured:1,attached:0,moved:0});
  assert.deepEqual(db.calls.map(call=>call.name),['company_profile_work','begin_company_tools','record_company_profile']);
  assert.equal(db.calls[2].args.policy,toolPolicy);
  assert.ok(!(await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('connections'),'the old policy\'s connectors are gone');
 } finally { await fake.close(); }
});

test('the main Agent\'s sub-agents switch on its Company profile writes the delegation variant there, and names it on the read-back', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  // #425: the Owner turned sub-agents on for the main Agent, so set_agent_subagents marked its `co-` profile pending.
  const db=workerDatabase([row(two,{attach:false,tools_level:1,tools_policy:toolPolicy,tools_pending:true,subagents:true})]);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake)})).configured,1);
  assert.ok((await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('delegation'));
  assert.deepEqual(db.calls.at(-1),{name:'record_company_profile',args:{c:two,engine_profile:name,level:1,policy:toolPolicy,subagents_written:true}});
 } finally { await fake.close(); }
});

test('raised, written, not recorded, then lowered: the profile stays pending until the read-back of the lower level is recorded', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const failing=workerDatabase([row(two,{attach:false,agent_level:3,tools_level:1,tools_policy:toolPolicy})],{failRecord:true});
  await keepCompanyProfiles(failing,{hermes:install(fake)});
  assert.ok(fake.settings.profiles.get(name).config.platform_toolsets.api_server.includes('cronjob'),'Hermes has level 3');
  assert.equal(failing.rows[0].tools_pending,true,'marked before writing, never cleared');
  // The Owner lowers to 1: the levels agree, but the pending mark keeps it work and runs refused until the read-back.
  failing.rows[0].agent_level=1;
  const db=workerDatabase(failing.rows);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake)})).configured,1);
  assert.deepEqual(db.calls.map(call=>call.name),['company_profile_work','begin_company_tools','record_company_profile']);
  assert.equal(db.rows[0].tools_pending,false);
  assert.ok(!(await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('cronjob'));
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

// Each Agent's own profile (ADR 0016), as the worker sees it: the profiles whose tools lag (agent_profile_work, lost ones
// first), the mark before a change, the recorded read-back, and tool health forgetting a lost profile. `log` is shared
// with the driver, so the order of marks, writes and records shows.
function agentWorkerDatabase(rows,{log=[],failRecord=false}={}) {
 const lags=row=>row.tools_level==null||row.tools_level!==row.agent_level||row.tools_policy!==toolPolicy||row.tools_pending;
 return {log,rows,rpc:async(name,args)=>{
  log.push({name,args});
  const row=rows.find(found=>found.agent_id===(args?.agent));
  if(name==='agent_profile_work') return {data:rows.filter(lags).sort((a,b)=>Number(a.tools_level!=null)-Number(b.tools_level!=null)).map(found=>({...found})),error:null};
  if(name==='begin_agent_tools') { row.tools_pending=true; return {data:null,error:null}; }
  if(name==='record_agent_profile') {
   if(failRecord||args.engine_profile!==row.profile||args.policy!==toolPolicy||args.subagents_written!==row.subagents) return {data:null,error:{message:'agentProfileInvalid'}};
   Object.assign(row,{tools_level:args.level,tools_policy:args.policy,tools_pending:false}); return {data:null,error:null};
  }
  if(name==='forget_company_profile') { const lost=rows.find(found=>found.profile===args.engine_profile); Object.assign(lost,{tools_level:null,tools_policy:null,tools_pending:false}); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const [writer,critic]=['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'];
const agentRow=(agent,extra={})=>({agent_id:agent,profile:`ag-${agent.replaceAll('-','')}`,agent_level:1,tools_level:1,tools_policy:toolPolicy,tools_pending:false,subagents:false,instructions:`You are ${agent}.`,...extra});
// A driver that records what it is asked in the database's log, and answers as `answer` says.
const recordingDriver=(log,answer=()=>({state:'configured',toolsets:[]}))=>({
 provide:async(hermes,profile)=>{ log.push({name:'provide',args:profile}); return answer('provide',profile); },
 configure:async(hermes,profile)=>{ log.push({name:'configure',args:profile}); return answer('configure',profile); }});
const hermesOf={address:'http://hermes:8642',profile:'default',key:'test-only-key'};

test('after a level change every Agent profile gets the new tools, each marked before the write and recorded after its read-back', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{agent_level:3}),agentRow(critic,{agent_level:3})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:2});
 assert.deepEqual(db.log.map(({name,args})=>`${name} ${args?.agent||args?.name||''}`.trim()),['agent_profile_work',
  `begin_agent_tools ${writer}`,`configure ag-${writer.replaceAll('-','')}`,`record_agent_profile ${writer}`,
  `begin_agent_tools ${critic}`,`configure ag-${critic.replaceAll('-','')}`,`record_agent_profile ${critic}`]);
 for(const call of db.log.filter(({name})=>name==='configure')) assert.deepEqual(call.args,{name:call.args.name,config:levelConfig(3),forbidden:levelConfig(3).agent.disabled_toolsets});
 assert.deepEqual(db.log.filter(({name})=>name==='record_agent_profile').map(({args})=>args),[writer,critic].map(agent=>({agent,engine_profile:`ag-${agent.replaceAll('-','')}`,level:3,policy:toolPolicy,subagents_written:false})));
 assert.ok(db.rows.every(row=>row.tools_level===3&&!row.tools_pending));
 db.log.length=0;
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:0});
 assert.deepEqual(db.log.map(({name})=>name),['agent_profile_work']);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:null}),{provided:0,configured:0});
});

test('the worker writes an Agent\'s sub-agents choice with the policy\'s delegation variant and records the read-back with it', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{agent_level:2,tools_level:2,tools_policy:3,subagents:true})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:1});
 const written=db.log.find(({name})=>name==='configure');
 assert.deepEqual(written.args.config,levelConfig(2,{subagents:true}));
 assert.ok(written.args.config.platform_toolsets.api_server.includes('delegation'));
 assert.deepEqual(db.log.find(({name})=>name==='record_agent_profile').args,{agent:writer,engine_profile:`ag-${writer.replaceAll('-','')}`,level:2,policy:toolPolicy,subagents_written:true});
});

test('a write the Engine did not apply leaves its profile marked and unrecorded, so no Run starts on it, and the next profile is still kept', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{agent_level:3}),agentRow(critic,{agent_level:3,tools_policy:1})]);
 const driver=recordingDriver(db.log,(step,profile)=>({state:profile.name===agentRow(writer).profile?'failed':'configured',toolsets:null}));
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver}),{provided:0,configured:1});
 assert.deepEqual(db.rows.map(row=>[row.tools_level,row.tools_pending]),[[1,true],[3,false]]);
 assert.ok(!db.log.some(({name,args})=>name==='record_agent_profile'&&args.agent===writer));
 const refusing=agentWorkerDatabase([agentRow(writer,{agent_level:2})],{failRecord:true});
 const logged=[]; const error=console.error; console.error=(...args)=>{ logged.push(args.join(' ')); };
 try { assert.deepEqual(await keepAgentProfiles(refusing,{hermes:hermesOf,driver:recordingDriver(refusing.log)}),{provided:0,configured:0}); }
 finally { console.error=error; }
 assert.equal(refusing.rows[0].tools_pending,true);
 assert.deepEqual(logged,[`Agent profile not kept: ${writer} agentProfileInvalid`]);
});

test('a lost Agent profile is made again first, empty, with the Agent\'s instructions as its soul, or the Company profile\'s', async () => {
 const db=agentWorkerDatabase([agentRow(writer,{agent_level:2}),agentRow(critic,{tools_level:null,tools_policy:null,instructions:null})]);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:1,configured:1});
 assert.deepEqual(db.log.map(({name})=>name),['agent_profile_work','provide','record_agent_profile','begin_agent_tools','configure','record_agent_profile']);
 const made=db.log.find(({name})=>name==='provide').args;
 assert.deepEqual(made,{name:`ag-${critic.replaceAll('-','')}`,config:levelConfig(1),forbidden:levelConfig(1).agent.disabled_toolsets,soul:made.soul});
 assert.match(made.soul,/^You are a marketing agent working for one company in gtmworks\./);
 db.rows[1].tools_level=null; db.rows[1].tools_policy=null; db.rows[1].instructions='You are the ad critic.'; db.log.length=0;
 await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)});
 assert.equal(db.log.find(({name})=>name==='provide').args.soul,'You are the ad critic.');
});

test('an Agent profile the Engine no longer serves is forgotten by tool health and made again, empty, with its soul and the install key', async () => {
 const fake=await fakeHermes();
 try {
  const name=`ag-${writer.replaceAll('-','')}`;
  await provideProfile(install(fake),{name,soul:'You are the writer.',config:levelConfig(1),forbidden:alwaysOff});
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
  assert.deepEqual([profile.key,profile.credentials,profile.config],['test-only-key',{},levelConfig(1)]);
  assert.deepEqual(db.rows[0],{...agentRow(writer,{instructions:'You are the writer.'})});
 } finally { await fake.close(); }
});
