import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, decidePermission } from '../lib/conversation-runs.mjs';
import { decideChannelPermission, driveChannelRuns, driveNoteRuns } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #163 on the fake engine: the closer keeps the request a Run waits on, delivers each claimed choice before the Run may
// close, and a Run waiting on its person to allow an action counts as running. The database is a small stand-in for the
// permission functions (supabase/tests/permission_requests.sql proves the real ones) that records what was asked of it.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const conversation='c1000000-0000-0000-0000-000000000001';
const secret='rm -rf /srv/exports/private-client-list.csv';

function databases(/** @type {ReturnType<typeof fakeEngine>} */ fake) {
 /** @type {{id:number,run:string,permission:string,content:any,state:string,at:string,decidedAt?:string}[]} */
 const cards=[]; const calls=/** @type {[string,any][]} */([]); const closed=/** @type {Map<string,any>} */(new Map());
 const key=encryptSecret('test-only-key',encryptionKey);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const service={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   if(name==='open_conversation_runs') return ok(fake.runs.filter(run=>!closed.has(run.id)).map((run,index)=>({message:index+1,conversation,run:run.id,person:'p',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'})));
   if(name==='track_run_question') return ok([]);
   if(name==='track_run_permission') {
    // What Postgres's jsonb refuses: a NUL, or half of a surrogate pair.
    if([args.asking?.description,args.asking?.command].some(words=>typeof words==='string'&&(words.includes('\u0000')||!words.isWellFormed()))) return {data:null,error:{code:'22P05',message:'unsupported Unicode escape sequence'}};
    for(const card of cards) if(card.run===args.run&&(args.ended&&['open','sending'].includes(card.state)||card.state==='open'&&card.permission!==args.asking?.id&&card.at<args.read_started_at)) card.state='closed';
    if(args.asking&&!args.ended&&!cards.some(card=>card.run===args.run&&card.permission===args.asking.id)) cards.push({id:cards.length+1,run:args.run,permission:args.asking.id,content:{description:args.asking.description,command:args.asking.command,choices:args.asking.choices},state:'open',at:args.read_started_at});
    return ok(cards.filter(card=>card.run===args.run&&card.state==='sending').map(card=>({card:card.id,permission:card.permission,choice:card.content.choice})));
   }
   if(name==='settle_permission') { const card=cards.find(each=>each.id===args.card); if(card?.state==='sending') card.state=args.verdict; return ok(card?.state); }
   if(name==='close_conversation_run') { closed.set(args.run,args); for(const card of cards) if(card.run===args.run&&['open','sending'].includes(card.state)) card.state='closed'; return ok(true); }
   return {data:null,error:{message:'unexpected'}};
  },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok({key_encrypted:key})}; return chain; },
 };
 const person={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   if(name!=='decide_permission') return {data:null,error:{message:'unexpected'}};
   const card=cards.find(each=>each.id===args.card);
   if(!card) return {data:null,error:{code:'P0002',message:'conversationNotFound'}};
   if(['sending','decided'].includes(card.state)) return ok({state:'decided',choice:card.content.choice,at:card.decidedAt,first:false});
   if(card.state!=='open') return ok({state:'closed',choice:null,at:null,first:false});
   if(!card.content.choices.includes(args.choice)) return {data:null,error:{code:'22023',message:'permissionChoiceInvalid'}};
   Object.assign(card,{state:'sending',decidedAt:'2026-06-10T10:20:00.000Z',content:{...card.content,choice:args.choice}});
   return ok({state:'decided',choice:args.choice,at:card.decidedAt,first:true});
  },
 };
 return {service,person,cards,calls,closed};
}

const asking=(/** @type {{description:string,command:string,choices?:import('../lib/engine.mjs').PermissionChoice[]}[]} */ permissions=[{description:'  delete the old exports\n',command:secret}])=>{
 const fake=fakeEngine();
 fake.settings.permissions=()=>permissions;
 fake.settings.reply=(input,_answers,choices)=>`Reply to: ${input} (${choices.map(choice=>choice??'not allowed').join(', ')})`;
 return fake;
};
const start=async(/** @type {ReturnType<typeof fakeEngine>} */ fake)=>/** @type {string} */(await fake.engineFor({}).start({conversation,input:'Clean up',idempotencyKey:`${conversation}:k`}));
const close=(/** @type {any} */ service,/** @type {ReturnType<typeof fakeEngine>} */ fake)=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
// A press as the route makes it: answered first, its delivery run after the answer (the route's after()).
const pressOf=(/** @type {any} */ person,/** @type {any} */ service,/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {import('../lib/engine.mjs').PermissionChoice} */ choice,card=1)=>{
 const later=/** @type {(()=>Promise<void>)[]} */([]);
 return {later,answered:decidePermission(person,service,{company:'co',conversation,card,choice,encryptionKey,engineFor:fake.engineFor,later:deliver=>{ later.push(deliver); }})};
};
const decide=async(/** @type {any} */ person,/** @type {any} */ service,/** @type {ReturnType<typeof fakeEngine>} */ fake,/** @type {import('../lib/engine.mjs').PermissionChoice} */ choice,card=1)=>{
 const {later,answered}=pressOf(person,service,fake,choice,card);
 const pressed=await answered;
 for(const deliver of later) await deliver();
 return pressed;
};

