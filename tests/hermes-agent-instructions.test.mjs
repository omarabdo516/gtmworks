import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAgentInstructions, writeAgentInstructions, writeSoulRules } from '../lib/hermes.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #176: an Agent's standing instructions are the text of its own profile's SOUL.md outside the gtmworks rules section
// (#345). The Owner's save replaces only that text, keeps the section as it is when the write lands, and counts the
// section against the size the Engine loads (context_file_max_chars when the profile sets a positive one, else 20,000).
const ads='ag-a0000000000000000000000000000001';
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:ads,key:fake.settings.key});
const profileOn=(fake,meta={})=>fake.settings.profiles.set(ads,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},...meta});
const section='<!-- gtmworks:rules -->\n## Rules the team gave you\n- Be brief\n<!-- /gtmworks:rules -->';

test('the instructions read the text outside the rules section, with the section size and the limit the Engine loads',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{soul:`You are Ads.\nWrite short copy.\n\n${section}\n`,config:{context_file_max_chars:5000}});
  assert.deepEqual(await readAgentInstructions(connection(fake),ads),
   {state:'found',instructions:'You are Ads.\nWrite short copy.',sectionChars:section.length,limit:5000});
  // No positive setting means the Engine's own floor; a number written as text counts too.
  profileOn(fake,{soul:'Just these words.'});
  assert.deepEqual(await readAgentInstructions(connection(fake),ads),
   {state:'found',instructions:'Just these words.',sectionChars:0,limit:20000});
  for(const set of [0,-1,'3000',null]) {
   profileOn(fake,{soul:'Words.',config:{context_file_max_chars:set}});
   assert.equal((await readAgentInstructions(connection(fake),ads)).limit,set==='3000'?3000:20000,String(set));
  }
  assert.equal((await readAgentInstructions(connection(fake),'not a profile')).state,'missing');
  fake.settings.managementStatus=401;
  assert.equal((await readAgentInstructions(connection(fake),ads)).state,'refused');
 } finally { await fake.close(); }
});

test('a save replaces only the text outside the section and keeps the section as it stands',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{soul:`Old words.\n\n${section}\n`});
  const written=await writeAgentInstructions(connection(fake),{profile:ads,instructions:'New words.\nA second line.'});
  assert.deepEqual(written,{state:'written',instructions:'New words.\nA second line.',sectionChars:section.length,limit:20000});
  assert.equal(fake.settings.profiles.get(ads).soul,`New words.\nA second line.\n${section}\n`,'the section is kept and the text around it replaced');
  const put=fake.settings.managementRequests.filter(request=>request.method==='PUT').at(-1);
  assert.equal(put.path,`/api/profiles/${ads}/soul`);
  assert.equal(put.body.content,`New words.\nA second line.\n${section}\n`);
  assert.deepEqual(await readAgentInstructions(connection(fake),ads),
   {state:'found',instructions:'New words.\nA second line.',sectionChars:section.length,limit:20000});
  // A profile with no section, and an Owner who empties the field: the file is the owner's text alone.
  profileOn(fake,{soul:'Old words.\n'});
  assert.deepEqual(await writeAgentInstructions(connection(fake),{profile:ads,instructions:''}),{state:'written',instructions:'',sectionChars:0,limit:20000});
  assert.equal(fake.settings.profiles.get(ads).soul,'');
  // The same text is not written again.
  const puts=fake.settings.managementRequests.filter(request=>request.method==='PUT').length;
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:''})).state,'written');
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,puts);
 } finally { await fake.close(); }
});

test('the rules the worker writes between the page load and the save are kept',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{soul:'The words the page read.\n'});
  assert.equal((await readAgentInstructions(connection(fake),ads)).instructions,'The words the page read.');
  // The worker writes the team's rules while the Owner has the page open.
  assert.equal((await writeSoulRules(connection(fake),{profile:ads,rules:['Answer every question within a day']})).state,'written');
  assert.match(fake.settings.profiles.get(ads).soul,/Answer every question within a day/);
  // The Owner's save re-reads just before writing: the new rules section is kept, the owner's text replaces the old.
  const written=await writeAgentInstructions(connection(fake),{profile:ads,instructions:'The words the Owner saved.'});
  assert.equal(written.state,'written');
  const soul=fake.settings.profiles.get(ads).soul;
  assert.equal(soul,`The words the Owner saved.\n${soul.match(/<!-- gtmworks:rules -->[\s\S]*<!-- \/gtmworks:rules -->/)[0]}\n`,'the section written meanwhile is the one kept');
  assert.match(soul,/Answer every question within a day/);
  assert.ok(!soul.includes('The words the page read.'),'the old text is gone');
 } finally { await fake.close(); }
});

test('text that with the section is larger than the Engine loads is refused, and nothing is written',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{soul:`Words.\n${section}\n`,config:{context_file_max_chars:section.length+5}});
  const puts=fake.settings.managementRequests.filter(request=>request.method==='PUT').length;
  assert.deepEqual(await writeAgentInstructions(connection(fake),{profile:ads,instructions:'123456'}),
   {state:'tooLong',instructions:null,sectionChars:section.length,limit:section.length+5});
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,puts,'a refused save writes nothing');
  // The section alone leaves exactly five characters for the owner's text.
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:'12345'})).state,'written');
  assert.equal(fake.settings.profiles.get(ads).soul,`12345\n${section}\n`);
 } finally { await fake.close(); }
});

test('a profile the Engine does not have is missing, and a refused or failed Engine is that state',async()=>{
 const fake=await fakeHermes();
 try {
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:'Words.'})).state,'missing');
  profileOn(fake,{soul:'Words.'});
  fake.settings.managementStatus=401;
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:'Other words.'})).state,'refused');
  fake.settings.managementStatus=500;
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:'Other words.'})).state,'failed');
  assert.equal((await writeAgentInstructions(connection(fake),{profile:'not a profile',instructions:'Words.'})).state,'failed');
  assert.equal((await writeAgentInstructions(connection(fake),{profile:ads,instructions:7})).state,'failed');
 } finally { await fake.close(); }
});
