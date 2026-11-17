import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #203 on the fake engine: an Agent's ask_for_app calls are carried out when its Run closes. A listed app its profile
// does not have connected keeps one card for its Run and call, however often the Run is closed; an app off the list, or
// one already connected for that Agent, keeps none; each Run still closes with its reply. The database is a small
// stand-in for agent_show_card (supabase/tests/connect_cards.sql proves the real one) that keeps a card once per run and
// call, as the real one does.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const conversation='c2030000-0000-0000-0000-000000000001';

function database(/** @type {ReturnType<typeof fakeEngine>} */ fake) {
 /** @type {{run:string,call:string,kind:string,title:string,content:unknown,state:string}[]} */
 const cards=[]; const closed=/** @type {Map<string,any>} */(new Map());
 const key=encryptSecret('test-only-key',encryptionKey);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 return {cards,closed,service:{
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
   if(name==='open_conversation_runs') return ok(fake.runs.filter(run=>!closed.has(run.id)).map((run,index)=>({message:index+1,conversation,run:run.id,person:'p',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'ag-writer',state:'connected'})));
   if(name==='track_run_question'||name==='track_run_permission') return ok([]);
   if(name==='agent_show_card') {
    let index=cards.findIndex(card=>card.run===args.run&&card.call===args.call);
    if(index<0) index=cards.push({run:args.run,call:args.call,kind:args.kind,title:args.title,content:args.content,state:'open'})-1;
    return ok({state:'shown',card:index+1});
   }
   if(name==='close_conversation_run') { if(closed.has(args.run)) return ok(false); closed.set(args.run,args); return ok(true); }
   return {data:null,error:{message:`unexpected ${name}`}};
  },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok({key_encrypted:key})}; return chain; },
 }};
}

test('a listed app not connected for the Agent keeps one card for its Run and call however often the Run is closed, an unknown or connected app keeps none, and each Run closes with its reply',async()=>{
 const fake=fakeEngine();
 fake.settings.apps={notion:'connected',amplitude:'off'};
 const reason='مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً.';
 /** @type {Record<string,{app:string,reason:string}>} */
 const asks={'Weekly report':{app:'amplitude',reason},'Sales from GA4':{app:'ga4',reason:'Needed for sales'},'Read the briefs':{app:'notion',reason:'To read the briefs'}};
 fake.settings.toolCalls=input=>[{id:'call-0',name:'ask_for_app',arguments:asks[input]}];
 const {service,cards,closed}=database(fake);
 const runs=[];
 for(const input of Object.keys(asks)) runs.push(await fake.engineFor({}).start({conversation,input,idempotencyKey:`${conversation}:${input}`}));
 const close=()=>closeOpenRuns(/** @type {any} */(service),{encryptionKey,conversation,engineFor:fake.engineFor});
 assert.equal(await close(),3);
 assert.equal(await close(),0,'a second close finds nothing open');
 assert.deepEqual(cards,[{run:runs[0],call:'call-0',kind:'connect',title:'Amplitude',content:{app:'amplitude',reason},state:'open'}]);
 assert.deepEqual(runs.map(run=>closed.get(run)?.reply),Object.keys(asks).map(input=>`Reply to: ${input}`));
 // A closer that reads the Run again, as a second closer racing the first does, keeps the same one card.
 closed.delete(runs[0]);
 assert.equal(await close(),1);
 assert.equal(cards.length,1);
});

test('while the Engine cannot say which apps the Agent has, the Run stays open and keeps nothing, and the next close keeps its card',async()=>{
 const fake=fakeEngine();
 fake.settings.apps='unreachable';
 fake.settings.toolCalls=()=>[{id:'call-0',name:'ask_for_app',arguments:{app:'canva',reason:'For the designs'}}];
 const {service,cards,closed}=database(fake);
 const run=await fake.engineFor({}).start({conversation,input:'Make the post',idempotencyKey:`${conversation}:post`});
 const close=()=>closeOpenRuns(/** @type {any} */(service),{encryptionKey,conversation,engineFor:fake.engineFor});
 assert.equal(await close(),0);
 assert.deepEqual([cards,closed.size],[[],0]);
 fake.settings.apps={canva:'attention'};
 assert.equal(await close(),1);
 assert.deepEqual(cards.map(card=>[card.run,card.content]),[[run,{app:'canva',reason:'For the designs'}]]);
});
