import test from 'node:test';
import assert from 'node:assert/strict';
import { ranOutAccounts } from '../lib/ran-out-accounts.mjs';

// #731: when a Conversation's Run ends because every account it could use ran out, the closer reads which subscription
// accounts the Engine's pool marked exhausted, each with its place among its provider's accounts, and the provider of the
// Agent's own model; the database keeps those of the Run's provider. The Engine is a stub here: lib/hermes.mjs reads it.
const connection={address:'http://127.0.0.1:8642',key:'test-only-key',profile:'writer'};
const listed=[{provider:'openai-codex',account:'c0dex1',exhausted:true},{provider:'openai-codex',account:'c0dex2',exhausted:false},
 {provider:'openai-codex',account:'c0dex3',exhausted:true},{provider:'anthropic',account:'c1aude',exhausted:true}];

function engine({accounts={state:'found',accounts:listed},models={state:'found',models:{writer:{provider:'openai-codex',model:'gpt-5.5'}}}}={}) {
 const calls=/** @type {any[]} */([]);
 return {calls,driver:{
  accounts:async(/** @type {any} */ at)=>{ calls.push(['accounts',at.profile]); return accounts; },
  profileModels:async(/** @type {any} */ at,/** @type {string[]} */ profiles)=>{ calls.push(['profileModels',at.profile,profiles]); return models; }}};
}

test('every exhausted subscription account is read from the root pool with its place, beside the Agent\'s own provider',async()=>{
 const {calls,driver}=engine();
 assert.deepEqual(await ranOutAccounts(connection,driver),{ownProvider:'openai-codex',accounts:[
  {provider:'openai-codex',account:'c0dex1',place:1},{provider:'openai-codex',account:'c0dex3',place:3},{provider:'anthropic',account:'c1aude',place:1}]});
 // The pool is the root profile's; the Agent's own model is read by its profile's name.
 assert.deepEqual(calls.sort(),[['accounts','default'],['profileModels','default',['writer']]]);
});

test('a pool that cannot be read names no account, and a profile with no model no provider',async()=>{
 assert.deepEqual(await ranOutAccounts(connection,engine({accounts:{state:'unreachable',accounts:null}}).driver),{ownProvider:'openai-codex',accounts:[]});
 assert.deepEqual(await ranOutAccounts(connection,engine({models:{state:'unreachable',models:null}}).driver).then(read=>read.ownProvider),null);
 const failing={accounts:async()=>{ throw new Error('down'); },profileModels:async()=>{ throw new Error('down'); }};
 assert.deepEqual(await ranOutAccounts(connection,failing),{ownProvider:null,accounts:[]});
 assert.deepEqual(await ranOutAccounts({...connection,profile:''},engine().driver),{ownProvider:null,accounts:[
  {provider:'openai-codex',account:'c0dex1',place:1},{provider:'openai-codex',account:'c0dex3',place:3},{provider:'anthropic',account:'c1aude',place:1}]});
});
