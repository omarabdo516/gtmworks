import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepReplyFiles, replyFilePath } from '../lib/reply-files.mjs';
import { shownReply } from '../lib/media-tags.mjs';
import { engineServing } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';

// #708, ADR 0028: an Agent hands a file it made in its own work folder by a `MEDIA:` line in its reply. gtmworks reads
// the file from that folder only, keeps it with the reply in the place's private folder, and takes the tag out of the
// text; a tag it cannot serve is named as a file that could not be attached, never shown as a path.
const company='10000000-0000-0000-0000-000000000001';
const place={company,folder:'conversations',scope:'c7080000-0000-0000-0000-000000000001'};
const profile='ag-2441b28395d20b822aa2dde51994e662';
const work={
 [`report:market.pdf`]:{type:'application/pdf',body:new Uint8Array([37,80,68,70])},
 [`report:page-01.jpg`]:{type:'application/octet-stream',body:new Uint8Array([255,216,255])},
 [`:big.zip`]:'tooLarge',
};
function drivers() {
 const asked=[]; const stored=[];
 const download=async(connection,{folder,name,root})=>{
  asked.push({profile:connection.profile,folder,name,root});
  const found=work[`${folder}:${name}`];
  if(!found) return {state:'missing'};
  if(typeof found==='string') return {state:found};
  return {state:'found',name,type:found.type,size:found.body.byteLength,body:found.body};
 };
 const upload=async(path,body,type)=>{ stored.push({path,size:body.byteLength,type}); };
 return {asked,stored,download,upload};
}
// The profile's handle as the closer holds it: its files capability reads the stand-in work folder above.
const keep=(reply,d)=>keepReplyFiles({engine:{profile,files:{download:file=>d.download({profile},file)}},place,run:'run_966dd48422f548c4bfc49c01bca5aa9a',reply,upload:d.upload});
// The Company's Engine on the wire, its Agent's work folder holding the report (tests/fake-hermes.mjs).
async function workFolder() {
 const fake=await engineServing(company);
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.files.set(`/opt/data/work/${profile}/report`,[{name:'market.pdf',size:4,mtime:1764000000}]);
 fake.settings.fileBytes.set(`/opt/data/work/${profile}/report/market.pdf`,{body:new Uint8Array([37,80,68,70]),type:'application/pdf'});
 return fake;
}

test('a PDF and a JPG in the Agent\'s own work folder become two files of the reply, and the tags leave its text',async()=>{
 const d=drivers();
 const kept=await keep(`Here is the report.\nMEDIA:/work/${profile}/report/market.pdf\nMEDIA: /work/${profile}/report/page-01.jpg\nRead page 1 first.`,d);
 assert.equal(kept.reply,'Here is the report.\nRead page 1 first.');
 assert.deepEqual(kept.missed,[]);
 assert.deepEqual(kept.files.map(({position,name,content_type,size})=>({position,name,content_type,size})),[
  {position:0,name:'market.pdf',content_type:'application/pdf',size:4},
  {position:1,name:'page-01.jpg',content_type:'image/jpeg',size:3}]);
 assert.deepEqual(d.asked.map(({profile:p,folder,name,root})=>[p,folder,name,root]),[[profile,'report','market.pdf','work'],[profile,'report','page-01.jpg','work']]);
 assert.deepEqual(d.stored.map(file=>file.path),[replyFilePath(place,'run_966dd48422f548c4bfc49c01bca5aa9a',0),replyFilePath(place,'run_966dd48422f548c4bfc49c01bca5aa9a',1)]);
 assert.match(d.stored[0].path,new RegExp(`^${company}/conversations/${place.scope}/reply-[0-9a-f]{32}-0$`));
});

