// CI runs this on stdin inside /app in the installed web container, in two steps, on the pinned Hermes release
// (ADR 0014). It prints names and states only, never a key.
//   prepare: two new companies, each with its own Owner. The worker gives each its own Hermes profile; the check
//     asserts the two profiles differ, are each company's own, and that each profile's saved config turns terminal,
//     files and code execution off and its Run API offers none of them. Each profile is pointed at the fake model,
//     standing in for the company's own sign-in. It prints the first company's profile, whose memory CI then writes.
//   verify <marker>: a run on each profile answers, and the marker in the first company's memory reaches the model in
//     that company's run only, never in the second company's.
// The companies and their Owners' sign-in are kept between the steps in a file of this container only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile,riskyToolsets}=await import(`${process.cwd()}/lib/agent-levels.mjs`);

const [step,marker]=process.argv.slice(2);
const state='/tmp/check-install-profiles.json';
const origin='http://gateway:8080';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};
const key=process.env.HERMES_API_KEY;
assert.ok(key,'the install key is in the web container');
const manage=(path,init={})=>fetch(`http://hermes:9119${path}`,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}});
const signedIn=async credentials=>{ const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options); await checked(person.auth.signInWithPassword(credentials)); return person; };

if(step==='prepare') {
 const companies=[];
 for(const name of ['Profile check A','Profile check B']) {
  const credentials={email:`profiles-${randomUUID().slice(0,8)}@example.com`,password:`Profiles-${randomUUID()}`};
  const {user}=await checked(service.auth.admin.createUser({...credentials,email_confirm:true}));
  await checked(service.from('people').insert({id:user.id,name}));
  const company=randomUUID();
  await checked(service.from('companies').insert({id:company,slug:`profiles-${company.slice(0,8)}`,name}));
  await checked(service.from('members').insert({company_id:company,person_id:user.id,role:'owner'}));
  companies.push({company,person:user.id,credentials});
 }
 for(const entry of companies) {
  const person=await signedIn(entry.credentials);
  entry.agent=(await until('company profile provided',async()=>(await checked(person.from('hermes_agents').select('id,is_default').eq('company_id',entry.company))).find(found=>found.is_default),120)).id;
  entry.profile=companyProfile(entry.company);
  assert.deepEqual((await checked(person.from('hermes_connections').select('profile').eq('company_id',entry.company))).map(found=>found.profile),[entry.profile]);
  // The profile's saved config turns the dangerous toolsets off, and its Run API offers none of them.
  const config=await (await manage(`/api/config?profile=${entry.profile}`)).json();
  for(const off of ['terminal','file','code_execution']) assert.ok(config.agent?.disabled_toolsets?.includes(off),`${entry.profile} disables ${off}`);
  const toolsets=await (await fetch(`http://hermes:8642/p/${entry.profile}/v1/toolsets`,{headers:{Authorization:`Bearer ${key}`}})).json();
  const enabled=toolsets.data.filter(toolset=>toolset.enabled).map(toolset=>toolset.name);
  assert.deepEqual(riskyToolsets.filter(name=>enabled.includes(name)),[],`${entry.profile} offers no terminal, file or code tools`);
  assert.ok(enabled.includes('web')&&enabled.includes('memory'),`${entry.profile} keeps its marketing tools`);
  const pointed=await manage(`/api/config?profile=${entry.profile}`,{method:'PUT',body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
  assert.equal(pointed.status,200);
 }
 assert.notEqual(companies[0].profile,companies[1].profile);
 const listed=(await (await manage('/api/profiles')).json()).profiles.map(profile=>profile.name);
 for(const entry of companies) assert.ok(listed.includes(entry.profile),`${entry.profile} is a Hermes profile`);
 writeFileSync(state,JSON.stringify(companies),{mode:0o600});
 console.log(companies[0].profile);
} else if(step==='verify') {
 assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
 const companies=JSON.parse(readFileSync(state,'utf8'));
 // The fake model: one Arabic reply, streamed or not, and every request it was sent.
 const reply='أهلاً، هذا رد من النموذج التجريبي.';
 const asked=[];
 const model=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
   const body=JSON.parse(raw||'{}'); asked.push(raw);
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
  const seen=[];
  for(const entry of companies) {
   const person=await signedIn(entry.credentials);
   const before=asked.length;
   const conversation=randomUUID();
   const sent=await sendMessage(person,service,{person:entry.person,company:entry.company,conversation,sendKey:randomUUID(),message:'مرحباً، اكتب عنواناً قصيراً.',encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
   assert.deepEqual(sent,{conversation});
   const answer=await until(`reply on ${entry.profile}`,async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),180);
   assert.ok(answer.body.includes(reply),answer.body);
   assert.ok(asked.length>before,`${entry.profile} asked the model`);
   seen.push(asked.slice(before).some(raw=>raw.includes(marker)));
  }
  // The first company's memory reached its own run and not the second company's.
  assert.deepEqual(seen,[true,false]);
  console.log(JSON.stringify({profiles:companies.map(entry=>entry.profile),memory:seen}));
 } finally { model.close(); model.closeAllConnections(); }
} else throw new Error('usage: prepare | verify <marker>');
