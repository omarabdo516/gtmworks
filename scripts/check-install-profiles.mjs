// CI runs this on stdin inside /app in the installed web container, in three steps, with two Companies on two Engines
// (#382, ADR 0018). It prints names, states and counts only, never a key or any other value of the install's environment
// (lib/install-proof.mjs).
//   prepare: the install's two Companies, each already made on its own Engine by the installer and `gtmworks company
//     add`. The worker gives each its own Hermes profile on its own Engine; the check asserts the two Engines differ, each
//     profile is its Company's own, and each profile's saved config turns terminal, files and code execution off and its
//     Run API offers none of them. Each profile is pointed at the fake model, standing in for a sign-in. It also proves
//     one Engine refuses the other's key. It prints the first Company's profile, whose memory CI then writes, and both
//     companies' names for the database refusal the install job checks.
//   verify <marker>: two more Agents are made, one in each Company, so each has a main Agent and a second one on its own
//     profile, and the marker in the first Company's memory reaches that Company's main Agent's run only: never the same
//     Company's second Agent, and never an Agent of the other Company on its other Engine. Each Company's shared space
//     serves no Run and holds the one shared Skills folder read by exactly its own Agents. Then a fake key for a provider
//     the Engine catalogues is set through the driver (#124): it is set in the first Company's space and both of its
//     Agents' profiles, in none of the second Company's and never the root, and removed from both again.
//   second: the first Company's second Agent alone, made as verify makes it and moved by the worker to its own profile,
//     for the sandbox steps when no verify ran before them (the agents-sandbox area, #553).
//   capacity <with-skills|no-skills>: ten more Agent profiles in the first Company on its Engine, each printed with its
//     name and the seconds it took to be ready. The install job measures that Engine's memory and the volume's disk around
//     them; the check ends with a Run on the first Agent still answered.
//   sandbox <marker>: one Agent's command, written file and code run in the Company's work sandbox (#393), a second Agent
//     starts in a folder of its own inside the Company's work folder, and neither a profile write nor a settings write
//     moves where a command runs. The job reads the host's Docker for where each marker landed, which a tool's own answer
//     cannot fake.
//   sandbox-mcp-add <marker>, then sandbox-mcp <marker>: a command server the Owner adds (#459) runs in the Company's
//     work sandbox: the Engine holds ssh into the sandbox and never the command, and Test lists its tool; after the job
//     restarts the Engine, an Agent calls it from a Conversation. The call holds until the job, which lists both
//     containers' processes meanwhile, releases it; the job reads where it ran.
//   sandbox-key <marker> <refused|runs>: one Agent's command, when the install job has replaced the sandbox's host key
//     (refused) or put it back (runs): the Engine's ssh client trusts a host it has not seen but refuses a changed key, and
//     the install pre-seeds known_hosts with the sandbox's, so a swapped sandbox is refused.
//   sandbox-sync <marker>: one Agent counts the files under /home/pn/.hermes in its sandbox (none, with file sync off) and
//     writes the paths a sync would map (its own Skills, the Company's shared folder, its memories); the job plants the
//     settings file there itself, and the profile names a credential file the job puts in the profile's home too. The
//     job checks that none of it, the credential file included, reaches the Engine or the sandbox, and that the Run
//     still works.
//   kanban <marker>: the Engine's own Kanban board (spec #831, #833). A Card made through the Engine's Kanban routes and
//     given to the first Company's second Agent is started by the dispatcher after one tick the step asks for; its
//     worker runs a command that writes `<marker>-card.txt` in the work folder and a command the Engine marks dangerous,
//     stops on a question, goes on after a person's comment and a move to ready, is sent for review, returned to the
//     same Agent and passed. The main Agent, in a Conversation, makes a Card for the second Agent with the Engine's own
//     tool, which the Engine's reviewing Agent passes; whether the main Agent's session is told, and what a Card in
//     triage does in two dispatcher ticks with the model its decomposer called, are printed. The job reads the host's
//     Docker for where the worker's files landed. The proxy area runs it (#911), in 270 s of its own, a line as each phase
//     ends.
//   library <marker>: one Agent writes a text file and a picture in its own folder of the Company's work folder (#395),
//     and the Owner's Library of it lists, previews and downloads both with the bytes the Agent wrote. In the same Run it
//     plants a link to the Company's second Agent's memory on the Engine's disk (the job wrote `<marker>-leak` in it), a
//     link up into that Agent's folder, a link to a folder and a hidden file: none is listed or read, and no byte of the
//     memory comes back.
//   company-sandbox <marker> <Company>: the named Company's main Agent, on its own Engine, runs one command that prints
//     where it ran and writes `<marker>.txt` in its own folder (#396). It needs no earlier step: the companies area runs
//     it on a Company `company add` made, and reads the host's Docker for which sandbox holds the file.
// The companies and their Owner's sign-in are kept between the steps in a file of this container only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile,toolConfig,noAgentGets,fixedToolsets,forbiddenOf,profileSettingsDiffer,isMainAgentProfile,mainAgentToolset}=await import(`${process.cwd()}/lib/agent-toolsets.mjs`);
const {agentSoul}=await import(`${process.cwd()}/lib/company-profiles.mjs`);
const {provideProfile}=await import(`${process.cwd()}/lib/engine/agents.mjs`);
const {writeProof,writeName,stepClock}=await import(`${process.cwd()}/lib/install-proof.mjs`);
const {kanbanPlan,reviewRequested,passedAfterReview}=await import(`${process.cwd()}/lib/install-kanban.mjs`);
const {engineOf}=await import(`${process.cwd()}/lib/company-engine.mjs`);

