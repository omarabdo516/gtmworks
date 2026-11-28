import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetListeners } from '../lib/engine/transport.mjs';
import { startRun, startUnknown } from '../lib/engine/runs.mjs';

// A start whose outcome was once unknown stays unknown until Hermes names the run (ADR 0015): no later answer can prove
// it never started.
const failing=code=>Object.assign(new TypeError('fetch failed'),{cause:{code}});

test('a retry of an unknown start is never read as not started', async () => {
 const real=globalThis.fetch;
 const start={address:'http://127.0.0.1:8642',profile:'writer',key:'test-only-key',input:'Hello',sessionKey:'s',idempotencyKey:'k',retry:true};
 // Each scripted list starts on a listener with no health kept (the backoff has its own tests, engine-transport.test.mjs).
 const answers=list=>{ forgetListeners(); const queue=[...list]; globalThis.fetch=async()=>{ const next=queue.shift(); if(next instanceof Error) throw next; return new Response(JSON.stringify(typeof next==='string'?{run_id:next}:{error:{message:'x'}}),{status:typeof next==='string'?202:next}); }; };
 try {
  answers([failing('ECONNREFUSED')]); assert.equal(await startRun(start),startUnknown,'nothing connected');
  for(const status of [400,401,409,429,500]) { answers([status]); assert.equal(await startRun(start),startUnknown,String(status)); }
  answers(['run_7']); assert.equal(await startRun(start),'run_7','Hermes names the run');
  assert.equal(await startRun({...start,address:'http://203.0.113.9:8642'}),startUnknown,'an address no longer allowed');
  // The first start of a key can still be refused.
  answers([409]); assert.equal(await startRun({...start,retry:false}),null);
 } finally { globalThis.fetch=real; }
});
