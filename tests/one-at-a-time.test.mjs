import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneAtATime } from '../lib/one-at-a-time.mjs';
import { changeCompanySetting } from '../lib/engine-settings.mjs';

// #436: the per-Company queue every Engine-settings writer and the Company knowledge saves take.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('work for one key runs after the work before it has ended, a failure included, and other keys do not wait',async()=>{
 const queue=oneAtATime();
 const order=[];
 const step=(name,ms,fail=false)=>async()=>{ order.push(`${name} start`); await pause(ms); order.push(`${name} end`); if(fail) throw new Error(name); return name; };
 const first=queue('a',step('a1',40,true));
 const second=queue('a',step('a2',5));
 const other=queue('b',step('b1',5));
 await assert.rejects(first,/a1/);
 assert.equal(await second,'a2');
 assert.equal(await other,'b1');
 assert.deepEqual(order,['a1 start','b1 start','b1 end','a1 end','a2 start','a2 end']);
});

test('one Company spelled in two letter cases is one queue for its setting writes',async()=>{
 const upper='ABCDEF00-0000-0000-0000-000000000001';
 const order=[];
 // A database that refuses every write as not the Owner's, so each call ends right after its turn's first step.
 const db={rpc:async()=>({data:false,error:null})};
 const ready=name=>async()=>{ order.push(`${name} start`); await pause(30); order.push(`${name} end`); return true; };
 const results=await Promise.all([
  changeCompanySetting(db,{company:upper,setting:'model',value:'openrouter/openai/gpt-5.4',hermes:null,ready:ready('upper')}),
  changeCompanySetting(db,{company:upper.toLowerCase(),setting:'model',value:'openrouter/openai/gpt-5.4',hermes:null,ready:ready('lower')}),
 ]);
 assert.deepEqual(results.map(result=>result.state),['notAllowed','notAllowed']);
 assert.deepEqual(order,['upper start','upper end','lower start','lower end']);
});
