import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { readFileSync } from 'node:fs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { decideChannelPermission, driveChannelRuns, driveNoteRuns } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #163 on the fake engine: a Run that asks to allow an action, in a note and in a channel. The databases are small
// stand-ins for the permission functions that record what was asked of them.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// The Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
engineRecord('co',hermes);
const secret='rm -rf /srv/exports/private-client-list.csv';

const asking=(/** @type {{description:string,command:string,choices?:import('../lib/engine.mjs').PermissionChoice[]}[]} */ permissions=[{description:'  delete the old exports\n',command:secret}])=>{
 const fake=fakeEngine();
 fake.settings.permissions=()=>permissions;
 fake.settings.reply=(input,_answers,choices)=>`Reply to: ${input} (${choices.map(choice=>choice??'not allowed').join(', ')})`;
 return fake;
};

// Nobody can answer a note's Run: its request is not allowed, at once, as its question is answered with nothing. A
// channel's Run asks the Member who called its Agent (#165), below.
for(const [label,drive,due,close] of /** @type {const} */([['note',driveNoteRuns,'note_runs_due','close_note_run']])) test(`a ${label}'s Run asking to allow an action is not allowed at once, and goes on to its reply`,async()=>{
 const fake=asking();
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:`${label}:1`}));
 const key=encryptSecret('test-only-key',encryptionKey); const closes=/** @type {any[]} */([]);
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name===due) return {data:closes.length?[]:[{message:1,run,company:'co',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected',key_encrypted:key}],error:null};
  if(name===close) { closes.push(args); return {data:true,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>drive(service,{})),{started:0,closed:0},'the read that finds the request does not close the Run');
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'deny'}]);
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>drive(service,{})),{started:0,closed:1});
 assert.equal(closes[0].reply,'Reply to: Clean up (deny)');
});

// #165: a channel's Run asks the Member who called its Agent. The closer keeps the request and the Run stays open while it
// waits; the caller's press is answered first and delivered after, once, to the same Run, which then goes on to its
// reply. The database is a stand-in for the channel's functions (supabase/tests/permission_waits.sql proves the real ones).
function channelDatabases(/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {string} */ run) {
 const key=encryptSecret('test-only-key',encryptionKey);
 /** @type {{id:number,permission:string,content:any,state:string,at:string}[]} */ const requests=[]; const calls=/** @type {[string,any][]} */([]); const closes=/** @type {any[]} */([]);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  if(name==='channel_runs_due') return ok(closes.length?[]:[{message:7,run,company:'co',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected',key_encrypted:key}]);
  if(name==='track_channel_permission') {
   for(const each of requests) if(args.ended&&['open','sending'].includes(each.state)||each.state==='open'&&each.permission!==args.asking?.id&&each.at<args.read_started_at) each.state='closed';
   if(args.asking&&!args.ended&&!requests.some(each=>each.permission===args.asking.id)) requests.push({id:requests.length+1,permission:args.asking.id,content:{description:args.asking.description,command:args.asking.command,choices:args.asking.choices},state:'open',at:args.read_started_at});
   return ok(requests.filter(each=>each.state==='sending').map(each=>({card:each.id,permission:each.permission,choice:each.content.choice})));
  }
  if(name==='settle_channel_permission') { const each=requests.find(request=>request.id===args.card); if(each?.state==='sending') each.state=args.verdict; return ok(each?.state); }
  if(name==='close_channel_run') { closes.push(args); for(const each of requests) if(['open','sending'].includes(each.state)) each.state='closed'; return ok(true); }
  return {data:null,error:{message:'unexpected'}};
 }};
 const caller={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
  if(name!=='decide_channel_permission') return {data:null,error:{message:'unexpected'}};
  const each=requests.find(request=>request.id===args.request);
  if(!each) return {data:null,error:{code:'P0002',message:'channelNotFound'}};
  if(each.state!=='open') return ok({state:'decided',choice:each.content.choice,at:'2026-06-10T10:20:00.000Z',first:false});
  Object.assign(each,{state:'sending',content:{...each.content,choice:args.choice}});
  return ok({state:'decided',choice:args.choice,at:'2026-06-10T10:20:00.000Z',first:true});
 }};
 return {service,caller,requests,calls,closes};
}

