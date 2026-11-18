// CI runs this on stdin inside /app in the installed web container, in two steps, on the pinned Hermes release
// (ADR 0014). It prints names and states only, never a key.
//   prepare: two new companies, each with its own Owner. The worker gives each its own Hermes profile; the check
//     asserts the two profiles differ, are each company's own, and that each profile's saved config turns terminal,
//     files and code execution off and its Run API offers none of them. Each profile is pointed at the fake model,
//     standing in for the company's own sign-in. It prints the first company's profile, whose memory CI then writes.
//   verify <marker>: a run on each profile answers, and the marker in the first company's memory reaches the model in
//     that company's run only, never in the second company's. Then an Agent made in the first company as the previous
//     app version made one, on the company's profile, is moved by the worker to its own profile once that profile is
//     pointed at the fake model (#121), and the marker reaches the main Agent's next run and not the moved Agent's.
//     Then a Contributor's suggestion the Owner approves lands in the first company's shared Skill "team-lessons"
//     (#122): each of its Agent profiles reads only its company's shared folder and holds the Skill locked, the next run
//     of each of its Agents carries the lesson and the second company's does not, and a run whose model tries to change
//     the Skill is refused by the Engine and leaves it as it was; that Run's one step reads from the Conversation's Hermes
//     session, failed, as the chat shows it (#141, #346). Then a fake key for a provider the Engine catalogues is
//     set through the driver (#124): it is set in the first company's space and the moved Agent's profile, in none of
//     the second company's, and removed from both again.
// The companies and their Owners' sign-in are kept between the steps in a file of this container only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const {sendMessage}=await import(`${process.cwd()}/lib/conversation-runs.mjs`);
const {companyProfile,riskyToolsets}=await import(`${process.cwd()}/lib/agent-levels.mjs`);

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
const key=process.env.HERMES_API_KEY;
assert.ok(key,'the install key is in the web container');
const manage=(path,init={})=>fetch(`http://hermes:9119${path}`,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}});
const pointAtFakeModel=async profile=>{
 const pointed=await manage(`/api/config?profile=${profile}`,{method:'PUT',body:JSON.stringify({config:{model:{provider:'custom',default:'fake-model',base_url:'http://web:8080/v1',api_key:'fake-model-key',context_length:128000}}})});
 assert.equal(pointed.status,200);
};
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
  assert.deepEqual((await checked(person.from('hermes_agents').select('profile').eq('company_id',entry.company))).map(found=>found.profile),[entry.profile]);
  // The profile's saved config turns the dangerous toolsets off, and its Run API offers none of them.
  const config=await (await manage(`/api/config?profile=${entry.profile}`)).json();
  for(const off of ['terminal','file','code_execution']) assert.ok(config.agent?.disabled_toolsets?.includes(off),`${entry.profile} disables ${off}`);
  const toolsets=await (await fetch(`http://hermes:8642/p/${entry.profile}/v1/toolsets`,{headers:{Authorization:`Bearer ${key}`}})).json();
  const enabled=toolsets.data.filter(toolset=>toolset.enabled).map(toolset=>toolset.name);
  assert.deepEqual(riskyToolsets.filter(name=>enabled.includes(name)),[],`${entry.profile} offers no terminal, file or code tools`);
  assert.ok(enabled.includes('web')&&enabled.includes('memory'),`${entry.profile} keeps its marketing tools`);
  await pointAtFakeModel(entry.profile);
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
 // A request whose last message is the person's and holds the trigger is answered with a skill_manage call that rewrites
 // the shared Skill; the Engine's answer to it (the next request's last message) is kept.
 const reply='أهلاً، هذا رد من النموذج التجريبي.';
 const asked=[]; const toolResults=[];
 const model=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   if(request.method!=='POST'||!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
   const body=JSON.parse(raw||'{}'); asked.push(raw);
   const last=body.messages?.at(-1);
   if(last?.role==='tool') toolResults.push(String(last.content));
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
 try {
  // A message from the entry's person to an Agent of the company in a new Conversation, answered: whether the marker
  // reached the model, the Conversation, and what the model was sent.
  const ask=async(entry,person,agent,label,message='مرحباً، اكتب عنواناً قصيراً.')=>{
   const before=asked.length;
   const conversation=randomUUID();
   // A profile the worker has not yet confirmed (its tools, its shared Skills folder) refuses the send as pending and
   // stores nothing, so the same send is made again until it is ready (#282).
   const send={person:entry.person,company:entry.company,conversation,sendKey:randomUUID(),agent,message};
   const sent=await until(`${label} ready for a run`,async()=>{ const result=await sendMessage(person,service,send); return result.error==='conversationAgentLevelPending'?null:result; },120);
   assert.deepEqual(sent,{conversation});
   const answer=await until(`reply on ${label}`,async()=>(await checked(person.from('conversation_messages').select('body').eq('conversation_id',conversation).eq('author','agent'))).at(0),180);
   assert.ok(answer.body.includes(reply),answer.body);
   assert.ok(asked.length>before,`${label} asked the model`);
   return {remembered:asked.slice(before).some(raw=>raw.includes(marker)),conversation,sent:asked.slice(before)};
  };
  const seen=[];
  for(const entry of companies) {
   const person=await signedIn(entry.credentials);
   const {remembered,conversation}=await ask(entry,person,entry.agent,entry.profile);
   seen.push(remembered); entry.conversation=conversation;
  }
  // The first company's memory reached its own run and not the second company's.
  assert.deepEqual(seen,[true,false]);

  const [first]=companies;
  const person=await signedIn(first.credentials);
  const profileOf=async agent=>{
   const [found]=await checked(person.from('hermes_agents').select('profile').eq('id',agent));
   return found.profile;
  };
  const [{run_id:run}]=await checked(person.from('conversation_messages').select('run_id').eq('conversation_id',first.conversation).eq('author','person'));
  const made=await checked(service.rpc('lead_create_agent',{conversation:first.conversation,run,call:'install-check',agent_name:'Install writer',job:'Writes the install check.',apps:[]}));
  assert.equal(made.state,'created');
  assert.equal(await profileOf(made.agent),first.profile,'the previous version makes the Agent on the company profile');
  const own=`ag-${made.agent.replaceAll('-','')}`;
  await until(`${own} made by the worker`,async()=>(await (await manage('/api/profiles')).json()).profiles.some(profile=>profile.name===own),120);
  await pointAtFakeModel(own);
  await until(`the Agent moved to ${own}`,async()=>await profileOf(made.agent)===own,240);
  assert.equal(await profileOf(first.agent),first.profile,'the main Agent keeps the company profile');
  const after=[(await ask(first,person,first.agent,first.profile)).remembered,(await ask(first,person,made.agent,own)).remembered];
  // The memory written in the company profile stayed with the main Agent; the moved Agent starts with an empty one.
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
  const [item]=await checked(person.from('waiting_items').select('id').eq('agent_rule_id',suggested.rule));
  assert.equal(await checked(person.rpc('decide_agent_rule',{c:first.company,item:item.id,approve:true})),'approved');

  // The worker writes it to the first company's shared space, which the second company's Agents never read.
  const homes=Object.fromEntries((await (await manage('/api/profiles')).json()).profiles.map(profile=>[profile.name,profile.path]));
  const spaceOf=entry=>`cs-${entry.company.replaceAll('-','')}`;
  const skill=async space=>(await (await manage(`/api/skills/content?profile=${space}&name=team-lessons`)).json()).content;
  const written=await until('the approved lesson in team-lessons',async()=>{ const content=await skill(spaceOf(first)); return content?.includes(lesson)&&content; },60);
  assert.ok(!(await skill(spaceOf(companies[1]))).includes(lesson),'the second company\'s shared Skill holds none of the first\'s lessons');
  for(const [entry,profile] of [[first,first.profile],[first,own],[companies[1],companies[1].profile]]) {
   const {skills:config}=await (await manage(`/api/config?profile=${profile}`)).json();
   const listed=(await (await manage(`/api/skills?profile=${profile}`)).json()).find(found=>found.name==='team-lessons');
   assert.deepEqual(config.external_dirs,[`${homes[spaceOf(entry)]}/skills`],`${profile} reads its own company's shared folder alone`);
   assert.ok(config.auto_load.includes('team-lessons')&&listed?.provenance==='external'&&listed.locked===true,`${profile} loads team-lessons and holds it locked`);
  }
  const carried=[[first,person,first.agent,first.profile],[first,person,made.agent,own],[companies[1],await signedIn(companies[1].credentials),companies[1].agent,companies[1].profile]];
  const lessons=[];
  for(const [entry,asker,agent,label] of carried) lessons.push((await ask(entry,asker,agent,label)).sent.some(raw=>raw.includes(lesson)));
  assert.deepEqual(lessons,[true,true,false]);

  // A Run whose model rewrites the Skill with the Agent's own tool is refused by the Engine, and the Skill stays.
  const refused=await ask(first,person,made.agent,own,trigger);
  assert.ok(toolResults.some(result=>result.includes('"success": false')&&result.includes('locked')),JSON.stringify(toolResults));
  assert.equal(await skill(spaceOf(first)),written,'team-lessons is unchanged');
  // That Run's one tool call, read from the Conversation's Hermes session on the Agent's own profile (#346), as the chat
  // reads it when it opens: skill_manage, failed (drawn Skipped), with the turn's length. gtmworks keeps no copy.
  const [{hermes_session_id:refusedSession}]=await checked(person.from('conversations').select('hermes_session_id').eq('id',refused.conversation));
  const {readSession}=await import(`${process.cwd()}/lib/hermes.mjs`);
  const read=await readSession({address:'http://hermes:8642',managementAddress:'http://hermes:9119',profile:own,key},refusedSession);
  assert.equal(read.state,'found',JSON.stringify(read));
  const turn=read.turns.at(-1);
  assert.deepEqual(turn.steps.map(({tool,state})=>({tool,state})),[{tool:'skill_manage',state:'failed'}],JSON.stringify(turn.steps));
  assert.ok(Number.isInteger(turn.seconds)&&turn.seconds>=0,`the Run's length is known: ${turn.seconds}`);
  console.log(JSON.stringify(turn));

  // The model the key brings is not checked: the Engine's model catalogue may be offline.
  const {readProviderKeys,setProviderKey,removeProviderKey}=await import(`${process.cwd()}/lib/hermes.mjs`);
  const engine={address:'http://hermes:8642',managementAddress:'http://hermes:9119',profile:first.profile,key};
  const keyed={space:spaceOf(first),profiles:[own]};
  const offered=await readProviderKeys(engine,{...keyed,profiles:[]});
  assert.equal(offered.state,'found');
  const provider=(offered.keys.find(found=>found.provider==='openrouter')||offered.keys[0])?.provider;
  assert.ok(provider,'the Engine takes a key for a provider');
  const holds=async profile=>Object.values(await (await manage(`/api/env?profile=${profile}`)).json()).some(row=>row?.provider===provider&&row.provider_primary===true&&row.is_set===true);
  const providerKeys=async()=>Promise.all([spaceOf(first),own,spaceOf(companies[1]),companies[1].profile].map(holds));
  assert.equal((await setProviderKey(engine,{...keyed,provider,value:`install-check-${randomUUID().replaceAll('-','')}`})).state,'written');
  assert.deepEqual(await providerKeys(),[true,true,false,false],'the key is in the first company\'s space and Agent profile only');
  assert.deepEqual((await readProviderKeys(engine,keyed)).lacking,[]);
  assert.equal((await removeProviderKey(engine,{...keyed,provider})).state,'removed');
  assert.deepEqual(await providerKeys(),[false,false,false,false],'the key is removed again');
  console.log(JSON.stringify({profiles:companies.map(entry=>entry.profile),memory:seen,moved:own,afterMove:after,lessons,keyProvider:provider}));
 } finally { model.close(); model.closeAllConnections(); }
} else throw new Error('usage: prepare | verify <marker>');
