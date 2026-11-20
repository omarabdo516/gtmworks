// CI runs this on stdin inside the installed web container, after one backup of an install with two Companies was
// restored into an empty install and after an update moved every Engine to another image (#386, ADR 0018). It proves
// every Company came back on its own Engine: a Run on each Company's main Agent gets a reply, and the code word the job
// wrote in that Company's own Engine before the backup is in that Company's own requests and in no other Company's.
// Every Company that has a main Agent is checked; a Company made straight in the database (the job's persistence probes)
// has no Agent and is left alone, and one with a main Agent and no readable Engine fails the check (lib/engine-targets.mjs).
// It prints Company names, states and profiles only, never a key or any other value of the install's environment
// (lib/install-proof.mjs).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const { sendMessage }=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const { engineOf }=await import(`${process.cwd()}/lib/company-engine.mjs`);
const { companyProfile }=await import(`${process.cwd()}/lib/agent-levels.mjs`);
const { engineTarget }=await import(`${process.cwd()}/lib/engine-targets.mjs`);
const { writeProof }=await import(`${process.cwd()}/lib/install-proof.mjs`);

const origin='http://gateway:8080';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const checked=async query=>{ const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data; };
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};

// Each Company's Engine, from the record the app and the worker answer from: its address and its own key. The code word
// is the one the install job wrote in the Company's own Engine before the backup; the job derives it the same way. A
// Company with no main Agent yet is left alone; one with a main Agent and no readable Engine fails the check (#378, C2).
const targets=[];
for(const company of await checked(service.from('companies').select('id,name').order('name'))) {
 // The main Agent runs on its Company's own profile; the server role reads hermes_agents by these columns only.
 const [agent]=await checked(service.from('hermes_agents').select('id,profile').eq('company_id',company.id).eq('profile',companyProfile(company.id)));
 const engine=await engineOf(company.id,service);
 const target=engineTarget({company,agent,engine});
 if(target) targets.push(target);
}
assert.ok(targets.length>=2,`two Companies or more, each with its main Agent and its own Engine: ${targets.map(target=>target.name).join(', ')}`);
const distinct=pick=>new Set(targets.map(pick)).size===targets.length;
assert.ok(distinct(target=>target.engine.address),'each Company is on its own Engine');
assert.ok(distinct(target=>target.engine.key),'each Engine has its own key');
assert.ok(distinct(target=>target.profile),'each Company has its own profile');

// The fake model: one Arabic reply, streamed or not, and every request it was sent. It stands in for each Company's own
// model access; what an Engine puts in the request is the memory it kept.
const asked=[];
const reply='أهلاً، هذا رد من النموذج التجريبي.';
const model=createServer((request,response)=>{
 let raw=''; request.on('data',chunk=>{ raw+=chunk; }); request.on('end',()=>{
  if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
  const body=JSON.parse(raw||'{}');
  asked.push(raw);
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
 // Each Company is spoken to by its own Owner: the first run's and the named Owner's is proxy-owner, the first-Owner
 // link's Company belongs to whoever claimed it.
 const owners=[];
 for(const [email,password] of [['proxy-owner@example.com','proxy-owner-password'],['linked-owner@example.test','linked-owner-password']]) {
  const client=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user:signedIn}}=await client.auth.signInWithPassword({email,password});
  if(signedIn) owners.push({client,user:signedIn});
 }
 for(const target of targets) {
  const [membership]=await checked(service.from('members').select('person_id').eq('company_id',target.company).eq('role','owner'));
  const found=owners.find(one=>one.user.id===membership?.person_id);
  assert.ok(found,`${target.name}'s Owner signs in`);
  const {client:owner,user}=found;
  const pointed=await fetch(`${target.management}/api/config?profile=${encodeURIComponent(target.profile)}`,{method:'PUT',
   headers:{Authorization:`Bearer ${target.engine.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
  assert.equal(pointed.status,200,`${target.name}'s profile points at the fake model`);
  const before=asked.length;
  const conversation=randomUUID();
  const send={person:user.id,company:target.company,conversation,sendKey:randomUUID(),agent:target.agent,message:'مرحباً، اكتب عنواناً قصيراً.'};
  // A profile the worker has not confirmed yet refuses the send as pending and stores nothing, so the same send is made
  // again until it is ready (#282).
  const sent=await until(`${target.name} ready for a run`,async()=>{ const result=await sendMessage(owner,service,send); return result.error==='conversationAgentLevelPending'?null:result; },180);
  assert.deepEqual(sent,{conversation});
  const answer=await until(`a reply in ${target.name}`,async()=>(await checked(owner.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
  assert.ok(answer.body.includes(reply),answer.body);
  // Its own Engine kept its own Company's memory, and no other Company's.
  const sentToModel=asked.slice(before);
  assert.ok(sentToModel.some(raw=>raw.includes(target.code)),`${target.name}'s Agent still remembers the code word its own Engine was given`);
  for(const other of targets) {
   if(other===target) continue;
   assert.ok(!sentToModel.some(raw=>raw.includes(other.code)),`${target.name}'s run never sees ${other.name}'s code word`);
  }
  writeProof({step:'run',company:target.company,profile:target.profile,state:'answered',memory:'remembered'});
 }
 writeProof({step:'engines',state:'answered',count:targets.length,companies:targets.map(target=>target.name)});
} finally { model.close(); model.closeAllConnections(); }
