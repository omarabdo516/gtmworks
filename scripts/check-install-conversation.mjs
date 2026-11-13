// CI runs this on stdin inside /app in the installed web container, after pointing the bundled Hermes at the fake model
// provider this script serves on http://web:8080/v1 (no subscription). It proves the bundled Hermes (ADR 0010) answers
// /health on the compose network, and that a company Owner's Arabic message gets its reply with no manual connection
// step: the worker provides the company's Hermes by itself, and closes the run with the reply.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);

const health=await fetch('http://hermes:8642/health');
assert.equal(health.status,200);
assert.equal((await health.json()).platform,'hermes-agent');

// An OpenAI-compatible chat completions endpoint that always gives one Arabic reply, streamed or not.
const reply='أهلاً، هذا رد من النموذج التجريبي.';
const asked=[];
const model=createServer((request,response)=>{
 let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
  if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
  const body=JSON.parse(raw||'{}'); asked.push(body);
  const usage={prompt_tokens:20,completion_tokens:8,total_tokens:28};
  if(!body.stream) { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify({id:'fake',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:{role:'assistant',content:reply},finish_reason:'stop'}],usage})); }
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(choices,extra={})=>response.write(`data: ${JSON.stringify({id:'fake',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
  chunk([{index:0,delta:{role:'assistant',content:reply},finish_reason:null}]);
  chunk([{index:0,delta:{},finish_reason:'stop'}]);
  chunk([],{usage});
  response.end('data: [DONE]\n\n');
 });
});
await new Promise(resolve=>model.listen(8080,'0.0.0.0',resolve));

try {
 const origin='http://gateway:8080';
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
 const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
 const credentials={email:'bundled-hermes@example.com',password:`Bundled-${randomUUID()}`};
 const {user}=await checked(service.auth.admin.createUser({...credentials,email_confirm:true}));
 await checked(service.from('people').insert({id:user.id,name:'Bundled Hermes Check'}));
 const company=randomUUID();
 await checked(service.from('companies').insert({id:company,slug:`bundled-${company.slice(0,8)}`,name:'Bundled Hermes'}));
 await checked(service.from('members').insert({company_id:company,person_id:user.id,role:'owner'}));

 // The Owner's own session, as the conversation route receives it.
 const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
 await checked(person.auth.signInWithPassword(credentials));

 const until=async(what,read,seconds)=>{
  for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
  throw new Error(`${what} within ${seconds}s`);
 };
 // Nobody connects anything: the worker gives the new company its bundled Hermes agent.
 const agent=await until('bundled Hermes agent provided',async()=>(await checked(person.from('hermes_agents').select('id,is_default').eq('company_id',company))).find(found=>found.is_default),120);
 const conversation=randomUUID();
 const sent=await sendMessage(person,service,{person:user.id,company,conversation,sendKey:randomUUID(),message:'مرحباً، اكتب لي عنواناً لمنشور عن إطلاق الدورة.',encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
 assert.deepEqual(sent,{conversation});
 // The worker closes the run from Hermes's own record and stores the reply.
 const answer=await until('reply stored',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),180);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(asked.length>0,'the bundled Hermes asked the fake model');
 assert.ok(asked.some(body=>JSON.stringify(body.messages).includes('مرحباً')),'the Arabic message reached the model');
 console.log(JSON.stringify({company,agent:agent.id,conversation}));
} finally { model.close(); model.closeAllConnections(); }
