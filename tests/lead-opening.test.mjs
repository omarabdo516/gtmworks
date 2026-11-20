import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openOnVisit } from '../lib/lead-opening.mjs';

// #434: an Owner's visit to Lead asks the database to open the first Conversation only when the Company has a model for
// sure, with Lead's words in the Owner's language; a "no" or a read that could not tell asks nothing.
const visit={company:'10000000-0000-0000-0000-000000000001',person:'20000000-0000-0000-0000-000000000001',conversation:'e4340000-0000-0000-0000-000000000001',owner:'Omar Abdo',lead:'Lead',companyName:'RS Learning'};
const service=answer=>{ const calls=[]; return {calls,rpc:async(name,args)=>{ calls.push([name,args]); return answer; }}; };

test('no model, or a read that could not tell, opens nothing and asks the database nothing',async()=>{
 for(const model of [false,null,Promise.resolve(null)]) {
  const db=service({data:'x',error:null});
  assert.equal(await openOnVisit(db,{...visit,model,language:'en'}),null);
  assert.deepEqual(db.calls,[]);
 }
});

test('with a model, Lead\'s opening in the Owner\'s language is written, greeting them by first name, and the Conversation is answered',async()=>{
 const db=service({data:visit.conversation,error:null});
 assert.equal(await openOnVisit(db,{...visit,model:Promise.resolve(true),language:'en'}),visit.conversation);
 const [[name,args]]=db.calls;
 assert.equal(name,'open_first_conversation');
 assert.deepEqual({c:args.c,person:args.person,conversation:args.conversation},{c:visit.company,person:visit.person,conversation:visit.conversation});
 assert.match(args.body,/^Hi Omar, I’m Lead, and I manage RS Learning’s team of agents\./);
 assert.match(args.body,/1\. What does RS Learning sell\?\n2\. Who buys it\?\n3\. What’s the goal right now\?$/);
 const arabic=service({data:null,error:null});
 assert.equal(await openOnVisit(arabic,{...visit,model:true,language:'ar'}),null,'a Company not to be opened answers null');
 assert.match(arabic.calls[0][1].body,/^أهلاً يا Omar، أنا Lead، وأنا اللي بدير فريق وكلاء RS Learning\./);
 await assert.rejects(openOnVisit(service({data:null,error:{message:'refused'}}),{...visit,model:true,language:'en'}),/refused/);
});