test('a waiting request is kept once with the engine\'s words and choices, and its Run stays open and working while it waits',async()=>{
 const fake=asking(); const {service,cards,closed}=databases(fake);
 const run=await start(fake);
 assert.equal(await close(service,fake),0,'a Run waiting on its person is running');
 assert.equal(await close(service,fake),0);
 assert.deepEqual(cards.map(({run,permission,content,state})=>({run,permission,content,state})),[{run,permission:`${run}_p1`,content:{description:'delete the old exports',command:secret,choices:['once','always','deny']},state:'open'}]);
 assert.equal(closed.size,0);
 assert.deepEqual(fake.permits,[],'nothing is sent before the person decides');
});

test('the closer tells the database the profile it read the Run on, where the engine would keep an always',async()=>{
 const fake=asking(); const {service,calls}=databases(fake);
 await start(fake); await close(service,fake);
 assert.deepEqual(calls.filter(([name])=>name==='track_run_permission').map(([,args])=>args.run_profile),['writer']);
});

for(const choice of /** @type {const} */(['once','always','deny'])) test(`${choice}: the choice is delivered once, settled decided, and the same Run then goes on to its reply`,async()=>{
 const fake=asking(); const {service,person,cards,calls,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 assert.deepEqual(await decide(person,service,fake,choice),{state:'decided',choice,at:'2026-06-10T10:20:00.000Z',first:true});
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice}]);
 assert.equal(cards[0].state,'decided');
 assert.deepEqual(calls.filter(([name])=>name==='settle_permission').map(([,args])=>args),[{card:1,verdict:'decided'}]);
 assert.equal(await close(service,fake),1);
 assert.equal(closed.get(run).reply,`Reply to: Clean up (${choice})`);
 assert.equal(fake.runs.length,1,'no second Run');
});

test('a press is answered as soon as its choice is kept, before anything is sent, and the choice goes after the answer',async()=>{
 const fake=asking(); const {service,person,cards}=databases(fake);
 const run=await start(fake); await close(service,fake);
 const first=pressOf(person,service,fake,'once');
 assert.deepEqual(await first.answered,{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true});
 assert.deepEqual(fake.permits,[],'nothing is sent before the answer');
 assert.equal(cards[0].state,'sending');
 const second=pressOf(person,service,fake,'deny');
 assert.deepEqual(await second.answered,{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:false});
 assert.equal(second.later.length,0,'a press that was not first delivers nothing');
 assert.equal(first.later.length,1);
 await first.later[0]();
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'once'}]);
 assert.equal(cards[0].state,'decided');
});

test('a double press sends the choice once and answers the first press again',async()=>{
 const fake=asking(); const {service,person}=databases(fake);
 const run=await start(fake); await close(service,fake);
 const [first,second]=await Promise.all([decide(person,service,fake,'once'),decide(person,service,fake,'deny')]);
 assert.deepEqual([first,second],[{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true},{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:false}]);
 assert.deepEqual(await decide(person,service,fake,'always'),{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:false});
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'once'}]);
});

