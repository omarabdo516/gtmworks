import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamLessons, keepSharedSkills } from '../lib/shared-skills.mjs';
import { knowledgeSkill, readKnowledge, saveKnowledge } from '../lib/company-knowledge-skill.mjs';
import { provideSharedSpace, writeSharedSkill, shareSkills } from '../lib/hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// One shared Skills folder per Company (#122, ADR 0016): the worker makes each Company's shared space once, writes the
// lessons its Owners and Managers approved there as "team-lessons", and has every Agent profile of the Company read
// that folder alone, auto-load the Skill and hold it locked.
const [rs,aleem]=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003'];
const hex=id=>id.replaceAll('-','');
const space=company=>`cs-${hex(company)}`;
const folder=company=>`/opt/data/profiles/${space(company)}/skills`;
const [lead,moved,made]=['co-'+hex(rs),'ag-a0000000000000000000000000000001','ag-a0000000000000000000000000000002'];
const aleemLead='co-'+hex(aleem);
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const skillOf=(fake,company)=>fake.settings.skills.get(space(company))?.get('team-lessons');
const requests=fake=>fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`);

test('the Skill holds one line per lesson, oldest first, each folded to one line', () => {
 const head='---\nname: team-lessons\ndescription: Lessons the team approved for every agent\n---\nLessons the team approved. Follow each one.\n\n';
 assert.ok(/^description: (.{1,60})$/m.test(teamLessons([])),'a description of at most 60 characters');
 assert.equal(teamLessons([]),`${head}None yet.\n`);
 assert.equal(teamLessons(['  Write every Saudi ad\n\tin a light   dialect ','No emojis']),`${head}- Write every Saudi ad in a light dialect\n- No emojis\n`);
 assert.equal(teamLessons(['---\nname: other']),`${head}- --- name: other\n`,'a lesson never opens a line of its own');
 const many=Array.from({length:300},(_,n)=>`${n}`.padStart(500,'x'));
 const kept=teamLessons(many);
 assert.ok(kept.length<=100000,'within the Engine\'s limit');
 assert.ok(kept.endsWith(`- ${many.at(-1)}\n`)&&!kept.includes(`- ${many[0]}\n`),'the newest lessons are kept');
});

// The worker's database, as shared_skills_work and the record functions answer (supabase/tests/shared_skills.sql proves
// them): each Company's profiles not yet confirmed, its space's folder once recorded, and its approved lessons.
function sharedDatabase(companies) {
 const spaces=new Map(); const shared=new Set(); const calls=[];
 const rpc=async(name,args)=>{
  calls.push(`${name}${args?.engine_profile?` ${args.engine_profile}`:args?.c?` ${args.c}`:''}`);
  if(name==='shared_skills_work') return {data:Object.entries(companies).map(([company,{profiles,rules}])=>({company_id:company,profile:space(company),folder:spaces.get(company)??null,
   lessons:rules.filter(rule=>rule.suggestion==='approved'&&!rule.removed).map(rule=>rule.body),profiles:profiles.filter(profile=>!shared.has(profile)).map(profile=>({profile}))})),error:null};
  if(name==='record_shared_space') { if(!spaces.has(args.c)) spaces.set(args.c,args.folder); return {data:spaces.get(args.c),error:null}; }
  if(name==='record_shared_skills') { const own=spaces.has(args.c)&&companies[args.c].profiles.includes(args.engine_profile); if(own) shared.add(args.engine_profile); return {data:own,error:null}; }
  if(name==='forget_shared_space') { spaces.delete(args.c); for(const profile of companies[args.c].profiles) shared.delete(profile); return {data:null,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 return {rpc,calls,spaces,shared};
}
// Profiles the Engine already has, each with its Run API key, as the profile loops leave them.
const profilesOn=(fake,names)=>{ for(const name of names) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}}); };

test('a Company\'s shared space is made once, also by two workers at once, and no Run can start on it', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead]);
  const db=sharedDatabase({[rs]:{profiles:[lead],rules:[]}});
  await Promise.all([keepSharedSkills(db,{hermes:install(fake)}),keepSharedSkills(db,{hermes:install(fake)})]);
  assert.deepEqual([...fake.settings.profiles.keys()].filter(name=>name.startsWith('cs-')),[space(rs)],'one space');
  assert.deepEqual(db.spaces,new Map([[rs,folder(rs)]]));
  const made=fake.settings.managementRequests.filter(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(made.map(request=>request.body),[{name:space(rs),no_skills:true},{name:space(rs),no_skills:true}],'made with no bundled Skills, never cloned');
  assert.deepEqual(requests(fake).filter(request=>request.startsWith('PUT /api/env')),[],'the space is given no Run API key');
  for(const path of ['/v1/capabilities','/v1/runs']) {
   const run=await fetch(`${fake.address}/p/${space(rs)}${path}`,{method:path==='/v1/runs'?'POST':'GET',headers:{Authorization:'Bearer test-only-key','Content-Type':'application/json'},body:path==='/v1/runs'?'{"input":"hello"}':undefined});
   assert.equal(run.status,401,path);
  }
  assert.equal(fake.settings.runs.length,0);
  assert.equal(skillOf(fake,rs),teamLessons([]));
  const before=requests(fake).length;
  await keepSharedSkills(db,{hermes:install(fake)});
  assert.deepEqual(requests(fake).slice(before),[`GET /api/skills/content?profile=${space(rs)}&name=team-lessons`,`GET /api/skills/content?profile=${space(rs)}&name=company-knowledge`],'a made space is never made again');
 } finally { await fake.close(); }
});

test('the main Agent\'s, a new Agent\'s and a moved Agent\'s profiles read their Company\'s folder alone, auto-load the Skill and lock it', async () => {
 const fake=await fakeHermes();
 try {
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
  fake.settings.defaultCredentials['openai-codex']='root-codex-token';
  profilesOn(fake,[lead,aleemLead]);
  // The new Agent's profile as Lead's call makes it, and the moved Agent's as its move makes it.
  const engine=engineFor(install(fake));
  for(const name of [made,moved]) assert.equal((await engine.provideAgent({name,instructions:'You write.',level:1})).state,'provided');
  const db=sharedDatabase({[rs]:{profiles:[made,moved,lead],rules:[]},[aleem]:{profiles:[aleemLead],rules:[]}});
  const pass=fake.settings.managementRequests.length;
  assert.deepEqual(await keepSharedSkills(db,{hermes:install(fake)}),{made:2,written:2,shared:4});
  const passed=fake.settings.managementRequests.slice(pass);
  for(const [company,profiles] of [[rs,[made,moved,lead]],[aleem,[aleemLead]]]) for(const profile of profiles) {
   const asked=passed.filter(request=>request.method==='PUT'&&request.path.endsWith(`?profile=${profile}`));
   assert.deepEqual(asked.map(request=>[request.path.split('?')[0],request.body]),[
    ['/api/config',{config:{skills:{external_dirs:[folder(company)],auto_load:['team-lessons']}}}],
    ['/api/skills/lock',{name:'team-lessons',locked:true}],
    ['/api/config',{config:{skills:{external_dirs:[folder(company)],auto_load:['team-lessons','company-knowledge']}}}],
    ['/api/skills/lock',{name:'company-knowledge',locked:true}]],profile);
   assert.deepEqual(fake.settings.profiles.get(profile).config.skills,{external_dirs:[folder(company)],auto_load:['team-lessons','company-knowledge']},profile);
   assert.ok(fake.settings.skillLocks.has(`${profile}:team-lessons`),profile);
  }
  for(const request of passed) {
   const named=[rs,aleem].filter(company=>request.path.includes(hex(company))||JSON.stringify(request.body??'').includes(hex(company)));
   assert.ok(named.length<=1,`${request.method} ${request.path} names one Company only`);
  }
  assert.deepEqual([...db.shared].sort(),[made,moved,lead,aleemLead].sort());
  const before=requests(fake).length;
  assert.deepEqual(await keepSharedSkills(db,{hermes:install(fake)}),{made:0,written:0,shared:0});
  assert.deepEqual(requests(fake).slice(before).filter(request=>!request.startsWith('GET')),[],'a confirmed profile and an unchanged Skill are written nothing');
 } finally { await fake.close(); }
});

test('an approved lesson is in the Skill after one pass, once; a refused one never; a removed one is gone after the next', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead]);
  const rules=[{body:'From now on, write every Saudi ad in a light dialect',suggestion:'pending'},{body:'From now on, no emojis',suggestion:'pending'},{body:'Told directly',suggestion:null}];
  const db=sharedDatabase({[rs]:{profiles:[lead],rules}});
  const pass=async()=>{ await keepSharedSkills(db,{hermes:install(fake)}); return skillOf(fake,rs); };
  assert.equal(await pass(),teamLessons([]),'nothing waiting or told directly is written');
  rules[0].suggestion='approved';
  const approved=await pass();
  assert.equal(approved.split('\n').filter(line=>line==='- From now on, write every Saudi ad in a light dialect').length,1);
  rules[1].suggestion='rejected';
  assert.equal(await pass(),approved,'a refused one never is');
  rules[0].removed=true;
  assert.equal(await pass(),teamLessons([]),'a removed one is gone');
 } finally { await fake.close(); }
});

test('writing twice, or with two workers at once, leaves the same text', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead]);
  const rules=[{body:'No emojis',suggestion:'approved'},{body:'Sign every reply',suggestion:'approved'}];
  const db=sharedDatabase({[rs]:{profiles:[lead],rules}});
  await keepSharedSkills(db,{hermes:install(fake)});
  rules.push({body:'Answer within the hour',suggestion:'approved'});
  await Promise.all([keepSharedSkills(db,{hermes:install(fake)}),keepSharedSkills(db,{hermes:install(fake)})]);
  const text=teamLessons(rules.map(rule=>rule.body));
  assert.equal(skillOf(fake,rs),text);
  const before=requests(fake).length;
  await keepSharedSkills(db,{hermes:install(fake)});
  assert.equal(skillOf(fake,rs),text);
  assert.deepEqual(requests(fake).slice(before).filter(request=>!request.startsWith('GET')),[],'the same text is not written again');
 } finally { await fake.close(); }
});

test('a space the Engine lost is forgotten, and made again with its Skill and its profiles on the next pass', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead]);
  const db=sharedDatabase({[rs]:{profiles:[lead],rules:[{body:'No emojis',suggestion:'approved'}]}});
  // #772: a Company whose row did not change is checked again by the slow pass for drift, five minutes on.
  let clock=1e6; const options={hermes:install(fake),memory:{marks:new Map(),drift:0},now:()=>clock};
  await keepSharedSkills(db,options);
  // The space's folder is recorded by the first pass, so the second reads the row it then keeps.
  clock+=1000; await keepSharedSkills(db,options);
  fake.settings.profiles.delete(space(rs)); fake.settings.skills.delete(space(rs));
  clock+=1000; await keepSharedSkills(db,options);
  assert.deepEqual([db.spaces.size,db.shared.size],[1,1],'nothing is asked of the Engine while the row is unchanged');
  clock+=300000; await keepSharedSkills(db,options);
  assert.deepEqual([db.spaces.size,db.shared.size],[0,0],'the drift pass finds the space lost: it is forgotten and its Company\'s profiles wait');
  clock+=1000; assert.deepEqual(await keepSharedSkills(db,options),{made:1,written:1,shared:1});
  assert.equal(skillOf(fake,rs),teamLessons(['No emojis']));
 } finally { await fake.close(); }
});

test('a profile with its own team-lessons keeps it and stays unconfirmed, and the space and the other profiles are kept', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead,made]);
  const own='---\nname: team-lessons\ndescription: The Agent\'s own\n---\nMine.\n';
  fake.settings.skills.set(made,new Map([['team-lessons',own]]));
  const db=sharedDatabase({[rs]:{profiles:[lead,made],rules:[]}});
  for(let pass=0;pass<2;pass++) await keepSharedSkills(db,{hermes:install(fake)});
  assert.deepEqual(db.calls.filter(call=>call.startsWith('forget_shared_space')),[],'the space is never forgotten');
  assert.deepEqual([...db.shared],[lead],'only the profile that reads the shared Skill is confirmed');
  assert.equal(fake.settings.skills.get(made).get('team-lessons'),own,'the profile\'s own Skill is kept');
 } finally { await fake.close(); }
});

test('every profile also auto-loads the Company knowledge, company-knowledge, and holds it locked; the worker makes it empty once and never rewrites what people saved', async () => {
 const fake=await fakeHermes();
 try {
  profilesOn(fake,[lead]);
  const db=sharedDatabase({[rs]:{profiles:[lead],rules:[]}});
  await keepSharedSkills(db,{hermes:install(fake)});
  assert.equal(fake.settings.skills.get(space(rs)).get('company-knowledge'),knowledgeSkill({}));
  assert.deepEqual(fake.settings.profiles.get(lead).config.skills,{external_dirs:[folder(rs)],auto_load:['team-lessons','company-knowledge']});
  assert.ok(fake.settings.skillLocks.has(`${lead}:company-knowledge`));
  assert.deepEqual([...db.shared],[lead]);
  const people={rpc:async(name,args)=>name==='check_company_knowledge'?{data:args.body,error:null}:{data:null,error:null}};
  assert.equal(await saveKnowledge(people,install(fake),{company:rs,part:'voice',body:'Like a colleague.'}),'companyKnowledgeSaved');
  db.shared.clear();
  await keepSharedSkills(db,{hermes:install(fake)});
  assert.deepEqual((await readKnowledge(install(fake),rs)).parts,{voice:'Like a colleague.'},'saved knowledge is kept');
 } finally { await fake.close(); }
});

// The worker with a fake driver: every call, in order, in one log the database shares.
function drivenDatabase(work,{fail}={}) {
 const log=[];
 return {log,rpc:async(name,args)=>{
  log.push(`${name}${args?.engine_profile?` ${args.engine_profile}`:args?.c?` ${args.c}`:''}`);
  if(fail===`${name} ${args?.c}`) return {data:null,error:{message:`${name} refused`}};
  if(name==='shared_skills_work') return {data:work,error:null};
  if(name==='record_shared_space') return {data:args.folder,error:null};
  if(name==='record_shared_skills') return {data:true,error:null};
  if(name==='forget_shared_space') return {data:null,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
}
const answering=(log,states={})=>({
 provide:async(_,{name})=>{ log.push(`provide ${name}`); return states.provide?.(name)??{state:'provided',folder:`/opt/data/profiles/${name}/skills`}; },
 write:async(_,{space:name,content})=>{ log.push(`write ${name} ${content.split('\n').filter(line=>line.startsWith('- ')).length}`); return {state:states.write?.(name)??'written'}; },
 share:async(_,{profile,folder:read,skill})=>{ log.push(`share ${profile} ${read} ${skill}`); return {state:states.share?.(profile)??'shared'}; }});
const row=(company,extra={})=>({company_id:company,profile:space(company),folder:null,lessons:['No emojis'],profiles:[{profile:'co-'+hex(company)}],...extra});

test('the worker makes the space, records it, writes the lessons, then shares each profile and records it; one Company never holds back another', async () => {
 const db=drivenDatabase([row(rs,{profiles:[{profile:made},{profile:lead}]}),row(aleem,{folder:folder(aleem)})],{fail:`record_shared_space ${rs}`});
 const logged=[]; const error=console.error; console.error=(...args)=>{ logged.push(args.join(' ')); };
 try { assert.deepEqual(await keepSharedSkills(db,{hermes:{address:'http://hermes:8642',profile:'default',key:'k'},driver:answering(db.log)}),{made:0,written:1,shared:1}); }
 finally { console.error=error; }
 assert.deepEqual(db.log,['shared_skills_work',`provide ${space(rs)}`,`record_shared_space ${rs}`,
  `write ${space(aleem)} 1`,`write ${space(aleem)} 0`,`share ${aleemLead} ${folder(aleem)} team-lessons`,`share ${aleemLead} ${folder(aleem)} company-knowledge`,`record_shared_skills ${aleemLead}`]);
 assert.deepEqual(logged,[`Shared Skills not kept: ${rs} record_shared_space refused`]);

 const ok=drivenDatabase([row(rs,{profiles:[{profile:made},{profile:lead}]})]);
 await keepSharedSkills(ok,{hermes:{address:'http://hermes:8642',profile:'default',key:'k'},driver:answering(ok.log,{share:profile=>profile===made?'refused':'shared'})});
 assert.deepEqual(ok.log,['shared_skills_work',`provide ${space(rs)}`,`record_shared_space ${rs}`,`write ${space(rs)} 1`,`write ${space(rs)} 0`,
  `share ${made} ${folder(rs)} team-lessons`,`share ${made} ${folder(rs)} company-knowledge`,`share ${lead} ${folder(rs)} team-lessons`,`share ${lead} ${folder(rs)} company-knowledge`,`record_shared_skills ${lead}`],'a profile the Engine did not confirm is not recorded');
 assert.deepEqual(await keepSharedSkills(ok,{hermes:null,driver:answering(ok.log)}),{made:0,written:0,shared:0});
});

test('no profile is pointed at a folder whose Skill could not be written, and a lost space or Skill is forgotten', async () => {
 for(const state of ['failed','refused','unreachable']) {
  const db=drivenDatabase([row(rs,{folder:folder(rs)})]);
  await keepSharedSkills(db,{hermes:{address:'http://hermes:8642',profile:'default',key:'k'},driver:answering(db.log,{write:()=>state})});
  assert.deepEqual(db.log,['shared_skills_work',`write ${space(rs)} 1`],state);
 }
 const lostSpace=drivenDatabase([row(rs,{folder:folder(rs)})]);
 await keepSharedSkills(lostSpace,{hermes:{address:'http://hermes:8642',profile:'default',key:'k'},driver:answering(lostSpace.log,{write:()=>'missing'})});
 assert.deepEqual(lostSpace.log,['shared_skills_work',`write ${space(rs)} 1`,`forget_shared_space ${rs}`]);
 const lostSkill=drivenDatabase([row(rs,{folder:folder(rs),profiles:[{profile:made},{profile:lead}]})]);
 await keepSharedSkills(lostSkill,{hermes:{address:'http://hermes:8642',profile:'default',key:'k'},driver:answering(lostSkill.log,{share:()=>'missing'})});
 assert.deepEqual(lostSkill.log,['shared_skills_work',`write ${space(rs)} 1`,`write ${space(rs)} 0`,`share ${made} ${folder(rs)} team-lessons`,`forget_shared_space ${rs}`]);
});

test('the driver asks the Engine about reserved names only, and a refused key is refused', async () => {
 const fake=await fakeHermes();
 try {
  const hermes=install(fake);
  assert.deepEqual(await provideSharedSpace(hermes,{name:'co-'+hex(rs)}),{state:'failed',folder:null});
  assert.deepEqual(await provideSharedSpace(hermes,{name:'default'}),{state:'failed',folder:null});
  assert.deepEqual(await writeSharedSkill(hermes,{space:lead,name:'team-lessons',content:'x'}),{state:'failed'});
  for(const profile of [space(rs),'default','writer']) assert.deepEqual(await shareSkills(hermes,{profile,folder:folder(rs),skill:'team-lessons'}),{state:'failed'},profile);
  assert.deepEqual(fake.settings.managementRequests,[]);
  const refused={...hermes,key:'wrong-key'};
  assert.deepEqual(await provideSharedSpace(refused,{name:space(rs)}),{state:'refused',folder:null});
  assert.deepEqual(await writeSharedSkill(refused,{space:space(rs),name:'team-lessons',content:'x'}),{state:'refused'});
  assert.deepEqual(await shareSkills(refused,{profile:lead,folder:folder(rs),skill:'team-lessons'}),{state:'refused'});
  assert.deepEqual(await provideSharedSpace({...hermes,address:'http://8.8.8.8:8642',managementAddress:undefined},{name:space(rs)}),{state:'unreachable',folder:null});
 } finally { await fake.close(); }
});
