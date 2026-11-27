import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { addCardFile, readCardFile, cardFileLimit } from '../lib/company-card-files.mjs';
import { readCompanyCard } from '../lib/company-card.mjs';

// Spec #831 (#843): a person adds a file to a Card, and every Member who sees the Card reads it back; a file the Agent
// named by a MEDIA line is read from its own work folder in the work sandbox, and says it cannot be read now when the
// sandbox is stopped. Both through gtmworks, by the file's key on the Card, never a path or an Engine address.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
const omar='20000000-0000-0000-0000-000000000001';
const reader=()=>({rpc:async name=>{
 if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(name==='company_app_agents') return {data:agents,error:null};
 return {data:null,error:{message:`unexpected ${name}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,maybeSingle:async()=>table==='kanban_cards'?{data:null,error:null}:table==='people'?{data:{name:'Omar Abdo'},error:null}:{data:null,error:{message:table}}};
 return read;
}});
const text=bytes=>new TextDecoder().decode(bytes);

test('a person\'s file is added to the Card on the Engine under their name, and read back by its key', async () => {
 const fake=await engineServing(company);
 try {
  const id=fake.settings.kanban.task({title:'Course reel',status:'ready',assignee:profileOf(ads)}).id;
  const body=new TextEncoder().encode('the brief');
  assert.deepEqual(await addCardFile(reader(),{company,card:id,person:omar,file:{name:'brief.txt',type:'text/plain',body}}),{state:'attached'});
  const [kept]=fake.settings.kanban.attachments;
  assert.equal(kept.filename,'brief.txt');
  assert.equal(kept.uploaded_by,'Omar Abdo');
  assert.equal(text(kept.body),'the brief');
  const card=(await readCompanyCard(reader(),{company,card:id})).card;
  const listed=card.files.find(file=>file.name==='brief.txt');
  assert.deepEqual(listed.by,{person:'Omar Abdo'});
  const read=await readCardFile(reader(),{company,card:id,file:listed.key});
  assert.equal(read.state,'found');
  assert.equal(read.name,'brief.txt');
  assert.equal(read.type,'application/octet-stream','anything but a raster image downloads');
  assert.equal(text(read.body),'the brief');
  // A picture is served as one, so it is drawn as a thumbnail.
  assert.deepEqual(await addCardFile(reader(),{company,card:id,person:omar,file:{name:'still.png',type:'image/png',body}}),{state:'attached'});
  assert.equal((await readCardFile(reader(),{company,card:id,file:'a2'})).type,'image/png');
 } finally { await fake.close(); }
});

test('a file past the Engine\'s cap is refused before anything is sent, and no key reads what the Card does not hold', async () => {
 const fake=await engineServing(company);
 try {
  const id=fake.settings.kanban.task({title:'Course reel',status:'ready',assignee:profileOf(ads)}).id;
  const other=fake.settings.kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  fake.settings.kanban.attach(other,{filename:'keywords.csv',body:'a,b'});
  const before=fake.settings.managementRequests.length;
  assert.equal(cardFileLimit,25*1024*1024);
  assert.deepEqual(await addCardFile(reader(),{company,card:id,person:omar,file:{name:'film.mov',type:'video/quicktime',body:new Uint8Array(cardFileLimit+1)}}),{state:'tooLarge'});
  assert.equal(fake.settings.managementRequests.length,before,'nothing reached the Engine');
  assert.equal(fake.settings.kanban.attachments.length,1);
  // Another Card's file by its id, a Card of an Agent hidden from the reader, and a key of no shape are all missing.
  assert.deepEqual(await readCardFile(reader(),{company,card:id,file:'a1'}),{state:'missing'});
  assert.deepEqual(await readCardFile(reader(),{company,card:other,file:'a1'}),{state:'missing'});
  assert.deepEqual(await readCardFile(reader(),{company,card:id,file:'a1/../2'}),{state:'missing'});
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/plugins/kanban/attachments/')));
  assert.deepEqual(await addCardFile(reader(),{company,card:other,person:omar,file:{name:'x.txt',type:'text/plain',body:new Uint8Array(1)}}),{state:'missing'});
 } finally { await fake.close(); }
});

test('a file the Agent named is read from its own work folder in the sandbox, and cannot be read now while it is stopped', async () => {
 const fake=await engineServing(company);
 try {
  const ad=profileOf(ads);
  fake.settings.profiles.set(ad,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.files.set(`/opt/data/work/${ad}`,[{name:'reel',isFolder:true}]);
  fake.settings.files.set(`/opt/data/work/${ad}/reel`,[{name:'final.mp4',size:9}]);
  fake.settings.fileBytes.set(`/opt/data/work/${ad}/reel/final.mp4`,{body:'the reel!',type:'video/mp4'});
  const id=fake.settings.kanban.task({title:'Course reel',status:'done',assignee:ad}).id;
  fake.settings.kanban.run(id,{profile:ad,status:'done',outcome:'completed',ended_at:3,summary:`Cut.\nMEDIA:/work/${ad}/reel/final.mp4\nMEDIA:/opt/data/auth.json`});
  const read=await readCardFile(reader(),{company,card:id,file:'s0'});
  assert.equal(read.state,'found');
  assert.equal(read.name,'final.mp4');
  assert.equal(text(read.body),'the reel!');
  assert.ok(fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/fs/download?')&&String(request.path).includes(encodeURIComponent(`/work/${ad}/reel/final.mp4`))),'read in the sandbox');
  // A tag outside the Agent's own folder is never asked for.
  assert.deepEqual(await readCardFile(reader(),{company,card:id,file:'s1'}),{state:'missing'});
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).includes('auth.json')));
  fake.settings.sandboxDown=true;
  assert.deepEqual(await readCardFile(reader(),{company,card:id,file:'s0'}),{state:'notNow'});
 } finally { await fake.close(); }
});
