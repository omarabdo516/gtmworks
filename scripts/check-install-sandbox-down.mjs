// CI runs this on stdin inside /app in the installed web container, in two steps around the install job stopping and
// starting the first Company's work sandbox (#398):
//   sandbox-down <marker>: the Company reads its sandbox as not running from the Engine's own ssh workspace, a message
//     that needs a command gets its reply with the failed sandbox step under it, and a message that needs no tool is
//     answered as usual.
//   sandbox-up <marker>: once the sandbox runs again the same read says running and the next command runs in it, with no
//     restart of the install. The job reads the marker from the sandbox's disk, so a tool's own answer cannot fake it.
// Only names, states and counts are printed, never a key or any other value of the install's environment
// (lib/install-proof.mjs).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile}=await import(`${process.cwd()}/lib/agent-toolsets.mjs`);
const {engineOf}=await import(`${process.cwd()}/lib/company-engine.mjs`);
const {readSession}=await import(`${process.cwd()}/lib/engine/sessions.mjs`);
const {readWorkSandbox}=await import(`${process.cwd()}/lib/engine/files.mjs`);
const {writeProof}=await import(`${process.cwd()}/lib/install-proof.mjs`);

const [step,marker]=process.argv.slice(2);
assert.ok(['sandbox-down','sandbox-up'].includes(step),'the step is sandbox-down or sandbox-up');
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const down=step==='sandbox-down';
const origin='http://gateway:8080';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};
const reply='أهلاً، هذا رد من النموذج التجريبي.';
// The fake model stands in for the Company's subscription: it asks for one command on the trigger message and answers
// with text otherwise, as the profile's model would.
const asked=[];
const model=createServer((request,response)=>{
 let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
  if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
  const body=JSON.parse(raw||'{}'); asked.push(body);
  const input=[...(body.messages||[])].reverse().find(message=>message.role==='user');
  const text=typeof input?.content==='string'?input.content:JSON.stringify(input?.content||'');
  const ran=(body.messages||[]).some(message=>message.role==='tool');
  const call=text.includes(`SANDBOX-DOWN ${marker}`)&&!ran
   ?{id:`call_sandbox_down`,type:'function',function:{name:'terminal',arguments:JSON.stringify({command:`id -un; printf '%s' '${marker}-${step}' > /work/${marker}-${step}.txt`})}}
   :null;
  const usage={prompt_tokens:20,completion_tokens:8,total_tokens:28};
  if(!body.stream) { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify({id:'fake',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:call?{role:'assistant',content:null,tool_calls:[call]}:{role:'assistant',content:reply},finish_reason:call?'tool_calls':'stop'}],usage})); }
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(choices,extra={})=>response.write(`data: ${JSON.stringify({id:'fake',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
  chunk([{index:0,delta:call?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:reply},finish_reason:null}]);
  chunk([{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}]);
  chunk([],{usage});
  response.end('data: [DONE]\n\n');
 });
});
await new Promise(resolve=>model.listen(8080,'0.0.0.0',resolve));

try {
 const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
 const {data:{user}}=await person.auth.signInWithPassword({email:'proxy-owner@example.com',password:'proxy-owner-password'});
 assert.ok(user,'the first-run Owner signs in');
 const first=await checked(service.from('companies').select('id').eq('name','Proxy Company').single());
 const company=first.id;
 const engine=await engineOf(company,service);
 assert.ok(engine,'the first Company has an Engine record');
 const managementAddress=engine.address.replace(/:\d+$/,'')+':9119';
 const management=(path,init={})=>fetch(`${managementAddress}${path}`,{...init,headers:{Authorization:`Bearer ${engine.key}`,'Content-Type':'application/json'}});
 const profile=companyProfile(company);
 const pointed=await management(`/api/config?profile=${encodeURIComponent(profile)}`,{method:'PUT',body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(pointed.status,200,'the Company profile points at the fake model');
 const agent=await until('the Company profile ready for a run',async()=>(await checked(person.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()))?.id,180);
 // The Company's own read of its work sandbox, the one Settings shows (#398): one answer, no polling.
 assert.deepEqual(await readWorkSandbox(engine),{state:down?'notRunning':'running'},`the work sandbox reads ${down?'not running':'running'}`);
 const send=async text=>{
  const conversation=randomUUID();
  const sendKey=randomUUID();
  const result=await until('the Company ready for a run',async()=>{ const sent=await sendMessage(person,service,{person:user.id,company,conversation,sendKey,agent,message:text,hermes:engine}); return 'queued' in sent?null:sent; },180);
  assert.deepEqual(result,{conversation});
  const body=await until('reply stored',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
  assert.ok(body.body.includes(reply),body.body);
  const {hermes_session_id:session}=await checked(person.from('conversations').select('hermes_session_id').eq('id',conversation).single());
  assert.ok(session,'the reply names its Engine session');
  const read=await readSession({...engine,managementAddress,profile},session);
  assert.equal(read.state,'found','the reply has a session to read');
  const steps=(read.turns||[]).flatMap(turn=>turn.steps);
  return {conversation,steps};
 };
 // A message that needs a command: the Engine asks for the terminal, and it runs in the Company's sandbox — or cannot
 // while the sandbox is not running, which is the one failed step the chat names under the reply.
 const command=await send(`SANDBOX-DOWN ${marker}: run the sandbox check.`);
 assert.equal(command.steps.filter(step=>step.tool==='terminal').length,1,JSON.stringify(command.steps));
 assert.deepEqual(command.steps.filter(step=>step.tool==='terminal').map(step=>[step.state,step.sandbox===true]),[[down?'failed':'done',down]]);
 // A message that needs no tool is answered as usual, with no sandbox step.
 const plain=await send(`SANDBOX-PLAIN ${marker}: say hello.`);
 assert.equal(plain.steps.some(step=>step.sandbox===true),false,JSON.stringify(plain.steps));
 writeProof({step,state:down?'notRunning':'running',sandbox:down?'notRunning':'running',plain:'answered',conversation:plain.conversation});
} finally { model.close(); model.closeAllConnections(); }
