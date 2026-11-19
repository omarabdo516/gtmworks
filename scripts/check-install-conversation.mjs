// CI runs this on stdin inside /app in the installed web container. It proves the bundled Hermes (ADR 0010) answers
// /health on the compose network, and that the first-run Company's Owner's Arabic message gets its reply with no manual
// connection step: the worker gives the Company its own Hermes profile (ADR 0014) by itself, and closes the run with the
// reply. The Company's Engine comes from the Engine record the installer wrote and first run attached (#380), so this also
// proves a Run on the first Company answers through the record. The profile is pointed at the fake model provider this
// script serves on http://web:8080/v1, standing in for the Company's own subscription sign-in (#3), so CI needs no
// subscription.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile}=await import(`${process.cwd()}/lib/agent-levels.mjs`);

const engineAddress=process.env.HERMES_ADDRESS||'http://gtmworks-engine-first:8642';
const engineManagement=process.env.HERMES_MANAGEMENT_ADDRESS||'http://gtmworks-engine-first:9119';

const health=await fetch(`${engineAddress}/health`);
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
 // The Owner and Company first run made, whose Engine record the installer registered and first run attached (#380).
 const credentials={email:'proxy-owner@example.com',password:'proxy-owner-password'};
 const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
 const {data:{user}}=await person.auth.signInWithPassword(credentials);
 assert.ok(user,'the first-run Owner signs in');
 const [{company_id:company}]=await checked(service.from('members').select('company_id').eq('person_id',user.id).eq('role','owner').limit(1));
 assert.ok(company,'the first-run Owner owns a Company');
 // The record, not the install's environment, is where its Engine comes from.
 const record=await checked(service.from('company_engines').select('address').eq('company_id',company).single());
 assert.equal(record.address,engineAddress,'the first Company has the install Engine record');

 const until=async(what,read,seconds)=>{
  for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
  throw new Error(`${what} within ${seconds}s`);
 };
 // Nobody connects anything: the worker gives the new company its bundled Hermes agent.
 const agent=await until('bundled Hermes agent provided',async()=>(await checked(person.from('hermes_agents').select('id,is_default').eq('company_id',company))).find(found=>found.is_default),120);
 // It runs on the company's own profile, never the shared `default` one.
 const profile=companyProfile(company);
 assert.deepEqual((await checked(person.from('hermes_agents').select('profile').eq('company_id',company))).map(found=>found.profile),[profile]);
 const configured=await fetch(`${engineManagement}/api/config?profile=${profile}`,{method:'PUT',headers:{Authorization:`Bearer ${process.env.HERMES_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(configured.status,200,'the company profile points at the fake model');
 const conversation=randomUUID();
 // The worker confirms the new profile (its tools, then its shared Skills folder) in its own loops; until then a send is
 // refused as pending and nothing is stored, so the same send is made again until the profile is ready (#282).
 const send={person:user.id,company,conversation,sendKey:randomUUID(),message:'مرحباً، اكتب لي عنواناً لمنشور عن إطلاق الدورة.'};
 const sent=await until('the company profile ready for a run',async()=>{ const result=await sendMessage(person,service,send); return result.error==='conversationAgentLevelPending'?null:result; },120);
 assert.deepEqual(sent,{conversation});
 // The worker closes the run from Hermes's own record and stores the reply.
 const answer=await until('reply stored',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),180);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(asked.length>0,'the bundled Hermes asked the fake model');
 assert.ok(asked.some(body=>JSON.stringify(body.messages).includes('مرحباً')),'the Arabic message reached the model');
 console.log(JSON.stringify({company,agent:agent.id,conversation}));
} finally { model.close(); model.closeAllConnections(); }
