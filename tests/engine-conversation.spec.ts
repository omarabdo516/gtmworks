import { test, expect } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, noteInstructions, sendMessage } from '../lib/conversation-runs.mjs';
import { instructionsOf, roleAppNames, roleTemplates } from '../lib/role-templates.mjs';
import { knowledgeInstructions } from '../lib/company-knowledge.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor as driverFor } from '../lib/engine.mjs';
import { runToolCall } from '../lib/agent-tools.mjs';
import { levelConfig } from '../lib/agent-levels.mjs';

// A conversation on the fake engine (tests/fake-engine.mjs): the engine contract with no subscription and no network,
// through the same send and close code the conversation route and the worker run, on the local database.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
// The seeded Company knowledge (#27) goes with every run of the Company's Agents.
const knowledge=()=>knowledgeInstructions(JSON.parse(query(`select part,body from public.company_knowledge where company_id='${company}' and body<>'' order by array_position(array['voice','audience','products','banned','decisions'],part)`)));
const omar='20000000-0000-0000-0000-000000000001';
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// Omar's own session (the company's Owner), as the conversation route receives it; and the service client the route
// and the worker use.
function clients() {
 return memberClient('omar@example.com');
}
// An agent whose Connection is never called: every run goes to the fake engine. Its address refuses connections, so
// the background worker (which drives Hermes) leaves these runs open for the fake engine to close.
function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','http://127.0.0.1:9','fake-${connection.slice(0,8)}','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${company}','${connection}','Faye','Marketing')`);
 // Shown to every Member, as the #15 update shows every Agent that existed before it.
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {connection,agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); query(`delete from public.hermes_connections where id='${connection}'`); }};
}
// A Member's own session, signed in by email link.
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
const agentRows=(conversation:string)=>JSON.parse(query(`select body from public.conversation_messages where conversation_id='${conversation}' and author='agent' order by id`));
const usageRows=(conversation:string)=>JSON.parse(query(`select outcome,input_tokens,output_tokens from public.conversation_usage where conversation_id='${conversation}' order by recorded_at,run_id`));

test('integration: a message on the fake engine gets its slow reply stored once, with its usage',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1; fake.settings.usage={input:3200,output:41};
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID(); const sendKey=randomUUID();
  const message={person:omar,company,conversation,sendKey,agent,message:'Plan the launch week',encryptionKey,engineFor:fake.engineFor};
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  // A retried send (double click, a lost answer) is the same message and the same run.
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  expect(fake.runs.map(run=>({conversation:run.conversation,input:run.input}))).toEqual([{conversation,input:'Plan the launch week'}]);
  expect(fake.connections[0]).toMatchObject({address:'http://127.0.0.1:9',key:'fake-engine-key'});
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
  // The reply is slow: the first pass finds the run still running.
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([]);
  // Two passes at once (a reader and the worker) store the reply and its usage once.
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([{body:'Reply to: Plan the launch week'}]);
  expect(usageRows(conversation)).toEqual([{outcome:'completed',input_tokens:3200,output_tokens:41}]);
 } finally { detach(); }
});

test('integration: on the fake engine a failed run and a stopped run end with their usage and no reply',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1e9;
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID();
  const send=(message:string)=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message,encryptionKey,engineFor:fake.engineFor});
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
  expect(await send('Stop this one')).toEqual({conversation});
  const engine=fake.engineFor({});
  expect(await engine.stop(fake.runs[0].id)).toBe(true);
  expect(await close()).toBe(1);
  fake.settings.pendingReads=0; fake.settings.ending='failed'; fake.settings.usage=null;
  expect(await send('This one fails')).toEqual({conversation});
  expect(await close()).toBe(1);
  expect(agentRows(conversation)).toEqual([]);
  expect(usageRows(conversation)).toEqual([{outcome:'stopped',input_tokens:14000,output_tokens:12},{outcome:'failed',input_tokens:null,output_tokens:null}]);
  // A run the engine cannot start is refused, and nothing is stored for it.
  fake.engineFor=()=>({...engine,start:async()=>null});
  expect(await send('Never started')).toEqual({error:'conversationHermesFailed',status:502});
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}'`))[0].n).toBe(2);
 } finally { detach(); }
});

