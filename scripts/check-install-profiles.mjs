// CI runs this on stdin inside /app in the installed web container, in three steps, on the pinned Hermes release
// (ADR 0014, ADR 0016). It prints names, states and counts only, never a key or any other value of the install's
// environment (lib/install-proof.mjs).
//   prepare: two new companies, each with its own Owner and its one shared space. The worker gives each its own Hermes
//     profile; the check asserts the two profiles differ, are each company's own, and that each profile's saved config
//     turns terminal, files and code execution off and its Run API offers none of them. Each profile is pointed at the
//     fake model, standing in for the company's own sign-in. It prints the first company's profile, whose memory CI
//     then writes, and the two companies' names for the database refusal the install job checks.
//   verify <marker>: two more Agents are made, so each company has a main Agent and a second one on its own profile,
//     and the marker in the first company's memory reaches that company's main Agent's run only, never the same
//     company's second Agent or either Agent of the other company. Each company's shared space serves no Run and holds
//     the one shared Skills folder read by exactly its own Agents. Then a fake key for a provider the Engine catalogues
//     is set through the driver (#124): it is set in the first company's space and both of its Agents' profiles, in
//     none of the second company's and never the root, and removed from both again.
//   capacity <with-skills|no-skills>: ten more Agent profiles in the first company, each printed with its name and the
//     seconds it took to be ready. The install job measures the Engine container's memory and the volume's disk around
//     them; the check ends with a Run on the first Agent still answered.
// The companies and their Owners' sign-in are kept between the steps in a file of this container only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile,levelConfig,alwaysOff,riskyToolsets,toolPolicy}=await import(`${process.cwd()}/lib/agent-levels.mjs`);
const {agentSoul}=await import(`${process.cwd()}/lib/company-profiles.mjs`);
const {provideProfile}=await import(`${process.cwd()}/lib/hermes.mjs`);
const {writeProof,writeName}=await import(`${process.cwd()}/lib/install-proof.mjs`);

