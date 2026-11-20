import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { readCompanySignIns } from '../lib/company-sign-in.mjs';
import { sendMessage } from '../lib/conversation-runs.mjs';

// A Company whose Engine is not running (#387): its Settings read one plain state (noEngine), and a message is refused
// with the one plain conversation error without starting or recording a Run. A later send on the same install works
// once the Engine answers again, since every call asks for the Company's Engine anew.
const company='10000000-0000-0000-0000-000000000002';
const profile=`co-${company.replaceAll('-','')}`;
const connection='f9000000-0000-0000-0000-000000000001';
const hermesOf=fake=>({address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'});

// The signed-in person's session and the service role, as the sign-in read and a send ask them.
function databases() {
 const calls=[];
 const rpc=async(name,args)=>{ calls.push({name,args});
  if(name==='company_engine_target') return {data:[{profile,profiles:[profile]}],error:null};
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection,profile,note:null},error:null};
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='pin_lead_brief') return {data:null,error:null};
  if(name==='begin_start') return {data:1,error:null};
  if(name==='release_conversation_run') return {data:true,error:null};
  if(name==='send_conversation_message') return {data:true,error:null};
  return {data:null,error:{message:'unexpected'}};
 };
 const chain=data=>{ const read={select:()=>read,eq:()=>read,maybeSingle:async()=>({data,error:null})}; return read; };
 return {db:{rpc,from:table=>chain(table==='hermes_agents'?{id:'a9000000-0000-0000-0000-000000000001',instructions:null}:null)},service:{rpc},calls};
}

test('an Engine that does not answer reads as noEngine, and a message to it is refused without a Run', async () => {
 const fake=await fakeHermes();
 const {db,service,calls}=databases();
 try {
  // Both the record's address (engineOf answered null) and an Engine that does not answer are the same one state.
  assert.deepEqual(await readCompanySignIns(db,{company,hermes:null}),{profile:null,profiles:null,signIns:null,noEngine:true});
  fake.settings.managementStatus=500;
  assert.deepEqual(await readCompanySignIns(db,{company,hermes:hermesOf(fake)}),{profile:null,profiles:null,signIns:null,noEngine:true});

  fake.settings.status=500;
  const refused=await sendMessage(db,service,{company,conversation:'c',sendKey:'k-1',message:'Are you there?',hermes:hermesOf(fake)});
  assert.deepEqual(refused,{error:'conversationHermesFailed',status:502});
  // The reservation is released, and neither a message nor a Run is recorded.
  assert.deepEqual(calls.filter(call=>call.name==='release_conversation_run').map(call=>call.name),['release_conversation_run']);
  assert.equal(calls.some(call=>call.name==='send_conversation_message'),false);
  assert.equal(fake.settings.runs.length,0);

  // When the Engine answers again the next send starts its Run, with no reload and nothing else changed.
  fake.settings.status=200;
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k-2',message:'Are you there now?',hermes:hermesOf(fake)}),{conversation:'c'});
  assert.equal(fake.settings.runs.length,1);
  assert.equal(calls.filter(call=>call.name==='send_conversation_message').length,1);
 } finally { await fake.close(); }
});

test('a Company with no Engine at all refuses the message the same way, and keeps the Agent for the next one', async () => {
 const fake=await fakeHermes();
 const {db,service,calls}=databases();
 try {
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k-3',message:'Hello',hermes:null}),{error:'conversationHermesFailed',status:502});
  assert.equal(calls.some(call=>call.name==='send_conversation_message'),false);
  assert.equal(fake.settings.runs.length,0);
 } finally { await fake.close(); }
});