test('a channel\'s Run asking to allow an action keeps its request and waits; its caller\'s choice is delivered once after the answer, and the same Run goes on to its reply',async()=>{
 const fake=asking();
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:'channel:7'}));
 const {service,caller,requests,calls,closes}=channelDatabases(fake,run);
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>driveChannelRuns(service,{})),{started:0,closed:0},'a Run waiting on its caller is running');
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>driveChannelRuns(service,{})),{started:0,closed:0});
 assert.deepEqual(requests.map(({permission,content,state})=>({permission,content,state})),[{permission:`${run}_p1`,content:{description:'delete the old exports',command:secret,choices:['once','always','deny']},state:'open'}]);
 assert.deepEqual(calls.filter(([name])=>name==='track_channel_permission').map(([,args])=>[args.message,args.run,args.run_profile]),[[7,run,'writer'],[7,run,'writer']]);
 assert.deepEqual(fake.permits,[],'nothing is sent before the caller decides');
 const later=/** @type {(()=>Promise<void>)[]} */([]);
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>decideChannelPermission(caller,service,{company:'co',channel:'ch',request:1,choice:'once',later:deliver=>{ later.push(()=>withEngineContract(fake.engineFor,deliver)); }})),
  {state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true});
 assert.deepEqual(fake.permits,[],'nothing is sent before the answer');
 assert.equal(later.length,1);
 await later[0]();
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'once'}]);
 assert.equal(requests[0].state,'decided');
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>decideChannelPermission(caller,service,{company:'co',channel:'ch',request:1,choice:'deny',later:deliver=>{ later.push(()=>withEngineContract(fake.engineFor,deliver)); }})),
  {state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:false});
 assert.equal(later.length,1,'a press that was not first delivers nothing');
 assert.deepEqual(await withEngineContract(fake.engineFor,()=>driveChannelRuns(service,{})),{started:0,closed:1});
 assert.equal(closes[0].reply,'Reply to: Clean up (once)');
 assert.equal(fake.permits.length,1,'the choice went once');
});

test('a channel\'s request with no words to show is not allowed at once, and nothing is kept',async()=>{
 const fake=asking([{description:' ',command:''}]);
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:'channel:7'}));
 const {service,requests,calls}=channelDatabases(fake,run);
 await withEngineContract(fake.engineFor,()=>driveChannelRuns(service,{}));
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'deny'}]);
 assert.deepEqual(requests,[]);
 assert.equal(calls.find(([name])=>name==='track_channel_permission')?.[1].asking,null);
});

// The request's words are the Engine's and may name a private file or a customer: the route that takes a press logs
// nothing of what it was sent.
test('the route logs no request body',()=>{
 const route=readFileSync('app/api/conversations/route.ts','utf8');
 assert.equal(route.match(/console\./g),null,'the route writes no log line of its own');
 const failures=route.match(/logActionFailure\([^)]*\)/g)||[];
 assert.ok(failures.includes("logActionFailure('conversation',new Error('Conversation request failed')"),'a failed request is logged as a fixed line');
 for(const failure of failures) assert.match(failure,/^logActionFailure\('conversation',new Error\('[^'`$]*'\)$/,`${failure} logs only fixed text`);
});

// A delivery that fails after the press logs a fixed label and the error's class or code, never its text: an Engine's
// or database's message may repeat the request's words.
test('a choice whose delivery fails after the press logs a fixed line, never the failure\'s text, in a channel',async()=>{
 const fake=asking();
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:'channel:7'}));
 const channel=channelDatabases(fake,run);
 await withEngineContract(fake.engineFor,()=>driveChannelRuns(channel.service,{}));
 const leaking=Object.assign(new Error(`approval failed for ${secret}`),{code:'XX000'});
 const lines=/** @type {string[]} */([]); const write=console.error;
 console.error=(/** @type {unknown[]} */ ...values)=>{ lines.push(values.map(value=>value instanceof Error?`${value.message} ${value.stack}`:String(value)).join(' ')); };
 try {
  const later=/** @type {(()=>Promise<void>)[]} */([]);
  await withEngineContract(fake.engineFor,()=>decideChannelPermission(channel.caller,{rpc:async()=>{ throw leaking; }},{company:'co',channel:'ch',request:1,choice:'once',later:deliver=>{ later.push(()=>withEngineContract(fake.engineFor,deliver)); }}));
  for(const deliver of later) await deliver();
 } finally { console.error=write; }
 assert.equal(lines.length,1,'the failure was logged');
 for(const line of lines) { assert.ok(!line.includes(secret),`${line} names the request`); assert.match(line,/^Permission not delivered yet: \S+ (Error|XX000)$/); }
});
