import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #155 on the fake engine: the Agent's Run carries the message's text and one image part per file in the Engine's own
// shape (the pinned Hermes v0.23.0 `/v1/runs` takes `input` as messages, and the last message's content list reaches the
// model), a message may carry images alone, and a turn that waited reads its files from the Conversation's record when
// it starts. A stored image that is gone ends its turn for its sender, so the Conversation's next turn can start, while a
// storage failure that may pass leaves the turn for the next pass (#368). The database is a small stand-in
// (supabase/tests/conversation_message_files.sql proves the real rules).
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const conversation='c1000000-0000-0000-0000-000000000001';
const connection='f9000000-0000-0000-0000-000000000001';
const png=Buffer.from('a png, not really: the Engine is given the bytes and its own type').toString('base64');
const jpeg=Buffer.from('a jpeg, not really').toString('base64');
const files=[{content_type:'image/png',base64:png},{content_type:'image/jpeg',base64:jpeg}];
const imagePart=(type,base64)=>({type:'image_url',image_url:{url:`data:${type};base64,${base64}`}});

/** @param {{has_files?:boolean,files?:{content_type:string,path:string,bytes:string}[],refuse?:string|null,download?:'not found'|'fails once'|null}} [options] */
function databases({has_files=false,files=[],refuse=null,download=null}={}) {
 const calls=/** @type {[string,any][]} */([]);
 const downloads=/** @type {string[]} */([]);
 // The Conversation's waiting turns, oldest first: the first until a turn is failed, then the next, then nothing.
 const turns=[{send_key:'q',message:'Look at these',has_files},{send_key:'q2',message:'And this too',has_files:false}];
 let claimed=0; let transient=download==='fails once'?1:0;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const completion={state:'reserved',connection,profile:'writer',note:null};
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  if(name==='conversation_agent') return ok(null);
  if(name==='queued_conversations') return ok([{conversation}]);
  if(name==='reserve_conversation_turn') return ok(completion);
  if(name==='claim_conversation_turn') { const turn=turns[claimed];
   return ok(turn?[{company:'co',agent:'a',person:'p',send_key:turn.send_key,message:turn.message,connection,profile:'writer',note:null,retry:false,has_files:turn.has_files}]:[]); }
  if(['pin_run','pin_run_history','pin_run_model','pin_lead_brief'].includes(name)) return ok(null);
  if(name==='begin_start') return ok(1);
  // The three-argument form fails a turn nobody attempted yet (attempt 0): it leaves the queue, so the next claim gets
  // the next turn. A retried turn's attempt is above 0 and the database leaves it alone.
  if(name==='fail_conversation_turn') { if(args.attempt===0) claimed++; return ok(null); }
  if(name==='send_conversation_message') return refuse?{data:null,error:{code:refuse}}:ok(true);
  if(name==='record_conversation_turn') { claimed++; return ok(true); }
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,order:async()=>ok(data),maybeSingle:async()=>ok(Array.isArray(data)?data[0]??null:data)}; return c; };
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_attachments'?files.map(file=>({content_type:file.content_type,path:file.path})):{id:'a',instructions:null})};
 const service={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_attachments'?files.map(file=>({content_type:file.content_type,path:file.path})):{id:'a',instructions:null}),
  storage:{from:()=>({download:async(/** @type {string} */ path)=>{ downloads.push(path);
   if(download==='not found') return {data:null,error:{statusCode:'404',status:400,error:'not_found',message:'Object not found'}};
   if(transient>0) { transient--; return {data:null,error:{status:503,statusCode:'503',message:'Service temporarily unavailable'}}; }
   const file=files.find(each=>each.path===path); return file?{data:new Blob([file.bytes]),error:null}:{data:null,error:{statusCode:'404',status:400,error:'not_found',message:'Object not found'}}; }})}};
 return {db,service,calls,downloads};
}

const send=(/** @type {ReturnType<typeof databases>} */ {db,service},/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {object} */ extra={})=>
 sendMessage(db,service,{company:'co',conversation,sendKey:'k',message:'Look at these',hermes,engineFor:fake.engineFor,...extra});

test('a message with images reaches the Engine as its text and one image part per file',async()=>{
 const fake=fakeEngine(); const stand=databases();
 assert.deepEqual(await send(stand,fake,{images:files}),{conversation});
 assert.equal(fake.runs.length,1);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',png),imagePart('image/jpeg',jpeg)]}]);
});

test('a message of images alone carries the images and no empty text part',async()=>{
 const fake=fakeEngine();
 assert.deepEqual(await send(databases(),fake,{message:'',images:[files[0]]}),{conversation});
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[imagePart('image/png',png)]}]);
});

test('a message without images is sent as its text, as every message was before',async()=>{
 const fake=fakeEngine();
 assert.deepEqual(await send(databases(),fake),{conversation});
 assert.equal(fake.runs[0].input,'Look at these');
});

test('a retry of the same send carries the same images, so it is the same Run',async()=>{
 const fake=fakeEngine(); const stand=databases();
 const first=await send(stand,fake,{images:files});
 const again=await send(stand,fake,{images:files});
 assert.deepEqual([first,again],[{conversation},{conversation}]);
 assert.equal(fake.runs.length,1,'the same idempotency key is the same Run');
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',png),imagePart('image/jpeg',jpeg)]}]);
});

test('a turn that waited carries its images when it starts, read from the Conversation’s files',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:Buffer.from('bytes of the image')}]});
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),1);
 assert.deepEqual(stand.downloads,['co/conversations/c/q-0']);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',Buffer.from('bytes of the image').toString('base64'))]}]);
});

test('a turn with no files is read from nowhere, as before',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:false,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:'unused'}]});
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),1);
 assert.deepEqual(stand.downloads,[]);
 assert.equal(fake.runs[0].input,'Look at these');
});

test('a queued turn whose stored image is gone fails for its sender, and the next turn starts',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:'the image is gone'}],download:'not found'});
 const failed=()=>stand.calls.filter(([name])=>name==='fail_conversation_turn');
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),0,'the turn is failed, not started');
 assert.deepEqual(failed(),[['fail_conversation_turn',{conversation,message_key:'q',attempt:0}]],'its sender sees the line, and its reservation is released');
 assert.equal(fake.runs.length,0,'the Engine never starts the turn whose image is gone');
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),1);
 assert.equal(fake.runs.length,1);
 assert.equal(fake.runs[0].input,'And this too','the Conversation’s next turn starts');
 assert.equal(failed().length,1,'the next turn is not failed');
});

test('a storage error that may pass leaves the turn to be retried on the next pass',async()=>{
 const fake=fakeEngine();
 const bytes='bytes of the image';
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes}],download:'fails once'});
 const failed=()=>stand.calls.filter(([name])=>name==='fail_conversation_turn');
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),0,'the pass starts nothing');
 assert.deepEqual(failed(),[],'a failure that may pass never fails the turn');
 assert.equal(fake.runs.length,0);
 assert.equal(await startQueuedTurns(stand.service,{hermes,engineFor:fake.engineFor}),1,'the next pass starts it');
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',Buffer.from(bytes).toString('base64'))]}]);
 assert.deepEqual(failed(),[]);
});
