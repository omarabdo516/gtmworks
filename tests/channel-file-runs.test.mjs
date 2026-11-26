import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { postChannelMessage } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #156 on the fake engine: a channel message that calls an Agent gives its Run the message's text and one image part per
// file in the Engine's own shape, read from the message's own files when the Run starts; a message that calls no Agent
// starts no Run at all and keeps its images under its turn. The database is a small stand-in
// (supabase/tests/channel_message_files.sql proves the real rules).
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['c1000000-0000-0000-0000-000000000001']) engineRecord(company,hermes);
const company='c1000000-0000-0000-0000-000000000001';
const channel='k1000000-0000-0000-0000-000000000001';
const png='a png, not really: the Engine is given the bytes and its own type';
const jpeg='a jpeg, not really';
const files=[new File([Buffer.from(png)],'cover.png',{type:'image/png'}),new File([Buffer.from(jpeg)],'logo.jpeg',{type:'image/jpeg'})];
const stored=[
 {content_type:'image/png',path:`${company}/channels/${channel}/q-0`,bytes:png},
 {content_type:'image/jpeg',path:`${company}/channels/${channel}/q-1`,bytes:jpeg},
];
const imagePart=(type,base64)=>({type:'image_url',image_url:{url:`data:${type};base64,${base64}`}});

/** @param {{mention?:boolean,attachments?:{content_type:string,path:string,bytes:string}[],refusePost?:boolean,failUpload?:boolean,failUploadAt?:number|null,discard?:string[],alreadyStored?:boolean,inStorage?:string[]}} [options] */
function databases({mention=false,attachments=stored,refusePost=false,failUpload=false,failUploadAt=null,discard=[],alreadyStored=false,inStorage=alreadyStored?[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`]:[]}={}) {
 const calls=/** @type {[string,any][]} */([]);
 const uploads=/** @type {string[]} */([]);
 const removals=/** @type {string[][]} */([]);
 const downloads=/** @type {string[]} */([]);
 let postedAfterUploads=-1;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const due=mention?[{message:7,run:null,connection:null,address:null,profile:'default',state:'connected',key_encrypted:null}]:[];
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  // The message is stored only once the images are there, as the trigger that links them runs as it is inserted.
  if(name==='post_channel_message') { postedAfterUploads=uploads.length; return refusePost?{data:null,error:{code:'22023'}}:ok(7); }
  if(name==='reserve_channel_files') return ok(alreadyStored?-1:attachments.length);
  if(name==='discard_channel_files') return ok(discard);
  if(name==='channel_runs_due') return ok(due);
  if(name==='begin_channel_start') return ok([{attempt:1,company,profile:'default',connection:'conn',session:'sess',input:'مراجع: Look at these',instructions:null,rules:[],has_files:true}]);
  if(name==='answer_channel_start') return ok(true);
  // A channel Run pins its tools at its first start (#148, #150); this stand-in pins none, so the Run carries no tools.
  if(name==='channel_handover_targets') return ok([]);
  if(name==='pin_channel_run') return ok(null);
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,order:async()=>ok(data)}; return c; };
 const storage={from:()=>({
  upload:async(/** @type {string} */ path,/** @type {unknown} */ _bytes,/** @type {{upsert?:boolean}} */ options={})=>{ if(failUpload||(failUploadAt!==null&&uploads.length===failUploadAt)) return {error:{message:'storage refused'}};
   // Storage refuses to write over a stored object unless asked to replace it.
   if(!options.upsert&&inStorage.includes(path)) return {error:{message:'The resource already exists'}};
   uploads.push(path); return {error:null}; },
  remove:async(/** @type {string[]} */ paths)=>{ removals.push(paths); return {error:null}; },
  download:async(/** @type {string} */ path)=>{ downloads.push(path); const file=attachments.find(each=>each.path===path);
   return file?{data:new Blob([file.bytes]),error:null}:{data:null,error:{message:'not found'}}; },
 })};
 return {
  db:{rpc},
  service:{rpc,from:(/** @type {string} */ table)=>chain(table==='channel_attachments'?attachments.map((file,position)=>({position,content_type:file.content_type,path:file.path})):[]),storage},
  calls,uploads,removals,downloads,
  get postedAfterUploads(){ return postedAfterUploads; },
 };
}

test('a channel message that calls an Agent gives its Run its text and one image part per file',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{message:7});
 assert.equal(fake.runs.length,1);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'مراجع: Look at these'},imagePart('image/png',Buffer.from(png).toString('base64')),imagePart('image/jpeg',Buffer.from(jpeg).toString('base64'))]}]);
 assert.deepEqual(stand.downloads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`]);
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`]);
 // The files are kept and written before the message exists, so the Run its insert starts already finds them.
 assert.deepEqual(stand.calls.map(([name])=>name).slice(0,2),['reserve_channel_files','post_channel_message']);
 assert.equal(stand.postedAfterUploads,2);
});

test('a Run the worker claims right after the post already has the images',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true});
 await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 // The post did not start the Run; the worker did, after it saw the new message, and both images were already stored.
 assert.equal(stand.postedAfterUploads,2,'both images were written before the message was posted');
 assert.equal(fake.runs.length,1);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'مراجع: Look at these'},imagePart('image/png',Buffer.from(png).toString('base64')),imagePart('image/jpeg',Buffer.from(jpeg).toString('base64'))]}]);
});

test('a post the database refuses discards the files kept for it and starts no Run',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true,refusePost:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{refused:'channelFailed',status:400});
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`],'the bytes were written first');
 assert.deepEqual(stand.calls.map(([name])=>name),['reserve_channel_files','post_channel_message','discard_channel_files'],'a failed post takes its files with it');
 assert.equal(fake.runs.length,0);
});

