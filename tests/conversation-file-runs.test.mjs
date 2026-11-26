import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #155 on the fake engine: the Agent's Run carries the message's text and one image part per file in the Engine's own
// shape (the pinned Hermes v0.23.0 `/v1/runs` takes `input` as messages, and the last message's content list reaches the
// model), a message may carry images alone, and a turn that waited reads its files from the Conversation's record when
// it starts. A stored image that is gone ends its turn for its sender, so the Conversation's next turn can start, while a
// storage failure that may pass leaves the turn for the next pass (#368). The database is a small stand-in
// (supabase/tests/conversation_message_files.sql proves the real rules).
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co']) engineRecord(company,hermes);
const conversation='c1000000-0000-0000-0000-000000000001';
const connection='f9000000-0000-0000-0000-000000000001';
const png=Buffer.from('a png, not really: the Engine is given the bytes and its own type').toString('base64');
const jpeg=Buffer.from('a jpeg, not really').toString('base64');
const files=[{content_type:'image/png',base64:png},{content_type:'image/jpeg',base64:jpeg}];
const imagePart=(type,base64)=>({type:'image_url',image_url:{url:`data:${type};base64,${base64}`}});

/** @param {{has_files?:boolean,retry?:boolean,begin?:'fails'|'none'|null,files?:{content_type:string,path:string,bytes:string}[],download?:'not found'|'fails once'|null}} [options] */
function databases({has_files=false,retry=false,begin=null,files=[],download=null}={}) {
 const calls=/** @type {[string,any][]} */([]);
 const downloads=/** @type {string[]} */([]);
 // The Conversation's waiting turns, oldest first: the first until a turn is failed, then the next, then nothing.
 const turns=[{send_key:'q',message:'Look at these',has_files},{send_key:'q2',message:'And this too',has_files:false}];
 let claimed=0;
 // The first turn's start was attempted before this claim (retry), so it is a retry and the database never fails it.
 const retried=()=>claimed===0&&retry;
 let transient=download==='fails once'?1:0;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const sentKeys=new Set(); const kept=/** @type {{content_type:string,path:string,bytes:string}[]} */([]);
 const rpc=async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  if(name==='conversation_agent') return ok(null);
  if(name==='queued_conversations') return ok([{conversation}]);
  // #764: a send stores its turn first, after its files are kept (open_only makes a new Conversation for them); the
  // starter then claims it. A key already recorded answers as sent.
  if(name==='queue_conversation_turn') {
   if(args.open_only) return ok({state:'opened'});
   if(sentKeys.has(args.message_key)) return ok({state:'sent'});
   if(!turns.slice(claimed).some(turn=>turn.send_key===args.message_key)) turns.splice(claimed,0,{send_key:args.message_key,message:args.message,has_files:kept.length>0});
   return ok({state:'queued'});
  }
  if(name==='claim_conversation_turn') { const turn=turns[claimed];
   return ok(turn?[{company:'co',agent:'a',person:'p',send_key:turn.send_key,message:turn.message,connection,profile:'writer',note:null,retry:retried(),has_files:turn.has_files}]:[]); }
  if(name==='conversation_handover_agents') return ok([]);
  if(['pin_run','pin_run_history','pin_run_model','pin_lead_brief'].includes(name)) return ok(null);
  if(name==='begin_turn_start') return begin==='fails'?{data:null,error:{code:'40001',message:'could not serialize access'}}:begin==='none'?ok(null):ok(retried()?2:1);
  // The three-argument form fails a turn nobody attempted yet (attempt 0): it leaves the queue, so the next claim gets
  // the next turn. A retried turn's attempt is above 0, or its start was attempted before this claim, and the database
  // leaves it alone: it may hold a Run.
  if(name==='fail_conversation_turn') { if(args.attempt===0&&!retried()) claimed++; return ok(null); }
  if(name==='record_conversation_turn') { sentKeys.add(args.message_key); claimed++; return ok(true); }
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const stored=()=>[...files,...kept];
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,order:async()=>ok(data),maybeSingle:async()=>ok(Array.isArray(data)?data[0]??null:data)}; return c; };
 const read=(/** @type {string} */ table)=>chain(table==='conversation_attachments'?stored().map(file=>({content_type:file.content_type,path:file.path})):table==='conversation_queued_turns'?{started_at:sentKeys.size?'now':null,failed_at:null}:{id:'a',instructions:null});
 const db={rpc,from:read};
 const service={rpc,from:read,
  storage:{from:()=>({download:async(/** @type {string} */ path)=>{ downloads.push(path);
   if(download==='not found') return {data:null,error:{statusCode:'404',status:400,error:'not_found',message:'Object not found'}};
   if(transient>0) { transient--; return {data:null,error:{status:503,statusCode:'503',message:'Service temporarily unavailable'}}; }
   const file=stored().find(each=>each.path===path); return file?{data:new Blob([file.bytes]),error:null}:{data:null,error:{statusCode:'404',status:400,error:'not_found',message:'Object not found'}}; }})}};
 // The route's keep of a send's images (lib/conversation-files.ts): the rows and bytes under the send's key.
 const keepFiles=(/** @type {{content_type:string,base64:string}[]} */ images)=>async()=>{ calls.push(['keepFiles',null]); kept.push(...images.map((image,at)=>({content_type:image.content_type,path:`co/conversations/c/k-${at}`,bytes:Buffer.from(image.base64,'base64')}))); return {}; };
 return {db,service,calls,downloads,keepFiles};
}

