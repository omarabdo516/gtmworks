import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNoEngine, engineServing } from './engine-records.mjs';
import { readCompanySignIns } from '../lib/company-sign-in.mjs';
import { readWorkSandbox } from '../lib/engine/files.mjs';

// A Company whose Engine is not running (#387): its Settings read one plain state (noEngine).
const company='10000000-0000-0000-0000-000000000002';
const profile=`co-${company.replaceAll('-','')}`;
const hermesOf=fake=>({address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'});

// The signed-in person's session, as the sign-in read asks it.
const database={rpc:async name=>name==='company_engine_target'?{data:[{profile,profiles:[profile]}],error:null}:{data:null,error:{message:'unexpected'}}};

test('an Engine that does not answer reads as noEngine', async () => {
 const fake=await engineServing(company);
 try {
  // Both the record's address (engineOf answered null) and an Engine that does not answer are the same one state.
  assert.deepEqual(await withNoEngine(company,()=>readCompanySignIns(database,{company})),{profile:null,profiles:null,signIns:null,noEngine:true});
  fake.settings.managementStatus=500;
  assert.deepEqual(await readCompanySignIns(database,{company}),{profile:null,profiles:null,signIns:null,noEngine:true});
 } finally { await fake.close(); }
});

// #398: the Company's work sandbox is a second container its Engine reaches over ssh. One read of the Engine's own ssh
// workspace names whether it is there, and it answers the same way again once the container runs again, with no restart.
test('a work sandbox that is not running reads as one state, and reads as running again once it answers', async () => {
 const fake=await engineServing(company);
 try {
  fake.settings.sandboxDown=true;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'notRunning'});
  fake.settings.sandboxDown=false;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'running'});
  // The Engine itself not answering is that other state, never "the sandbox is not running".
  fake.settings.managementStatus=500;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'unreachable'});
  assert.deepEqual(await readWorkSandbox(null),{state:'unreachable'});
 } finally { await fake.close(); }
});
