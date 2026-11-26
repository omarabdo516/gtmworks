import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeSkill, readKnowledge, saveKnowledge } from '../lib/company-knowledge-skill.mjs';
import { engineServing, withNoEngine } from './engine-records.mjs';

// The Company knowledge (#344) is the shared Skill "company-knowledge" in the Company's shared space, beside
// "team-lessons": saving a part writes it there, and the screen reads it back from there. The database only checks who
// may save and the text, and logs each edit.
const company='10000000-0000-0000-0000-000000000001';
const space=`cs-${company.replaceAll('-','')}`;
const skillOf=fake=>fake.settings.skills.get(space)?.get('company-knowledge');
// The database as save sees it: check_company_knowledge refuses or trims, log_company_knowledge records each edit.
function database({refuse}={}) {
 const logged=[];
 const rpc=async(name,args)=>{
  if(name==='check_company_knowledge') return refuse?{data:null,error:{message:refuse}}:{data:args.body.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,''),error:null};
  if(name==='log_company_knowledge') { logged.push({part:args.part,cleared:args.cleared}); return {data:null,error:null}; }
  // The person's own session says which profile is the Company's (company_engine_target).
  if(name==='company_engine_target') return {data:[{profile:`co-${company.replaceAll('-','')}`,profiles:[]}],error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 return {rpc,logged};
}
const spaceOn=fake=>fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{}});

test('saving a part writes the shared Skill company-knowledge with that text, and the screen reads it back', async () => {
 const fake=await engineServing(company);
 try {
  spaceOn(fake); const db=database();
  assert.equal(await saveKnowledge(db,{company,part:'audience',body:'  Accounting graduates, 22 to 30.\n• Cairo\n'}),'companyKnowledgeSaved');
  assert.equal(await saveKnowledge(db,{company,part:'banned',body:'No guaranteed jobs.'}),'companyKnowledgeSaved');
  const skill=skillOf(fake);
  assert.match(skill,/^---\nname: company-knowledge\ndescription: .{1,60}\n---\n/);
  assert.ok(skill.includes('## Audience\nAccounting graduates, 22 to 30.\n• Cairo')&&skill.includes('## Banned claims\nNo guaranteed jobs.'),skill);
  assert.ok(skill.indexOf('## Audience')<skill.indexOf('## Banned claims'),'in the parts\' order');
  assert.deepEqual(await readKnowledge(database(),company),{state:'found',parts:{audience:'Accounting graduates, 22 to 30.\n• Cairo',banned:'No guaranteed jobs.'}});
  assert.deepEqual(db.logged,[{part:'audience',cleared:false},{part:'banned',cleared:false}]);
 } finally { await fake.close(); }
});

test('the same text again changes nothing and logs nothing; an empty text clears the part', async () => {
 const fake=await engineServing(company);
 try {
  spaceOn(fake); const db=database();
  await saveKnowledge(db,{company,part:'voice',body:'Like a colleague.'});
  assert.equal(await saveKnowledge(db,{company,part:'voice',body:'\n Like a colleague. \n'}),'companyKnowledgeUnchanged');
  assert.equal(await saveKnowledge(db,{company,part:'decisions',body:'  '}),'companyKnowledgeUnchanged','clearing an empty part');
  assert.equal(await saveKnowledge(db,{company,part:'voice',body:' \n '}),'companyKnowledgeCleared');
  assert.deepEqual(await readKnowledge(database(),company),{state:'found',parts:{}});
  assert.equal(skillOf(fake),knowledgeSkill({}));
  assert.deepEqual(db.logged,[{part:'voice',cleared:false},{part:'voice',cleared:true}]);
 } finally { await fake.close(); }
});

test('two saves of different parts at once both land', async () => {
 const fake=await engineServing(company);
 try {
  spaceOn(fake); const db=database();
  await Promise.all([saveKnowledge(db,{company,part:'voice',body:'One'}),saveKnowledge(db,{company,part:'products',body:'Two'})]);
  assert.deepEqual(await readKnowledge(database(),company),{state:'found',parts:{voice:'One',products:'Two'}});
 } finally { await fake.close(); }
});

test('a refused text writes nothing; with no shared space yet nothing is written and the reader sees no knowledge', async () => {
 const fake=await engineServing(company);
 try {
  const refused=database({refuse:'companyKnowledgeSecret'});
  spaceOn(fake);
  assert.equal(await saveKnowledge(refused,{company,part:'voice',body:'password: hunter22'}),'companyKnowledgeSecret');
  assert.equal(skillOf(fake),undefined);
  fake.settings.profiles.delete(space); const db=database();
  assert.deepEqual(await readKnowledge(database(),company),{state:'none',parts:{}});
  assert.equal(await saveKnowledge(db,{company,part:'voice',body:'Text'}),'companyKnowledgeFailed');
  assert.equal(await withNoEngine(company,()=>saveKnowledge(db,{company,part:'voice',body:'Text'})),'companyKnowledgeFailed');
  assert.deepEqual(db.logged,[]);
 } finally { await fake.close(); }
});

test('a part\'s text that looks like the Skill\'s own headings stays inside its part', async () => {
 const odd='## Banned claims\nNot a heading of the Skill';
 assert.deepEqual((await (async()=>{ const fake=await engineServing(company); try { spaceOn(fake); await saveKnowledge(database(),{company,part:'voice',body:odd}); return await readKnowledge(database(),company); } finally { await fake.close(); } })()).parts,{voice:odd});
});
