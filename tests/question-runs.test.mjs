import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { answerQuestion, closeOpenRuns, sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #138 on the fake engine: the closer keeps the question a Run asks, delivers each claimed answer before the Run may
// close, and a Run waiting on its person counts as running. The database is a small stand-in for the three question
// functions (supabase/tests/question_cards.sql proves the real ones) that records what the closer asked of it.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const conversation='c1000000-0000-0000-0000-000000000001';
const answerKey='a1000000-0000-0000-0000-000000000001';

function databases(/** @type {ReturnType<typeof fakeEngine>} */ fake) {
 /** @type {{id:number,run:string,question:string,content:any,state:string,key?:string,at:string}[]} */
 const cards=[]; const calls=/** @type {[string,any][]} */([]); const closed=/** @type {Map<string,any>} */(new Map());
 const key=encryptSecret('test-only-key',encryptionKey);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const service={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   if(name==='open_conversation_runs') return ok(fake.runs.filter(run=>!closed.has(run.id)).map((run,index)=>({message:index+1,conversation,run:run.id,person:'p',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'})));
   if(name==='track_run_question') {
    if(args.asking&&!args.ended&&!cards.some(card=>card.run===args.run&&card.question===args.asking.id)) cards.push({id:cards.length+1,run:args.run,question:args.asking.id,content:{question:args.asking.text,choices:args.asking.choices,multiple:args.asking.multiple},state:'open',at:args.read_started_at});
    for(const card of cards) if(card.run===args.run&&card.state==='open'&&(args.ended||card.question!==args.asking?.id&&card.at<args.read_started_at)) card.state='closed';
    return ok(cards.filter(card=>card.run===args.run&&card.state==='sending').map(card=>({card:card.id,question:card.question,answer:card.content.answer})));
   }
   if(name==='settle_question') { const card=cards.find(each=>each.id===args.card); if(card?.state==='sending') card.state=args.verdict; return ok(card?.state); }
   if(name==='close_conversation_run') { closed.set(args.run,args); return ok(true); }
   return {data:null,error:{message:'unexpected'}};
  },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok({key_encrypted:key})}; return chain; },
 };
 const person={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{ calls.push([name,args]);
   if(name==='conversation_agent') return ok('a9000000-0000-0000-0000-000000000001');
   if(name!=='answer_question') return {data:null,error:{message:'unexpected'}};
   const card=args.card===null?cards.find(each=>each.key===args.answer_key)||cards.find(each=>['open','sending'].includes(each.state)):cards.find(each=>each.id===args.card);
   if(!card) return ok('none');
   if(card.key===args.answer_key) return ok('claimed');
   if(card.state!=='open') return ok(card.state==='closed'?'closed':'taken');
   Object.assign(card,{state:'sending',key:args.answer_key,content:{...card.content,answer:args.choice===null?args.answer:card.content.choices[args.choice]}});
   return ok('claimed');
  },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok(null)}; return chain; },
 };
 return {service,person,cards,calls,closed};
}

const asking=()=>{
 const fake=fakeEngine();
 fake.settings.questions=()=>[{text:'  Which audience first?\n',choices:['Parents','Students','Teachers']}];
 fake.settings.reply=(input,answers)=>`Reply to: ${input} (${answers.map(answer=>answer??'unanswered').join(', ')})`;
 return fake;
};
const start=async(/** @type {ReturnType<typeof fakeEngine>} */ fake)=>/** @type {string} */(await fake.engineFor({}).start({conversation,input:'Plan the ads',idempotencyKey:`${conversation}:k`}));
const close=(/** @type {any} */ service,/** @type {ReturnType<typeof fakeEngine>} */ fake)=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});

