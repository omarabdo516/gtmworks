import test from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { companyEngine } from '../lib/engine/handle.mjs';
import { ranOutAccounts } from '../lib/ran-out-accounts.mjs';

// #731: when a Conversation's Run ends because every account it could use ran out, the closer reads which subscription
// accounts the Engine's pool marked exhausted, each with its place among its provider's accounts, and the provider of the
// Agent's own model; the database keeps those of the Run's provider. The Engine is the Hermes wire fake, reached through
// the Company's Engine handle.
const company='10000000-0000-0000-0000-000000000031';
const row=(/** @type {string} */ id,/** @type {boolean} */ exhausted,priority=0)=>({id,label:id,auth_type:/** @type {const} */('oauth'),source:'manual:device_code',priority,access_token:`token-${id}`,last_status:exhausted?'exhausted':null});
async function engine() {
 const fake=await engineServing(company);
 fake.settings.defaultPool['openai-codex']=[row('c0dex1',true,0),row('c0dex2',false,1),row('c0dex3',true,2)];
 fake.settings.defaultPool.anthropic=[row('c1aude',true,0)];
 fake.settings.profiles.set('writer',{soul:'',provider:'openai-codex',model:'gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 return fake;
}

test('every exhausted subscription account is read from the root pool with its place, beside the Agent\'s own provider',async()=>{
 const fake=await engine();
 try {
  const at=/** @type {any} */(await companyEngine(company));
  assert.deepEqual(await ranOutAccounts(at,'writer'),{ownProvider:'openai-codex',accounts:[
   {provider:'openai-codex',account:'c0dex1',place:1},{provider:'openai-codex',account:'c0dex3',place:3},{provider:'anthropic',account:'c1aude',place:1}]});
 } finally { await fake.close(); }
});

test('a pool that cannot be read names no account, and a profile with no model no provider',async()=>{
 const fake=await engine();
 try {
  const at=/** @type {any} */(await companyEngine(company));
  fake.settings.poolFail=true;
  assert.deepEqual(await ranOutAccounts(at,'writer'),{ownProvider:'openai-codex',accounts:[]});
  fake.settings.poolFail=false;
  assert.deepEqual((await ranOutAccounts(at,'nobody')).ownProvider,null);
  assert.deepEqual((await ranOutAccounts(at,'')).accounts.length,3,'no profile reads the pool alone');
 } finally { await fake.close(); }
 // An Engine that does not answer names nothing.
 const gone=await engine(); const at=/** @type {any} */(await companyEngine(company)); await gone.close();
 assert.deepEqual(await ranOutAccounts(at,'writer'),{ownProvider:null,accounts:[]});
});
