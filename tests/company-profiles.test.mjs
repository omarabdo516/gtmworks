import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentLevels, levelToolsets, alwaysOff, riskyToolsets, levelConfig, forbiddenOf, riskyOf, companyProfile, toolPolicy } from '../lib/agent-levels.mjs';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { provideProfile, configureProfile, readToolsets, readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn } from '../lib/hermes.mjs';
import { keepCompanyProfiles, keepAgentProfiles, checkAgentTools } from '../lib/company-profiles.mjs';
import { engineFor } from '../lib/engine.mjs';
import { changeCompanySignIn, readCompanySignIns } from '../lib/company-sign-in.mjs';
import { encryptSecret, decryptSecret } from '../lib/agent-crypto.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';

const encryptionKey=Buffer.alloc(32,9).toString('base64');
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
 for(const level of agentLevels.slice(1)) assert.ok(levelToolsets[level-1].every(name=>levelToolsets[level].includes(name)));
 // Disabling these composites would strip web search too (Hermes removes every tool of a disabled composite).
 for(const composite of ['debugging','safe']) assert.ok(!levelConfig(1).agent.disabled_toolsets.includes(composite));
 for(const bad of [0,4,'1',null]) assert.throws(()=>levelConfig(bad),/agentLevelInvalid/);
 assert.deepEqual(riskyOf(['web','file','terminal','memory']),['terminal','file']);
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
  const done=await keepCompanyProfiles(db,{hermes:install(fake),encryptionKey});
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
  for(const call of attached) {
   assert.doesNotMatch(call.args.bundled_key,/test-only-key/);
   assert.equal(decryptSecret(call.args.bundled_key,encryptionKey),'test-only-key');
   assert.ok(call.args.bundled_features.includes('run_submission'));
  }
  // Each company's Runs use its own profile: the attach tested that profile's Run API, not the shared one.
  assert.deepEqual(fake.settings.requests.filter(request=>request.path.endsWith('/health')).map(request=>request.path),profiles.map(name=>`/p/${name}/health`));
  // Nothing is left to do: asking again makes nothing.
  assert.equal(await keepCompanyProfiles(db,{hermes:install(fake),encryptionKey}).then(result=>result.provided),0);
 } finally { await fake.close(); }
});