test('a failed upload posts nothing and gives its rows back',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true,failUpload:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{refused:'channelFailed',status:400});
 assert.deepEqual(stand.calls.map(([name])=>name),['reserve_channel_files','discard_channel_files'],'nothing is stored when its bytes cannot be');
 assert.equal(fake.runs.length,0);
});

test('a retry of a send whose files a stored message already took keeps nothing again and posts the same message',async()=>{
 const fake=fakeEngine(); const stand=databases({alreadyStored:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{message:7},'the send goes on to its message, which the send key already stored');
 assert.deepEqual(stand.uploads,[],'a stored send uploads nothing a second time');
 assert.deepEqual(stand.calls.map(([name])=>name).slice(0,2),['reserve_channel_files','post_channel_message']);
 assert.equal(fake.runs.length,0,'the stored message starts no second Run');
});

test('a retry of a stored send whose first upload failed writes the missing image, and never replaces the stored one',async()=>{
 const fake=fakeEngine(); const stand=databases({alreadyStored:true,inStorage:[`${company}/channels/${channel}/q-0`]});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{message:7});
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-1`],'only the image missing from storage is written');
 assert.deepEqual(stand.removals,[],'nothing of the stored message is removed');
});

test('a storage error while repairing a stored send never stops it reaching its message',async()=>{
 const fake=fakeEngine(); const stand=databases({alreadyStored:true,failUpload:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{message:7},'the send goes on to the message its key stored');
 assert.deepEqual(stand.removals,[],'nothing of the stored message is removed');
});

test('an image-only retry of a stored send answers that message, with its images kept',async()=>{
 const fake=fakeEngine(); const stand=databases({alreadyStored:true});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'',files}));
 assert.deepEqual(sent,{message:7},'the empty retry reaches the message its send key already stored');
 assert.deepEqual(stand.uploads,[],'a stored send uploads its images no second time');
 assert.deepEqual(stand.calls.map(([name])=>name).slice(0,2),['reserve_channel_files','post_channel_message']);
 assert.equal(stand.calls[1][1].message,'','the retry posts the same empty body its images carried');
 assert.equal(fake.runs.length,0,'the stored message starts no second Run');
});

test('a failed upload leaves removal to the guarded discard, never to a path it wrote itself',async()=>{
 const fake=fakeEngine(); const stand=databases({failUploadAt:1,discard:[]});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files}));
 assert.deepEqual(sent,{refused:'channelFailed',status:400});
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`],'the first image was written before the second failed');
 assert.deepEqual(stand.removals,[],'the guarded discard returned no path, so nothing else is removed');
 assert.equal(fake.runs.length,0);
});

