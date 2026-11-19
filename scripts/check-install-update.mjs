// CI runs this on stdin inside the installed web container, after the update of an install the previous release made
// with one Company (#385, ADR 0018), on the pinned Hermes release. It proves what the update must not lose: the fact the
// Company's Agent was told before it, and the sign-in the Company made before it, both on the Engine the update adopted.
// It prints names, states and counts only, never a key or any other value of the install's environment
// (lib/install-proof.mjs).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const { sendMessage }=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const { readCompanySignIns }=await import(`${process.cwd()}/lib/company-sign-in.mjs`);
const { writeProof }=await import(`${process.cwd()}/lib/install-proof.mjs`);

const marker=process.argv[2];
assert.match(marker||'',/^[a-z0-9-]{8,64}$/,'the marker the job wrote before the update');
const origin='http://gateway:8080';
const management=process.env.HERMES_MANAGEMENT_ADDRESS||'http://gtmworks-engine-first:9119';
const key=process.env.HERMES_API_KEY;
assert.ok(key,'the adopted Engine key is given to this check alone');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const checked=async query=>{ const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data; };
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};

// The install the previous release made had one Company, and so does the updated one.
const companies=await checked(service.from('companies').select('id,name'));
assert.equal(companies.length,1,`one Company: ${companies.map(found=>found.name).join(', ')}`);
const company=companies[0].id;
const owner=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
await checked(owner.auth.signInWithPassword({email:'proxy-owner@example.com',password:'proxy-owner-password'}));
// The sign-in made before the update still serves the Company's Agents: the Engine that answers for the Company holds
// it on the profile the Engine lends every Agent that has none of its own.
const signIn=await until('the Company signed in from its Engine',async()=>{
 const read=await readCompanySignIns(owner,{company});
 assert.notEqual(read.noEngine,true,"the Company's Engine answers");
 return read.signIns?.anthropic?.state==='connected'?read:null;
},60);
assert.equal(signIn.signIns.anthropic.state,'connected');
writeProof({step:'sign-in',state:signIn.signIns.anthropic.state,company});

// The fake model: one Arabic reply, streamed or not, and every request it was sent. It stands in for the Company's own
// model access; the Agent's memory is what the Engine itself puts in the request.
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
 const [agent]=await checked(service.from('hermes_agents').select('id,profile').eq('company_id',company).eq('is_default',true));
 assert.ok(agent?.profile,`the Company's main Agent: ${JSON.stringify(agent)}`);
 // The Agent runs on the profile the Engine kept, now pointed at the fake model.
 const pointed=await fetch(`${management}/api/config?profile=${encodeURIComponent(agent.profile)}`,{method:'PUT',
  headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
  body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(pointed.status,200,'the Company profile points at the fake model');
 const {data:signedIn}=await owner.auth.getUser();
 const conversation=randomUUID();
 const send={person:signedIn.user.id,company,conversation,sendKey:randomUUID(),agent:agent.id,message:'مرحباً، اكتب عنواناً قصيراً.'};
 // A profile the worker has not confirmed yet refuses the send as pending and stores nothing, so the same send is made
 // again until it is ready (#282).
 const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(owner,service,send); return result.error==='conversationAgentLevelPending'?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until('a reply from the Agent',async()=>(await checked(owner.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 // What it was told before the update is in what its Engine sent the model.
 assert.ok(asked.some(raw=>raw.includes(marker)),'the Agent still remembers the fact it was told before the update');
 writeProof({step:'memory',state:'remembered',profile:agent.profile,company});
} finally { model.close(); model.closeAllConnections(); }