const send=(/** @type {ReturnType<typeof databases>} */ {db,service,keepFiles},/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {{images?:{content_type:string,base64:string}[],message?:string}} */ {images,...extra}={})=>
 withEngineContract(fake.engineFor,()=>sendMessage(db,service,{company:'co',conversation,sendKey:'k',message:'Look at these',...(images?{keepFiles:keepFiles(images)}:{}),...extra}));

test('a message with images keeps them before its turn is stored, and its Run carries its text and one image part per file',async()=>{
 const fake=fakeEngine(); const stand=databases();
 assert.deepEqual(await send(stand,fake,{images:files}),{conversation});
 const names=stand.calls.map(([name,args])=>name==='queue_conversation_turn'&&!args.open_only?'queue':name);
 assert.ok(names.indexOf('keepFiles')<names.indexOf('queue'),'the files are kept before the turn the starter claims');
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

test('a retry of the same send is the same message, so it is the same Run',async()=>{
 const fake=fakeEngine(); const stand=databases();
 const first=await send(stand,fake,{images:files});
 const again=await send(stand,fake,{images:files});
 assert.deepEqual([first,again],[{conversation},{conversation}]);
 assert.equal(fake.runs.length,1,'the same send key is the same turn');
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',png),imagePart('image/jpeg',jpeg)]}]);
});

test('a turn that waited carries its images when it starts, read from the Conversation’s files',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:Buffer.from('bytes of the image')}]});
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),1);
 assert.deepEqual(stand.downloads,['co/conversations/c/q-0']);
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',Buffer.from('bytes of the image').toString('base64'))]}]);
});

test('a turn with no files is read from nowhere, as before',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:false,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:'unused'}]});
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),1);
 assert.deepEqual(stand.downloads,[]);
 assert.equal(fake.runs[0].input,'Look at these');
});

test('a queued turn whose stored image is gone fails for its sender, and the next turn starts',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:'the image is gone'}],download:'not found'});
 const failed=()=>stand.calls.filter(([name])=>name==='fail_conversation_turn');
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),0,'the turn is failed, not started');
 assert.deepEqual(failed(),[['fail_conversation_turn',{conversation,message_key:'q',attempt:0}]],'its sender sees the line, and its reservation is released');
 assert.equal(fake.runs.length,0,'the Engine never starts the turn whose image is gone');
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),1);
 assert.equal(fake.runs.length,1);
 assert.equal(fake.runs[0].input,'And this too','the Conversation’s next turn starts');
 assert.equal(failed().length,1,'the next turn is not failed');
});

// #764: a send whose images cannot be kept is refused before its turn is stored, so nothing is left half sent and the
// route gives its words back to the box.
test('a send whose images cannot be kept stores no turn',async()=>{
 const fake=fakeEngine(); const stand=databases();
 const sent=await withEngineContract(fake.engineFor,()=>sendMessage(stand.db,stand.service,{company:'co',conversation,sendKey:'k',message:'Look at these',keepFiles:async()=>({error:'conversationFailed'})}));
 assert.deepEqual(sent,{error:'conversationFailed',status:500});
 assert.equal(stand.calls.some(([name,args])=>name==='queue_conversation_turn'&&!args.open_only),false);
 assert.equal(fake.runs.length,0);
});

// #465: the images of a turn whose start was attempted or marked unknown are kept while it may need them
// (supabase/tests/queued_turn_files_kept.sql), so its retry reads them and asks again with the same key and body.
test('a retried turn whose images were kept starts with the same images, as a retry of the same Run',async()=>{
 const fake=fakeEngine(); const starts=/** @type {any[]} */([]);
 const engineFor=(/** @type {any} */ connection)=>{ const engine=fake.engineFor(connection); return {...engine,start:(/** @type {any} */ input)=>{ starts.push(input); return engine.start(input); }}; };
 const bytes='bytes of the image';
 const stand=databases({has_files:true,retry:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes}]});
 assert.equal(await withEngineContract(engineFor,()=>startQueuedTurns(stand.service,{})),1,'the retried turn starts');
 assert.deepEqual(stand.downloads,['co/conversations/c/q-0']);
 assert.equal(starts[0].retry,true,'as a retry, which no answer but a run id settles');
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',Buffer.from(bytes).toString('base64'))]}],'with the images it was sent with');
 assert.deepEqual(stand.calls.filter(([name])=>name==='fail_conversation_turn'),[]);
});

test('a retried turn whose image is gone for outside reasons is never failed and never sent without it',async()=>{
 const fake=fakeEngine();
 const stand=databases({has_files:true,retry:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes:'gone'}],download:'not found'});
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),0);
 assert.equal(fake.runs.length,0,'no request with a changed body under the same key');
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),0,'the database refuses to fail it, so it waits: it may hold a Run');
 assert.equal(fake.runs.length,0);
});

test('a storage error that may pass leaves the turn to be retried on the next pass',async()=>{
 const fake=fakeEngine();
 const bytes='bytes of the image';
 const stand=databases({has_files:true,files:[{content_type:'image/png',path:'co/conversations/c/q-0',bytes}],download:'fails once'});
 const failed=()=>stand.calls.filter(([name])=>name==='fail_conversation_turn');
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),0,'the pass starts nothing');
 assert.deepEqual(failed(),[],'a failure that may pass never fails the turn');
 assert.equal(fake.runs.length,0);
 assert.equal(await withEngineContract(fake.engineFor,()=>startQueuedTurns(stand.service,{})),1,'the next pass starts it');
 assert.deepEqual(fake.runs[0].input,[{role:'user',content:[{type:'text',text:'Look at these'},imagePart('image/png',Buffer.from(bytes).toString('base64'))]}]);
 assert.deepEqual(failed(),[]);
});