// #287: a Contributor gets a reply on the fake engine through the company agent's Connection (the company Owner's), and
// a Viewer is refused by the database before the engine is called.
test('integration: a Contributor gets a reply on the fake engine and a Viewer is refused',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const contributor='20000000-0000-0000-0000-000000000005';
 query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
 try {
  const {service,person}=await memberClient('multi@example.com');
  const conversation=randomUUID();
  expect(await sendMessage(person,service,{person:contributor,company,conversation,sendKey:randomUUID(),agent,message:'Draft the teaser',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  expect(fake.connections[0]).toMatchObject({address:'http://127.0.0.1:9',key:'fake-engine-key'});
  expect(await closeOpenRuns(service,{encryptionKey,conversation,owner:contributor,engineFor:fake.engineFor})).toBe(1);
  const {data:record}=await person.from('conversation_messages').select('author,body').eq('conversation_id',conversation).order('id');
  expect(record).toEqual([{author:'person',body:'Draft the teaser'},{author:'agent',body:'Reply to: Draft the teaser'}]);

  const viewer=(await memberClient('viewer@example.com')).person;
  expect(await sendMessage(viewer,service,{person:'20000000-0000-0000-0000-000000000004',company,conversation:randomUUID(),sendKey:randomUUID(),agent,message:'Hello',encryptionKey,engineFor:fake.engineFor})).toEqual({code:'42501'});
  expect(fake.runs).toHaveLength(1);
 } finally { query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`); detach(); }
});

// Lead, the main Agent, on the Company's own profile in the bundled Engine (ADR 0014); the tests below share it.
function bundledLead() {
 const profile=`co-${company.replaceAll('-','')}`;
 const [made]=JSON.parse(query(`select id from public.hermes_agents where company_id='${company}' and is_default`));
 if(made) return {profile,lead:made.id as string};
 const [connection,lead]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','http://127.0.0.1:9','${profile}','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${lead}','${company}','${connection}','Lead','General',true)`);
 query(`insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('${company}','${omar}','${lead}','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','${connection}'))`);
 query(`insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}' on conflict (company_id) do update set tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false`);
 return {profile,lead};
}

test('integration: Lead makes the Agent the Owner asks for, and nothing for a Manager',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const fake=fakeEngine();
 fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}}];
 const made=()=>JSON.parse(query(`select a.id,a.name,a.speciality,array_to_string(a.apps,'|') as apps,a.requested_by,a.created_at is not null as dated,a.is_default,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='${company}' and a.id<>'${lead}'`));
 const {service,person}=await clients();
 const conversation=randomUUID();
 const ask=()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want someone to handle Meta ads',encryptionKey,engineFor:fake.engineFor});
 const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
 expect(await ask()).toEqual({conversation});
 expect(await close()).toBe(1);
 expect(made()).toEqual([]);
 await fake.engineFor({}).createAgent({name:profile,instructions:''});
 expect(await ask()).toEqual({conversation});
 const down=(connection:object)=>({...fake.engineFor(connection),readAgent:async()=>({state:'unreachable' as const,agent:null})});
 expect(await closeOpenRuns(service,{encryptionKey,conversation,engineFor:down})).toBe(0);
 expect(made()).toEqual([]);
 const closed=await Promise.all([close(),close()]);
 expect(closed[0]+closed[1]).toBe(1);
 expect(fake.runs.map(run=>run.tools.map(tool=>tool.name))).toEqual([['create_agent','save_rule'],['create_agent','save_rule']]);
 expect(fake.agentReads).toContain(profile);
 const [agent]=made();
 expect(made()).toEqual([{id:agent.id,name:'Meta Ads',speciality:'Runs the Meta ads.',apps:'Meta Ads Manager|Canva',requested_by:omar,dated:true,is_default:false,profile}]);
 expect(JSON.parse(query(`select actor_id,action,details->>'agent_name' as name,details->>'job' as job from public.company_log where company_id='${company}' and agent_id='${agent.id}'`)))
  .toEqual([{actor_id:omar,action:'agent_requested',name:'Meta Ads',job:'Runs the Meta ads.'}]);
 expect((await person.from('lead_made_agents').select('conversation_id,run_id,agent_id')).data).toEqual([{conversation_id:conversation,run_id:fake.runs[1].id,agent_id:agent.id}]);

 const answer=fake.settings.reply;
 fake.settings.reply=()=>'';
 fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{name:'SEO',job:'Writes the blog.',apps:[]}}];
 expect(await ask()).toEqual({conversation});
 expect(await close()).toBe(1);
 expect(made().map((row:{name:string})=>row.name).sort()).toEqual(['Meta Ads','SEO']);
 fake.settings.reply=answer;

 const manager=(await memberClient('manager@example.com')).person;
 const theirs=randomUUID();
 expect(await sendMessage(manager,service,{person:'20000000-0000-0000-0000-000000000002',company,conversation:theirs,sendKey:randomUUID(),agent:lead,message:'I want someone to handle Meta ads',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation:theirs});
 expect(fake.runs[3].tools.map(tool=>tool.name)).toEqual(['request_agent','save_rule']);
 expect(await closeOpenRuns(service,{encryptionKey,conversation:theirs,engineFor:fake.engineFor})).toBe(1);
 expect(made()).toHaveLength(2);
});

