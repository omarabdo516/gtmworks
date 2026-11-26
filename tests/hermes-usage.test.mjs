import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { startRun, readRun } from '../lib/engine/runs.mjs';
import { readUsage } from '../lib/engine/sessions.mjs';

const connection=fake=>({address:fake.address,profile:'writer',key:'test-only-key'});
const started=async fake=>({...connection(fake),run:await startRun({...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'})});

test('a stopped run keeps what Hermes reported, and a run with no report has unknown usage, not zero',async()=>{
 const fake=await fakeHermes(); fake.settings.ending='cancelled'; fake.settings.usage={input_tokens:900,output_tokens:7};
 try {
  const run=await started(fake);
  assert.deepEqual(await readRun(run),{status:'cancelled',output:null,session:'s',usage:{input:900,output:7}});
  fake.settings.usage=undefined;
  assert.deepEqual(await readRun(run),{status:'cancelled',output:null,session:'s',usage:null});
  fake.settings.usage={input_tokens:'many',output_tokens:-1};
  assert.equal((await readRun(run)).usage,null);
 } finally { await fake.close(); }
});


// #347: an Agent's token use is its Hermes profile's own (the management listener's usage analytics over the last days,
// hermes_cli/web_routers/analytics.py get_usage_analytics); gtmworks keeps no count. Another profile's sessions and a
// session older than the period are not counted. #32: the per-model rows Hermes answers are kept without their price;
// Hermes merges auxiliary usage into them, so they are each model's own count, never a second total to add up.
test('a profile\'s token use over the last days is read from Hermes with its per-model rows and no price, and is unknown when Hermes cannot be asked',async()=>{
 const fake=await fakeHermes();
 try {
  const now=Date.now()/1000; const management={address:fake.address,managementAddress:fake.managementAddress,profile:'co-usage',key:fake.settings.key};
  fake.settings.sessions.set('a',{profile:'co-usage',messages:[],input_tokens:1200,output_tokens:34,model:'anthropic/claude-opus-4.6',started_at:now-3600});
  fake.settings.sessions.set('b',{profile:'co-usage',messages:[],input_tokens:800,output_tokens:6,model:'anthropic/claude-opus-4.6',started_at:now-5*86400});
  fake.settings.sessions.set('c',{profile:'co-usage',messages:[],input_tokens:70,output_tokens:3,model:'openai/gpt-5.5',started_at:now-3600});
  fake.settings.sessions.set('d',{profile:'co-other',messages:[],input_tokens:5000,output_tokens:60,model:'openai/gpt-5.5',started_at:now-3600});
  const week=await readUsage(management,7);
  assert.deepEqual(week,{state:'found',input:2070,output:43,sessions:3,models:[
   {model:'anthropic/claude-opus-4.6',input:2000,output:40,sessions:2},
   {model:'openai/gpt-5.5',input:70,output:3,sessions:1}]});
  // No price reaches gtmworks, and no cost field is made up in its place.
  assert.equal(JSON.stringify(week).match(/cost|price|currency/i),null);
  assert.deepEqual(await readUsage(management,1),{state:'found',input:1270,output:37,sessions:2,models:[
   {model:'anthropic/claude-opus-4.6',input:1200,output:34,sessions:1},
   {model:'openai/gpt-5.5',input:70,output:3,sessions:1}]});
  assert.deepEqual(await readUsage({...management,profile:'co-none'},7),{state:'found',input:0,output:0,sessions:0,models:[]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path==='/api/analytics/usage?profile=co-usage&days=7'));
  assert.deepEqual(await readUsage({...management,key:'wrong'},7),{state:'refused',input:null,output:null,sessions:null,models:null});
  assert.deepEqual(await readUsage({...management,address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2'},7),{state:'unreachable',input:null,output:null,sessions:null,models:null});
 } finally { await fake.close(); }
});
