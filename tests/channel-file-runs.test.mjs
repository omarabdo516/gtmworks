import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postChannelMessage } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #156 on the fake engine: a channel message that calls an Agent gives its Run the message's text and one image part per
// file in the Engine's own shape, read from the message's own files when the Run starts; a message that calls no Agent
// starts no Run at all and keeps its images under its turn. The database is a small stand-in
// (supabase/tests/channel_message_files.sql proves the real rules).
const hermes={address:'http://hermes:8642',key:'test-only-key'};
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

/** @param {{mention?:boolean,attachments?:{content_type:string,path:string,bytes:string}[],refusePost?:boolean,failUpload?:boolean}} [options] */
function databases({mention=false,attachments=stored,refusePost=false,failUpload=false}={}) {
 const calls=/** @type {[string,any][]} */([]);
 const uploads=/** @type {string[]} */([]);
 const downloads=/** @type {string[]} */([]);
 let postedAfterUploads=-1;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const due=mention?[{message:7,run:null,connection:null,address:null,profile:'default',state:'connected',key_encrypted:null}]:[];
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  // The message is stored only once the images are there, as the trigger that links them runs as it is inserted.
  if(name==='post_channel_message') { postedAfterUploads=uploads.length; return refusePost?{data:null,error:{code:'22023'}}:ok(7); }
  if(name==='reserve_channel_files') return ok(attachments.length);
  if(name==='discard_channel_files') return ok([]);
  if(name==='channel_runs_due') return ok(due);
  if(name==='begin_channel_start') return ok([{attempt:1,company,profile:'default',connection:'conn',session:'sess',input:'مراجع: Look at these',instructions:null,rules:[],has_files:true}]);
  if(name==='answer_channel_start') return ok(true);
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,order:async()=>ok(data)}; return c; };
 const storage={from:()=>({
  upload:async(/** @type {string} */ path)=>{ if(failUpload) return {error:{message:'storage refused'}}; uploads.push(path); return {error:null}; },
  remove:async()=>({error:null}),
  download:async(/** @type {string} */ path)=>{ downloads.push(path); const file=attachments.find(each=>each.path===path);
   return file?{data:new Blob([file.bytes]),error:null}:{data:null,error:{message:'not found'}}; },
 })};
 return {
  db:{rpc},
  service:{rpc,from:(/** @type {string} */ table)=>chain(table==='channel_attachments'?attachments.map(file=>({content_type:file.content_type,path:file.path})):[]),storage},
  calls,uploads,downloads,
  get postedAfterUploads(){ return postedAfterUploads; },
 };
}

test('a channel message that calls an Agent gives its Run its text and one image part per file',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true});
 const sent=await postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files,hermes,engineFor:fake.engineFor});
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
 await postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files,hermes,engineFor:fake.engineFor});
 // The post did not start the Run; the worker did, after it saw the new message, and both images were already stored.
 assert.equal(stand.postedAfterUploads,2,'both images were written before the message was posted');
 assert.equal(fake.runs.length,1);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'مراجع: Look at these'},imagePart('image/png',Buffer.from(png).toString('base64')),imagePart('image/jpeg',Buffer.from(jpeg).toString('base64'))]}]);
});

test('a post the database refuses discards the files kept for it and starts no Run',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true,refusePost:true});
 const sent=await postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files,hermes,engineFor:fake.engineFor});
 assert.deepEqual(sent,{refused:'channelFailed',status:400});
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`],'the bytes were written first');
 assert.deepEqual(stand.calls.map(([name])=>name),['reserve_channel_files','post_channel_message','discard_channel_files'],'a failed post takes its files with it');
 assert.equal(fake.runs.length,0);
});

test('a failed upload posts nothing and gives its rows back',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:true,failUpload:true});
 const sent=await postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'@Faye look',files,hermes,engineFor:fake.engineFor});
 assert.deepEqual(sent,{refused:'channelFailed',status:400});
 assert.deepEqual(stand.calls.map(([name])=>name),['reserve_channel_files','discard_channel_files'],'nothing is stored when its bytes cannot be');
 assert.equal(fake.runs.length,0);
});

test('a channel message with images that calls no Agent starts no Run and keeps its files',async()=>{
 const fake=fakeEngine(); const stand=databases({mention:false});
 const sent=await postChannelMessage(stand.db,stand.service,{company,channel,sendKey:'q',message:'Look at these',files,hermes,engineFor:fake.engineFor});
 assert.deepEqual(sent,{message:7});
 assert.equal(fake.runs.length,0,'ordinary talk between Members starts no Run');
 const reserved=stand.calls.find(([name])=>name==='reserve_channel_files')?.[1];
 assert.equal(reserved.files.length,2,'the message keeps both images');
 assert.equal(reserved.ch,channel);
 assert.deepEqual(stand.uploads,[`${company}/channels/${channel}/q-0`,`${company}/channels/${channel}/q-1`]);
 assert.deepEqual(stand.downloads,[],'no Run reads them when no Agent is called');
 assert.deepEqual(stand.calls.map(([name])=>name).slice(0,2),['reserve_channel_files','post_channel_message']);
});
