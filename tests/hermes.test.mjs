import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { testHermes } from '../lib/hermes.mjs';

test('Test connection authenticates the selected profile and reads the tested version',async()=>{
 const fake=await fakeHermes();
 try {
  assert.deepEqual(await testHermes({address:fake.address,profile:'writer',key:'test-only-key'}),{state:'connected',version:'0.23.0',features:['run_submission','run_events_sse']});
  assert.deepEqual(fake.settings.requests.map(request=>request.path),['/p/writer/v1/capabilities','/p/writer/health']);
  assert.ok(fake.settings.requests.every(request=>request.authorization==='Bearer test-only-key'));
 } finally { await fake.close(); }
});

test('wrong keys, outages and unknown versions never offer agent features',async()=>{
 const fake=await fakeHermes(); const input={address:fake.address,profile:'writer',key:'test-only-key'};
 try {
  for(const status of [401,403]) {
   fake.settings.status=status;
   assert.deepEqual(await testHermes(input),{state:'refused',version:null,features:[]});
  }
  fake.settings.status=503;
  assert.deepEqual(await testHermes(input),{state:'unreachable',version:null,features:[]});
  fake.settings.status=302;
  assert.deepEqual(await testHermes(input),{state:'unreachable',version:null,features:[]});
  assert.ok(!fake.settings.requests.some(request=>request.path==='/must-not-follow'));
  fake.settings.status=200; fake.settings.version='0.24.0';
  assert.deepEqual(await testHermes(input),{state:'untested_version',version:'0.24.0',features:[]});
  fake.settings.version='remote error containing test-only-key';
  assert.deepEqual(await testHermes(input),{state:'untested_version',version:null,features:[]});
 } finally { await fake.close(); }
 assert.deepEqual(await testHermes(input),{state:'unreachable',version:null,features:[]});
});
