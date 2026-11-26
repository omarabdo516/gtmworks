// CI runs this on stdin inside /app in the installed web container (scripts/ci-install-lib.sh engine_node), against the
// first Engine of the install (HERMES_ADDRESS, HERMES_MANAGEMENT_ADDRESS, ENGINE_KEY), with the Engine's network closed
// to the install as every install's is (ADR 0018). It checks gtmworks's plugin of the main Agent's profile on the pinned
// Engine (#884), in steps. It prints names and states only, never a key.
//   settled: every Company of the install has its main Agent's plugin offered, so the one Engine restart that loads
//     it is behind the checks that follow (scripts/ci-install-lib.sh complete_setup and second_company).
//   offered: the worker has placed the plugin in the main Agent's profile of the Company on this Engine and the Engine
//     offers its toolset to that profile's Runs, and to no Agent's own profile; the plugin's route refuses a call with no
//     key and with a wrong one. The agents area runs it after the install and again after `gtmworks update`.
//   make <marker>: a Run on a session marked as an Owner's calls the tool through the Engine's own tool search, which
//     makes a profile that answers a Run at once, with no restart; a Run on a session nobody marked is refused with a
//     reason the Agent can say, and makes no profile. Needs the Engine pointed at the fake model (the agents area).
//   tell <marker>: a session marked as an Owner's for the plugin's longest life, before a backup.
//   told <marker>: after the restore, the plugin is in place and offered, and what it was told before the backup is there.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
const {companyProfile,isAgentProfile,forbiddenOf,fixedToolsets}=await import(`${process.cwd()}/lib/agent-toolsets.mjs`);
const {engineOf}=await import(`${process.cwd()}/lib/company-engine.mjs`);
const {releasePlugin,markOwnerSession,readOwnerSessions,readMainAgentPlugin,readOfferedPlugin}=await import(`${process.cwd()}/lib/engine/plugin.mjs`);

const [step,marker]=process.argv.slice(2);
const service=createClient('http://gateway:8080',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tool='gtmworks_make_agent';
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};

// Every Company's main Agent's profile, on its own Engine, offers the plugin's toolset: the worker placed it and its one
// restart is over. A Company still waiting for its profile is waited for too.
if(step==='settled') {
 // Only a Company with an Owner gets its profile (company_profile_work); one held behind its first-Owner link has none.
 const {data:owners,error:failed}=await service.from('members').select('company_id').eq('role','owner').is('removed_at',null);
 assert.equal(failed,null,JSON.stringify(failed));
 const all=[...new Set(owners.map(row=>row.company_id))].map(id=>({id}));
 for(const one of all) {
  const main=companyProfile(one.id);
  await until(`the main Agent's plugin offered on ${main}`,async()=>{
   const at=await engineOf(one.id,service);
   if(!at) return false;
   // This release's revision, not only the toolset: an earlier one still loaded means a restart is still to come.
   return (await readOfferedPlugin({address:at.address,managementAddress:at.address.replace(/:\d+$/,':9119'),key:at.key,profile:main})).current===true;
  },300);
 }
 console.log(`main Agent plugin: offered on the main Agent of ${all.length} Companies`);
 process.exit(0);
}

// The Company whose Engine is the first one, and its main Agent's profile there, from the records the worker reads.
// Only a Company with an active Owner has a main Agent's profile (company_profile_work); the backup area's seed adds
// Companies on the same Engine with none.
const {data:owned,error}=await service.from('members').select('company_id').eq('role','owner').is('removed_at',null);
assert.equal(error,null,JSON.stringify(error));
const companies=[...new Set(owned.map(row=>row.company_id))].sort().map(id=>({id}));
let company=null, record=null;
for(const one of companies) { const found=await engineOf(one.id,service); if(found?.address===process.env.HERMES_ADDRESS) { company=one; record=found; break; } }
assert.ok(company&&record,'a Company runs on the first Engine');
const profile=companyProfile(company.id);
const connection={address:record.address,managementAddress:process.env.HERMES_MANAGEMENT_ADDRESS,key:record.key,profile};
const headers=(key=record.key)=>({...(key?{Authorization:`Bearer ${key}`}:{}),'Content-Type':'application/json'});
const manage=(path,init={},key)=>fetch(`${connection.managementAddress}${path}`,{...init,headers:headers(key)});
const api=(path,init={})=>fetch(`${connection.address}${path}`,{...init,headers:headers()});
const toolsets=async name=>(await (await api(`/p/${encodeURIComponent(name)}/v1/toolsets`)).json()).data.filter(one=>one.enabled).map(one=>one.name);
const profiles=async()=>(await (await manage('/api/profiles')).json()).profiles;
const route=`/api/plugins/gtmworks/owner-sessions?profile=${profile}`;