test('a tag outside the Agent\'s own work folder reads nothing, and the reply names the file instead of its path',async()=>{
 const d=drivers();
 const kept=await keep(['MEDIA:/opt/data/auth.json',`MEDIA:/work/${profile}/../ag-other/secret.pdf`,'MEDIA:/work/ag-00000000000000000000000000000000/report/market.pdf',
  `MEDIA:/work/${profile}/.hermes/x.pdf`,'Done.'].join('\n'),d);
 assert.deepEqual(d.asked,[],'no other folder is ever asked for');
 assert.equal(kept.reply,'Done.');
 assert.deepEqual(kept.files,[]);
 assert.deepEqual(kept.missed,['auth.json','secret.pdf','market.pdf','x.pdf']);
 assert.doesNotMatch(JSON.stringify(kept),/\/opt\/data|\/work\//);
});

test('a missing file, one over the size served and a relative path are told apart from a delivered one',async()=>{
 const d=drivers();
 const kept=await keep('`MEDIA:report/market.pdf` and MEDIA:"big.zip" and MEDIA:gone.pdf.',d);
 assert.deepEqual(kept.files.map(file=>file.name),['market.pdf'],'a path relative to the work folder is the Agent\'s own');
 assert.deepEqual(kept.missed,['big.zip','gone.pdf']);
 assert.equal(kept.reply,'and and.');
});

test('a path from the Agent\'s folder with a space or no extension is still a tag, and a reply keeps twenty names at most',async()=>{
 const d=drivers();
 const kept=await keep(`MEDIA:/work/${profile}/report/my report.pdf\nMEDIA:/work/${profile}/Makefile\n${Array.from({length:25},(_,n)=>`MEDIA:/opt/data/x${n}.pdf`).join('\n')}`,d);
 assert.equal(kept.reply,'');
 assert.equal(kept.missed.length,20);
 assert.deepEqual(kept.missed.slice(0,2),['my report.pdf','Makefile']);
});

test('a reply of file tags alone keeps an empty text, and the same file named twice is one file',async()=>{
 const d=drivers();
 const kept=await keep(`MEDIA:/work/${profile}/report/market.pdf\nMEDIA:/work/${profile}/report/market.pdf`,d);
 assert.equal(kept.reply,'');
 assert.equal(kept.files.length,1);
});

test('a reply shown later never shows a tag: what is left of one is named as a file that could not be attached',()=>{
 assert.deepEqual(shownReply(`See:\nMEDIA:/work/${profile}/report/report-page-01.jpg\nthanks`),{body:'See:\nthanks',missed:['report-page-01.jpg']});
 assert.deepEqual(shownReply('No files here: a MEDIA team.'),{body:'No files here: a MEDIA team.',missed:[]});
 assert.deepEqual(shownReply('Plan for Social MEDIA: tips, posts and ads.'),{body:'Plan for Social MEDIA: tips, posts and ads.',missed:[]},'words after the tag\'s name in a sentence are no file');
});

test('a Conversation\'s finished Run is closed with the files its reply hands over, kept in the Conversation\'s folder',async()=>{
 const { closeOpenRuns }=await import('../lib/conversation-runs.mjs');
 const conversation='c7080000-0000-0000-0000-000000000002';
 const open={message:1,company,conversation,run:'run_14e4b42663b646029c0198fd2d50badb',person:'p',profile};
 const closes=[]; const uploads=[];
 const db={
  rpc:async(name,args)=>{
   if(name==='open_conversation_runs') return {data:closes.length?[]:[open],error:null};
   if(name==='track_run_question'||name==='track_run_permission') return {data:[],error:null};
   if(name==='close_conversation_run') { closes.push(args); return {data:true,error:null}; }
   return {data:null,error:{message:`unexpected ${name}`}};
  },
  storage:{from:bucket=>({upload:async(path,body,options)=>{ uploads.push({bucket,path,type:options.contentType,upsert:options.upsert}); return {error:null}; }})},
 };
 const engine={read:async()=>({state:'completed',reply:`تمام، التقرير أهو.\nMEDIA:/work/${profile}/report/market.pdf\nMEDIA:/opt/data/auth.json`,session:'s1',usage:null,toolCalls:[]})};
 const fake=await workFolder();
 try { assert.equal(await withEngineContract(()=>/** @type {any} */(engine),()=>closeOpenRuns(db,{conversation})),1); } finally { await fake.close(); }
 assert.equal(closes.length,1);
 assert.equal(closes[0].reply,'تمام، التقرير أهو.');
 assert.deepEqual(closes[0].missed_files,['auth.json']);
 assert.deepEqual(closes[0].reply_files.map(file=>file.name),['market.pdf']);
 assert.deepEqual(uploads,[{bucket:'creatives',path:replyFilePath({company,folder:'conversations',scope:conversation},open.run,0),type:'application/pdf',upsert:true}]);
});

test('a channel reply is closed with its file, kept in the channel\'s folder for every Member of it',async()=>{
 const { driveChannelRuns }=await import('../lib/channel-runs.mjs');
 const channel='69000000-0000-0000-0000-000000000001'; const closes=[]; const uploads=[];
 const service={
  rpc:async(name,args)=>{
   if(name==='channel_runs_due') return {data:closes.length?[]:[{message:7,run:'run_708_channel',profile,ordinal:1,company}],error:null};
   if(name==='track_channel_question'||name==='track_channel_permission') return {data:[],error:null};
   if(name==='close_channel_run') { closes.push(args); return {data:true,error:null}; }
   return {data:null,error:{message:`unexpected ${name}`}};
  },
  from:table=>({select:()=>({eq:(_column,id)=>({eq:(by,c)=>({single:async()=>table==='channel_messages'&&id===7&&by==='company_id'&&c===company?{data:{channel_id:channel},error:null}:{data:null,error:{message:'no row'}}})})})}),
  storage:{from:()=>({upload:async path=>{ uploads.push(path); return {error:null}; }})},
 };
 const engine={read:async()=>({state:'completed',reply:`MEDIA:/work/${profile}/report/market.pdf`,session:null,usage:null,toolCalls:[]})};
 const fake=await workFolder();
 try { await withEngineContract(()=>/** @type {any} */(engine),()=>driveChannelRuns(service,{})); } finally { await fake.close(); }
 assert.equal(closes.length,1);
 assert.equal(closes[0].reply,'');
 assert.deepEqual(closes[0].reply_files.map(file=>file.name),['market.pdf']);
 assert.deepEqual(uploads,[replyFilePath({company,folder:'channels',scope:channel},'run_708_channel',0)]);
});

test('a file name with several dots is read whole, and a path with backslashes is named by its last part alone',()=>{
 assert.deepEqual(shownReply(`Here: MEDIA:/work/${profile}/report.v2.pdf.\nAnd MEDIA:C:\\private\\report.pdf`),{body:'Here:.\nAnd',missed:['report.v2.pdf','report.pdf']});
});

test('a start the previous release sent without the file note is retried with that body, which Hermes replays',async()=>{
 const { hermesEngine }=await import('../lib/engine/contract.mjs');
 const bodies=[]; const real=globalThis.fetch;
 // Hermes holds the key for the body the previous release sent: no instructions at all (api_server_runs.py, 409).
 globalThis.fetch=async(_url,request)=>{
  const body=JSON.parse(request.body); bodies.push(body);
  return body.instructions?new Response(JSON.stringify({error:{code:'idempotency_key_conflict'}}),{status:409}):new Response(JSON.stringify({run_id:'run_earlier'}),{status:202});
 };
 try {
  const engine=hermesEngine({address:'http://hermes:8642',key:'test-only-key',profile});
  const start={conversation:'c',input:'Plan',idempotencyKey:'c:k'};
  assert.equal(await engine.start({...start,retry:true}),'run_earlier');
  assert.equal(bodies.length,2);
  assert.match(bodies[0].instructions,/MEDIA:\/work\//);
  assert.deepEqual(bodies[1],{input:'Plan'});
  bodies.length=0;
  assert.equal(await engine.start(start),null,'a first start whose key is taken is refused, as before');
  assert.equal(bodies.length,1);
 } finally { globalThis.fetch=real; }
});
