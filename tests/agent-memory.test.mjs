import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMemoryNotes, resetMemory } from '../lib/hermes.mjs';
import { readAgentMemory, resetAgentMemory } from '../lib/agent-memory.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// An Agent's memory (#350) belongs to its own Hermes profile (ADR 0016, ADR 0017) and gtmworks keeps no copy: the
// contract lists that profile's notes through the learning routes, which also hold skills, so no skill is ever listed
// or touched, and a reset clears that one profile's notes and nothing else.
const company='10000000-0000-0000-0000-000000000001';
const [ads,seo]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021'];
const hex=id=>id.replaceAll('-','');
const adsProfile=`ag-${hex(ads)}`; const seoProfile=`ag-${hex(seo)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
// Two Agents of one Company with their own notes, and a skill beside the notes of the first.
async function twoAgents() {
 const fake=await fakeHermes();
 profileOn(fake,adsProfile); profileOn(fake,seoProfile);
 fake.settings.memory.set(adsProfile,{memory:['Prefers short subject lines.','Never mention prices before the offer.'],profile:['Omar works in Cairo.']});
 fake.settings.memory.set(seoProfile,{memory:['Writes for people who already know the product.'],profile:[]});
 fake.settings.skills.set(adsProfile,new Map([['weekly-ads-recap','---\nname: weekly-ads-recap\ndescription: Recaps the week.\n---\nWrite the recap.\n']]));
 return fake;
}
// The signed-in person's own session: company_app_agents lists the Agents they see, and the memory functions answer
// their Role (`refuse` names the refusal). Every log_memory_reset call is kept.
function session({agents,refuse=null}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_memory_reset') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_memory_reset') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,logged};
}
const rows=[
 {agent:ads,name:'Meta Ads',connection:'f0000000-0000-0000-0000-000000000011',profile:adsProfile,main:false,own:true},
 {agent:seo,name:'SEO',connection:'f0000000-0000-0000-0000-000000000021',profile:seoProfile,main:false,own:true},
];

test('the notes of one Agent\'s profile are listed with their id and text, and a skill beside them never is', async () => {
 const fake=await twoAgents();
 try {
  const read=await readMemoryNotes(at(fake,adsProfile));
  assert.equal(read.state,'found');
  assert.deepEqual(read.notes.map(note=>note.text),[
   'Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
  for(const note of read.notes) {
   assert.match(note.id,/^memory:(memory|profile):\d{1,9}:[0-9a-f]{12}$/,note.id);
   assert.ok(!note.id.includes('weekly-ads-recap'));
  }
  // The skill sits in the same graph; the contract never asks for it, so it can never be returned.
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).includes('weekly-ads-recap')));
  assert.ok(fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/learning/graph')));
  // Another Agent's profile is read on its own, never mixed in.
  const other=await readMemoryNotes(at(fake,seoProfile));
  assert.deepEqual(other.notes.map(note=>note.text),['Writes for people who already know the product.']);
 } finally { await fake.close(); }
});

test('a reset clears one Agent\'s memory only: the other Agent\'s notes and the skill stay', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  assert.equal((await resetMemory(at(fake,adsProfile))).state,'reset');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes,[]);
  assert.equal((await readMemoryNotes(at(fake,seoProfile))).notes.length,1,'the other Agent keeps its notes');
  assert.ok(fake.settings.skills.get(adsProfile)?.has('weekly-ads-recap'),'the skill is not touched');
  assert.ok(before.notes.length>0);
  const reset=fake.settings.managementRequests.filter(request=>request.method==='POST'&&String(request.path).startsWith('/api/memory/reset'));
  assert.equal(reset.length,1);
  assert.match(String(reset[0].path),new RegExp(`profile=${adsProfile}`));
  assert.deepEqual(reset[0].body,{target:'all'},'the Engine is always sent the profile it clears');
 } finally { await fake.close(); }
});

test('a profile the Engine no longer serves is missing, a refused key is refused, and no memory of a stranger is read', async () => {
 const fake=await twoAgents();
 try {
  fake.settings.unknownProfiles.push(adsProfile); fake.settings.profiles.delete(adsProfile);
  assert.equal((await readMemoryNotes(at(fake,adsProfile))).state,'unreachable');
  // A profile that is not an Agent's or a Company's own is never read at all.
  for(const profile of ['default','writer','ag-not-a-name']) assert.deepEqual(await readMemoryNotes(at(fake,profile)),{state:'failed',notes:null});
 } finally { await fake.close(); }
});

test('a Member reads the notes of the Agent they see, with whether it is the main one', async () => {
 const fake=await twoAgents();
 try {
  const {db}=session({agents:rows});
  const read=await readAgentMemory(db,{company,agent:ads,hermes:install(fake)});
  assert.equal(read.state,'found');
  assert.equal(read.main,false);
  assert.deepEqual(read.notes.map(note=>note.text),[
   'Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
  const main=await readAgentMemory(session({agents:rows.map(row=>row.agent===ads?{...row,main:true}:row)}).db,{company,agent:ads,hermes:install(fake)});
  assert.equal(main.main,true,'the main Agent is named as the main one (#121)');
 } finally { await fake.close(); }
});

test('an Agent hidden from the reader is not found, and their memory is never asked of the Engine', async () => {
 const fake=await twoAgents();
 try {
  const {db}=session({agents:[rows[1]]});
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await readAgentMemory(db,{company,agent:ads,hermes:install(fake)}),{state:'missing',main:false,notes:null});
  assert.deepEqual(await resetAgentMemory(db,{company,agent:ads,hermes:install(fake)}),{state:'missing'});
  assert.equal(fake.settings.managementRequests.length,0,'nothing reaches the Engine for an Agent the reader does not see');
 } finally { await fake.close(); }
});

test('only the Owner resets: a refused Role changes nothing and logs nothing, and a reset logs one row with no note text', async () => {
 const fake=await twoAgents();
 try {
  const refused=session({agents:rows,refuse:'memoryNotAllowed'});
  assert.deepEqual(await resetAgentMemory(refused.db,{company,agent:ads,hermes:install(fake)}),{state:'notAllowed'});
  assert.equal(fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/memory/reset')).length,0);
  assert.deepEqual(refused.logged,[]);
  const owner=session({agents:rows});
  assert.deepEqual(await resetAgentMemory(owner.db,{company,agent:ads,hermes:install(fake)}),{state:'reset'});
  assert.deepEqual(owner.logged,[{c:company,agent:ads}],'one row, naming the Agent and nothing of its notes');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes,[]);
 } finally { await fake.close(); }
});