test('integration: Lead keeps a Manager\'s and a Contributor\'s request for an Agent, and makes none',async()=>{
 test.setTimeout(120000);
 const {lead}=bundledLead();
 const fake=fakeEngine();
 fake.settings.toolCalls=()=>[{id:'call-0',name:'request_agent',arguments:{name:' WhatsApp Leads ',job:'Follows up the WhatsApp leads.',apps:['WhatsApp Business']}}];
 const agents=()=>JSON.parse(query(`select count(*)::int as n from public.hermes_agents where company_id='${company}'`))[0].n;
 const before=agents();
 const {service}=await clients();
 const [manager,contributor]=['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005'];
 const asked='I want someone to follow up our WhatsApp leads';
 // The Engine that would make an Agent does not answer: a request does not ask it.
 const down=(connection:object)=>({...fake.engineFor(connection),readAgent:async()=>({state:'unreachable' as const,agent:null})});
 const conversations:string[]=[];
 for(const [email,person] of [['manager@example.com',manager],['multi@example.com',contributor]]) {
  const {person:member}=await memberClient(email);
  const conversation=randomUUID(); conversations.push(conversation);
  expect(await sendMessage(member,service,{person,company,conversation,sendKey:randomUUID(),agent:lead,message:asked,encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  // A reader and the worker close the run at once: one request is kept.
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,owner:person,engineFor:down});
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
 }
 expect(fake.runs.map(run=>run.tools.map(tool=>tool.name))).toEqual([['request_agent','save_rule'],['request_agent','suggest_rule']]);
 expect(fake.agentReads).toEqual([]);
 expect(agents()).toBe(before);
 const listed=`('${conversations.join("','")}')`;
 expect(JSON.parse(query(`select conversation_id,run_id,call_id,asked_by,asked_with,agent_name,job,array_to_string(apps,'|') as apps,state from public.lead_agent_requests where conversation_id in ${listed} order by id`)))
  .toEqual(conversations.map((conversation,index)=>({conversation_id:conversation,run_id:fake.runs[index].id,call_id:'call-0',asked_by:[manager,contributor][index],asked_with:asked,agent_name:'WhatsApp Leads',job:'Follows up the WhatsApp leads.',apps:'WhatsApp Business',state:'waiting'})));
 expect(JSON.parse(query(`select count(*)::int as n from public.lead_made_agents where conversation_id in ${listed}`))[0].n).toBe(0);
 expect(JSON.parse(query(`select actor_id,action,details->>'asked_for' as asked_for from public.company_log where company_id='${company}' and action in ('agent_request_sent','agent_request_made','agent_request_declined') order by id`)))
  .toEqual([{actor_id:manager,action:'agent_request_sent',asked_for:'WhatsApp Leads'},{actor_id:contributor,action:'agent_request_sent',asked_for:'WhatsApp Leads'}]);
});

// #18: an Owner tells an Agent a lasting rule in its Conversation; the fake engine scripts the Agent's save_rule call.
// #25: a Contributor's rule is a suggestion, scripted as the suggest_rule call they are offered instead.
test('integration: an Agent saves the rule the Owner tells it, with its log row, and every later run carries it; a Contributor\'s rule is a suggestion only their own runs carry',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const rule='من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
 const suggestion='From now on, no emojis';
 fake.settings.toolCalls=input=>input===rule?[{id:'call-0',name:'save_rule',arguments:{rule:` ${rule} `}}]:input===suggestion?[{id:'call-0',name:'suggest_rule',arguments:{rule:suggestion}}]:[];
 const rules=()=>JSON.parse(query(`select body,said_by,conversation_id,run_id,removed_at,suggestion from public.agent_rules where agent_id='${agent}' order by said_at`));
 const contributor='20000000-0000-0000-0000-000000000005';
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const send=(message:string)=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message,encryptionKey,engineFor:fake.engineFor});
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
  expect(await send(rule)).toEqual({conversation});
  expect(fake.runs[0].tools.map(tool=>tool.name)).toEqual(['save_rule']);
  expect(fake.runs[0].instructions).toBe(knowledge());
  // A reader and the worker close the run at once: the rule is saved once, before the reply is stored.
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(rules()).toEqual([{body:rule,said_by:omar,conversation_id:conversation,run_id:fake.runs[0].id,removed_at:null,suggestion:null}]);
  expect(JSON.parse(query(`select actor_id,actor_kind,action,details->>'agent_name' as agent,details->>'rule' as rule from public.company_log where company_id='${company}' and agent_id='${agent}'`)))
   .toEqual([{actor_id:omar,actor_kind:'person',action:'agent_rule_saved',agent:'Faye',rule}]);
  expect((await person.from('agent_rules').select('run_id').eq('conversation_id',conversation)).data).toEqual([{run_id:fake.runs[0].id}]);

  expect(await send('Draft the offer email')).toEqual({conversation});
  expect(fake.runs[1].instructions).toContain(`- ${rule}`);
  expect(await close()).toBe(1);

  // The Owner's rule reaches another Member's next run at once: a Contributor's own Conversation with the same Agent is
  // told it, and offered suggest_rule, not save_rule.
  const theirs=randomUUID();
  const {person:member}=await memberClient('multi@example.com');
  const tell=(message:string)=>sendMessage(member,service,{person:contributor,company,conversation:theirs,sendKey:randomUUID(),agent,message,encryptionKey,engineFor:fake.engineFor});
  const closeTheirs=()=>closeOpenRuns(service,{encryptionKey,conversation:theirs,owner:contributor,engineFor:fake.engineFor});
  expect(await tell('Draft the teaser')).toEqual({conversation:theirs});
  expect(fake.runs[2].tools.map(tool=>tool.name)).toEqual(['suggest_rule']);
  expect(fake.runs[2].instructions).toContain(`- ${rule}`);
  expect(await closeTheirs()).toBe(1);

  // The Contributor tells a rule: it is kept as a suggestion waiting on the Owner and the Manager, their own next run
  // carries it, and another Member's does not.
  expect(await tell(suggestion)).toEqual({conversation:theirs});
  expect(await closeTheirs()).toBe(1);
  expect(rules()[1]).toEqual({body:suggestion,said_by:contributor,conversation_id:theirs,run_id:fake.runs[3].id,removed_at:null,suggestion:'pending'});
  expect(JSON.parse(query(`select i.person_id from public.waiting_items i join public.agent_rules r on r.id=i.agent_rule_id where r.agent_id='${agent}' and i.resolved_at is null order by i.person_id`)))
   .toEqual([{person_id:omar},{person_id:'20000000-0000-0000-0000-000000000002'}]);
  expect(await tell('Draft the next post')).toEqual({conversation:theirs});
  expect(fake.runs[4].instructions).toContain(`- ${rule}\n- ${suggestion}`);
  expect(await closeTheirs()).toBe(1);
  expect(await send('Draft the launch post')).toEqual({conversation});
  expect(fake.runs[5].instructions).toContain(`- ${rule}`);
  expect(fake.runs[5].instructions).not.toContain(suggestion);
  expect(await close()).toBe(1);
  expect(rules()).toHaveLength(2);
 } finally { detach(); }
});

