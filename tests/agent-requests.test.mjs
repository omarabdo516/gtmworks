import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerRequest } from '../lib/agent-requests.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { fakeEngine } from './fake-engine.mjs';

const company='10000000-0000-0000-0000-000000000001';
const profile='co-10000000000000000000000000000001';
const encryptionKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
// The Owner's session (company_engine_target, answer_agent_request) and the service role that reads only the bundled
// Connection's key.
function harness(/** @type {{error?:{code:string,message:string}|null,data?:unknown,target?:unknown}} */ {error=null,data='made',target={connection:'connection-1',address:'http://127.0.0.1:9',profile}}={}) {
 const fake=fakeEngine(); const rpcs=/** @type {[string,object][]} */([]); const keys=/** @type {object[]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {object} */ args)=>{ rpcs.push([name,args]); return name==='company_engine_target'?{data:target?[target]:[],error:null}:{data:error?null:data,error}; }};
 const where=/** @type {Record<string,string>} */({});
 const service={from:()=>({select:()=>{ const chain={eq:(/** @type {string} */ column,/** @type {string} */ value)=>{ where[column]=value; return chain; },maybeSingle:async()=>{ keys.push({...where}); return {data:{key_encrypted:encryptSecret('install-key',encryptionKey)},error:null}; }}; return chain; }})};
 const answer=(/** @type {{make:boolean,reason?:string|null}} */ given)=>answerRequest(db,service,{company,request:7,encryptionKey,engineFor:connection=>fake.engineFor(connection),...given});
 return {fake,rpcs,keys,answer};
}

test('«Make it» answers that the Engine is not ready, and asks the database nothing, until it has the Company\'s profile',async()=>{
 const {fake,rpcs,keys,answer}=harness();
 assert.equal(await answer({make:true}),'engineNotReady');
 assert.deepEqual(rpcs.map(([name])=>name),['company_engine_target']);
 assert.deepEqual(keys,[{id:'connection-1',company_id:company}],'only the Company\'s bundled Connection key is read');
 assert.deepEqual(fake.connections,[{address:'http://127.0.0.1:9',profile,key:'install-key'}]);
 await fake.engineFor({}).createAgent({name:profile,instructions:''});
 assert.equal(await answer({make:true}),'made');
 assert.deepEqual(rpcs.at(-1),['answer_agent_request',{c:company,request:7,make:true,reason:null}]);
});

test('«Make it» answers that the Engine did not answer, and a Company with no profile of its own is not ready',async()=>{
 const {fake,rpcs,answer}=harness();
 const engineFor=fake.engineFor;
 fake.engineFor=connection=>({...engineFor(connection),readAgent:async()=>({state:'unreachable',agent:null})});
 assert.equal(await answer({make:true}),'engineUnreachable');
 assert.equal(await harness({target:null}).answer({make:true}),'engineNotReady');
 assert.deepEqual(rpcs.map(([name])=>name),['company_engine_target']);
});

test('«No» asks no Engine and sends the reason as written',async()=>{
 const {fake,rpcs,answer}=harness({data:'declined'});
 assert.equal(await answer({make:false,reason:'Ads follows WhatsApp leads now.'}),'declined');
 assert.deepEqual(rpcs,[['answer_agent_request',{c:company,request:7,make:false,reason:'Ads follows WhatsApp leads now.'}]]);
 assert.deepEqual([fake.agentReads,fake.connections],[[],[]]);
});

test('each refusal of the database is one answer, and anything else is a failure',async()=>{
 for(const [code,message,state] of [['42501','agentRequestNotAllowed','notAllowed'],['P0002','agentRequestNotFound','notFound'],['55000','agentRequestNotMade','notMade'],
  ['22023','agentRequestAnswered','answered'],['22023','agentRequestReasonMissing','reasonMissing'],['22023','agentRequestAnswerMissing','failed'],['XX000','boom','failed']])
  assert.equal(await harness({error:{code,message}}).answer({make:false,reason:'No'}),state,`${code} ${message}`);
});