const [step,marker]=process.argv.slice(2);
// A message holding this makes the fake model ask the Engine to rewrite the shared Skill.
const trigger='Change the team lessons now.';
const state='/tmp/check-install-profiles.json';
const origin='http://gateway:8080';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
const until=async(what,read,seconds)=>{
 for(let left=seconds;left>0;left--) { const found=await read(); if(found) return found; await new Promise(resolve=>setTimeout(resolve,1000)); }
 throw new Error(`${what} within ${seconds}s`);
};
// Each Company's Engine, from the record the app and the worker answer from: its address and its own key. The management
// listener is the same Engine on its management port.
const engineFor=async company=>{
 const engine=await engineOf(company,service);
 assert.ok(engine,`Company ${company} has an Engine record`);
 return {...engine,managementAddress:engine.address.replace(/:\d+$/,'')+':9119'};
};
const manage=(engine,path,init={})=>fetch(`${engine.managementAddress}${path}`,{...init,headers:{Authorization:`Bearer ${engine.key}`,'Content-Type':'application/json'}});
const pointAtFakeModel=async(engine,profile)=>{
 const pointed=await manage(engine,`/api/config?profile=${encodeURIComponent(profile)}`,{method:'PUT',body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(pointed.status,200,`${profile} points at the fake model`);
};
const credentials={email:process.env.PROOF_EMAIL||'proxy-owner@example.com',password:process.env.PROOF_PASSWORD||'proxy-owner-password'};
const signedIn=async(email=credentials.email,password=credentials.password)=>{ const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options); await checked(person.auth.signInWithPassword({email,password})); return person; };
const profileOf=async(person,agent)=>{ const [found]=await checked(person.from('hermes_agents').select('profile').eq('id',agent)); return found?.profile; };
// A profile's saved config offers the one fixed set of tools every Agent gets, and its Run API agrees: the terminal, the
// files and code execution included (#393), no tool no Agent gets on, and every Agent's commands starting in the Company's
// work folder with no person needed to approve each code call.
const checkProfile=async(engine,profile)=>{
 const config=await (await manage(engine,`/api/config?profile=${encodeURIComponent(profile)}`)).json();
 for(const off of noAgentGets) assert.ok(config.agent?.disabled_toolsets?.includes(off),`${profile} disables ${off}`);
 const toolsets=await (await fetch(`${engine.address}/p/${encodeURIComponent(profile)}/v1/toolsets`,{headers:{Authorization:`Bearer ${engine.key}`}})).json();
 const enabled=toolsets.data.filter(toolset=>toolset.enabled).map(toolset=>toolset.name);
 assert.deepEqual(forbiddenOf(enabled),[],`${profile} offers no tool no Agent gets`);
 // The main Agent's profile also offers its plugin's tool (#884); no other profile does.
 const plugin=isMainAgentProfile(profile)?[mainAgentToolset]:[];
 assert.deepEqual([...enabled].sort(),[...fixedToolsets(),...plugin].sort(),`${profile} offers exactly the fixed set${plugin.length?' and the main Agent\'s tool':''}`);
 assert.equal(profileSettingsDiffer(config,profile),false,`${profile} starts in its own folder and needs no approval for code`);
};
const spaceOf=entry=>`cs-${entry.company.replaceAll('-','')}`;
const shown=entry=>({company:entry.company,profile:entry.profile,space:entry.space,agent:entry.agent,second:entry.secondProfile});
// The fake model: one Arabic reply, streamed or not, the tool calls a step scripts, and every request it was sent. A
// step that needs a tool call passes its plan; the default is the shared-Skill rewrite the verify step proves is refused.
const skillCall={id:'call_lessons',type:'function',function:{name:'skill_manage',
 arguments:JSON.stringify({operations:[{action:'patch',name:'team-lessons',content:'---\nname: team-lessons\ndescription: Changed by an agent\n---\nChanged.\n'}]})}};
const skillPlan=messages=>{
 const last=messages.at(-1);
 return last?.role==='user'&&JSON.stringify(last.content).includes(trigger)?skillCall:null;
};
const fakeModel=async(requests,results=[],plan=skillPlan)=>{
 const reply='أهلاً، هذا رد من النموذج التجريبي.';
 const model=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',async()=>{
   if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
   const body=JSON.parse(raw||'{}'); requests.push(raw);
   const last=body.messages?.at(-1);
   if(last?.role==='tool') results.push(String(last.content));
   // A step's plan may take its time (kanban paces its polls).
   const call=await plan(body.messages||[],body);
   const finish=call?'tool_calls':'stop';
   const usage={prompt_tokens:20,completion_tokens:8,total_tokens:28};
   if(!body.stream) { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify({id:'fake',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:call?{role:'assistant',content:null,tool_calls:[call]}:{role:'assistant',content:reply},finish_reason:finish}],usage})); }
   response.writeHead(200,{'Content-Type':'text/event-stream'});
   const chunk=(choices,extra={})=>response.write(`data: ${JSON.stringify({id:'fake',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
   chunk([{index:0,delta:call?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:reply},finish_reason:null}]);
   chunk([{index:0,delta:{},finish_reason:finish}]);
   chunk([],{usage});
   response.end('data: [DONE]\n\n');
  });
 });
 await new Promise(resolve=>model.listen(8080,'0.0.0.0',resolve));
 return {model,reply};
};

// A message from the Owner to an Agent of the Company in a new Conversation, answered: whether the marker reached the
// model, the Conversation, and what the model was sent. The verify and second steps each ask through their own fake model.
const askerFor=({asked,reply,person})=>async(entry,agent,label,message='مرحباً، اكتب عنواناً قصيراً.',client=person)=>{
 const before=asked.length;
 const conversation=randomUUID();
 // A profile the worker has not yet confirmed (its tools, its shared Skills folder) refuses the send as pending and
 // stores nothing, so the same send is made again until it is ready (#282).
 const send={person:entry.person,company:entry.company,conversation,sendKey:randomUUID(),agent,message};
 const sent=await until(`${label} ready for a run`,async()=>{ const result=await sendMessage(client,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until(`reply on ${label}`,async()=>(await checked(client.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(asked.length>before,`${label} asked the model`);
 return {remembered:Boolean(marker)&&asked.slice(before).some(raw=>raw.includes(marker)),conversation,sent:asked.slice(before)};
};
// The first Company's second Agent, made on the company profile as the previous app version made one and moved by the
// worker to its own profile (#121), keeps its Conversation and starts empty. The verify step makes it before its checks;
// the second step makes it alone, for the sandbox steps of the agents-sandbox area (#553).
const makeFirstSecondAgent=async(ask,person,first,firstEngine)=>{
 first.conversation=(await ask(first,first.agent,first.profile)).conversation;
 const [{run_id:run}]=await checked(person.from('conversation_messages').select('run_id').eq('conversation_id',first.conversation).eq('author','person'));
 const made=await checked(service.rpc('lead_create_agent',{conversation:first.conversation,run,call:'install-check',agent_name:'Install writer',job:'Writes the install check.',apps:[]}));
 assert.equal(made.state,'created');
 assert.equal(await profileOf(person,made.agent),first.profile,'the previous version makes the Agent on the company profile');
 const own=`ag-${made.agent.replaceAll('-','')}`;
 await until(`${own} made by the worker`,async()=>(await (await manage(firstEngine,'/api/profiles')).json()).profiles.some(profile=>profile.name===own),180);
 await pointAtFakeModel(firstEngine,own);
 await until(`the Agent moved to ${own}`,async()=>await profileOf(person,made.agent)===own,240);
 assert.equal(await profileOf(person,first.agent),first.profile,'the main Agent keeps the company profile');
 first.second=made.agent; first.secondProfile=own;
};

if(step==='prepare') {
const person=await signedIn();
const {data:{user}}=await person.auth.getUser();
assert.ok(user,'the first-run Owner signs in');
const them=user.id;
// A Company keeps no time of its own: the order its Engine was made is the order it was added, the first-run one first.
const made=new Map((await checked(service.from('company_engines').select('id').order('created_at'))).map((engine,at)=>[engine.id,at]));
const all=(await checked(service.from('companies').select('id,name,engine_id')))
 .sort((a,b)=>(made.get(a.engine_id)??Infinity)-(made.get(b.engine_id)??Infinity));
// The two Companies on two Engines: a restored install also holds Companies the backup check made on the first Engine,
// so the second Company of the proof is the first one whose Engine address differs from the first's.
const pair=[]; const engines=[];
for(const entry of all) {
 const engine=await engineOf(entry.id,service);
 if(!engine) continue;
 if(!pair.length) { pair.push(entry); engines.push({...engine,managementAddress:engine.address.replace(/:\d+$/,'')+':9119'}); continue; }
 if(engine.address===engines[0].address) continue;
 pair.push(entry);
 engines.push({...engine,managementAddress:engine.address.replace(/:\d+$/,'')+':9119'});
 break;
}
assert.equal(pair.length,2,'the install has two Companies on two Engines');
assert.notEqual(engines[0].address,engines[1].address,'each Company is on its own Engine');
assert.notEqual(engines[0].key,engines[1].key,'each Engine has its own key');
for(const [index,entry] of pair.entries()) {
 entry.company=entry.id;
 entry.person=them;
 const engine=engines[index];
 entry.agent=(await until(`${entry.name}'s company profile provided`,async()=>(await checked(person.from('hermes_agents').select('id,is_default').eq('company_id',entry.id))).find(found=>found.is_default),180)).id;
 entry.profile=companyProfile(entry.id);
 assert.deepEqual((await checked(person.from('hermes_agents').select('profile').eq('company_id',entry.id))).map(found=>found.profile),[entry.profile]);
 await checkProfile(engine,entry.profile);
 await pointAtFakeModel(engine,entry.profile);
 // One shared space per Company, its own, holding the folder its Agent profiles read. The worker lists it once made.
 const space=await until(`${entry.profile}'s shared space`,async()=>{
  const spaces=await checked(service.rpc('shared_skills_work'));
  return (spaces||[]).find(found=>found.company_id===entry.id&&typeof found.folder==='string');
 },180);
 assert.equal(space.profile,spaceOf(entry));
 assert.match(space.folder,new RegExp(`/${space.profile}/skills$`));
 entry.space=space.profile; entry.folder=space.folder;
}
assert.notEqual(pair[0].profile,pair[1].profile);
assert.notEqual(pair[0].space,pair[1].space);
// Each Engine holds its own Company's profiles and none of the other Company's.
for(const [index,entry] of pair.entries()) {
 const listed=(await (await manage(engines[index],'/api/profiles')).json()).profiles.map(profile=>profile.name);
 assert.ok(listed.includes(entry.profile),`${entry.profile} is a Hermes profile of its Company's Engine`);
 assert.ok(listed.includes(entry.space),`${entry.space} is a Hermes profile of its Company's Engine`);
 const other=pair[1-index];
 assert.ok(!listed.includes(other.profile),`${other.profile} is not on ${entry.name}'s Engine`);
 assert.ok(!listed.includes(other.space),'another Company\'s shared space is not on this Engine');
}
// One Engine refuses the other's key, on a Run API route that needs a key, so a leaked key opens one Company at most.
for(const [index,entry] of pair.entries()) {
 const other=engines[1-index];
 const refused=await fetch(`${engines[index].address}/p/${encodeURIComponent(entry.profile)}/v1/toolsets`,{headers:{Authorization:`Bearer ${other.key}`}});
 assert.ok([401,403].includes(refused.status),`${entry.name}'s Engine refuses another Engine's key (HTTP ${refused.status})`);
}
// The settings gtmworks lists are the running Engine's own: its schema and defaults are read here, so a release that
// renames or retypes one fails the install instead of a Settings screen.
const {engineSettings,settingsSchemaProblems}=await import(`${process.cwd()}/lib/engine-settings.mjs`);
const schema=await (await manage(engines[0],`/api/config/schema?profile=${pair[0].profile}`)).json();
const defaults=await (await manage(engines[0],'/api/config/defaults')).json();
assert.deepEqual(settingsSchemaProblems(engineSettings,schema,defaults),[],'the running Engine has every setting gtmworks lists');
writeFileSync(state,JSON.stringify(pair),{mode:0o600});
writeProof({step:'prepare',companies:pair.map(shown)});
writeName(pair[0].profile);
} else if(step==='verify') {
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const pair=JSON.parse(readFileSync(state,'utf8'));
const engines=await Promise.all(pair.map(entry=>engineFor(entry.company)));
const asked=[]; const toolResults=[];
const {model,reply}=await fakeModel(asked,toolResults);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const personOf=()=>person;
 for(const entry of pair) entry.person=user.id;
 const ask=askerFor({asked,reply,person});
 const first=pair[0], other=pair[1];
 const firstEngine=engines[0], otherEngine=engines[1];
 await makeFirstSecondAgent(ask,person,first,firstEngine);
 // The second Company's second Agent, on its own profile at creation, on the second Company's own Engine: the Engine
 // provides the profile it will be named for, and the database attaches the Agent to it (#126, #120).
 other.conversation=(await ask(other,other.agent,other.profile)).conversation;
 const [{run_id:secondRun}]=await checked(person.from('conversation_messages').select('run_id').eq('conversation_id',other.conversation).eq('author','person'));
 const call='install-second';
 const plan=await checked(service.rpc('lead_agent_profile',{conversation:other.conversation,run:secondRun,call,instructions:null}));
 assert.ok(plan?.profile,JSON.stringify(plan));
 const provided=await provideProfile({...otherEngine},{name:plan.profile,soul:agentSoul(plan.soul),config:toolConfig({profile:plan.profile}),forbidden:toolConfig({profile:plan.profile}).agent.disabled_toolsets});
 assert.equal(provided.state,'configured',plan.profile);
 await pointAtFakeModel(otherEngine,plan.profile);
 const second=await checked(service.rpc('lead_create_agent',{conversation:other.conversation,run:secondRun,call,agent_name:'Install second',job:'Writes the install check.',apps:[],template:null,instructions:null,own_profile:true}));
 assert.equal(second.state,'created');
 await until(`${plan.profile} recorded for its Agent`,async()=>await profileOf(person,second.agent)===plan.profile,180);
 other.second=second.agent; other.secondProfile=plan.profile;

 // Four Agents, each a profile of its own on its Company's Engine: the two main Agents on their Company's `co-`
 // profile, each second Agent on its `ag-` profile; no name is another Agent's, another Company's or a shared space's.
 const profiles=pair.flatMap(entry=>[entry.profile,entry.secondProfile]);
 assert.equal(new Set(profiles).size,4,'each of the four Agents has a profile of its own');
 for(const entry of pair) {
  assert.equal(entry.profile,companyProfile(entry.company),'the main Agent keeps its Company profile');
  assert.equal(entry.secondProfile,`ag-${entry.second.replaceAll('-','')}`,'the second Agent has its own profile');
  assert.equal(entry.space,spaceOf(entry),'the shared space is its Company\'s own');
  assert.notEqual(entry.profile,entry.secondProfile);
  assert.notEqual(entry.profile,entry.space);
  assert.notEqual(entry.secondProfile,entry.space);
  await checkProfile(engines[pair.indexOf(entry)],entry.secondProfile);
 }
 assert.ok(!profiles.includes('default'),'no Agent runs on the root profile');
 // The database holds exactly these two Agents per Company, and no profile serves two Companies.
 const rows=await checked(service.from('hermes_agents').select('company_id,profile'));
 assert.deepEqual(rows.filter(row=>pair.some(entry=>entry.company===row.company_id)).map(row=>row.profile).sort(),[...profiles].sort());
 assert.equal(new Set(rows.map(row=>row.profile)).size,rows.length,'no profile serves two Companies');

 // The memory written in the first Company's main Agent's profile reaches its own Run only: one message to each of the
 // four Agents, and the fake model sees the marker in the first one's requests alone, on the other Engine never.
 const memory=[];
 for(const entry of pair) for(const [agent,profile] of [[entry.agent,entry.profile],[entry.second,entry.secondProfile]])
  memory.push((await ask(entry,agent,profile)).remembered);
 assert.deepEqual(memory,[true,false,false,false]);
 const seen=[memory[0],memory[2]];
 assert.deepEqual(seen,[true,false]);
 // The memory written in the company profile stayed with the main Agent; the moved Agent starts with an empty one.
 const after=[(await ask(first,first.agent,first.profile)).remembered,(await ask(first,first.second,first.secondProfile)).remembered];
 assert.deepEqual(after,[true,false]);

 // A Contributor tells the main Agent a lasting rule, a suggestion; the Owner approves it from "Waiting on you".
 const teller={email:`lessons-${randomUUID().slice(0,8)}@example.com`,password:`Lessons-${randomUUID()}`};
 const {user:told}=await checked(service.auth.admin.createUser({...teller,email_confirm:true}));
 await checked(service.from('people').insert({id:told.id,name:'Lesson teller'}));
 await checked(service.from('members').insert({company_id:first.company,person_id:told.id,role:'contributor'}));
 const lesson=`From now on, sign every post as team ${randomUUID().slice(0,8)}.`;
 const contributor=await signedIn(teller.email,teller.password);
 const said=(await ask({...first,person:told.id},first.agent,first.profile,lesson,contributor)).conversation;
 const [{run_id:saidRun}]=await checked(contributor.from('conversation_messages').select('run_id').eq('conversation_id',said).eq('author','person'));
 const suggested=await checked(service.rpc('agent_save_rule',{conversation:said,run:saidRun,call:'install-lesson',rule:lesson}));
 assert.equal(suggested.state,'suggested');
 const [item]=await checked(person.from('waiting_items').select('id').eq('agent_rule_id',suggested.rule));
 assert.equal(await checked(personOf(first).rpc('decide_agent_rule',{c:first.company,item:item.id,approve:true})),'approved');

 // The worker writes it to the first Company's shared space on its own Engine, which the second Company's Engine never
 // holds.
 const homes=new Map();
 for(const [index,entry] of pair.entries()) homes.set(entry.company,Object.fromEntries((await (await manage(engines[index],'/api/profiles')).json()).profiles.map(profile=>[profile.name,profile.path])));
 const skill=async(engine,space)=>(await (await manage(engine,`/api/skills/content?profile=${encodeURIComponent(space)}&name=team-lessons`)).json()).content;
 const written=await until('the approved lesson in team-lessons',async()=>{ const content=await skill(firstEngine,spaceOf(first)); return content?.includes(lesson)&&content; },90);
 const otherSkill=await skill(otherEngine,spaceOf(other));
 assert.ok(!String(otherSkill||'').includes(lesson),'the second Company\'s Engine holds none of the first\'s lessons');
 // Each of the four Agent profiles reads exactly its own Company's shared folder, and holds the shared Skill locked.
 for(const [index,entry] of pair.entries()) for(const profile of [entry.profile,entry.secondProfile]) {
  const folder=`${homes.get(entry.company)[entry.space]}/skills`;
  const config=await until(`${profile} reads ${folder} alone`,async()=>{ const found=(await (await manage(engines[index],`/api/config?profile=${encodeURIComponent(profile)}`)).json()).skills;
   return JSON.stringify(found?.external_dirs)===JSON.stringify([folder])?found:null; },180);
  const listed=(await (await manage(engines[index],`/api/skills?profile=${encodeURIComponent(profile)}`)).json()).find(found=>found.name==='team-lessons');
  assert.deepEqual(config.external_dirs,[folder],`${profile} reads its own company's shared folder alone`);
  assert.ok(config.auto_load.includes('team-lessons')&&listed?.provenance==='external'&&listed.locked===true,`${profile} loads team-lessons and holds it locked`);
 }
 // A Skill written in the first Company's folder is listed for both of its Agents and for neither of the other's.
 const unique=`install-check-${randomUUID().slice(0,8)}`;
 const placed=await manage(firstEngine,`/api/skills?profile=${encodeURIComponent(first.space)}`,{method:'POST',body:JSON.stringify({name:unique,content:`---\nname: ${unique}\ndescription: The install check's own Skill\n---\nWritten for the install check.\n`})});
 assert.ok(placed.ok&&(await placed.json())?.success===true,'the install check writes its Skill in the first Company\'s folder');
 const listsSkill=async(engine,profile)=>(await (await manage(engine,`/api/skills?profile=${encodeURIComponent(profile)}`)).json()).some(found=>found.name===unique);
 await until(`${unique} listed for both of the first Company's Agents`,async()=>await listsSkill(firstEngine,first.profile)&&await listsSkill(firstEngine,first.secondProfile),180);
 assert.deepEqual([await listsSkill(otherEngine,other.profile),await listsSkill(otherEngine,other.secondProfile)],[false,false],'the other Company\'s Agents list no Skill of the first\'s folder');
 const carried=pair.flatMap(entry=>[{entry,agent:entry.agent,label:entry.profile},{entry,agent:entry.second,label:entry.secondProfile}]);
 const lessons=[];
 for(const one of carried) lessons.push((await ask(one.entry,one.agent,one.label)).sent.some(raw=>raw.includes(lesson)));
 assert.deepEqual(lessons,[true,true,false,false]);

 // A Run on a shared space is refused: each Engine serves its space but gives it no Run API key.
 for(const [index,entry] of pair.entries()) {
  const before=asked.length;
  const refusedRun=await fetch(`${engines[index].address}/p/${encodeURIComponent(entry.space)}/v1/runs`,{method:'POST',headers:{Authorization:`Bearer ${engines[index].key}`,'Content-Type':'application/json'},body:JSON.stringify({input:'مرحباً'})});
  assert.ok([401,403].includes(refusedRun.status),`a Run on ${entry.space} is refused (HTTP ${refusedRun.status})`);
  assert.equal(asked.length,before,`${entry.space} reaches no model`);
 }

 // A Run whose model rewrites the Skill with the Agent's own tool is refused by the Engine, and the Skill stays.
 const refused=await ask(first,first.second,first.secondProfile,trigger);
 assert.ok(toolResults.some(result=>result.includes('"success": false')&&result.includes('locked')),JSON.stringify(toolResults));
 assert.equal(await skill(firstEngine,spaceOf(first)),written,'team-lessons is unchanged');
 // That Run's one tool call, read from the Conversation's Hermes session on the Agent's own profile (#346), as the chat
 // reads it when it opens: skill_manage, failed (drawn Skipped), with the turn's length. gtmworks keeps no copy.
 const [{hermes_session_id:refusedSession}]=await checked(person.from('conversations').select('hermes_session_id').eq('id',refused.conversation));
 const {readSession}=await import(`${process.cwd()}/lib/engine/sessions.mjs`);
 const read=await readSession({...firstEngine,profile:first.secondProfile},refusedSession);
 assert.equal(read.state,'found',JSON.stringify(read));
 const turn=read.turns.at(-1);
 assert.deepEqual(turn.steps.map(({tool,state})=>({tool,state})),[{tool:'skill_manage',state:'failed'}],JSON.stringify(turn.steps));
 assert.ok(Number.isInteger(turn.seconds)&&turn.seconds>=0,`the Run's length is known: ${turn.seconds}`);
 writeProof({step:'steps',state:'found',count:turn.steps.length,seconds:turn.seconds});

 // The model the key brings is not checked: the Engine's model catalogue may be offline.
 const {readProviderKeys,setProviderKey,removeProviderKey}=await import(`${process.cwd()}/lib/engine/providers.mjs`);
 const keyed={space:spaceOf(first),profiles:[first.profile,first.secondProfile]};
 const offered=await readProviderKeys({...firstEngine,profile:first.profile},{...keyed,profiles:[]});
 assert.equal(offered.state,'found');
 const provider=(offered.keys.find(found=>found.provider==='openrouter')||offered.keys[0])?.provider;
 assert.ok(provider,'the Engine takes a key for a provider');
 const holds=async(engine,profile)=>Object.values(await (await manage(engine,`/api/env?profile=${encodeURIComponent(profile)}`)).json()).some(row=>row?.provider===provider&&row.provider_primary===true&&row.is_set===true);
 const providerKeys=()=>Promise.all([[firstEngine,spaceOf(first)],[firstEngine,first.profile],[firstEngine,first.secondProfile],[otherEngine,other.space],[otherEngine,other.profile],[otherEngine,other.secondProfile],[firstEngine,'default']].map(([engine,profile])=>holds(engine,profile)));
 assert.equal((await setProviderKey({...firstEngine,profile:first.profile},{...keyed,provider,value:`install-check-${randomUUID().replaceAll('-','')}`})).state,'written');
 const keyedStates=await providerKeys();
 assert.deepEqual(keyedStates,[true,true,true,false,false,false,false],'the key is in the first Company\'s space and its two Agent profiles only, never the root nor the other Engine');
 assert.deepEqual((await readProviderKeys({...firstEngine,profile:first.profile},keyed)).lacking,[]);
 assert.equal((await removeProviderKey({...firstEngine,profile:first.profile},{...keyed,provider})).state,'removed');
 assert.deepEqual(await providerKeys(),[false,false,false,false,false,false,false],'the key is removed again');
 writeFileSync(state,JSON.stringify(pair),{mode:0o600});
 writeProof({step:'verify',companies:pair.map(shown),memory,skills:lessons,keys:keyedStates,provider});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='second') {
const pair=JSON.parse(readFileSync(state,'utf8'));
const first=pair[0];
const firstEngine=await engineFor(first.company);
const asked=[];
const {model,reply}=await fakeModel(asked);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 for(const entry of pair) entry.person=user.id;
 await makeFirstSecondAgent(askerFor({asked,reply,person}),person,first,firstEngine);
 await checkProfile(firstEngine,first.secondProfile);
 writeFileSync(state,JSON.stringify(pair),{mode:0o600});
 writeProof({step:'second',companies:pair.map(shown)});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='capacity') {
assert.ok(['with-skills','no-skills'].includes(marker),'capacity names with-skills or no-skills');
const pair=JSON.parse(readFileSync(state,'utf8'));
const first=pair[0];
const firstEngine=await engineFor(first.company);
const made=[];
for(let index=1;index<=10;index++) {
 const name=`ag-${randomUUID().replaceAll('-','')}`;
 const started=Date.now();
 let profile;
 // The Engine may take a moment to serve a new profile's Run API; each attempt finishes the same profile, never clones.
 for(let attempt=1;attempt<=20;attempt++) {
  profile=await provideProfile({...firstEngine},{name,soul:'An Agent profile the install check made for capacity.',config:toolConfig({profile:name}),forbidden:toolConfig({profile:name}).agent.disabled_toolsets,noSkills:marker==='no-skills'});
  if(profile.state==='configured') break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(profile.state,'configured',name);
 const seconds=Number(((Date.now()-started)/1000).toFixed(3));
 made.push({name,seconds});
 writeProof({step:'capacity',kind:marker,profile:name,seconds,made:index,state:profile.state});
}
// A Run on the first Agent still answers after the profiles were made.
const asked=[];
const {model,reply}=await fakeModel(asked);
try {
 await pointAtFakeModel(firstEngine,first.profile);
 const person=await signedIn();
 const conversation=randomUUID();
 const firstKey=randomUUID();
 const sent=await until('the first Agent ready for a run',async()=>{ const result=await sendMessage(person,service,{person:first.person??(await person.auth.getUser()).data.user.id,company:first.company,conversation,sendKey:firstKey,agent:first.agent,message:'مرحباً، اكتب عنواناً قصيراً.'}); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until('the first Agent still answers',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(asked.length>0,'the first Agent asked the model');
 first.capacity=(first.capacity||[]).concat(made);
 writeFileSync(state,JSON.stringify(pair),{mode:0o600});
 writeProof({step:'capacity',kind:marker,made:made.length,state:'answered',company:first.company});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='company-sandbox') {
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const name=process.argv[4];
const person=await signedIn();
const {data:{user}}=await person.auth.getUser();
assert.ok(user,'the Owner signs in');
const [company]=await checked(service.from('companies').select('id').eq('name',name));
assert.ok(company,`the Company ${name}`);
const agent=await until(`${name}'s main Agent`,async()=>(await checked(person.from('hermes_agents').select('id,profile,is_default').eq('company_id',company.id))).find(found=>found.is_default&&found.profile),180);
const engine=await engineFor(company.id);
await until(`${agent.profile} on its Engine`,async()=>(await (await manage(engine,'/api/profiles')).json()).profiles?.some(profile=>profile.name===agent.profile),180);
await pointAtFakeModel(engine,agent.profile);
const command=`hostname; pwd; printf '%s' '${marker}' > '${marker}.txt'`;
const plan=messages=>messages.some(message=>message.role==='user'&&String(typeof message.content==='string'?message.content:JSON.stringify(message.content)).includes(`COMPANY-SANDBOX ${marker}`))
 &&!messages.some(message=>message.role==='tool')
 ? {id:'call_company_sandbox',type:'function',function:{name:'terminal',arguments:JSON.stringify({command})}}
 : null;
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,plan);
try {
 const conversation=randomUUID();
 const send={person:user.id,company:company.id,conversation,sendKey:randomUUID(),agent:agent.id,message:`COMPANY-SANDBOX ${marker}: run the check.`};
 const sent=await until(`${name}'s Agent ready for a run`,async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until(`reply of ${name}'s Agent`,async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 const terminal=(()=>{ try { return JSON.parse(String(results[0])); } catch { return null; } })();
 assert.equal(terminal?.exit_code,0,String(results[0]));
 const [host,cwd]=String(terminal.output).trim().split('\n');
 assert.equal(cwd,`/work/${agent.profile}`,'the command starts in the Agent\'s own folder of its Company\'s work folder');
 writeProof({step:'company-sandbox',marker,sandbox_host:host,profile:agent.profile,cwd});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='sandbox') {
// The work sandbox (#393, ADR 0018): a command, a file and code an Agent asks for run in the Company's sandbox and never
// on its Engine; two Agents start in a folder of their own inside the Company's work folder; and neither a profile write
// nor a settings write can move where a command runs. The fake model scripts the calls; the install job reads the host's
// Docker for where each marker landed, which a tool's own answer cannot fake.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const pair=JSON.parse(readFileSync(state,'utf8'));
const first=pair[0];
const firstEngine=await engineFor(first.company);
// Each profile is pointed at the fake model again for this step's Runs, whatever an earlier step left in its model
// setting: the verify step, for one, ends by setting and removing a provider's key, which leaves a profile's model on
// that provider and no key to reach it.
await pointAtFakeModel(firstEngine,first.profile);
await pointAtFakeModel(firstEngine,first.secondProfile);
const calls=[
 {name:'terminal',arguments:{command:`id -un; hostname; pwd; printf '%s' '${marker}-terminal' > /work/${marker}-terminal.txt`}},
 {name:'write_file',arguments:{path:`/work/${marker}-file.txt`,content:`${marker}-file`}},
 {name:'execute_code',arguments:{code:`from pathlib import Path\nimport os, socket\nPath('/work/${marker}-code.txt').write_text('${marker}-code')\nprint(socket.gethostname(), os.getuid())`}},
];
const pwdCall={name:'terminal',arguments:{command:'hostname; pwd'}};
const textOf=messages=>messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
const plan=messages=>{
 const text=textOf(messages);
 const done=messages.filter(message=>message.role==='tool').length;
 const call=text.includes(`SANDBOX-RUN ${marker}`)?calls[done]:text.includes(`SANDBOX-PWD ${marker}`)&&done<1?pwdCall:null;
 return call?{id:`call_sandbox_${done}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}:null;
};
const parsed=value=>{ try { return JSON.parse(value); } catch { return null; } };
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,plan);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const ask=async(agent,label,message)=>{
  const before=results.length;
  const conversation=randomUUID();
  const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent,message};
  const sent=await until(`${label} ready for a run`,async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
  assert.deepEqual(sent,{conversation});
  const answer=await until(`reply on ${label}`,async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
  assert.ok(answer.body.includes(reply),answer.body);
  return {conversation,tools:results.slice(before)};
 };
 // A command, a file and some code, asked for by name and run by the Engine's pinned backend.
 const run=await ask(first.agent,first.profile,`SANDBOX-RUN ${marker}: run the sandbox check.`);
 assert.equal(run.tools.length,3,JSON.stringify(run.tools));
 const terminal=parsed(run.tools[0]);
 const written=parsed(run.tools[1]);
 const code=parsed(run.tools[2]);
 const lines=String(terminal?.output??'').trim().split('\n');
 const [userName,host,cwd]=lines;
 assert.equal(terminal?.exit_code,0,run.tools[0]);
 assert.equal(userName,'pn','the command runs as the sandbox\'s own user');
 assert.equal(cwd,`/work/${first.profile}`,'the command starts in its own folder in the Company\'s work folder');
 assert.equal(written?.verified,true,run.tools[1]);
 assert.equal(written?.resolved_path,`/work/${marker}-file.txt`);
 assert.equal(code?.status,'success',run.tools[2]);
 const codeOutput=String(code?.output??'').trim().split(/\s+/);
 assert.equal(codeOutput[0],host,'code runs in the same sandbox as the command');
 assert.equal(codeOutput[1],'1000','code runs as the sandbox\'s ordinary user, never root');
 // Two Agents, two folders: each starts in its own folder inside the Company's one work folder, and the sandbox's login
 // shell makes the folder before the Engine's first command needs it (sandbox/work-shell).
 const second=await ask(first.second,first.secondProfile,`SANDBOX-PWD ${marker}: where do I start?`);
 const [secondHost,secondPwd]=String(parsed(second.tools[0])?.output??'').trim().split('\n');
 assert.equal(secondHost,host,'the second Agent\'s command runs in the same sandbox');
 assert.equal(secondPwd,`/work/${first.secondProfile}`,'the second Agent starts in a folder of its own');
 assert.notEqual(secondPwd,cwd,'the two Agents start in two different folders');
 // A profile write and a settings write, both answered as the probe measured (200 {"ok":true}), then a command again: it
 // still runs in the sandbox, in the Agent's own folder. The managed scope pins the backend after both (probe section 5,
 // rows 5 and 6).
 const profileWrite=await manage(firstEngine,`/api/config?profile=${encodeURIComponent(first.profile)}`,{method:'PUT',
  body:JSON.stringify({config:{terminal:{backend:'local',ssh_host:'127.0.0.1',ssh_user:'root'}}})});
 assert.equal(profileWrite.status,200,`a profile write is answered as stored (HTTP ${profileWrite.status})`);
 const settingsWrite=await manage(firstEngine,`/api/env?profile=${encodeURIComponent(first.profile)}`,{method:'PUT',body:JSON.stringify({key:'TERMINAL_ENV',value:'local'})});
 assert.equal(settingsWrite.status,200,`a settings write is answered as stored (HTTP ${settingsWrite.status})`);
 const after=await ask(first.agent,first.profile,`SANDBOX-PWD ${marker}: where do I start?`);
 const [afterHost,afterPwd]=String(parsed(after.tools[0])?.output??'').trim().split('\n');
 assert.equal(afterHost,host,'a profile write and a settings write cannot move a command off the sandbox');
 assert.equal(afterPwd,`/work/${first.profile}`,'the command still starts in the Agent\'s own folder');
 // The profile is put back to the fixed configuration for any later step.
 const restored=await (await import(`${process.cwd()}/lib/engine/agents.mjs`)).configureProfile(firstEngine,{name:first.profile,config:toolConfig({profile:first.profile}),forbidden:toolConfig({profile:first.profile}).agent.disabled_toolsets});
 assert.equal(restored.state,'configured');
 writeProof({step:'sandbox',marker,sandbox_host:host,user:userName,profile:first.profile,cwd,pwd:secondPwd,file:written?.resolved_path,code:code?.status});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='sandbox-mcp-add'||step==='sandbox-mcp') {
// A command server the Owner adds runs in the Company's work sandbox (#459, ADR 0024), in two steps around an Engine
// restart the install job makes. `sandbox-mcp-add`: added through gtmworks's driver as the Owner's form adds it, the
// Engine holds ssh into the sandbox and never the command itself, Test lists its tool and its card reads the command
// back as typed. The job then restarts the Engine, which connects every configured server when it starts, so the call
// does not wait on the Engine's MCP reconcile tick (gateway/run_profile_reconcile.py, measured at 23 s to over 4 min in
// CI). `sandbox-mcp`: an Agent calls the tool from a Conversation; the tool holds until the install job, which reads
// the processes of both containers from the host's Docker while the call runs, creates its release file in the
// sandbox. A tool's own answer cannot fake where it ran.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const pair=JSON.parse(readFileSync(state,'utf8'));
const first=pair[0];
const firstEngine=await engineFor(first.company);
const {prepareCommandServer,testServer,readApps,disconnectApp}=await import(`${process.cwd()}/lib/engine/apps.mjs`);
const target={...firstEngine,profile:first.profile};
const key='sandbox-proof';
const command={command:'node',args:['/work/tools/sandbox-proof-mcp.mjs']};
if(step==='sandbox-mcp-add') {
 await pointAtFakeModel(firstEngine,first.profile);
 // A failed add leaves nothing behind; a good one stays for the call.
 let added=false;
 try {
  assert.equal(await prepareCommandServer(target,{key,...command}),null,'the command server is added and on');
  const config=await (await manage(firstEngine,`/api/config?profile=${encodeURIComponent(first.profile)}`)).json();
  assert.equal(config.mcp_servers?.[key]?.command,'ssh','the Engine starts ssh into the sandbox, never the command');
  assert.ok(config.mcp_servers[key].args.includes('pn@sandbox'),'over the terminal backend\'s own route');
  assert.deepEqual(await testServer(target,key),{state:'connected',tools:['prove']},'Test lists the tool of the server in the sandbox');
  const card=(await readApps(target)).apps?.find(app=>app.key===key);
  assert.deepEqual([card?.source,card?.auth,card?.command,card?.args,card?.state],['custom','command',command.command,command.args,'connected']);
  added=true;
  writeProof({step:'sandbox-mcp-add',marker,profile:first.profile,state:'added'});
 } finally { if(!added) await disconnectApp(target,key).catch(()=>{}); }
} else {
// The pinned Engine offers an MCP server's tools to a Run through its tool search: `tool_search` lists each deferred tool
// by name (mcp__<server>__<tool>) and `tool_call` invokes it (model_tools.py, get_tool_definitions). A tool the Run lists
// directly is called directly.
const textOf=messages=>messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
let offered=null;
const plan=(messages,body)=>{
 if(!textOf(messages).includes(`SANDBOX-MCP ${marker}`)||messages.some(message=>message.role==='tool')) return null;
 const tools=(body?.tools||[]).map(tool=>tool?.function).filter(Boolean);
 const direct=tools.find(tool=>typeof tool.name==='string'&&tool.name.endsWith('__prove'))?.name;
 const deferred=tools.find(tool=>tool.name==='tool_search')?.description?.match(/mcp__\w+__prove/)?.[0];
 // The Engine asks the model again after the tool's answer, and for its own auxiliary calls with no tools, so the tool
 // once offered stays offered.
 offered=offered??direct??deferred??null;
 if(direct) return {id:'call_sandbox_mcp',type:'function',function:{name:direct,arguments:JSON.stringify({marker})}};
 return deferred&&tools.some(tool=>tool.name==='tool_call')
  ?{id:'call_sandbox_mcp',type:'function',function:{name:'tool_call',arguments:JSON.stringify({calls:[{name:deferred,arguments:{marker}}]})}}:null;
};
const asked=[]; const results=[];
let model=null;
try {
 const started=await fakeModel(asked,results,plan);
 model=started.model; const {reply}=started;
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 // The restarted Engine connected the server when it started; a Run that still does not offer it is asked again in a
 // new Conversation, three times at most.
 let answered=null;
 for(let attempt=0;attempt<3&&!offered;attempt++) {
  if(attempt) await new Promise(resolve=>setTimeout(resolve,15000));
  const conversation=randomUUID();
  const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:`SANDBOX-MCP ${marker}: call your design tool.`};
  const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
  assert.deepEqual(sent,{conversation});
  answered=await until('the reply',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),300);
 }
 assert.ok(answered?.body.includes(reply),answered?.body);
 assert.ok(offered,'a Run offers the server\'s tool once the Engine has started with it');
 assert.ok(results.length>=1,'the tool\'s answer reached the model');
 // The answer comes back as the Engine wraps a tool's result ({"result": "<host> <folder> <pid>"} inside its
 // untrusted-result block): only the host name and the /work path are read out of it.
 const [,host,cwd]=String(results[0]).match(/([a-z0-9][a-z0-9.-]*) (\/work\/[a-z0-9_-]+) \d+/)??[];
 assert.equal(cwd,`/work/${first.profile}`,'the server starts in the Agent\'s own folder of the Company\'s work folder');
 assert.equal((await disconnectApp(target,key)).state,'disconnected','Remove takes the server out of the profile');
 writeProof({step:'sandbox-mcp',marker,sandbox_host:host,profile:first.profile,cwd});
} finally { if(model) { model.close(); model.closeAllConnections(); } await disconnectApp(target,key).catch(()=>{}); }
}
} else if(step==='sandbox-key') {
// The Engine's pinned ssh client is hard-coded `StrictHostKeyChecking=accept-new`, which trusts a host it has not seen
// but refuses one whose key changed (tools/environments/ssh.py). The install pre-seeds the Engine's known_hosts with its
// sandbox's host key, so this step proves the pin: the install job replaces the sandbox's host key and restarts it, and
// an Agent's next command must fail (`refused`); after the key is put back the same command must run (`runs`). What it
// wrote is read by the job from the sandbox, so a tool's own answer cannot fake it.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const want=process.argv[4];
assert.ok(['refused','runs'].includes(want),'sandbox-key names refused or runs');
const first=JSON.parse(readFileSync(state,'utf8'))[0];
const firstEngine=await engineFor(first.company);
await pointAtFakeModel(firstEngine,first.profile);
const command=`printf '%s' '${marker}' > /work/${marker}-key.txt; id -un`;
const pwdPlan=messages=>{
 const text=messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
 const done=messages.filter(message=>message.role==='tool').length;
 return text.includes(`SANDBOX-KEY ${marker}`)&&done<1
  ? {id:'call_sandbox_key',type:'function',function:{name:'terminal',arguments:JSON.stringify({command})}}
  : null;
};
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,pwdPlan);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const conversation=randomUUID();
 const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:`SANDBOX-KEY ${marker}: run the check.`};
 const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until('reply on the sandbox key check',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(results.length>=1,JSON.stringify(results));
 const terminal=(()=>{ try { return JSON.parse(String(results[0])); } catch { return null; } })();
 const ran=terminal?.exit_code===0;
 if(want==='runs') assert.equal(ran,true,String(results[0]));
 else assert.notEqual(ran,true,`the Engine must refuse the sandbox's changed host key (${results[0]})`);
 writeProof({step:'sandbox-key',marker,want,ran});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='sandbox-sync') {
// Nothing is copied between the Engine and the sandbox (#393): the ssh backend runs with file sync off, so the sandbox's
// /home/pn/.hermes holds no file when an Agent's command starts, and nothing an Agent writes there comes back. The Agent
// counts the files it finds and writes the paths a sync would map (its own Skills, the shared Skills folder, its memories;
// a redirect into ~/.hermes/config.yaml is a command the Engine holds for a person's approval, so the install job plants
// the settings file itself); the install job checks the Engine's own Skills, shared folder, memory and settings after
// the teardown and asserts none of it arrived, and that a Run still works.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const first=JSON.parse(readFileSync(state,'utf8'))[0];
const firstEngine=await engineFor(first.company);
await pointAtFakeModel(firstEngine,first.profile);
// The profile names a credential file the sync would carry (the job writes it in the profile's home): with file sync off
// it must not reach the sandbox.
const named=await manage(firstEngine,`/api/config?profile=${encodeURIComponent(first.profile)}`,{method:'PUT',
 body:JSON.stringify({config:{terminal:{credential_files:['sandbox-check-credentials/credential.json']}}})});
assert.equal(named.status,200,`${first.profile} names the credential file the sync would carry (HTTP ${named.status})`);
const command=[
 `uploaded=$(find /home/pn/.hermes -type f 2> /dev/null | wc -l | tr -d ' ')`,
 `mkdir -p /home/pn/.hermes/skills/agent-made /home/pn/.hermes/external_skills/0/shared-made /home/pn/.hermes/memories`,
 `printf 'EDIT-${marker}\\n' > /home/pn/.hermes/skills/agent-made/SKILL.md`,
 `printf 'EDIT-${marker}\\n' > /home/pn/.hermes/external_skills/0/shared-made/SKILL.md`,
 `printf 'EDIT-${marker}\\n' > /home/pn/.hermes/memories/MEMORY.md`,
 `printf 'uploaded=%s\\n' "$uploaded"`,
].join('\n');
const plan=messages=>{
 const text=messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
 const done=messages.filter(message=>message.role==='tool').length;
 return text.includes(`SANDBOX-SYNC ${marker}`)&&done<1
  ? {id:'call_sandbox_sync',type:'function',function:{name:'terminal',arguments:JSON.stringify({command})}}
  : null;
};
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,plan);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const conversation=randomUUID();
 const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:`SANDBOX-SYNC ${marker}: write the paths a sync would copy.`};
 const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until('reply on the sandbox sync check',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.ok(results.length>=1,JSON.stringify(results));
 const terminal=(()=>{ try { return JSON.parse(String(results[0])); } catch { return null; } })();
 assert.equal(terminal?.exit_code,0,String(results[0]));
 const output=String(terminal?.output??'');
 const uploaded=Number(output.match(/uploaded=(\d+)/)?.[1]);
 assert.equal(uploaded,0,'the sandbox holds no file the Engine copied in');
 writeProof({step:'sandbox-sync',marker,count:uploaded});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='kanban') {
// The Engine's own Kanban board (spec #831, #833, ADR 0033 item 2), with settings alone: every Card is a Hermes Kanban
// task on the first Company's Engine, made and moved through the Engine's own routes on its management listener, and
// worked by its own dispatcher, tools and review. The check starts no Run for a Card: it asks the Engine for a dispatch
// tick, as gtmworks will after a write that makes a Card startable. The second Agent works Card A in the Company's work
// sandbox: a command that leaves a file there, a command the Engine marks dangerous (after its profile's own write tries
// to deny it; the managed scope approves it), a question, a person's answer, a review the person returns and then passes.
// The main Agent, in a Conversation (a Run started through the Run API), makes Card B for the second Agent with the
// Engine's own tool, which the second Agent works and the Engine's reviewing Agent passes; the step records whether the
// main Agent's session is told. A Card in triage is watched for two dispatcher ticks, with the model its decomposer
// called. The install job reads the host's Docker for where the worker's files landed.
// Its time is its clock's (lib/install-proof.mjs): the proxy area runs it after about 7 of its 12 minutes (#911), so the
// step has 270 s, prints a line as each phase ends, and holds every wait inside them. The triage Card's two ticks are the
// Engine's own (its decomposer runs on no tick a caller asks for), so Card A, Card B and the triage Card run side by side
// from its start; a failure prints the Cards as the board reads them before the step ends.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const clock=stepClock('kanban',270);
// A request the Engine never answers cannot hold the step past its budget either.
setTimeout(()=>{ clock.phase('the budget is spent with a request still open'); process.exit(1); },(clock.left()+20)*1000).unref();
const first=JSON.parse(readFileSync(state,'utf8'))[0];
const firstEngine=await engineFor(first.company);
const worker=first.secondProfile;
assert.ok(worker&&worker!==first.profile,'the first Company has a second Agent on a profile of its own');
for(const profile of [first.profile,worker]) {
 await pointAtFakeModel(firstEngine,profile);
 // The board's tools are offered to the profile's Runs, the Run API's included (lib/agent-toolsets.mjs).
 await checkProfile(firstEngine,profile);
}
clock.phase('both Agents are on the fake model and offered the board',{profile:worker});
const person='Proxy Owner';
const board=(path,init={})=>manage(firstEngine,`/api/plugins/kanban${path}`,{...init,signal:AbortSignal.timeout(20_000)});
const answered=async(response,what)=>{ assert.ok(response.ok,`${what} (HTTP ${response.status}: ${await response.clone().text()})`); return response.json(); };
const read=async id=>answered(await board(`/tasks/${encodeURIComponent(id)}`),`read Card ${id}`);
const make=async card=>(await answered(await board('/tasks',{method:'POST',body:JSON.stringify(card)}),`make the Card ${card.title}`)).task;
const move=async(id,change,what)=>answered(await board(`/tasks/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(change)}),what);
const comment=async(id,body)=>answered(await board(`/tasks/${encodeURIComponent(id)}/comments`,{method:'POST',body:JSON.stringify({body,author:person})}),`comment on ${id}`);
// One dispatcher tick that ran. Two dispatchers never tick one board at once: a tick asked for while another holds the
// board's lock (the Engine's own, or one this step asked for beside it) does nothing and says `skipped_locked`, so it is
// asked again. Each tick prints what it did, by Card id.
const ticked=result=>Object.fromEntries(Object.entries(result).filter(([,value])=>Array.isArray(value)?value.length:Boolean(value))
 .map(([key,value])=>[key,Array.isArray(value)?value.map(entry=>Array.isArray(entry)?entry[0]:entry):value]));
const tick=async what=>{
 const result=await until('a dispatch tick that ran',async()=>{
  const asked=await answered(await board('/dispatch?max=8',{method:'POST'}),'ask the Engine for a dispatch tick');
  return asked.skipped_locked?null:asked;
 },clock.within(15));
 clock.phase(`a dispatch tick asked for ${what}`,{board:ticked(result)});
 return result;
};
// A Card in one of the statuses named. A Card in review may already be `running` again: the dispatcher's own tick
// (every 60 s, as shipped) starts a reviewing Agent on it, which this step's fake model holds for the person.
const reaches=(id,statuses,seconds,also=()=>true)=>until(`Card ${id} ${[statuses].flat().join(' or ')}`,async()=>{
 const found=await read(id); return [statuses].flat().includes(found.task.status)&&also(found)?found:null;
},seconds);
const lastRun=found=>found.runs.at(-1);
let personActed=()=>{};
const acted=new Promise(resolve=>{ personActed=resolve; });
// The step's end, which no hold of the fake model outlasts.
const spent=new Promise(resolve=>{ setTimeout(resolve,clock.left()*1000).unref(); });
// The fake model's script (lib/install-kanban.mjs) reads what each session was told in its user turns only: Hermes's
// system prompt lists the bundled Skills, sdlc-review among them, for every session, and a reviewer is told so by the
// preloaded skill's line of its own first turn. Card A's reviewer waits for the person, or the step's end.
const {plan,tag,results,seen}=kanbanPlan({marker,worker,person,hold:()=>Promise.race([acted,spent])});
const parsed=value=>{ try { return JSON.parse(value); } catch { return null; } };
const cards={};
// The Cards as the board reads them, by id, status, Agent, each Run's profile and outcome and the latest events' kinds:
// what a failure prints.
const shownCards=async()=>Object.fromEntries(await Promise.all(Object.entries(cards).map(async([name,id])=>{
 try {
  const found=await read(id);
  return [name,{id,status:found.task.status,assignee:found.task.assignee,runs:found.runs.map(run=>[run.profile,run.status,run.outcome]),
   events:(found.events||[]).slice(-8).map(event=>event.kind)}];
 } catch(error) { return [name,{id,unread:String(error?.message??error).slice(0,200)}]; }
})));
const {model,reply}=await fakeModel([],[],plan);
try {
 // A Card in triage with no Agent, watched from now for two of the dispatcher's own ticks (60 s each, as shipped), beside
 // the rest of the step: it is read once the decomposer was called twice, or once two ticks' time is past.
 const idea=await make({title:tag.idea,body:'An idea to split later.',triage:true});
 cards.triage=idea.id;
 assert.equal(idea.status,'triage');
 clock.phase('a Card in triage is made',{board:{triage:idea.id}});
 const triage=(async()=>{
  await until('the decomposer called on two ticks',async()=>seen.decomposer.length>=2||null,clock.within(125)).catch(()=>{});
  const calls=seen.decomposer.length;
  // The second call's answer is the Engine's to apply: a Card it splits leaves triage within seconds.
  await until('the triage Card leaves triage',async()=>(await read(idea.id)).task.status!=='triage'||null,clock.within(5)).catch(()=>{});
  const found=await read(idea.id);
  clock.phase('the triage Card is read after two of the Engine\'s own ticks',{board:{status:found.task.status,decomposer_calls:calls}});
  return {status:found.task.status,children:found.links?.children?.length??0,decomposer_calls:calls,decomposer_models:[...new Set(seen.decomposer)]};
 })();
 // Joined with the other two below; until then a failed read of it waits there, not as an unhandled rejection.
 triage.catch(()=>{});
 // A profile's own write cannot turn the board worker's setting off: the managed scope is applied after it, per leaf.
 const denied=await manage(firstEngine,`/api/config?profile=${encodeURIComponent(worker)}`,{method:'PUT',body:JSON.stringify({config:{approvals:{single_query_mode:'deny'}}})});
 assert.equal(denied.status,200,`a profile write is answered as stored (HTTP ${denied.status})`);
 clock.phase('the second Agent\'s profile wrote single_query_mode deny');
 // Card A, given to the second Agent through the board's routes: ready, and nothing runs until a tick.
 const card=await make({title:tag.card,body:`Write a short brief for the launch. ${marker}`,assignee:worker});
 cards.a=card.id;
 assert.equal(card.status,'ready');
 assert.equal(card.created_by,'dashboard');
 assert.deepEqual((await read(card.id)).runs,[],'no Run before the tick');
 // A person's file on Card A (#843), added through the Engine's own route as gtmworks adds one: the Engine keeps it in
 // its Kanban attachments folder and names it in the worker's prompt by that path, which the sandbox holds read-only.
 const form=new FormData();
 form.append('file',new Blob([`${marker}-attachment`],{type:'text/plain'}),`${marker}-brief.txt`);
 form.append('uploaded_by',person);
 const uploaded=await fetch(`${firstEngine.managementAddress}/api/plugins/kanban/tasks/${encodeURIComponent(card.id)}/attachments`,{method:'POST',
  headers:{Authorization:`Bearer ${firstEngine.key}`},body:form,signal:AbortSignal.timeout(20_000)});
 const attachment=(await answered(uploaded,'add a person\'s file to Card A')).attachment;
 assert.match(String(attachment?.stored_path),/^\/opt\/data\/kanban\/attachments\//,`the Engine keeps it in its attachments folder: ${JSON.stringify(attachment)}`);
 assert.equal(attachment.uploaded_by,person);
 clock.phase('Card A is made, ready, with no Run, and a person\'s file on it',{board:{card:card.id}});
 const tickAsked=Date.now();
 const spawned=(await tick('for Card A')).spawned??[];
 const started=await until('the dispatcher starts Card A',async()=>{ const found=await read(card.id); return found.runs.length?found:null; },clock.within(30));
 const startSeconds=Math.round((Date.now()-tickAsked)/1000);
 assert.equal(lastRun(started).profile,worker,'the Card is worked by the Agent it was given to');
 clock.phase('the dispatcher started Card A',{board:{card:card.id,spawned_by_tick:spawned.some(([id])=>id===card.id),started_seconds:startSeconds}});
 // Card B, beside Card A: the main Agent, in a Conversation, gives a job to the second Agent with the Engine's own tool;
 // the second Agent works it and the Engine's reviewing Agent passes it by itself.
 const jobFlow=(async()=>{
  const owner=await signedIn();
  const {data:{user}}=await owner.auth.getUser();
  assert.ok(user,'the first-run Owner signs in');
  const conversation=randomUUID();
  const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:`${tag.ask}: give the job to the second Agent.`};
  const sent=await until('the main Agent ready for a run',async()=>{ const result=await sendMessage(owner,service,send); return 'queued' in result?null:result; },clock.within(60));
  assert.deepEqual(sent,{conversation});
  const answer=await until('reply on the board Conversation',async()=>(await checked(owner.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),clock.within(90));
  assert.ok(answer.body.includes(reply),answer.body);
  const createdAnswer=results.get('call_kanban_create')??'';
  const columns=(await answered(await board('/board'),'read the board')).columns;
  const job=columns.flatMap(column=>column.tasks).find(found=>found.title===tag.job);
  assert.ok(job,`the main Agent made Card B: ${createdAnswer}`);
  cards.b=job.id;
  assert.equal(job.created_by,first.profile,'Card B is made by the main Agent');
  assert.equal(job.assignee,worker,'Card B is given to the second Agent');
  clock.phase('the main Agent\'s Conversation made Card B',{board:{job:job.id}});
  await tick('for Card B');
  // Sent for review only by a Run that ended `review_requested`: a worker that completes its own Card, as every one did
  // on run 45849314052, is no review (lib/install-kanban.mjs).
  await reaches(job.id,['review','running','done'],clock.within(90),found=>reviewRequested(found.runs,`JOB-DONE-${marker}`));
  clock.phase('Card B is sent for review',{board:{job:job.id}});
  await tick('for Card B\'s review');
  const jobDone=await reaches(job.id,'done',clock.within(90));
  assert.ok(passedAfterReview(jobDone.runs,`JOB-DONE-${marker}`,`JOB-PASSED-${marker}`),
   `the reviewing Agent passed Card B by itself, on a Run after the review request: ${JSON.stringify(jobDone.runs.map(run=>[run.profile,run.outcome]))}`);
  clock.phase('the reviewing Agent passed Card B',{board:{job:job.id}});
  // Whether the main Agent's session is told: the Engine's notifier, which polls every 5 s, wakes the session that made
  // the Card, on its review request as on its end. Recorded, not required.
  const told=await until('the main Agent is told',async()=>seen.told||null,clock.within(20)).then(()=>true,()=>false);
  clock.phase('the main Agent\'s session told of Card B, or not',{board:{told}});
  return {id:job.id,created_by:job.created_by,assignee:job.assignee,subscribed:/"subscribed"\s*:\s*true/.test(createdAnswer),done:jobDone.task.status,told};
 })();
 // Card A, the person's: its question, its answer, its return and its pass.
 const cardFlow=(async()=>{
  // The worker runs its command and the dangerous one in the sandbox, then stops on its question.
  const blocked=await reaches(card.id,'blocked',clock.within(90));
  assert.equal(lastRun(blocked).outcome,'blocked');
  assert.match(String(lastRun(blocked).summary??blocked.task.latest_summary),new RegExp(`QUESTION-${marker}`));
  const ran=parsed(results.get('call_kanban_work'));
  assert.equal(ran?.exit_code,0,`the worker's command ran: ${results.get('call_kanban_work')}`);
  const [host,pwd]=String(ran.output??'').trim().split('\n');
  const written=String(ran.output??'').trim().split('\n').at(-1);
  const dangerous=results.get('call_kanban_danger')??'';
  assert.doesNotMatch(dangerous,/\bBLOCKED\b/,`the dangerous command is not refused: ${dangerous}`);
  assert.equal(parsed(dangerous)?.exit_code,0,`the dangerous command ran: ${dangerous}`);
  clock.phase('Card A ran its two commands and is blocked on its question',{board:{card:card.id}});
  // The person answers: a comment under their name, then a move to ready; the worker's next Run reads it and goes on.
  await comment(card.id,`${tag.answer}: use blue.`);
  assert.equal((await move(card.id,{status:'ready'},'move Card A to ready after the answer')).task.status,'ready');
  await tick('for Card A after the answer');
  const reviewed=await reaches(card.id,['review','running'],clock.within(90),found=>reviewRequested(found.runs,`SUMMARY-1-${marker}`));
  assert.ok(seen.work.some(run=>run.answer&&run.person),'the next Run read the answer under the person\'s name');
  assert.ok(reviewed.runs.filter(run=>run.profile===worker).length>=2,'the answer started a second Run of the same Agent');
  clock.phase('Card A read the answer and is sent for review',{board:{card:card.id}});
  // The person returns the review with a reason: the reason is a comment (the move takes none), then a move to ready
  // puts the Card back to the same Agent. A reviewer the Engine's own tick started meanwhile is stopped first.
  await comment(card.id,`${tag.back}: make it shorter.`);
  let reviewerStopped=false;
  if((await read(card.id)).task.status==='running') {
   await answered(await board(`/tasks/${encodeURIComponent(card.id)}/reclaim`,{method:'POST',body:JSON.stringify({reason:'A person returns the review.'})}),'stop the reviewer\'s Run');
   reviewerStopped=(await reaches(card.id,['review','ready'],clock.within(30))).task.status;
   clock.phase('the reviewer the Engine\'s own tick started on Card A is stopped',{board:{card:card.id,reviewer_stopped:reviewerStopped}});
  }
  const returned=reviewerStopped==='ready'?(await read(card.id)).task:(await move(card.id,{status:'ready'},'return Card A')).task;
  assert.equal(returned.status,'ready','a return moves the Card to ready');
  assert.equal(returned.assignee,worker,'a return puts the Card back to the same Agent');
  clock.phase('the person returned Card A to the same Agent',{board:{card:card.id,returned_to:returned.assignee}});
  await tick('for Card A after the return');
  const again=await reaches(card.id,['review','running'],clock.within(90),found=>reviewRequested(found.runs,`SUMMARY-2-${marker}`));
  assert.ok(seen.work.some(run=>run.back),'the Agent\'s next Run read the reason it was sent back');
  assert.equal(again.task.assignee,worker);
  clock.phase('Card A read the reason and is sent for review again',{board:{card:card.id}});
  // The person passes it: the Card is done with the Agent's summary and the line naming the person.
  const passedLine=`Passed by ${person}.`;
  await move(card.id,{status:'done',summary:`${again.task.latest_summary}\n\n${passedLine}`},'pass Card A');
  personActed();
  const done=await reaches(card.id,'done',clock.within(20));
  assert.ok(String(done.task.latest_summary).includes(`SUMMARY-2-${marker}`)&&String(done.task.latest_summary).includes(passedLine),String(done.task.latest_summary));
  assert.ok(passedAfterReview(done.runs,`SUMMARY-2-${marker}`,passedLine),
   `the person's pass ends a Run after the second review request: ${JSON.stringify(done.runs.map(run=>[run.profile,run.outcome]))}`);
  assert.ok(done.comments.some(found=>found.author===person&&found.body.startsWith(tag.answer)),'the answer is on the Card under the person\'s name');
  clock.phase('the person passed Card A, done with its summary',{board:{card:card.id}});
  return {host,pwd,written,reviewerStopped,returned:returned.assignee,done:done.task.status};
 })();
 // The three side by side: the first to fail fails the step at once.
 const [a,job,ideaAfter]=await Promise.all([cardFlow,jobFlow,triage]);
 writeProof({step:'kanban',marker,sandbox_host:a.host,pwd:a.pwd,profile:worker,attachment_path:attachment.stored_path,attachment_write:a.written,board:{
  card:card.id,spawned_by_tick:spawned.some(([id])=>id===card.id),started_seconds:startSeconds,dangerous:'ran',
  reviewer_stopped:a.reviewerStopped,returned_to:a.returned,done:a.done,job,triage:ideaAfter,reviews:seen.reviews}});
} catch(error) {
 // How far it got, and the Cards as the board reads them, before the step ends; nothing left open holds it past a second.
 clock.phase('failed',{marker,board:{error:String(error?.message??error).slice(0,400),cards:await shownCards()}});
 setTimeout(()=>process.exit(1),1000).unref();
 throw error;
} finally { personActed(); model.close(); model.closeAllConnections(); }
} else if(step==='library') {
// The Library shows the Company's work folder (#395): an Agent writes a text file with its file tool and a picture with
// its terminal, in its own folder of the work folder, and the Owner's Library of that Agent lists both, previews the
// text and the picture, and downloads each with the same bytes the Agent wrote, all through gtmworks's own service and
// the Engine contract. The job reads the sandbox and the Engine's mount for the same files, and tries a write from the
// Engine's container, which must fail.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const {agentLibrary,agentFilePreview,agentFileDownload}=await import(`${process.cwd()}/lib/agent-files.mjs`);
const first=JSON.parse(readFileSync(state,'utf8'))[0];
const firstEngine=await engineFor(first.company);
await pointAtFakeModel(firstEngine,first.profile);
const text=`# ${marker}\n\nمسودة الحملة: Arabic and English in one file.\n`;
const picture=[137,80,78,71,13,10,26,10,0,1,2,3,254,255];
const textName=`${marker}-brief.md`; const pictureName=`${marker}-shot.png`;
const octal=picture.map(byte=>`\\${byte.toString(8).padStart(3,'0')}`).join('');
// The links an Agent could flip in the work folder: on the Engine's read-only mount, an absolute one resolves on the
// Engine's own disk, where the other profile's memory is.
const mine=`/work/${first.profile}`; const theirs=first.secondProfile; const memory=`/opt/data/profiles/${theirs}/memories`;
const planted={leak:`${marker}-leak.md`,up:`${marker}-up`,folder:`${marker}-mem`,hidden:`.${marker}-hidden`};
const calls=[
 {name:'write_file',arguments:{path:`${mine}/${textName}`,content:text}},
 {name:'terminal',arguments:{command:`printf '${octal}' > ${mine}/${pictureName}`}},
 {name:'terminal',arguments:{command:[`mkdir -p /work/${theirs}`,`printf theirs > /work/${theirs}/${marker}-x`,
  `ln -s ${memory}/MEMORY.md ${mine}/${planted.leak}`,`ln -s ../${theirs}/${marker}-x ${mine}/${planted.up}`,
  `ln -s ${memory} ${mine}/${planted.folder}`,`printf hidden > ${mine}/${planted.hidden}`].join(' && ')}},
];
const plan=messages=>{
 const said=messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
 const done=messages.filter(message=>message.role==='tool').length;
 const call=said.includes(`LIBRARY-RUN ${marker}`)?calls[done]:null;
 return call?{id:`call_library_${done}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}:null;
};
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,plan);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const conversation=randomUUID();
 const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:`LIBRARY-RUN ${marker}: save the brief and the shot.`};
 const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 const answer=await until('reply on the library check',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
 assert.ok(answer.body.includes(reply),answer.body);
 assert.equal(results.length,3,JSON.stringify(results));
 // The Owner's Library of that Agent, read as the app reads it: the signed-in person's own session, the Company's Engine.
 const request={company:first.company,agent:first.agent};
 const library=await agentLibrary(person,request);
 assert.equal(library.state,'found',JSON.stringify(library));
 const listed=new Map(library.entries.map(entry=>[entry.name,entry]));
 assert.equal(listed.get(textName)?.size,Buffer.byteLength(text),'the Library lists the file the Agent wrote, with its size');
 assert.equal(listed.get(pictureName)?.size,picture.length,'the Library lists the picture the Agent made, with its size');
 assert.ok(!JSON.stringify(library).includes('/opt/')&&!JSON.stringify(library).includes('/work/'),'no Engine or sandbox path in the answer');
 const preview=await agentFilePreview(person,{...request,name:textName});
 assert.equal(preview.state,'found',JSON.stringify(preview));
 assert.equal(preview.preview.kind,'text');
 assert.equal(preview.preview.text,text,'the preview is the text the Agent wrote');
 const shot=await agentFilePreview(person,{...request,name:pictureName});
 assert.equal(shot.preview?.kind,'image','the picture previews as a picture');
 const download=await agentFileDownload(person,{...request,name:textName});
 assert.equal(download.state,'found',JSON.stringify({state:download.state}));
 assert.equal(Buffer.from(download.body).toString('utf8'),text,'the download is the bytes the Agent wrote');
 const image=await agentFileDownload(person,{...request,name:pictureName});
 assert.equal(image.state,'found',JSON.stringify({state:image.state}));
 assert.deepEqual([...image.body],picture,'the picture downloads with the same bytes');
 // What the Agent planted is neither listed nor read, and nothing of the other profile's memory comes back.
 for(const name of Object.values(planted)) assert.ok(!listed.has(name),`${name} is not listed`);
 const answers=[];
 for(const name of [planted.leak,planted.up,planted.hidden]) {
  const got=await agentFileDownload(person,{...request,name}); const seen=await agentFilePreview(person,{...request,name});
  assert.ok(['missing','invalid'].includes(got.state),`${name} does not download: ${got.state}`);
  assert.ok(['missing','invalid'].includes(seen.state),`${name} does not preview: ${seen.state}`);
  answers.push(got,seen);
 }
 const inside=await agentLibrary(person,{...request,folder:planted.folder});
 assert.equal(inside.state,'missing','a link to a folder is not a folder of the Library');
 const behind=await agentFileDownload(person,{...request,folder:planted.folder,name:'MEMORY.md'});
 assert.equal(behind.state,'missing','nothing behind a link to a folder downloads');
 answers.push(inside,behind,await agentFilePreview(person,{...request,folder:planted.folder,name:'MEMORY.md'}));
 const said=JSON.stringify(answers,(key,value)=>value instanceof Uint8Array?Buffer.from(value).toString('utf8'):value);
 assert.ok(!said.includes(`${marker}-leak`)&&!said.includes('theirs'),'no byte of the other profile comes back');
 writeProof({step:'library',marker,profile:first.profile,count:library.entries.length,kind:preview.preview.kind,file:textName});
} finally { model.close(); model.closeAllConnections(); }
} else if(step==='screen-open'||step==='screen-sleep'||step==='screen-wake'||step==='screen-live') {
// The Company's Screen (#711, vault decision 0068): one display and one browser profile in the Company's sandbox, shared
// by its Agents. screen-open: the first Company's main Agent is asked to open a page on its Screen. Its Run is offered
// computer_use (the Engine finds the sandbox image's driver the install copied in), so it captures the Screen, which
// wakes it, opens the page with the sandbox's own browser on the display the Engine published, and lists the Screen's
// windows with computer_use until the page's title is there. The Engine's display.status, asked on its management
// listener's /api/ws as the Engine contract will, then reads the Screen awake on :20 inside the sandbox. The profile's
// idle stop is set short for the proof first (the default, 30 minutes, is the Engine's and is put back by screen-wake).
// screen-sleep: display.status, read every few seconds, until the Screen is asleep: the listener stops an idle Screen
// only for a profile a display.* call named there (tui_gateway/methods_display_watch.py), which screen-open's call did.
// screen-wake: the same Agent uses its Screen again, and display.status reads it awake.
assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
const first=JSON.parse(readFileSync(state,'utf8'))[0];
const firstEngine=await engineFor(first.company);
// One JSON-RPC call on the management listener's /api/ws, admitted by the Engine's own key (the session-token provider
// of a gated listener takes it as `?token=`).
const display=async(method,params={})=>{
 const socket=new WebSocket(`${firstEngine.managementAddress.replace(/^http/,'ws')}/api/ws?token=${encodeURIComponent(firstEngine.key)}`);
 try {
  return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error(`${method} was not answered within 60 s`)),60000);
   socket.addEventListener('message',event=>{
    const data=JSON.parse(String(event.data));
    if(data.id!==1) return;
    clearTimeout(timer);
    if(data.error) reject(new Error(`${method}: ${data.error.message}`)); else resolve(data.result);
   });
   socket.addEventListener('close',event=>{ clearTimeout(timer); reject(new Error(`${method}: the listener closed /api/ws (${event.code} ${event.reason})`)); });
   socket.addEventListener('open',()=>socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method,params:{profile:first.profile,...params}})));
  });
 } finally { socket.close(); }
};
const shownStatus=status=>({running:status.running,display:status.display,placement:status.placement});
if(step==='screen-sleep') {
 const asleep=await until('the idle Screen asleep',async()=>{ const status=await display('display.status'); return status.running?null:status; },300);
 assert.equal(asleep.blocker,null,'an asleep Screen can wake again');
 writeProof({step,marker,profile:first.profile,screen:shownStatus(asleep)});
} else if(step==='screen-live') {
 // screen-live (#713, ADR 0029): the awake Screen's live stream through gtmworks's own address only. The Owner signs in
 // as a browser does (the session cookie the app reads), opens /api/display/ws on the gateway, the install's one public
 // address, with the Origin a browser sends (the app refuses one whose host is not the Host the gateway passed on), and
 // holds the stream: the real Xvnc's RFB handshake to its framebuffer of 1440 by 900, then a full picture.
 // Taking control leaves the Engine's lease with a person, a pointer move goes through, and "Done" gives it back; both
 // are one Company log row with the Owner. Then the socket closes while in control, as a lost connection, and the lease
 // is back with the Agent.
 const {createServerClient}=await import('@supabase/ssr');
 const {supabaseSettings}=await import(`${process.cwd()}/lib/supabase-settings.mjs`);
 const {default:WebSocketClient}=await import('ws');
 const settings=supabaseSettings();
 const jar=new Map();
 const browser=createServerClient(settings.url,settings.anonKey,{cookieOptions:settings.cookieOptions,cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>{ for(const {name,value} of items) { if(value) jar.set(name,value); else jar.delete(name); } }}});
 const signedIn=await browser.auth.signInWithPassword(credentials);
 assert.equal(signedIn.error,null,'the Owner signs in');
 const owner=signedIn.data.user.id;
 const cookie=[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
 const open=()=>{
  const socket=new WebSocketClient(`${origin.replace(/^http/,'ws')}/api/display/ws?company=${first.company}&agent=${first.agent}`,{headers:{cookie,origin}});
  const said=[]; let bytes=Buffer.alloc(0); let wake=()=>{};
  socket.on('message',(data,binary)=>{ if(binary) bytes=Buffer.concat([bytes,data]); else said.push(JSON.parse(String(data))); wake(); });
  const closed=new Promise(resolve=>socket.on('close',code=>{ wake(); resolve(code); }));
  socket.on('error',()=>{});
  const wait=async(what,ready,seconds=30)=>{
   const end=Date.now()+seconds*1000;
   for(;;) { const found=ready(); if(found) return found; if(Date.now()>end) throw new Error(`${what} within ${seconds}s: ${JSON.stringify(said)}`); await new Promise(resolve=>{ wake=resolve; setTimeout(resolve,500); }); }
  };
  const heard=(what,match)=>wait(what,()=>said.find(message=>Object.entries(match).every(([key,value])=>message[key]===value)));
  const take=async count=>{ await wait('RFB bytes',()=>bytes.length>=count); const out=bytes.subarray(0,count); bytes=bytes.subarray(count); return out; };
  return {socket,said,closed,heard,take,available:()=>bytes.length,drop:()=>{ bytes=Buffer.alloc(0); }};
 };
 const live=open();
 await live.heard('the Screen controlled by its Agent',{control:'agent'});
 await live.heard('a live stream',{stream:'open'});
 const version=String(await live.take(12));
 assert.match(version,/^RFB 003\.00[378]\n$/,'the stream is the Screen\'s RFB');
 live.socket.send(Buffer.from('RFB 003.008\n'));
 const [count]=await live.take(1);
 assert.ok(count>0,'the Screen offers a security type');
 const types=[...await live.take(count)];
 assert.ok(types.includes(1),`the Screen's stream needs no password inside the Engine (offered ${types})`);
 live.socket.send(Buffer.from([1]));
 assert.equal((await live.take(4)).readUInt32BE(0),0,'the handshake is accepted');
 live.socket.send(Buffer.from([1]));
 const init=await live.take(24);
 const width=init.readUInt16BE(0), height=init.readUInt16BE(2);
 await live.take(init.readUInt32BE(20));
 assert.deepEqual([width,height],[1440,900],'the stream is the Screen at the Engine\'s size');
 // A full picture, asked in the Screen's own pixel format: held for ten seconds through the gateway.
 const ask=Buffer.alloc(10); ask[0]=3; ask.writeUInt16BE(width,6); ask.writeUInt16BE(height,8);
 live.socket.send(ask);
 const held=Date.now();
 let received=0;
 while(Date.now()-held<10000) { await new Promise(resolve=>setTimeout(resolve,500)); received+=live.available(); live.drop(); }
 assert.ok(received>100000,`a full picture came through gtmworks (${received} bytes)`);
 assert.equal(live.socket.readyState,live.socket.OPEN,'the stream is still open after ten seconds');
 // Take control, a pointer move, then Done.
 live.socket.send(JSON.stringify({take:true}));
 await live.heard('control for the Owner',{control:'mine'});
 assert.equal((await display('display.status')).lease?.holder,'human','the Engine\'s lease is with a person');
 const pointer=Buffer.alloc(6); pointer[0]=5; pointer.writeUInt16BE(100,2); pointer.writeUInt16BE(100,4);
 live.socket.send(pointer);
 live.socket.send(JSON.stringify({giveBack:true}));
 await live.heard('control given back',{given:true});
 assert.equal((await display('display.status')).lease?.holder,'agent','the Engine\'s lease is back with the Agent');
 // A socket ended while in control gives it back.
 live.socket.send(JSON.stringify({take:true}));
 await until('control taken again',async()=>live.said.filter(message=>message.control==='mine').length>=2,30);
 live.socket.terminate();
 await until('the lease back with the Agent after the socket ended',async()=>(await display('display.status')).lease?.holder==='agent',30);
 // The Owner reads the log as they would in Activity: the service role has no grant on it.
 const rows=await checked(browser.from('company_log').select('action,actor_id').eq('agent_id',first.agent).in('action',['agent_screen_taken','agent_screen_given_back']));
 const by=action=>rows.filter(row=>row.action===action&&row.actor_id===owner).length;
 await until('the give-back rows',async()=>{ const again=await checked(browser.from('company_log').select('action,actor_id').eq('agent_id',first.agent).eq('action','agent_screen_given_back')); return again.filter(row=>row.actor_id===owner).length>=2; },30);
 assert.equal(by('agent_screen_taken'),2,'each take is one log row with the Owner');
 writeProof({step,marker,profile:first.profile,screen:{width,height},bytes:received});
} else {
await pointAtFakeModel(firstEngine,first.profile);
const idle=step==='screen-open'?0.5:30;
const idled=await manage(firstEngine,`/api/config?profile=${encodeURIComponent(first.profile)}`,{method:'PUT',body:JSON.stringify({config:{bot_desktop:{idle_stop_minutes:idle}}})});
assert.equal(idled.status,200,`the profile's idle stop is set to ${idle} minutes`);
const title=`SCREEN-${marker}`;
const page=`/work/${first.profile}/${marker}-screen.html`;
// The page, written beside the Agent's work and opened with the sandbox's browser on the Screen's own display (the
// launcher publishes it in the profile's folder under /tmp/hermes-bot-desktop) and the Screen's one browser profile.
const open=`printf '<!doctype html><title>${title}</title><h1>${marker}</h1>' > ${page} && set -a && . "$(ls -t /tmp/hermes-bot-desktop/*/env | head -n 1)" && set +a && exec chromium --user-data-dir="$HOME/.hermes/bot-desktop/browser-profile" --no-first-run --no-default-browser-check file://${page}`;
const offered=[];
const textOf=messages=>messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
// The pinned Engine defers computer_use behind its tool search (tools.tool_search.defer): `tool_search` lists it by name
// and `tool_call` invokes it, as the sandbox-mcp step calls a deferred tool; a Run that lists it directly calls it so.
let direct=false;
const call=(done,name,args)=>name==='computer_use'&&!direct
 ?{id:`call_screen_${done}`,type:'function',function:{name:'tool_call',arguments:JSON.stringify({calls:[{name,arguments:args}]})}}
 :{id:`call_screen_${done}`,type:'function',function:{name,arguments:JSON.stringify(args)}};
const plan=(messages,body)=>{
 const tools=(body?.tools||[]).map(tool=>tool?.function).filter(Boolean);
 // The Engine also asks the model for its own auxiliary calls, with no tools: only a Run's own requests count.
 if(tools.length) {
  direct=tools.some(tool=>tool.name==='computer_use');
  const deferred=tools.some(tool=>tool.name==='tool_call')&&/\bcomputer_use\b/.test(tools.find(tool=>tool.name==='tool_search')?.description||'');
  offered.push({names:tools.map(tool=>tool.name),computerUse:direct||deferred});
 }
 if(!tools.length) return null;
 const text=textOf(messages);
 const answers=messages.filter(message=>message.role==='tool');
 const done=answers.length;
 if(text.includes(`SCREEN-WAKE ${marker}`)) return done<1?call(done,'computer_use',{action:'capture',mode:'ax'}):null;
 if(!text.includes(`SCREEN-OPEN ${marker}`)) return null;
 if(done===0) return call(done,'computer_use',{action:'capture',mode:'ax'});
 if(done===1) return call(done,'terminal',{command:open,background:true});
 const seen=answers.slice(2).some(message=>JSON.stringify(message.content).includes(title));
 if(seen||done>=16) return null;
 return done%2===0?call(done,'computer_use',{action:'list_windows'}):call(done,'computer_use',{action:'wait',seconds:2});
};
const asked=[]; const results=[];
const {model,reply}=await fakeModel(asked,results,plan);
try {
 const person=await signedIn();
 const {data:{user}}=await person.auth.getUser();
 assert.ok(user,'the first-run Owner signs in');
 const conversation=randomUUID();
 const message=step==='screen-open'?`SCREEN-OPEN ${marker}: open the page on your Screen.`:`SCREEN-WAKE ${marker}: look at your Screen.`;
 const send={person:user.id,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message};
 const sent=await until('the Agent ready for a run',async()=>{ const result=await sendMessage(person,service,send); return 'queued' in result?null:result; },180);
 assert.deepEqual(sent,{conversation});
 // A Run that never replies says how far it came: how often it asked the model, with which tools, and what each tool
 // answered, cut short (the tool answers are the Screen's and the sandbox's, never a key).
 const answer=await until('reply on the Screen check',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),300)
  .catch(error=>{ throw new Error(`${error.message}: the model was asked ${asked.length} times, first offered ${JSON.stringify(offered[0])}, tool answers ${JSON.stringify(results.map(result=>result.slice(0,300)))}`); });
 assert.ok(answer.body.includes(reply),answer.body);
 // The Run itself was offered computer_use, and never the browser tools no Agent gets: what the model was sent, not the
 // toolsets the profile reports, which read its settings only.
 assert.ok(offered.length>0&&offered.every(request=>request.computerUse),`the Run is offered computer_use: ${JSON.stringify(offered[0])}`);
 assert.ok(!offered.some(request=>request.names.some(name=>/^browser_/.test(name||''))),'the Run is offered no browser tool');
 const captured=String(results[0]??'');
 assert.ok(results.length>=1&&!/human_has_control|not ready|not installed|is not running/.test(captured),`the Screen is captured: ${captured.slice(0,400)}`);
 if(step==='screen-open') {
  const launched=(()=>{ try { return JSON.parse(String(results[1])); } catch { return null; } })();
  assert.ok(launched&&!launched.error,`the page is opened on the Screen: ${String(results[1]).slice(0,400)}`);
  assert.ok(results.slice(2).some(result=>result.includes(title)),`computer_use lists the page's window on the Screen: ${results.at(-1)?.slice(0,600)}`);
 }
 const status=await display('display.status');
 assert.equal(status.running,true,'display.status reads the Screen awake');
 assert.equal(status.display,':20','the Screen is the Company\'s one display');
 assert.equal(status.placement,'terminal:ssh','the Screen is inside the Company\'s sandbox, reached over ssh');
 assert.equal(status.lease?.holder,'agent','the Agent holds its Screen');
 writeProof({step,marker,profile:first.profile,screen:shownStatus(status),window:step==='screen-open'?title:undefined});
} finally { model.close(); model.closeAllConnections(); }
}
} else throw new Error('usage: prepare | verify <marker> | capacity <with-skills|no-skills> | sandbox <marker> | sandbox-mcp-add <marker> | sandbox-mcp <marker> | sandbox-key <marker> <refused|runs> | sandbox-sync <marker> | kanban <marker> | library <marker> | screen-open <marker> | screen-sleep <marker> | screen-wake <marker> | screen-live <marker>');