const [step,marker]=process.argv.slice(2);
// A message holding this makes the fake model ask the Engine to rewrite the shared Skill.
const trigger='Change the team lessons now.';
const state='/tmp/check-install-profiles.json';
const origin='http://gateway:8080';
const engine={address:'http://hermes:8642',managementAddress:'http://hermes:9119'};
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
const pointAtFakeModel=async profile=>{
 const pointed=await manage(`/api/config?profile=${encodeURIComponent(profile)}`,{method:'PUT',body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(pointed.status,200);
};
const signedIn=async credentials=>{ const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options); await checked(person.auth.signInWithPassword(credentials)); return person; };
const profileOf=async(person,agent)=>{ const [found]=await checked(person.from('hermes_agents').select('profile').eq('id',agent)); return found?.profile; };
// A profile's saved config turns the dangerous toolsets off, and its Run API offers none of them; the marketing tools stay.
const checkProfile=async profile=>{
 const config=await (await manage(`/api/config?profile=${encodeURIComponent(profile)}`)).json();
 for(const off of ['terminal','file','code_execution']) assert.ok(config.agent?.disabled_toolsets?.includes(off),`${profile} disables ${off}`);
 const toolsets=await (await fetch(`http://hermes:8642/p/${encodeURIComponent(profile)}/v1/toolsets`,{headers:{Authorization:`Bearer ${key}`}})).json();
 const enabled=toolsets.data.filter(toolset=>toolset.enabled).map(toolset=>toolset.name);
 assert.deepEqual(riskyToolsets.filter(name=>enabled.includes(name)),[],`${profile} offers no terminal, file or code tools`);
 assert.ok(enabled.includes('web')&&enabled.includes('memory'),`${profile} keeps its marketing tools`);
};
const spaceOf=company=>`cs-${company.replaceAll('-','')}`;
const shown=entry=>({company:entry.company,profile:entry.profile,space:entry.space,agent:entry.agent,second:entry.secondProfile});
// The fake model: one Arabic reply, streamed or not, and every request it was sent.
const fakeModel=async(requests,results=[])=>{
 const reply='أهلاً، هذا رد من النموذج التجريبي.';
 const model=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
   const body=JSON.parse(raw||'{}'); requests.push(raw);
   const last=body.messages?.at(-1);
   if(last?.role==='tool') results.push(String(last.content));
   const call=last?.role==='user'&&JSON.stringify(last.content).includes(trigger)?{id:'call_lessons',type:'function',function:{name:'skill_manage',
    arguments:JSON.stringify({operations:[{action:'patch',name:'team-lessons',content:'---\nname: team-lessons\ndescription: Changed by an agent\n---\nChanged.\n'}]})}}:null;
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
  assert.deepEqual((await checked(person.from('hermes_agents').select('profile').eq('company_id',entry.company))).map(found=>found.profile),[entry.profile]);
  await checkProfile(entry.profile);
  await pointAtFakeModel(entry.profile);
  // One shared space per Company, its own, holding the folder its Agent profiles read. The worker lists it once made.
  const space=await until(`${entry.profile}'s shared space`,async()=>{
   const spaces=await checked(service.rpc('shared_skills_work'));
   return (spaces||[]).find(found=>found.company_id===entry.company&&typeof found.folder==='string');
  },180);
  assert.equal(space.profile,spaceOf(entry.company));
  assert.match(space.folder,new RegExp(`/${space.profile}/skills$`));
  entry.space=space.profile; entry.folder=space.folder;
 }
 assert.notEqual(companies[0].profile,companies[1].profile);
 assert.notEqual(companies[0].space,companies[1].space);
 const listed=(await (await manage('/api/profiles')).json()).profiles.map(profile=>profile.name);
 for(const entry of companies) {
  assert.ok(listed.includes(entry.profile),`${entry.profile} is a Hermes profile`);
  assert.ok(listed.includes(entry.space),`${entry.space} is a Hermes profile`);
 }
 writeFileSync(state,JSON.stringify(companies),{mode:0o600});
 writeProof({step:'prepare',companies:companies.map(shown)});
 writeName(companies[0].profile);
} else if(step==='verify') {
 assert.match(marker||'',/^[a-z0-9-]{8,64}$/);
 const companies=JSON.parse(readFileSync(state,'utf8'));
 const asked=[]; const toolResults=[];
 const {model,reply}=await fakeModel(asked,toolResults);
 try {
  const people=new Map();
  for(const entry of companies) people.set(entry,await signedIn(entry.credentials));
  const personOf=entry=>people.get(entry);
  // A message from the entry's person to an Agent of the company in a new Conversation, answered: whether the marker
  // reached the model, the Conversation, and what the model was sent.
  const ask=async(entry,person,agent,label,message='مرحباً، اكتب عنواناً قصيراً.')=>{
   const before=asked.length;
   const conversation=randomUUID();
   // A profile the worker has not yet confirmed (its tools, its shared Skills folder) refuses the send as pending and
   // stores nothing, so the same send is made again until it is ready (#282).
   const send={person:entry.person,company:entry.company,conversation,sendKey:randomUUID(),agent,message};
   const sent=await until(`${label} ready for a run`,async()=>{ const result=await sendMessage(person,service,send); return result.error==='conversationAgentLevelPending'?null:result; },180);
   assert.deepEqual(sent,{conversation});
   const answer=await until(`reply on ${label}`,async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
   assert.ok(answer.body.includes(reply),answer.body);
   assert.ok(asked.length>before,`${label} asked the model`);
   return {remembered:asked.slice(before).some(raw=>raw.includes(marker)),conversation,sent:asked.slice(before)};
  };
  const first=companies[0], other=companies[1];
  // The first company's second Agent, made on the company profile as the previous app version made one and moved by the
  // worker to its own profile (#121), keeps its Conversation and starts empty.
  first.conversation=(await ask(first,personOf(first),first.agent,first.profile)).conversation;
  const [{run_id:run}]=await checked(personOf(first).from('conversation_messages').select('run_id').eq('conversation_id',first.conversation).eq('author','person'));
  const made=await checked(service.rpc('lead_create_agent',{conversation:first.conversation,run,call:'install-check',agent_name:'Install writer',job:'Writes the install check.',apps:[]}));
  assert.equal(made.state,'created');
  assert.equal(await profileOf(personOf(first),made.agent),first.profile,'the previous version makes the Agent on the company profile');
  const own=`ag-${made.agent.replaceAll('-','')}`;
  await until(`${own} made by the worker`,async()=>(await (await manage('/api/profiles')).json()).profiles.some(profile=>profile.name===own),180);
  await pointAtFakeModel(own);
  await until(`the Agent moved to ${own}`,async()=>await profileOf(personOf(first),made.agent)===own,240);
  assert.equal(await profileOf(personOf(first),first.agent),first.profile,'the main Agent keeps the company profile');
  first.second=made.agent; first.secondProfile=own;

  // The second company's second Agent, on its own profile at creation, as Lead's create_agent makes one: the Engine
  // provides the profile it will be named for, and the database attaches the Agent to it (#126, #120).
  other.conversation=(await ask(other,personOf(other),other.agent,other.profile)).conversation;
  const [{run_id:secondRun}]=await checked(personOf(other).from('conversation_messages').select('run_id').eq('conversation_id',other.conversation).eq('author','person'));
  const call='install-second';
  const plan=await checked(service.rpc('lead_agent_profile',{conversation:other.conversation,run:secondRun,call,instructions:null}));
  assert.ok(plan?.profile&&plan.level,JSON.stringify(plan));
  const provided=await provideProfile({...engine,key},{name:plan.profile,soul:agentSoul(plan.soul),config:levelConfig(plan.level),forbidden:alwaysOff});
  assert.equal(provided.state,'configured',plan.profile);
  await pointAtFakeModel(plan.profile);
  const second=await checked(service.rpc('lead_create_agent',{conversation:other.conversation,run:secondRun,call,agent_name:'Install second',job:'Writes the install check.',apps:[],template:null,instructions:null,own_level:plan.level,own_policy:toolPolicy}));
  assert.equal(second.state,'created');
  await until(`${plan.profile} recorded for its Agent`,async()=>await profileOf(personOf(other),second.agent)===plan.profile,180);
  other.second=second.agent; other.secondProfile=plan.profile;

  // Four Agents, each a profile of its own: the two main Agents on their Company's `co-` profile, each second Agent on
  // its `ag-` profile; no name is another Agent's, another Company's, a shared space's or the root profile.
  const profiles=companies.flatMap(entry=>[entry.profile,entry.secondProfile]);
  assert.equal(new Set(profiles).size,4,'each of the four Agents has a profile of its own');
  for(const entry of companies) {
   assert.equal(entry.profile,companyProfile(entry.company),'the main Agent keeps its Company profile');
   assert.equal(entry.secondProfile,`ag-${entry.second.replaceAll('-','')}`,'the second Agent has its own profile');
   assert.equal(entry.space,spaceOf(entry.company),'the shared space is its Company\'s own');
   assert.notEqual(entry.profile,entry.secondProfile);
   assert.notEqual(entry.profile,entry.space);
   assert.notEqual(entry.secondProfile,entry.space);
   await checkProfile(entry.secondProfile);
  }
  assert.ok(!profiles.includes('default'),'no Agent runs on the root profile');
  // The database holds exactly these two Agents per Company, and no profile serves two Companies.
  const rows=await checked(service.from('hermes_agents').select('company_id,profile'));
  assert.deepEqual(rows.filter(row=>companies.some(entry=>entry.company===row.company_id)).map(row=>row.profile).sort(),[...profiles].sort());
  assert.equal(new Set(rows.map(row=>row.profile)).size,rows.length,'no profile serves two Companies');

  // The memory written in the first company's main Agent's profile reaches its own Run only: one message to each of the
  // four Agents, and the fake model sees the marker in the first one's requests alone.
  const memory=[];
  for(const entry of companies) for(const [agent,profile] of [[entry.agent,entry.profile],[entry.second,entry.secondProfile]])
   memory.push((await ask(entry,personOf(entry),agent,profile)).remembered);
  assert.deepEqual(memory,[true,false,false,false]);
  const seen=[memory[0],memory[2]];
  assert.deepEqual(seen,[true,false]);
  // The memory written in the company profile stayed with the main Agent; the moved Agent starts with an empty one.
  const after=[(await ask(first,personOf(first),first.agent,first.profile)).remembered,(await ask(first,personOf(first),first.second,first.secondProfile)).remembered];
  assert.deepEqual(after,[true,false]);

  // A Contributor tells the main Agent a lasting rule, a suggestion; the Owner approves it from "Waiting on you".
  const teller={email:`lessons-${randomUUID().slice(0,8)}@example.com`,password:`Lessons-${randomUUID()}`};
  const {user:told}=await checked(service.auth.admin.createUser({...teller,email_confirm:true}));
  await checked(service.from('people').insert({id:told.id,name:'Lesson teller'}));
  await checked(service.from('members').insert({company_id:first.company,person_id:told.id,role:'contributor'}));
  const lesson=`From now on, sign every post as team ${randomUUID().slice(0,8)}.`;
  const contributor=await signedIn(teller);
  const said=(await ask({...first,person:told.id},contributor,first.agent,first.profile,lesson)).conversation;
  const [{run_id:saidRun}]=await checked(contributor.from('conversation_messages').select('run_id').eq('conversation_id',said).eq('author','person'));
  const suggested=await checked(service.rpc('agent_save_rule',{conversation:said,run:saidRun,call:'install-lesson',rule:lesson}));
  assert.equal(suggested.state,'suggested');
  const [item]=await checked(personOf(first).from('waiting_items').select('id').eq('agent_rule_id',suggested.rule));
  assert.equal(await checked(personOf(first).rpc('decide_agent_rule',{c:first.company,item:item.id,approve:true})),'approved');

  // The worker writes it to the first company's shared space, which the second company's Agents never read.
  const homes=Object.fromEntries((await (await manage('/api/profiles')).json()).profiles.map(profile=>[profile.name,profile.path]));
  const skill=async space=>(await (await manage(`/api/skills/content?profile=${encodeURIComponent(space)}&name=team-lessons`)).json()).content;
  const written=await until('the approved lesson in team-lessons',async()=>{ const content=await skill(spaceOf(first)); return content?.includes(lesson)&&content; },90);
  assert.ok(!(await skill(spaceOf(other))).includes(lesson),'the second company\'s shared Skill holds none of the first\'s lessons');
  // Each of the four Agent profiles reads exactly its own Company's shared folder, and holds the shared Skill locked.
  for(const {entry,profile} of companies.flatMap(entry=>[{entry,profile:entry.profile},{entry,profile:entry.secondProfile}])) {
   const folder=`${homes[entry.space]}/skills`;
   const config=await until(`${profile} reads ${folder} alone`,async()=>{ const found=await (await manage(`/api/config?profile=${encodeURIComponent(profile)}`)).json();
    return JSON.stringify(found.external_dirs)===JSON.stringify([folder])?found:null; },180);
   const listed=(await (await manage(`/api/skills?profile=${encodeURIComponent(profile)}`)).json()).find(found=>found.name==='team-lessons');
   assert.deepEqual(config.external_dirs,[folder],`${profile} reads its own company's shared folder alone`);
   assert.ok(config.auto_load.includes('team-lessons')&&listed?.provenance==='external'&&listed.locked===true,`${profile} loads team-lessons and holds it locked`);
  }
  // A Skill written in the first Company's folder is listed for both of its Agents and for neither of the other's.
  const unique=`install-check-${randomUUID().slice(0,8)}`;
  const placed=await manage(`/api/skills?profile=${encodeURIComponent(first.space)}`,{method:'POST',body:JSON.stringify({name:unique,content:`---\nname: ${unique}\ndescription: The install check's own Skill\n---\nWritten for the install check.\n`})});
  assert.ok(placed.response.ok&&placed.result?.success===true,'the install check writes its Skill in the first Company\'s folder');
  const listsSkill=async profile=>(await (await manage(`/api/skills?profile=${encodeURIComponent(profile)}`)).json()).some(found=>found.name===unique);
  await until(`${unique} listed for both of ${first.profile}'s company's Agents`,async()=>await listsSkill(first.profile)&&await listsSkill(first.secondProfile),180);
  assert.deepEqual([await listsSkill(other.profile),await listsSkill(other.secondProfile)],[false,false],'the other Company\'s Agents list no Skill of the first\'s folder');
  const carried=companies.flatMap(entry=>[{entry,agent:entry.agent,label:entry.profile},{entry,agent:entry.second,label:entry.secondProfile}]);
  const lessons=[];
  for(const one of carried) lessons.push((await ask(one.entry,personOf(one.entry),one.agent,one.label)).sent.some(raw=>raw.includes(lesson)));
  assert.deepEqual(lessons,[true,true,false,false]);

  // A Run on a shared space is refused: the Engine serves the space but gives it no Run API key.
  for(const entry of companies) {
   const before=asked.length;
   const refusedRun=await fetch(`http://hermes:8642/p/${encodeURIComponent(entry.space)}/v1/runs`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({input:'مرحباً'})});
   assert.ok([401,403].includes(refusedRun.status),`a Run on ${entry.space} is refused (HTTP ${refusedRun.status})`);
   assert.equal(asked.length,before,`${entry.space} reaches no model`);
  }

  // A Run whose model rewrites the Skill with the Agent's own tool is refused by the Engine, and the Skill stays.
  const refused=await ask(first,personOf(first),first.second,first.secondProfile,trigger);
  assert.ok(toolResults.some(result=>result.includes('"success": false')&&result.includes('locked')),JSON.stringify(toolResults));
  assert.equal(await skill(spaceOf(first)),written,'team-lessons is unchanged');
  // That Run's one tool call, read from the Conversation's Hermes session on the Agent's own profile (#346), as the chat
  // reads it when it opens: skill_manage, failed (drawn Skipped), with the turn's length. gtmworks keeps no copy.
  const [{hermes_session_id:refusedSession}]=await checked(personOf(first).from('conversations').select('hermes_session_id').eq('id',refused.conversation));
  const {readSession}=await import(`${process.cwd()}/lib/hermes.mjs`);
  const read=await readSession({...engine,profile:first.secondProfile,key},refusedSession);
  assert.equal(read.state,'found',JSON.stringify(read));
  const turn=read.turns.at(-1);
  assert.deepEqual(turn.steps.map(({tool,state})=>({tool,state})),[{tool:'skill_manage',state:'failed'}],JSON.stringify(turn.steps));
  assert.ok(Number.isInteger(turn.seconds)&&turn.seconds>=0,`the Run's length is known: ${turn.seconds}`);
  writeProof({step:'steps',state:'found',count:turn.steps.length,seconds:turn.seconds});

  // The model the key brings is not checked: the Engine's model catalogue may be offline.
  const {readProviderKeys,setProviderKey,removeProviderKey}=await import(`${process.cwd()}/lib/hermes.mjs`);
  const keyed={space:spaceOf(first),profiles:[first.profile,first.secondProfile]};
  const offered=await readProviderKeys({...engine,profile:first.profile,key},{...keyed,profiles:[]});
  assert.equal(offered.state,'found');
  const provider=(offered.keys.find(found=>found.provider==='openrouter')||offered.keys[0])?.provider;
  assert.ok(provider,'the Engine takes a key for a provider');
  const holds=async profile=>Object.values(await (await manage(`/api/env?profile=${encodeURIComponent(profile)}`)).json()).some(row=>row?.provider===provider&&row.provider_primary===true&&row.is_set===true);
  const providerKeys=async()=>Promise.all([spaceOf(first),first.profile,first.secondProfile,spaceOf(other),other.profile,other.secondProfile,'default'].map(holds));
  assert.equal((await setProviderKey({...engine,profile:first.profile,key},{...keyed,provider,value:`install-check-${randomUUID().replaceAll('-','')}`})).state,'written');
  const keyedStates=await providerKeys();
  assert.deepEqual(keyedStates,[true,true,true,false,false,false,false],'the key is in the first company\'s space and its two Agent profiles only, never the root');
  assert.deepEqual((await readProviderKeys({...engine,profile:first.profile,key},keyed)).lacking,[]);
  assert.equal((await removeProviderKey({...engine,profile:first.profile,key},{...keyed,provider})).state,'removed');
  assert.deepEqual(await providerKeys(),[false,false,false,false,false,false,false],'the key is removed again');
  writeFileSync(state,JSON.stringify(companies),{mode:0o600});
  writeProof({step:'verify',companies:companies.map(shown),memory,skills:lessons,keys:keyedStates,provider});
 } finally { model.close(); model.closeAllConnections(); }
} else if(step==='capacity') {
 assert.ok(['with-skills','no-skills'].includes(marker),'capacity names with-skills or no-skills');
 const companies=JSON.parse(readFileSync(state,'utf8'));
 const first=companies[0];
 const made=[];
 for(let index=1;index<=10;index++) {
  const name=`ag-${randomUUID().replaceAll('-','')}`;
  const started=Date.now();
  let profile;
  // The Engine may take a moment to serve a new profile's Run API; each attempt finishes the same profile, never clones.
  for(let attempt=1;attempt<=20;attempt++) {
   profile=await provideProfile({...engine,key},{name,soul:'An Agent profile the install check made for capacity.',config:levelConfig(1),forbidden:alwaysOff,noSkills:marker==='no-skills'});
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
  await pointAtFakeModel(first.profile);
  const person=await signedIn(first.credentials);
  const conversation=randomUUID();
  const sent=await until('the first Agent ready for a run',async()=>{ const result=await sendMessage(person,service,{person:first.person,company:first.company,conversation,sendKey:randomUUID(),agent:first.agent,message:'مرحباً، اكتب عنواناً قصيراً.'}); return result.error==='conversationAgentLevelPending'?null:result; },180);
  assert.deepEqual(sent,{conversation});
  const answer=await until('the first Agent still answers',async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),240);
  assert.ok(answer.body.includes(reply),answer.body);
  assert.ok(asked.length>0,'the first Agent asked the model');
  first.capacity=(first.capacity||[]).concat(made);
  writeFileSync(state,JSON.stringify(companies),{mode:0o600});
  writeProof({step:'capacity',kind:marker,made:made.length,state:'answered',company:first.company});
 } finally { model.close(); model.closeAllConnections(); }
} else throw new Error('usage: prepare | verify <marker> | capacity <with-skills|no-skills>');