test('integration: Lead makes an Agent from each ready-made role, fitted with the Company\'s name, and runs to it carry the role',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const fake=fakeEngine();
 await fake.engineFor({}).createAgent({name:profile,instructions:''});
 const {service,person}=await clients();
 const conversation=randomUUID();
 for(const template of Object.keys(roleTemplates)) {
  fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template}}];
  expect(await sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:`I want the ready-made ${template}`,encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  expect(await closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor})).toBe(1);
 }
 const made=JSON.parse(query(`select a.id,a.template,a.name,a.speciality,array_to_string(a.apps,'|') as apps,a.instructions from public.lead_made_agents l join public.hermes_agents a on a.id=l.agent_id where l.conversation_id='${conversation}' order by l.created_at`));
 expect(made.map((agent:{template:string})=>agent.template)).toEqual(Object.keys(roleTemplates));
 for(const agent of made) {
  const role=roleTemplates[agent.template as keyof typeof roleTemplates];
  expect(agent).toMatchObject({name:role.name,speciality:role.job,apps:roleAppNames(agent.template).join('|'),instructions:instructionsOf(agent.template).replaceAll('{company}','RS Learning')});
  for(const limit of role.limits) expect(agent.instructions).toContain(limit);
  expect(agent.instructions).not.toContain('{company}');
 }

 const writer=made.find((agent:{template:string})=>agent.template==='writer');
 try {
  expect((await person.rpc('save_member_note',{c:company,note:'Answer in short points.'})).error).toBeNull();
  const theirs=randomUUID();
  expect(await sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:writer.id,message:'Write about the tax diploma',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation:theirs});
  expect(fake.runs.at(-1)).toMatchObject({conversation:theirs,instructions:`${writer.instructions}\n\n${knowledge()}\n\n${noteInstructions('Answer in short points.')}`});
 } finally { query(`delete from public.member_notes where company_id='${company}'`); }
});

