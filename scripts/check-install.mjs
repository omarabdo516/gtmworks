// CI runs this on stdin inside /app in the installed web container, using its HTTP APIs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const {engineFor}=await import(`${process.cwd()}/lib/engine.mjs`);
const {registerEngine}=await import(`${process.cwd()}/lib/engine-record.mjs`);
const {writeSoulRules,provideSharedSpace,writeSharedSkill,readSharedSkill}=await import(`${process.cwd()}/lib/hermes.mjs`);
const {knowledgeSkill}=await import(`${process.cwd()}/lib/company-knowledge-skill.mjs`);

const seed=process.argv[2]==='seed';
const origin='http://gateway:8080';
const admin=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const credentials={email:'restore@example.com',password:'Install-restore-239!'};
const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
// The Agents' profiles, rules, knowledge, skills, memory and history live only in the bundled Engine's volume (#349): a
// rule and the Company knowledge are written through the engine contract before the backup and read back after the
// restore, so a backup that left the volume out fails here.
assert.ok(process.env.HERMES_API_KEY,'the install key is in the web container');
const engine={address:process.env.BUNDLED_HERMES_URL,profile:'default',key:process.env.HERMES_API_KEY};
// An Agent profile the worker writes no rules into, so only the Engine's volume can give the rule back after a restore.
const ruleProfile='ag-00000000000000000000000000000349';
const rule='Always close the install check with the line keep this rule.';
const knowledge='The install check calls its customers partners.';
const spaceOf=company=>`cs-${String(company).replaceAll('-','')}`;
if(seed) {
 const {user}=await checked(admin.auth.admin.createUser({...credentials,email_confirm:true}));
 await checked(admin.from('people').insert({id:user.id,name:'Restore Person'}));
 const companies=[];
 for(const slug of ['restore-one','restore-two']) {
  // Like bootstrap-owner and the test seed, supply the UUID; companies.id has no default. A Company is made only onto a
  // waiting Engine record (#380), so the install's Engine is registered first.
  const company=randomUUID();
  await registerEngine(admin,{address:engine.address,key:engine.key});
  const created=await checked(admin.from('companies').insert({id:company,slug,name:slug}).select().single());
  companies.push(created.id);
  await checked(admin.from('members').insert({company_id:company,person_id:user.id,role:'contributor'}));
  // A card waiting on the person, with one stored file, written by the server (the external-agent API is gone, #341).
  const stage=await checked(admin.from('work_stages').select('id').eq('company_id',company).eq('kind','ideas').single());
  const card=await checked(admin.from('work_cards').insert({company_id:company,stage_id:stage.id,title:`Keep ${slug}`,next_actor:user.id}).select('id').single());
  const path=`${company}/${card.id}/keep.txt`;
  await checked(admin.storage.from('creatives').upload(path,new Blob([`File for ${slug}`],{type:'text/plain'})));
  const creative=await checked(admin.from('work_creatives').insert({company_id:company,card_id:card.id,name:'keep.txt'}).select('id').single());
  await checked(admin.from('work_versions').insert({company_id:company,card_id:card.id,creative_id:creative.id,path}));
 }
 // An Agent with a rule in its SOUL.md, and each Company's knowledge in its shared space (ADR 0016, #344).
 const agent=await engineFor(engine).createAgent({name:ruleProfile,instructions:'You are the install check Agent.'});
 assert.ok(['created','exists'].includes(agent.state),`the Agent profile: ${agent.state}`);
 const ruled=await writeSoulRules(engine,{profile:ruleProfile,rules:[rule]});
 assert.ok(['written','unchanged'].includes(ruled.state),`the Agent rule: ${ruled.state}`);
 for(const company of companies) {
  // The worker makes a shared space only for a Company with a recorded profile, which these have not: the check makes it.
  const space=await provideSharedSpace(engine,{name:spaceOf(company)});
  assert.equal(space.state,'provided',`the shared space of ${company}`);
  const {state}=await writeSharedSkill(engine,{space:spaceOf(company),name:'company-knowledge',content:knowledgeSkill({voice:knowledge})});
  assert.ok(['written','unchanged'].includes(state),`the Company knowledge of ${company}: ${state}`);
 }
}
// Read back from the Engine's volume: the seed reads what it just wrote, and verify reads the volume a restore put back.
const kept=await engineFor(engine).readAgent(ruleProfile);
assert.equal(kept.state,'found','the restored volume holds the Agent profile');
assert.ok(kept.agent.instructions.includes(rule),'the restored volume holds the Agent rule');
const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const {user}=await checked(person.auth.signInWithPassword(credentials));
assert.equal((await checked(person.from('people').select('name').eq('id',user.id).single())).name,'Restore Person');
for(const slug of ['restore-one','restore-two']) {
 const company=await checked(person.from('companies').select().eq('slug',slug).single());
 assert.equal(company.name,slug);
 const found=await readSharedSkill(engine,{space:spaceOf(company.id),name:'company-knowledge'});
 assert.equal(found.state,'found',`the Company knowledge of ${slug}: ${found.state}`);
 assert.ok(found.content.includes(knowledge),`the Company knowledge of ${slug} is in the restored volume`);
 assert.equal((await checked(person.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).single())).role,'contributor');
 const cards=await checked(person.from('work_cards').select('id,title').eq('company_id',company.id).eq('next_actor',user.id));
 assert.equal(cards.length,1); assert.equal(cards[0].title,`Keep ${slug}`);
 const versions=await checked(person.from('work_versions').select('id,path').eq('company_id',company.id).eq('card_id',cards[0].id));
 assert.equal(versions.length,1);
 const {signedUrl}=await checked(admin.storage.from('creatives').createSignedUrl(versions[0].path,3600));
 const response=await fetch(signedUrl); assert.equal(response.status,200);
 assert.equal(await response.text(),`File for ${slug}`);
 console.log(JSON.stringify({person:user.id,company:company.id,card:cards[0].id,version:versions[0].id,rule:ruleProfile,knowledge:found.state}));
}
