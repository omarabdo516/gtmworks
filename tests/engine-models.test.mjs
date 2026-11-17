import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #158: an Agent's models are the Engine's own list for its profile, and a Run may run on one of them.
const writer={soul:'',provider:'anthropic',model:'claude-opus-4-6',key:'test-only-key',config:{},credentials:{anthropic:'signed-in'},env:{OPENROUTER_API_KEY:'set'}};
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'writer',key:'test-only-key'});
const message={conversation:'conversation-1',input:'Plan the launch post',idempotencyKey:'conversation-1:message-1'};

test('a Run with a chosen model is sent with its provider and model, and one with no choice is sent as before',async()=>{
 const fake=await fakeHermes(); fake.settings.profiles.set('writer',writer);
 try {
  const engine=engineFor(connection(fake));
  assert.equal(typeof await engine.start({...message,model:{provider:'openrouter',model:'openai/gpt-5.5'}}),'string');
  assert.equal(typeof await engine.start({...message,idempotencyKey:'conversation-1:message-2'}),'string');
  assert.deepEqual(fake.settings.runs.map(run=>JSON.parse(run.body)),[
   {input:'Plan the launch post',provider:'openrouter',model:'openai/gpt-5.5'},
   {input:'Plan the launch post'}]);
 } finally { await fake.close(); }
});

test('a model the Engine refuses does not start the Run',async()=>{
 const fake=await fakeHermes(); fake.settings.profiles.set('writer',writer);
 try {
  fake.settings.refusedModels.add('openai/gpt-5.5');
  assert.equal(await engineFor(connection(fake)).start({...message,model:{provider:'openrouter',model:'openai/gpt-5.5'}}),null);
  assert.deepEqual(fake.settings.runs,[]);
 } finally { await fake.close(); }
});

test('an Agent\'s models are read from /api/model/options for its profile, with the one in use',async()=>{
 const fake=await fakeHermes(); fake.settings.profiles.set('writer',{...writer,credentials:{}});
 // A current provider that lost its sign-in is listed unauthenticated, and offers nothing.
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.models(),{state:'found',current:{provider:'anthropic',model:'claude-opus-4-6'},models:[
   {provider:'openrouter',providerName:'OpenRouter',model:'anthropic/claude-opus-4.6'},
   {provider:'openrouter',providerName:'OpenRouter',model:'openai/gpt-5.5'}]});
  fake.settings.profiles.set('writer',writer);
  assert.deepEqual((await engine.models()).models.map(({provider,model})=>`${provider}:${model}`),['anthropic:claude-opus-4-6','openrouter:anthropic/claude-opus-4.6','openrouter:openai/gpt-5.5']);
  assert.ok(fake.settings.managementRequests.some(request=>request.path==='/api/model/options?profile=writer'));
  fake.settings.modelOptionsFail=true;
  assert.deepEqual(await engine.models(),{state:'unreachable',current:null,models:[]});
 } finally { await fake.close(); }
});