test('an unreachable engine holds the Run and the claim, and the next pass delivers the same choice',async()=>{
 const fake=asking(); const {service,person,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 fake.settings.unreachablePermits=1;
 assert.deepEqual(await decide(person,service,fake,'once'),{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true},'the card shows the claim');
 assert.equal(cards[0].state,'sending','an engine that could not be asked holds the choice');
 assert.equal(closed.size,0,'and the Run with it');
 assert.equal(await close(service,fake),0,'the pass that delivers it read the Run still waiting');
 assert.equal(cards[0].state,'decided');
 assert.deepEqual(fake.permits.map(sent=>sent.choice),['once','once'],'the same choice again');
 assert.equal(await close(service,fake),1);
 assert.equal(closed.get(run).reply,'Reply to: Clean up (once)');
});

test('a Run that ended while its claim waited closes with the choice kept, and nothing is sent to it, also when the engine cannot be reached',async()=>{
 const fake=asking(); const {service,person,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 fake.settings.unreachablePermits=1;
 await decide(person,service,fake,'once');
 assert.equal(cards[0].state,'sending');
 assert.equal(await fake.engineFor({}).stop(run),true);
 fake.settings.unreachablePermits=1;
 assert.equal(await close(service,fake),1,'the ended Run closes');
 assert.equal(closed.get(run).run_outcome,'stopped');
 assert.deepEqual([cards[0].state,cards[0].content.choice],['closed','once']);
 assert.equal(fake.permits.length,1,'only the press\'s own attempt, none after the Run ended');
});

test('a time limit: once the engine stops waiting the card closes, a press after it is told so and sends nothing, and the Run goes on to its reply',async()=>{
 const fake=asking(); const {service,person,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 fake.expire(run);
 // A read that began before the card was kept says nothing about it; the next one begins after.
 cards[0].at=new Date(Date.parse(cards[0].at)-1000).toISOString();
 assert.equal(await close(service,fake),1);
 assert.equal(cards[0].state,'closed');
 assert.equal(closed.get(run).reply,'Reply to: Clean up (not allowed)');
 assert.deepEqual(await decide(person,service,fake,'once'),{state:'closed',choice:null,at:null,first:false});
 assert.deepEqual(fake.permits,[]);
});

test('a choice the engine no longer takes when it arrives closes the card, and the next press is told so',async()=>{
 const fake=asking(); const {service,person,cards}=databases(fake);
 const run=await start(fake); await close(service,fake);
 // The Run still works after its request timed out, so the choice is sent and found no longer waited on.
 fake.settings.pendingReads=1;
 fake.expire(run);
 assert.deepEqual(await decide(person,service,fake,'once'),{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true},'answered before it is sent');
 assert.equal(cards[0].state,'closed');
 assert.deepEqual(await decide(person,service,fake,'deny'),{state:'closed',choice:null,at:null,first:false});
 assert.deepEqual(fake.permits.map(sent=>sent.choice),['once'],'sent once, and gone');
});

test('Stop while a request waits stops the Run and closes the request',async()=>{
 const fake=asking(); const {service,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 assert.equal(await fake.engineFor({}).stop(run),true);
 assert.equal(await close(service,fake),1);
 assert.equal(closed.get(run).run_outcome,'stopped');
 assert.equal(cards[0].state,'closed');
});

test('a request with no words to show is not allowed at once, and nothing is kept',async()=>{
 const fake=asking([{description:' \n',command:''}]); const {service,cards,calls}=databases(fake);
 const run=await start(fake); await close(service,fake);
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'deny'}]);
 assert.deepEqual(cards,[]);
 assert.equal(calls.find(([name])=>name==='track_run_permission')?.[1].asking,null);
});

test('a request longer than the card keeps is shortened between characters, never inside one',async()=>{
 const long=`${'a'.repeat(3998)}😀😀b`;
 const fake=asking([{description:long,command:'rm'}]); const {service,cards}=databases(fake);
 await start(fake); await close(service,fake);
 assert.equal(cards[0].content.description,`${'a'.repeat(3998)}😀…`);
});

test('a request whose words carry a NUL or half of a surrogate pair is kept without them, and its choice is delivered',async()=>{
 const fake=asking([{description:'delete the\u0000 old exports \uD800',command:'rm -r exports\u0000'}]); const {service,person,cards}=databases(fake);
 const run=await start(fake); await close(service,fake);
 assert.deepEqual(cards.map(({content,state})=>({content,state})),[{content:{description:'delete the old exports \uFFFD',command:'rm -r exports',choices:['once','always','deny']},state:'open'}]);
 assert.deepEqual(await decide(person,service,fake,'once'),{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true});
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'once'}]);
 assert.equal(cards[0].state,'decided');
});