// ADR 0016: an Agent Lead makes gets its own Engine profile. Lead's runs stay on the fake engine, which scripts the call;
// reading Lead's profile and making, reading or removing an Agent's go through the real driver to the fake Engine server,
// whose key is Lead's Connection key (the install key on a bundled install) and whose root profile has a model with a
// sign-in that a new profile copies.
async function ownProfiles(profile:string) {
 const hermes=await fakeHermes();
 hermes.settings.key='fake-engine-key';
 hermes.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:'fake-engine-key',config:{},credentials:{}});
 hermes.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
 hermes.settings.defaultCredentials['openai-codex']='root-codex-token';
 const fake=fakeEngine();
 const engineFor=(connection:{address:string,profile:string,key:string})=>{
  const driver=driverFor({...connection,address:hermes.address,managementAddress:hermes.managementAddress});
  return {...fake.engineFor(connection),readAgent:driver.readAgent,provideAgent:driver.provideAgent,removeAgent:driver.removeAgent};
 };
 return {hermes,fake,engineFor};
}
type MadeAgent={id:string,instructions:string,profile:string,lead_key:boolean,derived:boolean,tools_level:number|null,tools_policy:number|null,tools_pending:boolean|null};
const madeBy=(conversation:string,lead:string,call='call-0'):MadeAgent[]=>JSON.parse(query(`select a.id,a.instructions,h.profile,
 h.key_encrypted=(select k.key_encrypted from public.hermes_agents l join public.hermes_connections k on k.id=l.connection_id where l.id='${lead}') as lead_key,
 a.id=public.lead_agent_id(m.conversation_id,m.run_id,'${call}') as derived,p.tools_level,p.tools_policy,p.tools_pending
 from public.lead_made_agents m join public.hermes_agents a on a.id=m.agent_id join public.hermes_connections h on h.id=a.connection_id
 left join public.agent_profiles p on p.agent_id=a.id where m.conversation_id='${conversation}' order by m.created_at`));
const managed=(hermes:Awaited<ReturnType<typeof fakeHermes>>)=>hermes.settings.managementRequests.map(request=>`${request.method} ${request.path?.split('?')[0]}`);