test('a channel message with images that calls no Agent starts no Run and keeps its files',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:false});
 const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'Look at these',files}));
 assert.deepEqual(sent,{message:7});
 assert.equal(fake.runs.length,0,'ordinary talk between Members starts no Run');
 const reserved=stand.calls.find(([name])=>name==='reserve_channel_files')?.[1];
 assert.equal(reserved.files.length,2,'the message keeps both images');
 assert.equal(reserved.ch,channel);
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`]);
 assert.deepEqual(stand.downloads,[],'no Run reads them when no Agent is called');
 assert.deepEqual(stand.calls.map(([name])=>name).slice(0,2),['reserve_channel_files','post_channel_message']);
});

test('a discard never removes the object a send of the same key kept again before its removal (#598)',async()=>{
 // One key sent twice at once: the first send's second upload fails, so it gives its rows back, and between that discard
 // and its removal from the bucket the second send keeps the rows again and writes its images. The database names each
 // keep attempt's paths (reserve_channel_files with an attempt, supabase/tests/message_files_per_attempt.sql), so the first
 // send's removal reaches only its own objects and the second send's message keeps every image its rows name.
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 let rows=/** @type {{position:number,content_type:string,path:string}[]} */([]);
 const objects=new Set(); const removed=/** @type {string[]} */([]);
 let failing=true; let second=/** @type {Promise<unknown>|null} */(null);
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='reserve_channel_files') {
   if(!rows.length) rows=args.files.map((/** @type {any} */ file)=>({position:file.position,content_type:file.content_type,path:`${company}/channels/${channel}/q-${args.attempt}-${file.position}`}));
   return ok(rows.length);
  }
  if(name==='discard_channel_files') {
   const gone=rows.map(row=>row.path); rows=[];
   failing=false; second??=withEngineContract(fakeEngine().engineFor,()=>postChannelMessage(db,service,{company,channel,sendKey:'q',message:'Look at these',files}));
   await second;
   return ok(gone);
  }
  if(name==='post_channel_message') return ok(7);
  if(name==='channel_runs_due') return ok([]);
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const read=()=>{ const c={select:()=>c,eq:()=>c,order:async()=>ok(rows)}; return c; };
 const storage={from:()=>({
  upload:async(/** @type {string} */ path)=>{ if(failing&&objects.size===1) return {error:{message:'storage refused'}}; objects.add(path); return {error:null}; },
  remove:async(/** @type {string[]} */ paths)=>{ for(const path of paths) { removed.push(path); objects.delete(path); } return {error:null}; },
 })};
 const db={rpc}; const service={rpc,from:read,storage};
 const first=await withEngineContract(fakeEngine().engineFor,()=>postChannelMessage(db,service,{company,channel,sendKey:'q',message:'Look at these',files}));
 assert.deepEqual(first,{refused:'channelFailed',status:400},'the first send could not store its images');
 assert.deepEqual(await second,{message:7},'the second send of the key stored its message');
 assert.equal(rows.length,2,'its message keeps both rows');
 assert.ok(removed.length>0,'the first send removed what it wrote');
 for(const row of rows) assert.ok(objects.has(row.path),`the second send's ${row.path} is still in the bucket`);
});

test('a send gives back only the rows its own keep attempt holds (#727)',async()=>{
 // A send of the same key that found these rows still holds them: the discard names this send's attempt, the one its
 // reserve named, so the database takes this attempt off the rows and gives back only those no other send still holds
 // (supabase/tests/message_files_holders.sql).
 const stand=databases({refusePost:true});
 await withEngineContract(fakeEngine().engineFor,()=>postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'Look at these',files}));
 const reserved=stand.calls.find(([name])=>name==='reserve_channel_files')?.[1];
 const discarded=stand.calls.find(([name])=>name==='discard_channel_files')?.[1];
 assert.match(reserved.attempt,/^[0-9a-f-]{36}$/,'the keep names its attempt');
 assert.equal(discarded.attempt,reserved.attempt,'the discard names the same attempt');
});