test('a pick: the question is kept once while its Run waits, the choice is delivered once, and the same Run then closes with its reply',async()=>{
 const fake=asking(); const {service,person,cards,calls,closed}=databases(fake);
 const run=await start(fake);
 assert.equal(await close(service,fake),0,'a Run waiting on its person is running');
 assert.equal(await close(service,fake),0);
 assert.deepEqual(cards.map(({run,question,content,state})=>({run,question,content,state})),[{run,question:`${run}_q1`,content:{question:'Which audience first?',choices:['Parents','Students','Teachers'],multiple:false},state:'open'}]);
 assert.deepEqual(await answerQuestion(person,service,{company:'co',conversation,card:1,choice:1,answerKey,encryptionKey,engineFor:fake.engineFor}),{state:'claimed'});
 assert.deepEqual(fake.answers,[{run,question:`${run}_q1`,text:'Students'}]);
 assert.equal(cards[0].state,'answered');
 assert.deepEqual(await answerQuestion(person,service,{company:'co',conversation,card:1,choice:0,answerKey:'a1000000-0000-0000-0000-000000000002',encryptionKey,engineFor:fake.engineFor}),{state:'taken'},'a second click elsewhere');
 assert.equal(fake.answers.length,1,'and nothing more is sent');
 assert.equal(await close(service,fake),1);
 assert.equal(closed.get(run).reply,'Reply to: Plan the ads (Students)');
 assert.equal(fake.runs.length,1,'no second Run');
 assert.deepEqual(calls.filter(([name])=>name==='settle_question').map(([,args])=>args),[{card:1,verdict:'answered'}]);
});

test('a free answer: a typed message while the question is open is its answer, starts no Run, and the same send key finds the same answer',async()=>{
 const fake=asking(); const {service,person,cards,calls}=databases(fake);
 const run=await start(fake); await close(service,fake);
 const send=()=>sendMessage(person,service,{company:'co',conversation,sendKey:answerKey,message:'Graduates, 22 to 30',encryptionKey,engineFor:fake.engineFor});
 assert.deepEqual(await send(),{conversation,answered:true});
 assert.deepEqual(await send(),{conversation,answered:true});
 assert.deepEqual(fake.answers,[{run,question:`${run}_q1`,text:'Graduates, 22 to 30'}]);
 assert.equal(cards[0].state,'answered');
 assert.ok(!calls.some(([name])=>name==='reserve_conversation_turn'),'never queued, never a new Run');
 assert.equal(fake.runs.length,1);
});

test('a time limit: once the engine stops waiting the card closes, an answer claimed late is closed too, and the Run goes on to its reply',async()=>{
 const fake=asking(); const {service,person,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 fake.expire(run);
 // A read that began before the card was kept says nothing about it; the next one begins after.
 cards[0].at=new Date(Date.parse(cards[0].at)-1000).toISOString();
 assert.equal(await close(service,fake),1);
 assert.equal(cards[0].state,'closed');
 assert.equal(closed.get(run).reply,'Reply to: Plan the ads (unanswered)');
 assert.deepEqual(await answerQuestion(person,service,{company:'co',conversation,card:1,choice:0,answerKey,encryptionKey,engineFor:fake.engineFor}),{state:'closed'});
 assert.deepEqual(fake.answers,[]);
});

test('a stop: the stopped Run closes its question and ends stopped; an answer claimed meanwhile is delivered as gone and closes',async()=>{
 const fake=asking(); const {service,person,cards,closed}=databases(fake);
 const run=await start(fake); await close(service,fake);
 assert.equal(await fake.engineFor({}).stop(run),true);
 fake.settings.unreachableAnswers=1;
 assert.deepEqual(await answerQuestion(person,service,{company:'co',conversation,card:1,choice:2,answerKey,encryptionKey,engineFor:fake.engineFor}),{state:'claimed'});
 assert.equal(cards[0].state,'sending','an engine that could not be asked holds the answer');
 assert.equal(closed.size,0,'and the Run with it');
 assert.equal(await close(service,fake),1);
 assert.equal(cards[0].state,'closed');
 assert.equal(closed.get(run).run_outcome,'stopped');
 assert.deepEqual(fake.answers.map(answer=>answer.text),['Teachers','Teachers'],'the same answer again');
});

test('a question longer than the card keeps is shortened between characters, never inside one',async()=>{
 const fake=fakeEngine(); const long=`${'a'.repeat(3998)}😀😀b`;
 fake.settings.questions=()=>[{text:long,choices:['Yes','No']}];
 const {service,cards}=databases(fake);
 await start(fake); await close(service,fake);
 const kept=cards[0].content.question;
 assert.equal(kept,`${'a'.repeat(3998)}😀…`);
 assert.ok(kept.isWellFormed(),'no half of a surrogate pair is left');
});