test('integration: Lead\'s call makes the Agent one profile of its own, also when two closers race, and its Runs start there without its instructions',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const {hermes,fake,engineFor}=await ownProfiles(profile);
 try {
  fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template:'writer'}}];
  const {service,person}=await clients();
  const conversation=randomUUID();
  expect(await sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want the ready-made writer',encryptionKey,engineFor})).toEqual({conversation});
  // A reader and the worker close the run at once: both may carry the call out, and one Agent is made.
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor});
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  const made=madeBy(conversation,lead);
  expect(made).toHaveLength(1);
  const [agent]=made;
  const own=`ag-${agent.id.replaceAll('-','')}`;
  expect(agent).toEqual({id:agent.id,instructions:instructionsOf('writer').replaceAll('{company}','RS Learning'),profile:own,lead_key:true,derived:true,tools_level:1,tools_policy:2,tools_pending:false});
  expect([...hermes.settings.profiles.keys()].filter(name=>name.startsWith('ag-'))).toEqual([own]);
  const kept=hermes.settings.profiles.get(own)!;
  expect([kept.soul,kept.key,kept.config]).toEqual([agent.instructions,'fake-engine-key',levelConfig(1)]);
  const asked=managed(hermes);
  for(const step of ['POST /api/profiles',`PUT /api/env`,`PUT /api/config`,'GET /api/model/options']) expect([1,2]).toContain(asked.filter(request=>request===step).length);
  expect(asked.filter(request=>request.startsWith('DELETE'))).toEqual([]);
  expect(JSON.parse(query(`select actor_id,action,details->>'agent_name' as name from public.company_log where company_id='${company}' and agent_id='${agent.id}'`)))
   .toEqual([{actor_id:omar,action:'agent_requested',name:roleTemplates.writer.name}]);

  // The same run and call carried out again (a closer stopped before the close) ask the Engine for no profile.
  const before=hermes.settings.managementRequests.length;
  expect(await runToolCall({db:service,engine:engineFor({address:'http://127.0.0.1:9',profile,key:'fake-engine-key'}),profile,conversation,run:fake.runs[0].id},
   {id:'call-0',name:'create_agent',arguments:{template:'writer'}})).toEqual({state:'created',agent:agent.id});
  expect(managed(hermes).slice(before)).toEqual(['GET /api/profiles',`GET /api/profiles/${profile}/soul`]);
  expect(madeBy(conversation,lead)).toHaveLength(1);

  // A message to the new Agent starts on its own profile, with the Company knowledge and no instructions of its own.
  const theirs=randomUUID();
  expect(await sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:agent.id,message:'Write about the tax diploma',encryptionKey,engineFor})).toEqual({conversation:theirs});
  expect(fake.connections.at(-1)).toMatchObject({profile:own,key:'fake-engine-key'});
  expect(fake.runs.at(-1)).toMatchObject({conversation:theirs,instructions:knowledge()});
  expect(await closeOpenRuns(service,{encryptionKey,conversation:theirs,engineFor})).toBe(1);
  expect(agentRows(theirs)).toEqual([{body:'Reply to: Write about the tax diploma'}]);
 } finally { await hermes.close(); }
});

test('integration: a profile that cannot be made, still offers a toolset that must stay off, or cannot answer leaves the Agent on Lead\'s profile, and its Runs answer',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const {service,person}=await clients();
 const cases:[string,(hermes:Awaited<ReturnType<typeof fakeHermes>>)=>void][]=[
  ['cannot be made',hermes=>{ hermes.settings.failStep='config'; }],
  ['still offers a toolset that must stay off',hermes=>{ hermes.settings.staleConfig=true; }],
  ['cannot answer',hermes=>{ hermes.settings.seedModel=null; }]];
 for(const [why,set] of cases) {
  const {hermes,fake,engineFor}=await ownProfiles(profile); set(hermes);
  try {
   fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template:'writer'}}];
   const conversation=randomUUID();
   expect(await sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want the ready-made writer',encryptionKey,engineFor})).toEqual({conversation});
   expect(await closeOpenRuns(service,{encryptionKey,conversation,engineFor})).toBe(1);
   const [agent]=madeBy(conversation,lead);
   expect(agent,why).toMatchObject({profile,lead_key:true,derived:true,tools_level:null});
   expect(managed(hermes).filter(request=>request.startsWith('DELETE')),why).toEqual([]);
   const theirs=randomUUID();
   expect(await sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:agent.id,message:'Write about the tax diploma',encryptionKey,engineFor})).toEqual({conversation:theirs});
   expect(fake.runs.at(-1)!.instructions,why).toBe(`${agent.instructions}\n\n${knowledge()}`);
   expect(await closeOpenRuns(service,{encryptionKey,conversation:theirs,engineFor})).toBe(1);
   expect(agentRows(theirs),why).toEqual([{body:'Reply to: Write about the tax diploma'}]);
  } finally { await hermes.close(); }
 }
});
