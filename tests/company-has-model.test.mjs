import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyHasModel } from '../lib/provider-keys.mjs';

// #422: before the first message, a Company with no model at all says so. It has one when its shared space holds a
// provider key or its Engine holds a subscription sign-in; what cannot be read claims nothing.
const db={rpc:async name=>({data:name==='company_engine_target'?[{profile:'co-1',profiles:['co-1']}]:name==='company_key_profiles'?[{profile:'cs-1',kind:'space'}]:null,error:null})};
const hermes={address:'http://127.0.0.1:9',key:'test-only-key'};
const keys=(...set)=>async()=>({state:'found',keys:[{provider:'openrouter',label:'OpenRouter',set:set.includes('openrouter')},{provider:'anthropic',label:'Anthropic',set:false}]});
const signIns=(...connected)=>async()=>({state:'found',signIns:Object.fromEntries(['openai-codex','anthropic'].map(id=>[id,{connected:connected.includes(id),flow:'external'}]))});
const has=driver=>companyHasModel(db,{company:'c',hermes,driver});

test('a key or a subscription is a model; neither is none',async()=>{
 assert.equal(await has({keys:keys('openrouter'),signIns:signIns()}),true);
 assert.equal(await has({keys:keys(),signIns:signIns('anthropic')}),true);
 assert.equal(await has({keys:keys(),signIns:signIns()}),false);
});

test('a key read first spares the sign-in read',async()=>{
 let asked=0;
 assert.equal(await has({keys:keys('openrouter'),signIns:async()=>{ asked++; return signIns()(); }}),true);
 assert.equal(asked,0);
});

test('an Engine that cannot be read, or none, claims nothing',async()=>{
 const unreachable=async()=>({state:'unreachable',keys:null,signIns:null});
 assert.equal(await has({keys:unreachable,signIns:signIns()}),null);
 assert.equal(await has({keys:keys(),signIns:unreachable}),null);
 assert.equal(await companyHasModel(db,{company:'c',hermes:null,driver:{keys:keys(),signIns:signIns()}}),null);
});