// The plugin in place, file for file as this release ships it, and its toolset offered to the main Agent's Runs.
const offered=async()=>{
 await until(`the worker places the plugin in ${profile}`,async()=>(await readMainAgentPlugin(connection)).state==='placed',240);
 // Offered at this release's revision: the running Engine loaded these files (lib/engine/plugin.mjs pluginRevision).
 await until(`the Engine offers this release's plugin to ${profile}`,async()=>(await readOfferedPlugin(connection)).current===true,240);
 const files=(await releasePlugin()).map(file=>file.path);
 assert.ok(files.includes('__init__.py')&&files.includes('dashboard/plugin_api.py'),'the release ships the plugin');
 for(const other of (await profiles()).map(one=>one.name).filter(isAgentProfile)) assert.ok(!(await toolsets(other)).includes('gtmworks'),`${other} is offered no plugin tool`);
 for(const [label,key] of [['no key',''],['a wrong key','install-check-wrong-key']]) {
  const answer=await manage(route,{method:'POST',body:JSON.stringify({session_id:'forged',person:'nobody'})},key);
  assert.equal(answer.status,401,`the plugin's route refuses ${label}`);
  assert.equal((await manage(route,{},key)).status,401,`the plugin's route refuses a read with ${label}`);
 }
 assert.ok(!(await readOwnerSessions(connection)).sessions.some(one=>one.session==='forged'),'a refused call marks nothing');
 console.log(`main Agent plugin: offered on ${profile}, ${files.length} files, its route refuses no key and a wrong key`);
};