// Nobody can answer a note's Run: its request is not allowed, at once, as its question is answered with nothing. A
// channel's Run asks the Member who called its Agent (#165), below.
for(const [label,drive,due,close] of /** @type {const} */([['note',driveNoteRuns,'note_runs_due','close_note_run']])) test(`a ${label}'s Run asking to allow an action is not allowed at once, and goes on to its reply`,async()=>{
 const fake=asking();
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:`${label}:1`}));
 const key=encryptSecret('test-only-key',encryptionKey); const closes=/** @type {any[]} */([]);
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name===due) return {data:closes.length?[]:[{message:1,run,connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected',key_encrypted:key}],error:null};
  if(name===close) { closes.push(args); return {data:true,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 assert.deepEqual(await drive(service,{encryptionKey,engineFor:fake.engineFor}),{started:0,closed:0},'the read that finds the request does not close the Run');
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'deny'}]);
 assert.deepEqual(await drive(service,{encryptionKey,engineFor:fake.engineFor}),{started:0,closed:1});
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
  if(name==='channel_runs_due') return ok(closes.length?[]:[{message:7,run,connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected',key_encrypted:key}]);
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
 assert.deepEqual(await driveChannelRuns(service,{encryptionKey,engineFor:fake.engineFor}),{started:0,closed:0},'a Run waiting on its caller is running');
 assert.deepEqual(await driveChannelRuns(service,{encryptionKey,engineFor:fake.engineFor}),{started:0,closed:0});
 assert.deepEqual(requests.map(({permission,content,state})=>({permission,content,state})),[{permission:`${run}_p1`,content:{description:'delete the old exports',command:secret,choices:['once','always','deny']},state:'open'}]);
 assert.deepEqual(calls.filter(([name])=>name==='track_channel_permission').map(([,args])=>[args.message,args.run,args.run_profile]),[[7,run,'writer'],[7,run,'writer']]);
 assert.deepEqual(fake.permits,[],'nothing is sent before the caller decides');
 const later=/** @type {(()=>Promise<void>)[]} */([]);
 assert.deepEqual(await decideChannelPermission(caller,service,{company:'co',channel:'ch',request:1,choice:'once',encryptionKey,engineFor:fake.engineFor,later:deliver=>{ later.push(deliver); }}),
  {state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true});
 assert.deepEqual(fake.permits,[],'nothing is sent before the answer');
 assert.equal(later.length,1);
 await later[0]();
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'once'}]);
 assert.equal(requests[0].state,'decided');
 assert.deepEqual(await decideChannelPermission(caller,service,{company:'co',channel:'ch',request:1,choice:'deny',encryptionKey,engineFor:fake.engineFor,later:deliver=>{ later.push(deliver); }}),
  {state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:false});
 assert.equal(later.length,1,'a press that was not first delivers nothing');
 assert.deepEqual(await driveChannelRuns(service,{encryptionKey,engineFor:fake.engineFor}),{started:0,closed:1});
 assert.equal(closes[0].reply,'Reply to: Clean up (once)');
 assert.equal(fake.permits.length,1,'the choice went once');
});

test('a channel\'s request with no words to show is not allowed at once, and nothing is kept',async()=>{
 const fake=asking([{description:' ',command:''}]);
 const run=/** @type {string} */(await fake.engineFor({}).start({conversation:'s',input:'Clean up',idempotencyKey:'channel:7'}));
 const {service,requests,calls}=channelDatabases(fake,run);
 await driveChannelRuns(service,{encryptionKey,engineFor:fake.engineFor});
 assert.deepEqual(fake.permits,[{run,permission:`${run}_p1`,choice:'deny'}]);
 assert.deepEqual(requests,[]);
 assert.equal(calls.find(([name])=>name==='track_channel_permission')?.[1].asking,null);
});

// The request's words are the Engine's and may name a private file or a customer: no step logs them, also when one
// fails, and the route that takes a press logs nothing of what it was sent.
test('nothing the request says reaches the server\'s log when a step fails, and the route logs no request body',async()=>{
 const fake=asking(); const {service,person}=databases(fake);
 await start(fake);
 const lines=/** @type {string[]} */([]);
 const spied=/** @type {const} */(['log','info','warn','error','debug']).map(level=>[level,console[level]]);
 for(const [level] of spied) console[level]=(/** @type {unknown[]} */ ...values)=>{ lines.push(values.map(value=>value instanceof Error?`${value.message} ${value.stack}`:typeof value==='string'?value:JSON.stringify(value)).join(' ')); };
 try {
  await close(service,fake);
  const failing={...service,rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>name==='track_run_permission'||name==='settle_permission'?{data:null,error:{message:'new row for relation "reply_cards" violates check constraint',code:'23514'}}:service.rpc(name,args)};
  assert.equal(await close(failing,fake),0);
  assert.deepEqual(await decide(person,{...failing,rpc:async()=>{ throw new Error('connection reset'); }},fake,'once'),{state:'decided',choice:'once',at:'2026-06-10T10:20:00.000Z',first:true});
 } finally { for(const [level,write] of spied) console[level]=write; }
 assert.ok(lines.length>=2,'the failures were logged');
 for(const line of lines) for(const word of [secret,'delete the old exports','private-client-list']) assert.ok(!line.includes(word),`${line} names the request`);
 const route=readFileSync('app/api/conversations/route.ts','utf8');
 assert.equal(route.match(/console\./g),null,'the route writes no log line of its own');
 const failures=route.match(/logActionFailure\([^)]*\)/g)||[];
 assert.ok(failures.includes("logActionFailure('conversation',new Error('Conversation request failed')"),'a failed request is logged as a fixed line');
 for(const failure of failures) assert.match(failure,/^logActionFailure\('conversation',new Error\('[^'`$]*'\)$/,`${failure} logs only fixed text`);
});
