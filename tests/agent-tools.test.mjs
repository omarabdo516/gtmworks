import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runToolCall } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

const profile='co-10000000000000000000000000000001';
function harness(/** @type {object} */ engineOverride={},/** @type {object} */ answer={state:'created',agent:'agent-1'}) {
 const fake=fakeEngine(); const engine={...fake.engineFor({}),...engineOverride}; const rpcs=/** @type {[string,object][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {object} */ args)=>{ rpcs.push([name,args]); return {data:answer,error:null}; }};
 const call=(/** @type {string} */ name,/** @type {unknown} */ args)=>runToolCall({db,engine,profile,conversation:'conversation-1',run:'run-1'},{id:'call-0',name,arguments:args});
 return {fake,engine,rpcs,call};
}
const asked={name:' Meta Ads ',job:'Runs the Meta ads. ',apps:['Meta Ads Manager',' Canva']};

test('an unknown tool or arguments that do not read are ignored, and nothing is asked of the Engine or the database',async()=>{
 const {fake,rpcs,call}=harness();
 for(const [name,args] of /** @type {[string,unknown][]} */([['delete_company',asked],['create_agent',null],['create_agent',{...asked,name:'x'.repeat(101)}],['create_agent',{...asked,job:' '}],
  ['create_agent',{...asked,apps:Array(9).fill('Canva')}],['create_agent',{...asked,apps:['x'.repeat(41)]}],['create_agent',{...asked,apps:[7]}],['create_agent',{...asked,name:'Meta\u0000Ads'}],['create_agent',{...asked,apps:['Can\u0000va']}],['create_agent',{name:'Meta Ads',job:'Runs ads.'}]]))
  assert.deepEqual(await call(name,args),{state:'ignored'},`${name} ${JSON.stringify(args)?.slice(0,60)}`);
 assert.deepEqual([fake.agentReads,rpcs],[[],[]]);
});

test('create_agent makes nothing while the Engine lacks the Company\'s profile, then asks the database once it is ready',async()=>{
 const {fake,engine,rpcs,call}=harness();
 assert.deepEqual(await call('create_agent',asked),{state:'engineNotReady'});
 assert.deepEqual([fake.agentReads,rpcs],[[profile],[]]);
 await engine.createAgent({name:profile,instructions:''});
 assert.deepEqual(await call('create_agent',asked),{state:'created',agent:'agent-1'});
 assert.deepEqual(rpcs,[['lead_create_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}]]);
 assert.deepEqual(await call('create_agent',{name:'x'.repeat(100),job:'Writes.',apps:Array(8).fill('y'.repeat(40))}),{state:'created',agent:'agent-1'});
 assert.deepEqual(await call('create_agent',{...asked,apps:[]}),{state:'created',agent:'agent-1'});
});

test('create_agent asks nothing of the database while the Engine does not answer, so the run stays open for a retry',async()=>{
 const {rpcs,call}=harness({readAgent:async()=>({state:'unreachable',agent:null})});
 assert.deepEqual(await call('create_agent',asked),{state:'engineUnreachable'});
 assert.deepEqual(rpcs,[]);
});

test('a save_rule call whose rule does not read is ignored, and nothing is asked of the database',async()=>{
 const {fake,rpcs,call}=harness();
 for(const args of /** @type {unknown[]} */([null,{},{rule:'  '},{rule:7},{rule:'x'.repeat(501)},{rule:'من دلوقتي\u0000'}]))
  assert.deepEqual(await call('save_rule',args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual([fake.agentReads,rpcs],[[],[]]);
});

test('save_rule asks the database with the trimmed rule, whatever the Engine\'s profile, and answers what it saved',async()=>{
 const {fake,rpcs,call}=harness({},{state:'saved',rule:'rule-1'});
 assert.deepEqual(await call('save_rule',{rule:' من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها\n'}),{state:'saved',rule:'rule-1'});
 assert.deepEqual(rpcs,[['agent_save_rule',{conversation:'conversation-1',run:'run-1',call:'call-0',rule:'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها'}]]);
 assert.deepEqual(fake.agentReads,[]);
 await call('save_rule',{rule:'y'.repeat(500)});
 assert.equal(rpcs.length,2);
});