test('a company on the shared profile moves only once its own profile holds a sign-in; a level change rewrites the tools', async () => {
 const fake=await fakeHermes();
 try {
  let clock=0; const waiting=new Map();
  const db=workerDatabase([row(three,{attach:false,move:true})]);
  const options={hermes:install(fake),encryptionKey,waiting,now:()=>clock};
  assert.deepEqual(await keepCompanyProfiles(db,options),{provided:1,configured:0,attached:0,moved:0});
  assert.ok(!db.calls.some(call=>call.name==='move_company_profile'),'no model sign-in yet: the company keeps running where it was');
  // A sign-in on the default profile, which Hermes would lend to the company profile, does not count as the company's.
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  clock+=60000;
  assert.equal((await keepCompanyProfiles(db,options)).moved,0,'an inherited sign-in never moves a company');
  delete fake.settings.defaultCredentials['openai-codex'];
  // The Owner signs in for the company; the next look (a minute later) moves it.
  const name=companyProfile(three);
  const started=await startSignIn({...install(fake),profile:name},'openai-codex');
  fake.settings.approve(started.session);
  clock+=1000;
  assert.equal((await keepCompanyProfiles(db,options)).moved,0,'asked at most once a minute');
  clock+=60000;
  assert.equal((await keepCompanyProfiles(db,options)).moved,1);
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

test('the tool health check records which Agents can reach a terminal, files or code', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const calls=[];
  const key=encryptSecret('test-only-key',encryptionKey);
  const db={rpc:async(rpc,args)=>{ calls.push({rpc,args});
   return rpc==='engine_tools_due'?{data:[{connection:'pasted',address:fake.address,profile:'writer',key_encrypted:key},{connection:'own',address:fake.address,profile:name,key_encrypted:key},
    {connection:'unreadable',address:fake.address,profile:'writer',key_encrypted:encryptSecret('wrong',encryptionKey)},
    {connection:'lost',address:fake.address,profile:companyProfile(three),key_encrypted:key}],error:null}:{data:null,error:null}; }};
  // The Engine lost one company profile (its data was not restored with a backup): the worker has it made again.
  fake.settings.unknownProfiles.push(companyProfile(three));
  assert.equal(await checkAgentTools(db,{encryptionKey}),2);
  assert.deepEqual(calls.filter(call=>call.rpc==='forget_company_profile').map(call=>call.args),[{connection:'lost'}]);
  // A pasted profile with Hermes's default tools has a terminal, files and code; the company profile has none.
  assert.deepEqual(calls.filter(call=>call.rpc==='record_engine_tools').map(call=>call.args),[{connection:'pasted',risky:['terminal','code_execution','file']},{connection:'own',risky:[]}]);
 } finally { await fake.close(); }
});

test('the sign-in driver passes on states, a code and an https link, never a credential', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const target={...install(fake),profile:name};
  // Hermes lets a profile with no credential of its own use the default profile's: that is never the company's own.
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  assert.deepEqual((await readSignIns(target)).signIns['openai-codex'],{connected:false,shared:true,flow:'device_code'});
  delete fake.settings.defaultCredentials['openai-codex'];
  assert.deepEqual(await readSignIns(target),{state:'found',signIns:{'openai-codex':{connected:false,shared:false,flow:'device_code'},anthropic:{connected:false,shared:false,flow:'external'}}});
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
  assert.ok(fake.settings.defaultCredentials['openai-codex']);
  assert.deepEqual(await disconnectSignIn(root,'openai-codex'),{state:'disconnected'});
  assert.deepEqual(await disconnectSignIn(root,'openai-codex'),{state:'nothing'});
  const cancelled=await startSignIn(root,'openai-codex');
  assert.deepEqual(await cancelSignIn(root,cancelled.session),{state:'cancelled'});
  assert.deepEqual(fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`),[
   'POST /api/providers/oauth/openai-codex/start',`GET /api/providers/oauth/openai-codex/poll/${atRoot.session}?profile=${name}`,
   `GET /api/providers/oauth/openai-codex/poll/${atRoot.session}`,'DELETE /api/providers/oauth/openai-codex','DELETE /api/providers/oauth/openai-codex',
   'POST /api/providers/oauth/openai-codex/start',`DELETE /api/providers/oauth/sessions/${cancelled.session}`]);
 } finally { await fake.close(); }
});

// The person's own session (is_company_owner, company_engine_target, record_subscription_change) and the service role
// reading the key. `oneCompany` is what the database says of the install, `agents` the Company's Agent profiles, and
// `logged` each change the Company's log was asked to record.
function sessions(fake,{owner,oneCompany=false,agents=[],logFails=false}) {
 const asked=[]; const logged=[];
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:companyProfile(args.c),one_company:oneCompany,profiles:[companyProfile(args.c),...agents]}],error:null};
  if(name==='record_subscription_change') { logged.push(args); return logFails?{data:null,error:{code:'XX000',message:'the database is down'}}:{data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}}; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})})};
 return {db,service,asked,logged};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
const pointedAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress});
 return {start:(target,provider)=>startSignIn(at(target),provider),poll:(target,provider,session)=>pollSignIn(at(target),provider,session),
  cancel:(target,session)=>cancelSignIn(at(target),session),disconnect:(target,provider)=>disconnectSignIn(at(target),provider),read:target=>readSignIns(at(target))}; };
const ask=(person,driver,change)=>changeCompanySignIn(person.db,person.service,{company:two,provider:'openai-codex',encryptionKey,driver,...change});
const states=read=>read.signIns&&Object.fromEntries(Object.entries(read.signIns).map(([id,found])=>[id,found.state]));
const signInPaths=fake=>fake.settings.managementRequests.filter(request=>request.path.startsWith('/api/providers/oauth/')).map(request=>`${request.method} ${request.path}`);

test('only an Owner starts, follows or removes a company sign-in, checked on the server for every step', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  for(const oneCompany of [false,true]) {
   const member=sessions(fake,{owner:false,oneCompany});
   for(const intent of ['start','poll','cancel','disconnect']) assert.deepEqual(await ask(member,driver,{intent,session:'abcdefgh'}),{status:403,body:{error:'signInNotAllowed'}});
   assert.deepEqual(member.logged,[]);
  }
  assert.equal(fake.settings.signInSessions.size,0,'a member never reaches Hermes');
  // A member still reads whether the company is connected.
  const member=sessions(fake,{owner:false});
  assert.deepEqual(await readCompanySignIns(member.db,member.service,{company:two,encryptionKey,driver}),{profile:companyProfile(two),oneCompany:false,signIns:{'openai-codex':{state:'notConnected',flow:'device_code'},anthropic:{state:'notConnected',flow:'external'}}});
  const owner=sessions(fake,{owner:true});
  const started=await ask(owner,driver,{intent:'start'});
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body).sort(),['code','expiresIn','interval','link','session']);
  const poll=()=>ask(owner,driver,{intent:'poll',session:started.body.session});
  assert.deepEqual(await poll(),{status:200,body:{status:'pending'}});
  fake.settings.approve(started.body.session);
  assert.deepEqual(await poll(),{status:200,body:{status:'approved'}});
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.equal(fake.settings.profiles.get(companyProfile(two)).credentials['openai-codex'],undefined);
  assert.deepEqual(owner.logged,[{c:two,provider:'openai-codex',connected:true,session:started.body.session},{c:two,provider:'openai-codex',connected:false,session:null}],'one log row asked for per connect and disconnect');
  assert.deepEqual(await ask(owner,driver,{provider:'anthropic',intent:'start'}),{status:409,body:{error:'signInTerminalOnly',profile:companyProfile(two)}});
  assert.deepEqual(await ask(owner,driver,{provider:'gemini',intent:'start'}),{status:400,body:{error:'signInInvalid'}});
 } finally { await fake.close(); }
});

const agentProfile='ag-a0000000000000000000000000000001';
test('on an install with one Company the Owner signs in once on the root profile, and an Agent profile with none of its own can then answer', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const engine=engineFor(install(fake));
  const provideWriter=()=>engine.provideAgent({name:agentProfile,instructions:'Write.',level:1});
  assert.deepEqual(await provideWriter(),{state:'noModel'},'no sign-in yet');
  const owner=sessions(fake,{owner:true,oneCompany:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver});
  assert.deepEqual(await read(),{profile:companyProfile(two),oneCompany:true,signIns:{'openai-codex':{state:'notConnected',flow:'device_code'},anthropic:{state:'notConnected',flow:'external'}}});
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

test('on one Company an older sign-in in the Company profile serves the main Agent only; Disconnect removes it, the root\'s and its Agents\', and no other Company\'s', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  for(const name of [companyProfile(two),agentProfile,companyProfile(three)]) await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const credentials=name=>fake.settings.profiles.get(name).credentials;
  credentials(companyProfile(two))['openai-codex']='company-codex-token';
  credentials(agentProfile)['openai-codex']='agent-codex-token';
  credentials(companyProfile(three))['openai-codex']='other-company-token';
  const owner=sessions(fake,{owner:true,oneCompany:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver});
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

test('on an install with several Companies a sign-in on the root profile shows as shared, and the Owner\'s steps never reach the root', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  const driver=pointedAt(fake);
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  const owner=sessions(fake,{owner:true,agents:[agentProfile]});
  const read=()=>readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver});
  assert.deepEqual(states(await read()),{'openai-codex':'shared',anthropic:'notConnected'});
  fake.settings.managementRequests.length=0;
  const started=await ask(owner,driver,{intent:'start'});
  assert.equal(fake.settings.signInSessions.get(started.body.session).profile,companyProfile(two));
  fake.settings.approve(started.body.session);
  assert.deepEqual(await ask(owner,driver,{intent:'poll',session:started.body.session}),{status:200,body:{status:'approved'}});
  assert.deepEqual(states(await read()),{'openai-codex':'shared',anthropic:'notConnected'},'never the Company\'s while the root holds one');
  assert.deepEqual(await ask(owner,driver,{intent:'disconnect'}),{status:200,body:{status:'disconnected'}});
  assert.ok(signInPaths(fake).every(path=>path.includes(`?profile=${companyProfile(two)}`)),signInPaths(fake).join('\n'));
  assert.equal(fake.settings.defaultCredentials['openai-codex'],'root-codex-token');
  delete fake.settings.defaultCredentials['openai-codex'];
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
  const owner=sessions(fake,{owner:true,oneCompany:true,logFails:true});
  const answers=[await readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver})];
  const started=await ask(owner,driver,{intent:'start'});
  fake.settings.approve(started.body.session);
  answers.push(started,await ask(owner,driver,{intent:'poll',session:started.body.session}));
  const approved=fake.settings.defaultCredentials['openai-codex'];
  answers.push(await readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver}),await ask(owner,driver,{intent:'disconnect'}),
   await readCompanySignIns(owner.db,owner.service,{company:two,encryptionKey,driver}));
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
 for(const language of ['en','ar']) for(const key of ['logActAgentLevel','logActAgentOwnProfile','agentLevel1','agentLevel3','agentToolWarning','signInTerminalOnly'])
  assert.notEqual(i18n(language).t(key),key,`${language}:${key}`);
});

test('the install job proves profiles per company on the pinned release, after the bundled Engine checks', async () => {
 const { load } = await import('js-yaml');
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
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
 assert.match(script,/person\.rpc\('decide_agent_rule',\{c:first\.company,item:item\.id,approve:true\}\)/);
 assert.match(script,/assert\.deepEqual\(lessons,\[true,true,false\]\)/);
 assert.match(script,/assert\.equal\(await skill\(spaceOf\(first\)\),written,'team-lessons is unchanged'\)/);
});

// The person's session and the service role, as sendMessage sees them; every call is recorded in order.
function conversationDatabases({profile,reserve=null,record=null}) {
 const order=[];
 const db={order,args:{},rpc:async(name,args)=>{ order.push(name); db.args[name]=args;
   if(name==='conversation_agent') return {data:null,error:null};
   // The sender's one entry point reserves the run when the Agent is free (reserve_conversation_turn, #team-work).
   if(name==='reserve_conversation_turn') return reserve||{data:{state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',note:null},error:null};
   if(name==='send_conversation_message') return record||{data:true,error:null};
   if(name==='release_conversation_run') return {data:true,error:null};
   return {data:null,error:{message:'unexpected'}}; },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{id:'a9000000-0000-0000-0000-000000000001'},error:null})}; return chain; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={rpc:async(name)=>{ order.push(`service ${name}`); return name==='begin_start'?{data:1,error:null}:name==='pin_run'?{data:{tools:null,rules:[]},error:null}:name==='pin_run_knowledge'?{data:[],error:null}:name==='pin_run_history'?{data:null,error:null}:{data:null,error:{message:'unexpected'}}; },from:table=>{ const filters={}; const chain={select:()=>chain,eq:(column,value)=>{filters[column]=value;return chain;},maybeSingle:async()=>{ order.push(`read ${table} ${filters.id||''}`);
   return table==='hermes_connections'?{data:{address:'http://hermes:8642',profile,state:'connected',features:['run_submission'],key_encrypted:key},error:null}:{data:{connection_id:'f9000000-0000-0000-0000-000000000099'},error:null}; }}; return chain; }};
 return {db,service,order};
}
const engine=order=>({engineFor:connection=>({start:async()=>{ order.push(`start ${connection.profile}`); return 'run_1'; }})});

test('a run is reserved on its pinned Connection before Hermes is called, and recorded after', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const {db,service,order}=conversationDatabases({profile:companyProfile(two)});
 const sent=await sendMessage(db,service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(order)});
 assert.deepEqual(sent,{conversation:'c'});
 // The reservation keeps the message for the record.
 assert.equal(db.args.reserve_conversation_turn.message,'Hi');
 // The record names the Connection the run started on, the one the reservation pinned.
 assert.equal(db.args.send_conversation_message.started_on,'f9000000-0000-0000-0000-000000000001');
 assert.deepEqual(order,['conversation_agent','reserve_conversation_turn','read hermes_connections f9000000-0000-0000-0000-000000000001','service pin_run','service pin_run_knowledge','service pin_run_history','service begin_start',`start ${companyProfile(two)}`,'send_conversation_message']);
});

test('a run never starts on another company\'s profile, nor while the profile\'s tools lag behind the level', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const borrowed=conversationDatabases({profile:companyProfile(three)});
 assert.deepEqual(await sendMessage(borrowed.db,borrowed.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(borrowed.order)}),{error:'conversationNotFound',status:404});
 assert.ok(!borrowed.order.some(step=>step.startsWith('start')));
 const pending=conversationDatabases({profile:companyProfile(two),reserve:{data:null,error:{code:'55000',message:'agentLevelPending'}}});
 assert.deepEqual(await sendMessage(pending.db,pending.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(pending.order)}),{error:'conversationAgentLevelPending',status:409});
 assert.ok(!pending.order.some(step=>step.startsWith('start')));
});

test('the level table is versioned: any change to it needs a new policy, in the code and in the database', () => {
 // The fingerprint of each policy's table. Changing the table without a new toolPolicy (and its migration) fails here.
 const fingerprints={2:'863aa8ac90a8fce674cf7880e0e63444c107d9051d7b95f9e861a58ac437da4d'};
 const table=JSON.stringify(agentLevels.map(level=>levelConfig(level)));
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
  assert.deepEqual(await keepCompanyProfiles(db,{hermes:install(fake),encryptionKey}),{provided:0,configured:1,attached:0,moved:0});
  assert.deepEqual(db.calls.map(call=>call.name),['company_profile_work','begin_company_tools','record_company_profile']);
  assert.equal(db.calls[2].args.policy,toolPolicy);
  assert.ok(!(await readToolsets({address:fake.address,profile:name,key:'test-only-key'})).toolsets.includes('connections'),'the old policy\'s connectors are gone');
 } finally { await fake.close(); }
});

test('raised, written, not recorded, then lowered: the profile stays pending until the read-back of the lower level is recorded', async () => {
 const fake=await fakeHermes();
 try {
  const name=companyProfile(two);
  await provideProfile(install(fake),{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const failing=workerDatabase([row(two,{attach:false,agent_level:3,tools_level:1,tools_policy:toolPolicy})],{failRecord:true});
  await keepCompanyProfiles(failing,{hermes:install(fake),encryptionKey});
  assert.ok(fake.settings.profiles.get(name).config.platform_toolsets.api_server.includes('cronjob'),'Hermes has level 3');
  assert.equal(failing.rows[0].tools_pending,true,'marked before writing, never cleared');
  // The Owner lowers to 1: the levels agree, but the pending mark keeps it work and runs refused until the read-back.
  failing.rows[0].agent_level=1;
  const db=workerDatabase(failing.rows);
  assert.equal((await keepCompanyProfiles(db,{hermes:install(fake),encryptionKey})).configured,1);
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
 assert.deepEqual(await sendMessage(late.db,late.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(late.order)}),{error:'conversationSendAgain',status:409});
 for(const language of ['en','ar']) assert.notEqual(i18n(language).t('conversationSendAgain'),'conversationSendAgain');
});

test('a run that never started releases its reservation at once; a started one leaves it to the record', async () => {
 const {sendMessage}=await import('../lib/conversation-runs.mjs');
 const refused=conversationDatabases({profile:companyProfile(two)});
 const refusing={engineFor:connection=>({start:async()=>{ refused.order.push(`start ${connection.profile}`); return null; }})};
 assert.deepEqual(await sendMessage(refused.db,refused.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...refusing}),{error:'conversationHermesFailed',status:502});
 assert.deepEqual(refused.order.slice(-2),[`start ${companyProfile(two)}`,'release_conversation_run']);
 assert.deepEqual(refused.db.args.release_conversation_run,{conversation:'c',c:two,message_key:'k',attempt:1});
 // A Connection that cannot be used never reaches the engine, and its reservation is released too.
 const borrowed=conversationDatabases({profile:companyProfile(three)});
 assert.deepEqual(await sendMessage(borrowed.db,borrowed.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(borrowed.order)}),{error:'conversationNotFound',status:404});
 assert.equal(borrowed.order.at(-1),'release_conversation_run');
 // A run that started is recorded, never released: the record ends its reservation.
 const started=conversationDatabases({profile:companyProfile(two)});
 assert.deepEqual(await sendMessage(started.db,started.service,{person:'p',company:two,conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(started.order)}),{conversation:'c'});
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
   if(failRecord||args.engine_profile!==row.profile||args.policy!==toolPolicy) return {data:null,error:{message:'agentProfileInvalid'}};
   Object.assign(row,{tools_level:args.level,tools_policy:args.policy,tools_pending:false}); return {data:null,error:null};
  }
  if(name==='forget_company_profile') { const lost=rows.find(found=>found.connection===args.connection); Object.assign(lost,{tools_level:null,tools_policy:null,tools_pending:false}); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const [writer,critic]=['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'];
const agentRow=(agent,extra={})=>({agent_id:agent,profile:`ag-${agent.replaceAll('-','')}`,agent_level:1,tools_level:1,tools_policy:toolPolicy,tools_pending:false,instructions:`You are ${agent}.`,...extra});
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
 assert.deepEqual(db.log.filter(({name})=>name==='record_agent_profile').map(({args})=>args),[writer,critic].map(agent=>({agent,engine_profile:`ag-${agent.replaceAll('-','')}`,level:3,policy:toolPolicy})));
 assert.ok(db.rows.every(row=>row.tools_level===3&&!row.tools_pending));
 db.log.length=0;
 assert.deepEqual(await keepAgentProfiles(db,{hermes:hermesOf,driver:recordingDriver(db.log)}),{provided:0,configured:0});
 assert.deepEqual(db.log.map(({name})=>name),['agent_profile_work']);
 assert.deepEqual(await keepAgentProfiles(db,{hermes:null}),{provided:0,configured:0});
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
  const db=agentWorkerDatabase([agentRow(writer,{connection:'own',instructions:'You are the writer.'})]);
  const tools={rpc:async(rpc,args)=>rpc==='engine_tools_due'?{data:[{connection:'own',address:fake.address,profile:name,key_encrypted:encryptSecret('test-only-key',encryptionKey)}],error:null}:db.rpc(rpc,args)};
  assert.equal(await checkAgentTools(tools,{encryptionKey}),0);
  assert.deepEqual(db.log.map(({name:called,args})=>[called,args]),[['forget_company_profile',{connection:'own'}]]);
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await keepAgentProfiles(db,{hermes:install(fake)}),{provided:1,configured:0});
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(created.body,{name,soul:'You are the writer.'},'made, never cloned from another profile');
  const profile=fake.settings.profiles.get(name);
  assert.deepEqual([profile.key,profile.credentials,profile.config],['test-only-key',{},levelConfig(1)]);
  assert.deepEqual(db.rows[0],{...agentRow(writer,{connection:'own',instructions:'You are the writer.'})});
 } finally { await fake.close(); }
});