// The fake model: a message naming the tool has the model call it through the Engine's tool search bridge (the plugin's
// tool is deferred, docs/engine-probes/plugin-tool.md section 3), and the model says what the tool answered.
const results=[], requests=[];
const fakeModel=async()=>{
 const server=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
   requests.push(raw);
   const body=JSON.parse(raw||'{}');
   const last=body.messages?.at(-1);
   if(last?.role==='tool') results.push(String(last.content));
   const content=last?.content;
   const text=typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
   // The arguments are the one line after MAKE; anything the Engine added around the message is left out.
   const asked=last?.role==='user'?/MAKE (\{[^\n]*?\})(?:\s|$)/.exec(text):null;
   let args=null; try { args=asked?JSON.parse(asked[1]):null; } catch { args=null; }
   const call=args?{id:`call_${results.length}`,type:'function',function:{name:'tool_call',arguments:JSON.stringify({name:tool,arguments:args})}}:null;
   const reply=call?null:`done: ${String(last?.content??'').slice(0,200)}`;
   const finish=call?'tool_calls':'stop', usage={prompt_tokens:20,completion_tokens:8,total_tokens:28};
   if(!body.stream) { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify({id:'fake',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:call?{role:'assistant',content:null,tool_calls:[call]}:{role:'assistant',content:reply},finish_reason:finish}],usage})); }
   response.writeHead(200,{'Content-Type':'text/event-stream'});
   const chunk=(choices,extra={})=>response.write(`data: ${JSON.stringify({id:'fake',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
   chunk([{index:0,delta:call?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:reply},finish_reason:null}]);
   chunk([{index:0,delta:{},finish_reason:finish}]);
   chunk([],{usage});
   response.end('data: [DONE]\n\n');
  });
 });
 await new Promise(resolve=>server.listen(8080,'0.0.0.0',resolve));
 return server;
};
// A profile pointed at the fake model, as the other checks point theirs; a config write, never a restart.
const pointAtFakeModel=name=>manage(`/api/config?profile=${encodeURIComponent(name)}`,{method:'PUT',
 body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
const run=async(name,input,session)=>{
 const started=await (await api(`/p/${encodeURIComponent(name)}/v1/runs`,{method:'POST',body:JSON.stringify({input,...(session?{session_id:session}:{})})})).json();
 assert.ok(started.run_id,JSON.stringify(started));
 return until(`Run ${started.run_id} on ${name} ends`,async()=>{
  const read=await (await api(`/p/${encodeURIComponent(name)}/v1/runs/${started.run_id}`)).json();
  return ['queued','started','running','claimed'].includes(read.status)?null:read;
 },180);
};
// The tool's answer the Run's session keeps, and whether the Run's events named the tool.
const asked=async(session,args)=>{
 const before=results.length;
 const ended=await run(profile,`Make an Agent for us.\nMAKE ${JSON.stringify(args)}`,session);
 if(ended.status!=='completed') {
  // What the Engine kept of the failed Run, and what the fake model was asked, for the reason.
  const kept=await (await manage(`/api/sessions/${encodeURIComponent(session)}/messages?profile=${profile}&order=latest&limit=10`)).text();
  assert.fail(`the Run in ${session} ${ended.status}: ${JSON.stringify(ended).slice(0,300)}; session ${kept.slice(0,1200)}; model saw ${requests.slice(-2).map(raw=>raw.slice(-800)).join(' | ')}`);
 }
 const answer=results.slice(before).map(text=>{ try { return JSON.parse(text); } catch { return null; } }).find(one=>one&&'success' in one);
 assert.ok(answer,`the tool answered in ${session}: ${JSON.stringify(results.slice(before)).slice(0,400)}`);
 return answer;
};

if(step==='offered') await offered();

if(step==='make') {
 assert.ok(marker,'a marker names the sessions');
 await offered();
 const model=await fakeModel();
 try {
  const owner=`install-owner-${marker}`, other=`install-other-${marker}`;
  // The checks before this one leave the main Agent's profile on another provider; its Runs here ask the fake model.
  assert.equal((await pointAtFakeModel(profile)).status,200);
  assert.equal((await markOwnerSession(connection,{session:owner,person:`owner-${marker}`,seconds:600})).state,'marked');
  const before=(await profiles()).map(one=>one.name);
  const name=`Install Writer ${marker.slice(-6)}`;
  const made=await asked(owner,{name,speciality:'Writes the install check.',instructions:'You write the install check, briefly.'});
  assert.equal(made.success,true,JSON.stringify(made));
  assert.ok(isAgentProfile(made.profile),made.profile);
  const listed=(await profiles()).find(one=>one.name===made.profile);
  assert.ok(listed,`${made.profile} is one of the Engine's profiles`);
  assert.equal(listed.display_name,name);
  assert.equal(listed.description,'Writes the install check.');
  // It starts with the fixed set every Agent gets, never the Engine's defaults, and without the main Agent's tool.
  const tools=await toolsets(made.profile);
  assert.deepEqual(forbiddenOf(tools),[],`${made.profile} offers no tool no Agent gets`);
  assert.deepEqual([...tools].sort(),[...fixedToolsets()].sort(),`${made.profile} offers exactly the fixed set`);
  // The new profile answers a Run at once, with no restart: it is pointed at the fake model as the check points each.
  assert.equal((await pointAtFakeModel(made.profile)).status,200);
  const first=await run(made.profile,'Hello, new Agent.');
  assert.equal(first.status,'completed',JSON.stringify(first).slice(0,400));
  // The same name again is refused with its reason.
  const again=await asked(owner,{name:name.toUpperCase(),speciality:'Writes it twice.',instructions:''});
  assert.equal(again.success,false);
  assert.match(again.error,/already exists/);
  // A session nobody marked: refused with a reason the Agent can say, and no profile made.
  const count=(await profiles()).length;
  const refused=await asked(other,{name:`Refused ${marker.slice(-6)}`,speciality:'Should not be made.',instructions:''});
  assert.equal(refused.success,false);
  assert.match(refused.error,/Only an Owner of this Company can make an Agent/);
  assert.equal((await profiles()).length,count,'a refused call makes no profile');
  assert.deepEqual((await profiles()).map(one=>one.name).filter(one=>!before.includes(one)),[made.profile]);
  console.log(`main Agent plugin: an Owner's session made ${made.profile}, which answered; another session was refused`);
 } finally { await new Promise(resolve=>model.close(resolve)); }
}

if(step==='tell') {
 assert.ok(marker,'a marker names the session');
 await offered();
 assert.equal((await markOwnerSession(connection,{session:`install-owner-${marker}`,person:`owner-${marker}`,seconds:3600})).state,'marked');
 console.log(`main Agent plugin: told install-owner-${marker} is an Owner's session`);
}

if(step==='told') {
 assert.ok(marker,'a marker names the session');
 await offered();
 const told=await readOwnerSessions(connection);
 assert.equal(told.state,'found');
 assert.ok(told.sessions.some(one=>one.session===`install-owner-${marker}`&&one.person===`owner-${marker}`),'the restore brings back what the plugin was told');
 console.log('main Agent plugin: in place after the restore, with what it was told before the backup');
}
