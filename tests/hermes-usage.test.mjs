import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { startRun, readRun } from '../lib/hermes.mjs';

const connection=fake=>({address:fake.address,profile:'writer',key:'test-only-key'});
const started=async fake=>({...connection(fake),run:await startRun({...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'})});

test('a completed run carries the input and output tokens Hermes reported',async()=>{
 const fake=await fakeHermes(); fake.settings.usage={input_tokens:14165,output_tokens:42};
 try {
  assert.deepEqual(await readRun(await started(fake)),{status:'completed',output:'Reply to: Hello',session:'s',usage:{input:14165,output:42}});
 } finally { await fake.close(); }
});

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

test('a run Hermes no longer knows is lost, with unknown usage',async()=>{
 const fake=await fakeHermes();
 try {
  const run=await started(fake);
  fake.settings.runs.length=0;
  assert.deepEqual(await readRun(run),{status:'lost',output:null,session:null,usage:null});
  fake.settings.status=500;
  assert.equal((await readRun(run)).status,'unreachable');
 } finally { await fake.close(); }
});
