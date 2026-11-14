import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentLevels, levelToolsets, alwaysOff, riskyToolsets, levelConfig, forbiddenOf, riskyOf, companyProfile } from '../lib/agent-levels.mjs';
import { provideProfile, configureProfile, readToolsets, readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn } from '../lib/hermes.mjs';
import { keepCompanyProfiles, checkAgentTools } from '../lib/company-profiles.mjs';
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
 assert.ok(levelToolsets[2].includes('connections')&&!levelToolsets[2].includes('cronjob')&&levelConfig(2).agent.disabled_toolsets.includes('cronjob'));
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
 assert.match(readFileSync('supabase/migrations/20261208000000_company_profiles.sql','utf8'),/'co-'\|\|replace\(c::text,'-',''\)/);
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
  assert.ok(three.toolsets.includes('cronjob')&&three.toolsets.includes('connections'));
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
function workerDatabase(rows) {
 const calls=[];
 return {calls,rows,rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='company_profile_work') return {data:rows.filter(row=>row.attach||row.move||row.tools_level!==row.agent_level).map(row=>({...row})),error:null};
  if(name==='record_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.tools_level=args.level; return {data:null,error:null}; }
  if(name==='attach_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.attach=false; return {data:true,error:null}; }
  if(name==='move_company_profile') { const row=rows.find(found=>found.company_id===args.c); row.move=false; return {data:1,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const row=(company,extra={})=>({company_id:company,profile:companyProfile(company),agent_level:1,tools_level:null,attach:true,move:false,...extra});

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
  assert.deepEqual(await readSignIns(target),{state:'found',signIns:{'openai-codex':{connected:false,flow:'device_code'},anthropic:{connected:false,flow:'external'}}});
  const started=await startSignIn(target,'openai-codex');
  assert.equal(started.state,'started');
  assert.equal(started.code,'ABCD-1234');
  assert.equal(started.link,'https://auth.openai.com/codex/device');
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
  const again=await startSignIn(target,'openai-codex');
  assert.deepEqual(await cancelSignIn(target,again.session),{state:'cancelled'});
  assert.deepEqual(await pollSignIn(target,'openai-codex',again.session),{state:'expired'});
  assert.equal((await startSignIn(target,'gemini')).state,'failed');
  assert.equal((await startSignIn({...target,key:'wrong'},'openai-codex')).state,'refused');
 } finally { await fake.close(); }
});

// The person's own session (is_company_owner, company_engine_target) and the service role reading the key.
function sessions(fake,{owner}) {
 const asked=[];
 const db={rpc:async(name,args)=>{ asked.push(name);
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:companyProfile(args.c)}],error:null};
  return {data:null,error:{message:'unexpected'}}; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})})};
 return {db,service,asked};
}

test('only an Owner starts, follows or removes a company sign-in, checked on the server for every step', async () => {
 const fake=await fakeHermes({managementPort:0});
 try {
  // The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
  const driver={start:(target,provider)=>startSignIn({...target,managementAddress:fake.managementAddress},provider),
   poll:(target,provider,session)=>pollSignIn({...target,managementAddress:fake.managementAddress},provider,session),
   disconnect:(target,provider)=>disconnectSignIn({...target,managementAddress:fake.managementAddress},provider),
   read:target=>readSignIns({...target,managementAddress:fake.managementAddress})};
  await provideProfile(install(fake),{name:companyProfile(two),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  const member=sessions(fake,{owner:false});
  for(const intent of ['start','poll','cancel','disconnect']) {
   const refused=await changeCompanySignIn(member.db,member.service,{company:two,provider:'openai-codex',intent,session:'abcdefgh',encryptionKey,driver});
   assert.deepEqual(refused,{status:403,body:{error:'signInNotAllowed'}});
  }
  assert.equal(fake.settings.signInSessions.size,0,'a member never reaches Hermes');
  // A member still reads whether the company is connected.
  assert.deepEqual(await readCompanySignIns(member.db,member.service,{company:two,encryptionKey,driver}),{profile:companyProfile(two),signIns:{'openai-codex':{connected:false,flow:'device_code'},anthropic:{connected:false,flow:'external'}}});
  const owner=sessions(fake,{owner:true});
  const started=await changeCompanySignIn(owner.db,owner.service,{company:two,provider:'openai-codex',intent:'start',encryptionKey,driver});
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body).sort(),['code','expiresIn','interval','link','session']);
  const poll=()=>changeCompanySignIn(owner.db,owner.service,{company:two,provider:'openai-codex',intent:'poll',session:started.body.session,encryptionKey,driver});
  assert.deepEqual(await poll(),{status:200,body:{status:'pending'}});
  fake.settings.approve(started.body.session);
  assert.deepEqual(await poll(),{status:200,body:{status:'approved'}});
  assert.deepEqual(await changeCompanySignIn(owner.db,owner.service,{company:two,provider:'openai-codex',intent:'disconnect',encryptionKey,driver}),{status:200,body:{status:'disconnected'}});
  assert.equal(fake.settings.profiles.get(companyProfile(two)).credentials['openai-codex'],undefined);
  assert.deepEqual(await changeCompanySignIn(owner.db,owner.service,{company:two,provider:'anthropic',intent:'start',encryptionKey,driver}),{status:409,body:{error:'signInTerminalOnly',profile:companyProfile(two)}});
  assert.deepEqual(await changeCompanySignIn(owner.db,owner.service,{company:two,provider:'gemini',intent:'start',encryptionKey,driver}),{status:400,body:{error:'signInInvalid'}});
 } finally { await fake.close(); }
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
});
