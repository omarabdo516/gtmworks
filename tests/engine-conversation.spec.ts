import { test, expect } from './fresh-seed';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { laneEngineRecords } from './spec-engine-records';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { answerQuestion, closeOpenRuns, noteInstructions, sendMessage } from '../lib/conversation-runs.mjs';
import { conversationRecord } from '../lib/conversation-record';
import { conversationColumns } from '../lib/conversations';
import { instructionsOf, roleAppNames, roleTemplates } from '../lib/role-templates.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { hermesHostOf } from './lane.mjs';
import { hermesEngine as driverFor } from '../lib/engine/contract.mjs';
import { runToolCall, toolSpecTexts } from '../lib/agent-tools.mjs';
import { toolConfig } from '../lib/agent-toolsets.mjs';
import { signIn } from './sign-in';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
import { moveAgentProfiles } from '../lib/company-profiles.mjs';
import { keepSharedSkills } from '../lib/shared-skills.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
test.beforeAll(()=>laneEngineRecords());

// A conversation on the fake engine (tests/fake-engine.mjs): the engine contract with no subscription and no network,
// through the same send and close code the conversation route and the worker run, on the local database.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
// The install's Hermes as these runs are given it: the fake engine answers in its place (#342), or the lane's fake Hermes.
const hermes={address:'http://127.0.0.1:9',key:'fake-engine-key'};

// Omar's own session (the company's Owner), as the conversation route receives it; and the service client the route
// and the worker use.
function clients() {
 return memberClient('omar@example.com');
}
// An agent whose runs go to the fake engine. The lane's Hermes address has no fake Hermes in these tests, so the
// background worker (which drives Hermes) leaves these runs open for the fake engine to close.
function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Faye','Marketing','fake-${connection.slice(0,8)}')`);
 // Shown to every Member, as the #15 update shows every Agent that existed before it.
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {connection,agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); }};
}
// An Agent of the Company on a profile of its own, with the name its chat's handover gives it (#147).
function attachTarget(name:string,speciality:string) {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','${name}','${speciality}','fake-${connection.slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {connection,agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); }};
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
const endRows=(conversation:string)=>JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}' order by recorded_at,run_id`));
// A chat with a Card on the board writes its rows on the Card (#146). Untied, as only the database can untie it, a chat
// has no Card, and its rows stay its person's.
const untie=(conversation:string)=>query(`update public.work_cards set conversation_id=null where conversation_id='${conversation}'`);

// Six minutes of tests in one file held one worker of one shard (#404, #410): each test makes its own rows and runs on
// its lane's own stack, so they spread over the shard's workers and the shards.
test.describe.configure({mode:'parallel'});

test('integration: a message on the fake engine gets its slow reply stored once, with its end',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1; fake.settings.usage={input:3200,output:41};
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID(); const sendKey=randomUUID();
  const message={person:omar,company,conversation,sendKey,agent,message:'Plan the launch week',hermes,engineFor:fake.engineFor};
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  // A retried send (double click, a lost answer) is the same message and the same run.
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  expect(fake.runs.map(run=>({conversation:run.conversation,input:run.input}))).toEqual([{conversation,input:'Plan the launch week'}]);
  // The Company's Engine record names the lane's Engine, and its key (scripts/local-db.sh).
  expect(fake.connections[0]).toMatchObject({address:`http://${hermesHostOf()}:8642`,key:'test-only-key'});
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  // The reply is slow: the first pass finds the run still running.
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([]);
  // Two passes at once (a reader and the worker) store the reply and its end once.
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([{body:'Reply to: Plan the launch week'}]);
  expect(endRows(conversation)).toEqual([{outcome:'completed'}]);
 } finally { detach(); }
});

test('integration: on the fake engine a failed run and a stopped run end with their outcome and no reply',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1e9;
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID();
  const send=(message:string)=>withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}));
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  expect(await send('Stop this one')).toEqual({conversation});
  const engine=fake.engineFor({});
  expect(await engine.stop(fake.runs[0].id)).toBe(true);
  expect(await close()).toBe(1);
  fake.settings.pendingReads=0; fake.settings.ending='failed'; fake.settings.usage=null;
  expect(await send('This one fails')).toEqual({conversation});
  expect(await close()).toBe(1);
  expect(agentRows(conversation)).toEqual([]);
  expect(endRows(conversation)).toEqual([{outcome:'stopped'},{outcome:'failed'}]);
  // A run the engine cannot start is refused, and nothing is stored for it.
  fake.engineFor=()=>({...engine,start:async()=>null});
  expect(await send('Never started')).toEqual({error:'conversationHermesFailed',status:502});
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}'`))[0].n).toBe(2);
 } finally { detach(); }
});

// Lead, the main Agent, on the Company's own profile in the bundled Engine (ADR 0014); the tests below share it.
function bundledLead() {
 const profile=`co-${company.replaceAll('-','')}`;
 // Each test's Engine is new, so it has no shared space yet (#122).
 query(`delete from public.company_shared_spaces where company_id='${company}'`);
 const [made]=JSON.parse(query(`select id from public.hermes_agents where company_id='${company}' and is_default`));
 if(made) return {profile,lead:made.id as string};
 const [connection,lead]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}')`);
 query(`insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) select id,'${profile}',true,true from public.companies where id='${company}' on conflict (company_id) do update set tools_confirmed=true,tools_pending=false,skills_shared=true`);
 return {profile,lead};
}

test('integration: Lead makes the Agent the Owner asks for, and nothing for a Manager',async({page})=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const fake=fakeEngine();
 fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}}];
 const made=()=>JSON.parse(query(`select a.id,a.name,a.speciality,array_to_string(a.apps,'|') as apps,a.requested_by,a.created_at is not null as dated,a.is_default,a.profile from public.hermes_agents a where a.company_id='${company}' and a.id<>'${lead}'`));
 const {service,person}=await clients();
 const conversation=randomUUID();
 const ask=()=>withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want someone to handle Meta ads'}));
 const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
 expect(await ask()).toEqual({conversation});
 expect(await close()).toBe(1);
 expect(made()).toEqual([]);
 await fake.engineFor({}).createAgent({name:profile,instructions:''});
 expect(await ask()).toEqual({conversation});
 const down=(connection:object)=>({...fake.engineFor(connection),readAgent:async()=>({state:'unreachable' as const,agent:null})});
 expect(await withEngineContract(down,()=>closeOpenRuns(service,{conversation}))).toBe(0);
 expect(made()).toEqual([]);
 const closed=await Promise.all([close(),close()]);
 expect(closed[0]+closed[1]).toBe(1);
 // #317, #475: hand_to_agent names the Company's other Agents, and this Company has none but Lead yet (made() is empty
 // above), so Lead's Runs are offered none; the Manager's Run below, once Meta Ads is made, is offered it.
 expect(fake.runs.map(run=>run.tools.map(tool=>tool.name))).toEqual([['create_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change'],['create_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']]);
 expect(fake.agentReads).toContain(profile);
 const [agent]=made();
 expect(made()).toEqual([{id:agent.id,name:'Meta Ads',speciality:'Runs the Meta ads.',apps:'Meta Ads Manager|Canva',requested_by:omar,dated:true,is_default:false,profile}]);
 expect(JSON.parse(query(`select actor_id,action,details->>'agent_name' as name,details->>'job' as job from public.company_log where company_id='${company}' and agent_id='${agent.id}'`)))
  .toEqual([{actor_id:omar,action:'agent_requested',name:'Meta Ads',job:'Runs the Meta ads.'}]);
 expect((await person.from('lead_made_agents').select('conversation_id,run_id,agent_id')).data).toEqual([{conversation_id:conversation,run_id:fake.runs[1].id,agent_id:agent.id}]);

 // #169: the Owner who asked is told once when the Agent appears in the Conversation; Open goes to its chat and takes
 // the toast away, and a reload of the Conversation raises no second one.
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 const madeToast=page.locator('.toast');
 await expect(madeToast.locator('span').first()).toHaveText('Meta Ads was made and shows in your agents');
 await madeToast.getByRole('button',{name:'Open Meta Ads'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/chat/${agent.id}$`));
 await expect(page.locator('.toast')).toHaveCount(0);
 await page.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.toast')).toHaveCount(0);
 await page.reload();
 await expect(page.locator('.toast')).toHaveCount(0);

 const answer=fake.settings.reply;
 fake.settings.reply=()=>'';
 fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{name:'SEO',job:'Writes the blog.',apps:[]}}];
 expect(await ask()).toEqual({conversation});
 const closedOnce=await Promise.all([close(),close()]);
 expect(closedOnce[0]+closedOnce[1]).toBe(1);
 expect(made().map((row:{name:string})=>row.name).sort()).toEqual(['Meta Ads','SEO']);
 // A reply that is only the made Agent's card is done, with no reply stored (#227).
 expect(JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}' and run_id='${fake.runs[2].id}'`))).toEqual([{outcome:'completed'}]);
 expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}' and author='agent' and run_id='${fake.runs[2].id}'`))[0].n).toBe(0);
 fake.settings.reply=answer;

 // #169: an Agent the Owner was told about and left unopened is not told again on a reload; the page's own question is
 // awaited, so that no toast is read as missing before a late answer could have raised it.
 const firstAsk=page.waitForResponse(response=>response.url().includes('/api/agent-toast'));
 await page.reload();
 await expect(page.locator('.toast').locator('span').first()).toHaveText('SEO was made and shows in your agents');
 await firstAsk;
 const laterAsk=page.waitForResponse(response=>response.url().includes('/api/agent-toast'));
 await page.reload();
 await laterAsk;
 await expect(page.locator('.toast')).toHaveCount(0);

 const manager=(await memberClient('manager@example.com')).person;
 const theirs=randomUUID();
 expect(await withEngineContract(fake.engineFor,()=>sendMessage(manager,service,{person:'20000000-0000-0000-0000-000000000002',company,conversation:theirs,sendKey:randomUUID(),agent:lead,message:'I want someone to handle Meta ads'}))).toEqual({conversation:theirs});
 // #167: Meta Ads, made for the Owner above, is hidden from the Manager, so Lead is offered the card that asks for one.
 expect(fake.runs[3].tools.map(tool=>tool.name)).toEqual(['request_agent','hand_to_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change','ask_to_open_agent']);
 expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation:theirs}))).toBe(1);
 expect(made()).toHaveLength(2);
});

test('integration: Lead keeps a Manager\'s and a Contributor\'s request for an Agent, and makes none',async()=>{
 test.setTimeout(120000);
 const {lead}=bundledLead();
 const fake=fakeEngine();
 // #167: an Agent hidden from both Members, so their Runs are offered the card that asks for one, whatever ran before.
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values (gen_random_uuid(),'${company}',gen_random_uuid(),'Quill','Articles',false,'engine-conversation-quill')`);
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
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(member,service,{person,company,conversation,sendKey:randomUUID(),agent:lead,message:asked}))).toEqual({conversation});
  // A reader and the worker close the run at once: one request is kept.
  const close=()=>withEngineContract(down,()=>closeOpenRuns(service,{conversation,owner:person}));
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
 }
 // #317: a Manager or Contributor's request still offers hand_to_agent after request_agent.
 expect(fake.runs.map(run=>run.tools.map(tool=>tool.name))).toEqual([['request_agent','hand_to_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change','ask_to_open_agent'],['request_agent','hand_to_agent','suggest_team_rule','show_draft','show_review','hand_over','ask_for_app','propose_change','ask_to_open_agent']]);
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
// #25: a Contributor's rule is a suggestion, scripted as the suggest_team_rule call they are offered instead.
test('integration: an Agent saves the rule the Owner tells it, with its log row, and no later run carries it (it is in the Agent\'s SOUL.md, #345); a Contributor\'s rule is a suggestion',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 // Another Agent of the Company, so hand_to_agent is offered whatever earlier tests on this lane left (#475).
 const peer=attachTarget('Peer','Helps the team.');
 const rule='من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
 const suggestion='From now on, no emojis';
 fake.settings.toolCalls=input=>input===rule?[{id:'call-0',name:'save_rule',arguments:{rule:` ${rule} `}}]:input===suggestion?[{id:'call-0',name:'suggest_team_rule',arguments:{rule:suggestion}}]:[];
 const rules=()=>JSON.parse(query(`select body,said_by,conversation_id,run_id,removed_at,suggestion from public.agent_rules where agent_id='${agent}' order by said_at`));
 const contributor='20000000-0000-0000-0000-000000000005';
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const send=(message:string)=>withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}));
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  expect(await send(rule)).toEqual({conversation});
  expect(fake.runs[0].tools.map(tool=>tool.name)).toEqual(['hand_to_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']);
  // No Run is told the Company knowledge (#344): every profile auto-loads it as the shared Skill company-knowledge.
  expect(fake.runs[0].instructions,'no instructions are sent: the fake engine keeps an absent field as null').toBeNull();
  // A reader and the worker close the run at once: the rule is saved once, before the reply is stored.
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(rules()).toEqual([{body:rule,said_by:omar,conversation_id:conversation,run_id:fake.runs[0].id,removed_at:null,suggestion:null}]);
  expect(JSON.parse(query(`select actor_id,actor_kind,action,details->>'agent_name' as agent,details->>'rule' as rule from public.company_log where company_id='${company}' and agent_id='${agent}'`)))
   .toEqual([{actor_id:omar,actor_kind:'person',action:'agent_rule_saved',agent:'Faye',rule}]);
  expect((await person.from('agent_rules').select('run_id').eq('conversation_id',conversation)).data).toEqual([{run_id:fake.runs[0].id}]);

  expect(await send('Draft the offer email')).toEqual({conversation});
  expect(fake.runs[1].instructions??'').not.toContain(rule);
  expect(await close()).toBe(1);

  // A Contributor's own Conversation with the same Agent is not told it either, and is offered suggest_team_rule, not
  // save_rule.
  const theirs=randomUUID();
  const {person:member}=await memberClient('multi@example.com');
  const tell=(message:string)=>withEngineContract(fake.engineFor,()=>sendMessage(member,service,{person:contributor,company,conversation:theirs,sendKey:randomUUID(),agent,message}));
  const closeTheirs=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation:theirs,owner:contributor}));
  expect(await tell('Draft the teaser')).toEqual({conversation:theirs});
  expect(fake.runs[2].tools.map(tool=>tool.name)).toEqual(['hand_to_agent','suggest_team_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']);
  expect(fake.runs[2].instructions??'').not.toContain(rule);
  expect(await closeTheirs()).toBe(1);

  // The Contributor tells a rule: it is kept as a suggestion waiting on the Owner and the Manager, and no run carries
  // it.
  expect(await tell(suggestion)).toEqual({conversation:theirs});
  expect(await closeTheirs()).toBe(1);
  expect(rules()[1]).toEqual({body:suggestion,said_by:contributor,conversation_id:theirs,run_id:fake.runs[3].id,removed_at:null,suggestion:'pending'});
  expect(JSON.parse(query(`select i.person_id from public.waiting_items i join public.agent_rules r on r.id=i.agent_rule_id where r.agent_id='${agent}' and i.resolved_at is null order by i.person_id`)))
   .toEqual([{person_id:omar},{person_id:'20000000-0000-0000-0000-000000000002'}]);
  expect(await tell('Draft the next post')).toEqual({conversation:theirs});
  expect(fake.runs[4].instructions??'').not.toContain(suggestion);
  expect(await closeTheirs()).toBe(1);
  expect(await send('Draft the launch post')).toEqual({conversation});
  expect(fake.runs[5].instructions??'').not.toContain(rule);
  expect(fake.runs[5].instructions??'').not.toContain(suggestion);
  expect(await close()).toBe(1);
  expect(rules()).toHaveLength(2);
 } finally { detach(); peer.detach(); }
});

// #136: an Agent shows a Contributor a draft as a card under its reply; the fake engine scripts its show_draft call. The
// limits the model is told (the spec's maxLength and maxItems) are the ones the database keeps: a draft at every limit
// is shown, and one over any of them is not.
test('integration: an Agent shows a draft once under its reply, also when two closers race, shows none for a call that does not hold, still closes the run with its reply, and logs it for its person and the Managers',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 // Another Agent of the Company, so hand_to_agent is offered whatever earlier tests on this lane left (#475).
 const peer=attachTarget('Peer','Helps the team.');
 const contributor='20000000-0000-0000-0000-000000000005';
 const plan={title:'خطة الحملة',line:'مسودة · Meta Ads',rows:[{label:'الهدف',value:'ليدز على واتساب'},{label:'الميزانية',value:'500 ج يومياً · 15,000 ج للشهر'}]};
 const {title,line,rows}=JSON.parse(toolSpecTexts().show_draft).parameters.properties;
 const most={title:'t'.repeat(title.maxLength),line:'l'.repeat(line.maxLength),
  rows:Array.from({length:rows.maxItems},()=>({label:'k'.repeat(rows.items.properties.label.maxLength),value:'v'.repeat(rows.items.properties.value.maxLength)}))};
 const calls:Record<string,unknown>={
  'Plan the campaign':{...plan,title:` ${plan.title} `},
  'At every limit':most,
  'No title':{line:plan.line,rows:plan.rows},
  'One row too many':{...most,rows:[...most.rows,most.rows[0]]},
  'Title over':{...most,title:`${most.title}t`},
  'Line over':{...most,line:`${most.line}l`},
  'Label over':{...most,rows:[{...most.rows[0],label:`${most.rows[0].label}k`}]},
  'Value over':{...most,rows:[{...most.rows[0],value:`${most.rows[0].value}v`}]},
  'Lone surrogate':{...plan,title:'خطة \ud83d'},
 };
 fake.settings.toolCalls=input=>Object.hasOwn(calls,input)?[{id:'call-0',name:'show_draft',arguments:calls[input]}]:[];
 try {
  const {service,person}=await memberClient('multi@example.com');
  const conversation=randomUUID();
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation,owner:contributor}));
  for(const [index,message] of Object.keys(calls).entries()) {
   expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:contributor,company,conversation,sendKey:randomUUID(),agent,message}))).toEqual({conversation});
   expect(fake.runs[index].tools.map(tool=>tool.name)).toEqual(['hand_to_agent','suggest_team_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']);
   // A reader and the worker close the run at once: the card is kept once, before the reply is stored.
   const closed=await Promise.all([close(),close()]);
   expect(closed[0]+closed[1]).toBe(1);
   // A chat with no Card: the first Run's Card is untied, so the later drafts are logged as before.
   untie(conversation);
  }
  expect(agentRows(conversation)).toEqual(Object.keys(calls).map(message=>({body:`Reply to: ${message}`})));
  const cards=JSON.parse(query(`select run_id,call_id,kind,title,content,state from public.reply_cards where conversation_id='${conversation}' order by id`));
  expect(cards).toEqual([{run_id:fake.runs[0].id,call_id:'call-0',kind:'draft',title:plan.title,content:{line:plan.line,rows:plan.rows},state:'shown'},
   {run_id:fake.runs[1].id,call_id:'call-0',kind:'draft',title:most.title,content:{line:most.line,rows:most.rows},state:'shown'}]);
  // The same run and call carried out again (a closer stopped before the close) answer the card they showed.
  const [{id}]=JSON.parse(query(`select id from public.reply_cards where run_id='${fake.runs[0].id}'`));
  expect(await runToolCall({db:service,engine:fake.engineFor({}),profile:'',conversation,run:fake.runs[0].id},{id:'call-0',name:'show_draft',arguments:{...plan,title:'Something else'}})).toEqual({state:'shown',card:Number(id)});
  expect(JSON.parse(query(`select count(*)::int as n from public.reply_cards where conversation_id='${conversation}'`))[0].n).toBe(2);

  // Only the Conversation's person reads the cards; the log rows are read by that person and by a Manager.
  expect((await person.from('reply_cards').select('title').eq('conversation_id',conversation).order('id')).data).toEqual([{title:plan.title},{title:most.title}]);
  const {person:owner}=await clients();
  expect((await owner.from('reply_cards').select('id').eq('conversation_id',conversation)).data).toEqual([]);
  const logged=async(reader:typeof person)=>(await reader.from('company_log').select('actor_id,actor_kind,action,details').eq('agent_id',agent).eq('action','agent_card_shown').order('id')).data;
  const rows=[plan.title,most.title].map(title=>({actor_id:agent,actor_kind:'agent',action:'agent_card_shown',details:{card:{kind:'draft',title},private:true,teller:contributor}}));
  expect(await logged(person)).toEqual(rows);
  expect(await logged((await memberClient('manager@example.com')).person)).toEqual(rows);
  expect(await logged((await memberClient('reviewer@example.com')).person)).toEqual([]);
 } finally { detach(); peer.detach(); }
});

// #227: a reply that is only a card is a complete reply. The engine reports no words as failed; a Run that stored a card
// closes done, and one whose only call did not hold still closes failed.
test('integration: an Agent\'s reply that is only a draft closes done once, also when two closers race, with no reply stored; with a call that does not hold, or read failed after its draft was shown, it closes failed',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const plan={title:'Campaign plan',line:'Draft · Meta Ads',rows:[{label:'Goal',value:'WhatsApp leads'}]};
 const calls:Record<string,unknown>={'Plan the campaign':plan,'No title':{line:plan.line,rows:plan.rows}};
 fake.settings.reply=()=>'';
 fake.settings.toolCalls=input=>[{id:'call-0',name:'show_draft',arguments:calls[input]}];
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  const failed=async()=>{
   const {data:found}=await person.from('conversations').select(conversationColumns).eq('id',conversation).single();
   return (await conversationRecord(person as unknown as Parameters<typeof conversationRecord>[0],omar,company,found!)).failed;
  };
  const send=(message:string)=>withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}));
  expect(await send('Plan the campaign')).toEqual({conversation});
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(await close()).toBe(0);
  expect(JSON.parse(query(`select run_id,kind,title from public.reply_cards where conversation_id='${conversation}'`))).toEqual([{run_id:fake.runs[0].id,kind:'draft',title:plan.title}]);
  expect(endRows(conversation).map((row:{outcome:string})=>row.outcome)).toEqual(['completed']);
  expect(agentRows(conversation)).toEqual([]);
  expect(await failed()).toBe(false);

  expect(await send('No title')).toEqual({conversation});
  expect(await close()).toBe(1);
  expect(JSON.parse(query(`select count(*)::int as n from public.reply_cards where conversation_id='${conversation}'`))[0].n).toBe(1);
  expect(JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}' and run_id='${fake.runs[1].id}'`))).toEqual([{outcome:'failed'}]);
  expect(agentRows(conversation)).toEqual([]);
  expect(await failed()).toBe(true);

  // A closer showed the draft, then lost the engine before the rest; the next read finds the run failed (its Agent was
  // detached): the draft alone does not make it done.
  expect(await send('Plan it again')).toEqual({conversation});
  const run=fake.runs[2].id;
  expect((await runToolCall({db:service,engine:fake.engineFor({}),profile:'',conversation,run},{id:'call-0',name:'show_draft',arguments:plan})).state).toBe('shown');
  const gone=(connection:object)=>({...fake.engineFor(connection),read:async()=>({state:'failed' as const,reply:null,session:null,usage:null,toolCalls:[]})});
  expect(await withEngineContract(gone,()=>closeOpenRuns(service,{conversation}))).toBe(1);
  expect(JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}' and run_id='${run}'`))).toEqual([{outcome:'failed'}]);
  expect(await failed()).toBe(true);
 } finally { detach(); }
});

// #137: an Agent shows the Owner its review as a card under its reply; the fake engine scripts its show_review calls. A
// review records no Approval, moves no Card and adds no Version (ADR 0006).
test('integration: an Agent shows a review once under its reply, shows none for a call with no texts or no decision, still closes each run with its reply, changes no Card, Approval or Version, and logs the review with its counts',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 // Another Agent of the Company, so hand_to_agent is offered whatever earlier tests on this lane left (#475).
 const peer=attachTarget('Peer','Helps the team.');
 const review={title:'مراجعة نصوص إعلانات ديسمبر',line:'3 نصوص · Meta Ads · قبل ما تطلع',items:[
  {text:'من خريج تجارة لمحاسب شغال في 3 شهور',fine:true,note:'الوعد واضح، ومعانا قصص طلبة تثبته.'},
  {text:'أضمن طريق لأول وظيفة محاسبة',fine:false,note:'«أضمن» وعد مقدرش نثبته. البديل: «أقصر طريق لأول شغلانة محاسبة».'},
  {text:'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج',fine:true,note:'السعر مطابق لصفحة الكورس.'}],decision:'2 جاهزين، و1 رجع لـ Ads بالبديل'};
 const calls:Record<string,unknown>={
  'Review the December ad texts':{...review,decision:` ${review.decision} `},
  'No texts':{title:review.title,line:review.line,decision:review.decision},
  'No decision':{title:review.title,line:review.line,items:review.items},
 };
 fake.settings.toolCalls=input=>Object.hasOwn(calls,input)?[{id:'call-0',name:'show_review',arguments:calls[input]}]:[];
 const work=()=>JSON.parse(query(`select (select count(*) from public.work_activity where action like 'approval%')::int as approvals,(select count(*) from public.work_activity)::int as activity,
  (select count(*) from public.work_versions)::int as versions,(select string_agg(id||':'||stage_id||':'||coalesce(approval_step_id::text,'-'),',' order by id) from public.work_cards) as cards`))[0];
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const send=async(message:string)=>{
   expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}))).toEqual({conversation});
   expect(fake.runs.at(-1)?.tools.map(tool=>tool.name)).toEqual(['hand_to_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']);
   expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
  };
  // The Conversation's first Run puts its Card on the board (#144), so the review's runs are measured after it. The Card
  // is untied: a chat with no Card logs its review privately.
  await send('Draft the December ad texts');
  untie(conversation);
  const before=work();
  for(const message of Object.keys(calls)) await send(message);
  expect(agentRows(conversation)).toEqual(['Draft the December ad texts',...Object.keys(calls)].map(message=>({body:`Reply to: ${message}`})));
  const cards=JSON.parse(query(`select run_id,call_id,kind,title,content,state from public.reply_cards where conversation_id='${conversation}' order by id`));
  expect(cards).toEqual([{run_id:fake.runs[1].id,call_id:'call-0',kind:'review',title:review.title,content:{line:review.line,items:review.items,decision:review.decision},state:'shown'}]);
  expect(work()).toEqual(before);

  expect((await person.from('reply_cards').select('kind,title').eq('conversation_id',conversation)).data).toEqual([{kind:'review',title:review.title}]);
  expect((await person.from('company_log').select('actor_id,actor_kind,action,details').eq('agent_id',agent).eq('action','agent_card_shown')).data)
   .toEqual([{actor_id:agent,actor_kind:'agent',action:'agent_card_shown',details:{card:{kind:'review',title:review.title,fine:2,edits:1},private:true,teller:omar}}]);
 } finally { detach(); peer.detach(); }
});

// #139: an Agent hands the Owner a step no Agent may do; the fake engine scripts its hand_over calls (the reference's th-team
// t10). "Done it" is the person's word, recorded once with who and when; it approves, publishes and spends nothing.
test('integration: an Agent hands a step over once under its reply, shows none with no title or an address that is not https, still closes each run, and its person marks it done once, logged as theirs with nothing approved',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 // Another Agent of the Company, so hand_to_agent is offered whatever earlier tests on this lane left (#475).
 const peer=attachTarget('Peer','Helps the team.');
 const hand={title:'انشر مقال «كورس محاسب شامل اونلاين»',line:'SEO سابه مسودة على WordPress، وانت اللي تدوس نشر.',app:'WordPress',
  rows:[{label:'الطول',value:'1,600 كلمة · 5 عناوين فرعية'},{label:'الروابط',value:'3 روابط لصفحة المحاسب الشامل'},{label:'المراجعة',value:'Critic: مقبول بعد تعديل واحد'}],
  url:'https://rslearning.example/wp-admin/post.php?post=812&action=edit',note:'هتابع ترتيبه في Search Console.'};
 const calls:Record<string,unknown>={
  'Get the article out':{...hand,title:` ${hand.title} `},
  'No title':{line:hand.line,app:hand.app,rows:hand.rows,url:hand.url},
  'Plain address':{...hand,url:'http://rslearning.example/wp-admin/post.php?post=812'},
 };
 fake.settings.toolCalls=input=>Object.hasOwn(calls,input)?[{id:'call-0',name:'hand_over',arguments:calls[input]}]:[];
 const work=()=>JSON.parse(query(`select (select count(*) from public.work_activity where action like 'approval%')::int as approvals,(select count(*) from public.work_activity)::int as activity,
  (select count(*) from public.work_versions)::int as versions,(select string_agg(id||':'||stage_id||':'||coalesce(approval_step_id::text,'-'),',' order by id) from public.work_cards) as cards`))[0];
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const send=async(message:string)=>{
   expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}))).toEqual({conversation});
   expect(fake.runs.at(-1)?.tools.map(tool=>tool.name)).toEqual(['hand_to_agent','save_rule','show_draft','show_review','hand_over','ask_for_app','propose_change']);
   expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
  };
  // The Conversation's first Run puts its Card on the board (#144), so the hand's runs are measured after it. The Card
  // is untied: a chat with no Card logs its Done it privately.
  await send('Draft the article');
  untie(conversation);
  const before=work();
  for(const message of Object.keys(calls)) await send(message);
  expect(agentRows(conversation)).toEqual(['Draft the article',...Object.keys(calls)].map(message=>({body:`Reply to: ${message}`})));
  const cards=()=>JSON.parse(query(`select run_id,call_id,kind,title,content,state,done_by,done_at from public.reply_cards where conversation_id='${conversation}' order by id`));
  expect(cards()).toEqual([{run_id:fake.runs[1].id,call_id:'call-0',kind:'hand',title:hand.title,content:{app:hand.app,line:hand.line,rows:hand.rows,url:hand.url,note:hand.note},state:'open',done_by:null,done_at:null}]);
  const [{id}]=JSON.parse(query(`select id from public.reply_cards where conversation_id='${conversation}'`));
  const card=Number(id);

  // The record, as the page reads it after a reload.
  const shown=async()=>{
   const {data:found}=await person.from('conversations').select(conversationColumns).eq('id',conversation).single();
   const record=await conversationRecord(person as unknown as Parameters<typeof conversationRecord>[0],omar,company,found!);
   return record.messages.flatMap(message=>message.cards??[]).flatMap(shownCard=>shownCard.kind==='reply'&&shownCard.card.kind==='hand'?[shownCard.card]:[]);
  };
  expect(await shown()).toEqual([{id:card,kind:'hand',title:hand.title,line:hand.line,app:hand.app,rows:hand.rows,url:hand.url,note:hand.note,state:'open'}]);

  // Another Member of the Company is refused and reads no card; the Conversation's person marks it done once.
  const {person:manager}=await memberClient('manager@example.com');
  expect((await manager.rpc('mark_hand_done',{c:company,conversation,card})).error?.code).toBe('P0002');
  expect((await manager.from('reply_cards').select('id').eq('conversation_id',conversation)).data).toEqual([]);
  const {data:first,error}=await person.rpc('mark_hand_done',{c:company,conversation,card});
  expect(error).toBeNull();
  expect([first.state,first.first]).toEqual(['done',true]);
  const [kept]=cards();
  expect([kept.state,kept.done_by,typeof kept.done_at]).toEqual(['done',omar,'string']);
  // A second press, as from a second tab, changes nothing: one record, and the one turn the first press queued to tell
  // the Agent (#140).
  expect((await person.rpc('mark_hand_done',{c:company,conversation,card})).data).toEqual({...first,first:false});
  expect(cards()).toEqual([kept]);
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_queued_turns where conversation_id='${conversation}' and hand_card=${card}`))[0].n).toBe(1);
  const [read]=await shown();
  expect(read).toMatchObject({id:card,state:'done',note:hand.note});
  expect(new Date((read as {at:string}).at).getTime()).toBe(new Date(first.at).getTime());

  // One log row: the person did it, the step's title, from "Handed to you" to "Done it". Nothing is approved.
  const logged=(await person.from('company_log').select('actor_id,actor_kind,subject,action,details').eq('agent_id',agent).eq('action','agent_hand_done')).data!;
  expect(logged).toEqual([{actor_id:omar,actor_kind:'person',subject:'agent',action:'agent_hand_done',details:{hand:{title:hand.title},private:true,teller:omar}}]);
  const line=describeEntry(logged[0]);
  expect([i18n('en').t(line.act[0]),line.obj,line.from,line.to].map(part=>typeof part==='object'&&part&&'key' in part?i18n('en').t(part.key):part)).toEqual(['did it',hand.title,'Handed to you','Done it']);
  expect(work()).toEqual(before);
 } finally {
  // The turn Done it queued (#140) is reserved on this Connection, which never answers (127.0.0.1:9), and an active
  // reservation keeps its Connection: the turn goes with the test's Agent, first, so the worker cannot claim and reserve
  // it again before its reservation goes.
  query(`delete from public.conversation_queued_turns where agent_id='${agent}'`);
  query(`delete from public.conversation_run_reservations where conversation_id in (select id from public.conversations where agent_id='${agent}')`);
  detach(); peer.detach();
 }
});

// #140: the whole app around a handed step, on the lane's fake Hermes, which the server and the worker reach as well (the fake engine
// lives in this test alone, so a press through the page could not start its Run there). The step is shown with the
// first Run's reply as agent_show_card shows a hand_over call (#139 proves the call itself).
function attachHermes() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Faye','Marketing','hand-${connection.slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); }};
}
const handTitle='انشر المقال';
async function handedStep(fake:Awaited<ReturnType<typeof fakeHermes>>) {
 // The lane's fake Hermes is the install's Hermes these sends reach (#342).
 const {service,person}=await clients(); const {agent,detach}=attachHermes();
 const conversation=randomUUID();
 // A message, sent as the route sends it, and its reply closed by whoever reads first (this test, the worker or the page).
 const send=async(message:string,replies=true)=>{
  const count=agentRows(conversation).length;
  expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent,message})).toEqual({conversation});
  if(replies) await expect.poll(async()=>{ await closeOpenRuns(service,{conversation}); return agentRows(conversation).length; }).toBe(count+1);
 };
 await send('Get the article out');
 const [{run_id:run}]=JSON.parse(query(`select run_id from public.conversation_messages where conversation_id='${conversation}' and author='person' order by id limit 1`));
 const show=()=>{
  query(`select public.agent_show_card('${conversation}','${run}','call-0','hand','${handTitle}','${JSON.stringify({app:'WordPress',line:'The draft is ready; you press Publish.',rows:[]})}'::jsonb)`);
  return Number(JSON.parse(query(`select id from public.reply_cards where conversation_id='${conversation}' and kind='hand'`))[0].id);
 };
 // What the Agent is told: who pressed, the step, its app and the time the database kept, in UTC.
 const told=(card:number)=>{ const [{done_at}]=JSON.parse(query(`select done_at from public.reply_cards where id=${card}`));
  return `عمر did the step you handed over, "${handTitle}" in WordPress, and pressed "Done it" at ${new Date(done_at).toISOString().slice(0,16).replace('T',' ')} UTC. Pick up from there.`; };
 return {conversation,send,show,told,detach};
}
const speaks=(value:'en'|'ar')=>query(`update public.people set language='${value}' where id='${omar}'`);

test('a handed step waits in Waiting on you until Done it, which starts one Run telling the Agent who did it and when; its reply comes under the card and the press adds no message',async({page})=>{
 test.setTimeout(180000);
 const fake=await laneHermes(); const {conversation,send,show,told,detach}=await handedStep(fake);
 // A chat with no Card: its step waits as an item of its own (one with a Card is drawn as that Card, #146).
 untie(conversation);
 try {
  speaks('en');
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com','/c/rs-learning/approvals');
  const count=page.locator('.sidebar .sb-count[href$="/approvals"] .sb-count__n');
  const before=Number(await count.textContent());
  const card=show();
  await page.reload();
  // One item of its own kind, with its Agent, the tag and the step's title, and the count rises by one.
  const item=page.locator('.col[data-column="waiting"] a.mcard[data-kind="hand"]');
  await expect(item).toHaveCount(1);
  await expect(count).toHaveText(String(before+1));
  await expect(item.locator('.mcard__who')).toHaveText('Faye');
  await expect(item.locator('.wtag--hand')).toHaveText('Handed to you');
  await expect(item.locator('.mcard__q')).toHaveText(handTitle);
  await expect(item).toHaveAttribute('href',`/c/rs-learning/conversations/${conversation}#hand-${card}`);
  // It opens the Conversation with the card in view, in English and in Arabic.
  const handCard=page.locator(`#hand-${card}`);
  await item.click();
  await expect(handCard).toBeInViewport();
  await expect(handCard).toBeFocused();
  // Landed, the address is the Conversation's again, so a reload opens on its newest message.
  await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
  speaks('ar');
  await page.goto('/c/rs-learning/approvals');
  await expect(item.locator('.wtag--hand')).toHaveText('اتسلّمتلك');
  await expect(item.locator('.mcard__q')).toHaveText(handTitle);
  await expect(count).toHaveText(String(before+1));
  await item.click();
  await expect(handCard).toBeInViewport();
  speaks('en');

  // A message written in the Conversation leaves the item where it is.
  await send('I will publish it after lunch');
  await page.goto('/c/rs-learning/approvals');
  await expect(item).toHaveCount(1);

  // Done it: exactly one new Run, told who did the step and when; the item leaves.
  await item.click();
  const runs=fake.settings.runs.length;
  await handCard.getByRole('button',{name:'Done it'}).click();
  await expect.poll(()=>fake.settings.runs.length).toBe(runs+1);
  expect(fake.settings.runs.at(-1)!.input).toBe(told(card));
  // Its reply comes under the card, and no message of the person's is drawn for the press.
  const reply=page.locator('.turns > li[data-author="agent"]').filter({hasText:'Reply to: عمر did the step'});
  await expect(reply).toHaveCount(1);
  expect(await reply.evaluate((node,id)=>!!(document.getElementById(id)!.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING),`hand-${card}`)).toBe(true);
  await expect(page.locator('.turns > li[data-author="person"]').filter({hasText:'did the step you handed over'})).toHaveCount(0);
  await page.reload();
  await expect(reply).toHaveCount(1);
  await expect(page.locator('.turns > li[data-author="person"]').filter({hasText:'did the step you handed over'})).toHaveCount(0);
  expect(fake.settings.runs.filter(run=>run.input===told(card))).toHaveLength(1);
  expect(fake.settings.runs).toHaveLength(runs+1);
  await page.goto('/c/rs-learning/approvals');
  await expect(item).toHaveCount(0);
  await expect(count).toHaveText(String(before));
 } finally { speaks('en'); detach(); await fake.close(); }
});

test('Done it pressed while the Agent is busy waits as its person\'s next turn and starts once that Run ends',async({page})=>{
 test.setTimeout(180000);
 const fake=await laneHermes(); const {conversation,send,show,told,detach}=await handedStep(fake);
 try {
  const card=show();
  fake.settings.pendingReads=1e9;
  await send('And the social posts',false);
  const runs=fake.settings.runs.length;
  speaks('en');
  await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}#hand-${card}`);
  const handCard=page.locator(`#hand-${card}`);
  await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/conversations')),handCard.getByRole('button',{name:'Done it'}).click()]);
  await expect(handCard.locator('.card__outcome')).toBeVisible();
  const turn=()=>JSON.parse(query(`select message,started_at from public.conversation_queued_turns where conversation_id='${conversation}' and hand_card=${card}`));
  expect(turn()).toEqual([{message:told(card),started_at:null}]);
  expect(fake.settings.runs).toHaveLength(runs);
  // The open Run ends; then the turn starts, once.
  fake.settings.pendingReads=0;
  await expect.poll(()=>fake.settings.runs.length,{timeout:30000}).toBe(runs+1);
  expect(fake.settings.runs.at(-1)!.input).toBe(told(card));
  await expect(page.locator('.turns > li[data-author="agent"]').last()).toContainText('Reply to: عمر did the step');
  expect(turn()[0].started_at).not.toBeNull();
  expect(fake.settings.runs).toHaveLength(runs+1);
 } finally { speaks('en'); detach(); await fake.close(); }
});

// #146: the step is handed over in a chat whose first Run put its Card In progress. While it waits, the Card is drawn
// once under Waiting on you, for its person, another Contributor and a Viewer with their own badge, and keeps its stage;
// the chat's pill shows the wait; Done it sends the Card back. The chat's draft and Done it are rows of the Card's Log.
test('a Card whose chat hands its person a step waits under Waiting on you for each reader and keeps its stage; Done it sends it back, and the chat\'s rows are on the Card\'s Log',async({page,browser})=>{
 test.setTimeout(240000);
 const fake=await laneHermes(); const {conversation,show,detach}=await handedStep(fake);
 const others=['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'];
 const language=(value:'en'|'ar')=>query(`update public.people set language='${value}' where id in ('${omar}','${others.join("','")}')`);
 const [{id:card,stage_id:stage}]=JSON.parse(query(`select id,stage_id from public.work_cards where conversation_id='${conversation}'`));
 const stageNow=()=>JSON.parse(query(`select stage_id from public.work_cards where id=${card}`))[0].stage_id;
 const [{run_id:run}]=JSON.parse(query(`select run_id from public.conversation_messages where conversation_id='${conversation}' and author='person' order by id limit 1`));
 const opened:{close:()=>Promise<void>}[]=[];
 const member=async(email:string)=>{ const context=await browser.newContext(); opened.push(context); const other=await context.newPage(); await signIn(other,email,'/c/rs-learning/work/board'); return other; };
 const kcard=(on:typeof page)=>on.locator(`#board-cols .kcard[data-card-id="${card}"]`);
 const columnOf=(on:typeof page)=>kcard(on).evaluate(node=>node.closest('.col')?.getAttribute('data-column'));
 const waitingCount=(on:typeof page)=>on.locator('.col[data-column="waiting"] .col__count');
 try {
  language('en');
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  const sidebar=page.locator('.sidebar .sb-count[href$="/approvals"] .sb-count__n');
  expect(await columnOf(page)).toBe('progress');
  const before={sidebar:Number(await sidebar.textContent()),column:Number(await waitingCount(page).textContent())};
  // A draft shown in the chat once it has its Card, and the step handed over.
  query(`select public.agent_show_card('${conversation}','${run}','call-1','draft','خطة المقال','{"line":"مسودة","rows":[]}'::jsonb)`);
  show();
  const reviewer=await member('reviewer@example.com'), viewer=await member('viewer@example.com');
  const badges={en:{omar:'Waiting on you',reviewer:'Waiting on عمر',viewer:'Waiting on the team',tag:'Handed to you'},ar:{omar:'مستنيك',reviewer:'مستني عمر',viewer:'مستني الفريق',tag:'اتسلّمتلك'}};
  for(const value of ['en','ar'] as const) {
   language(value);
   for(const [who,on] of [['omar',page],['reviewer',reviewer],['viewer',viewer]] as const) {
    await on.reload();
    await expect(on.locator(`.col[data-column="waiting"] .kcard[data-card-id="${card}"]`),`${who} in ${value}`).toHaveCount(1);
    await expect(kcard(on)).toHaveCount(1);
    await expect(kcard(on).locator('.wtag--hand')).toHaveText(badges[value].tag);
    await expect(kcard(on).locator('.badge')).toHaveText(badges[value][who]);
    await expect(kcard(on).locator('.badge')).toHaveClass(who==='omar'?'badge badge--wait':'badge');
    await expect(kcard(on).locator('.kcard__t')).toHaveText(handTitle);
   }
   await expect(page.locator('a.mcard[data-kind="hand"]')).toHaveCount(0);
   await expect(sidebar).toHaveText(String(before.sidebar+1));
   await expect(waitingCount(page)).toHaveText(String(before.column+1));
  }
  expect(stageNow()).toBe(stage);

  // The chat's pill shows the wait, as the Card does.
  language('en');
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  const pill=page.locator('.chat__corner .corner-pill');
  await expect(pill).toHaveAccessibleName('On the board: Waiting on you');
  await expect(pill).toHaveClass(/\bis-waiting\b/);

  // The draft is on the Card's Log for another Contributor, and on the Activity log for the Viewer.
  await reviewer.goto(`/c/rs-learning/work/board?card=${card}`);
  await reviewer.locator('.sheet #sh-tab-log').click();
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('delivered the draft');
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('خطة المقال');
  await viewer.goto(`/c/rs-learning/log?card=${card}`);
  await expect(viewer.locator('main')).toContainText('delivered the draft');

  // Done it: the Card is drawn In progress again, its stage as it was, and the pill names its column.
  await page.locator('[id^="hand-"]').getByRole('button',{name:'Done it'}).click();
  await expect(pill).toHaveAccessibleName('On the board: In progress');
  await expect(pill).not.toHaveClass(/\bis-waiting\b/);
  for(const on of [page,reviewer,viewer]) {
   await on.goto('/c/rs-learning/work/board');
   await expect.poll(()=>columnOf(on)).toBe('progress');
   await expect(kcard(on).locator('.badge')).toHaveCount(0);
  }
  await expect(sidebar).toHaveText(String(before.sidebar));
  expect(stageNow()).toBe(stage);
  await reviewer.goto(`/c/rs-learning/work/board?card=${card}`);
  await reviewer.locator('.sheet #sh-tab-log').click();
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('did it');
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText(handTitle);
  await viewer.goto(`/c/rs-learning/log?card=${card}`);
  await expect(viewer.locator('main')).toContainText('did it');
 } finally {
  language('en'); for(const context of opened) await context.close();
  // Done it's turn may still hold its reservation, which keeps the Connection detach() removes; the turn goes first, so
  // the worker cannot claim and reserve it again.
  query(`delete from public.conversation_queued_turns where conversation_id='${conversation}'`);
  query(`delete from public.conversation_run_reservations where conversation_id='${conversation}'`);
  try { detach(); } finally { await fake.close(); }
 }
});

// #138: an Agent asks its person with the Engine's own clarify tool; the fake engine scripts the question (the reference's
// th-meta m3) and gives its reply the answer.
test('integration: an Agent\'s question is answered once by its person, by a pick or typed words, the same Run goes on to its reply, the record reads the answer as the person\'s, and the log row is the person\'s',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const angles=['من خريج لمحاسب شغال','Excel وOdoo في كورس واحد','شهادة معتمدة وتدريب عملي'];
 fake.settings.questions=input=>input.startsWith('Plan')?[{text:'اختار زاوية الإعلان',choices:angles}]:[];
 fake.settings.reply=(input,answers)=>`Reply to: ${input} (${answers.join(', ')})`;
 try {
  const {service,person}=await clients();
  const conversation=randomUUID();
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  const read=async()=>{
   const {data:found}=await person.from('conversations').select(conversationColumns).eq('id',conversation).single();
   const record=await conversationRecord(person as unknown as Parameters<typeof conversationRecord>[0],omar,company,found!);
   // The Card the first Run put on the board (#144) has its own case.
   return {pending:record.pending,asking:record.asking??false,turns:record.messages.filter(message=>message.kind!=='boarded').map(message=>({author:message.author,kind:message.kind??null,body:message.body,
    cards:message.cards?.map(card=>card.kind==='reply'&&card.card.kind==='question'?{state:card.card.state,answer:card.card.state==='answered'?card.card.answer:null}:card.kind)??null}))};
  };
  const waiting=async()=>((await person.rpc('waiting_list',{c:company})).data as {kind:string,title:string,asked_by:string,conversation_id:string}[]).filter(item=>item.kind==='question');
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message:'Plan the Meta campaign'}))).toEqual({conversation});
  // The Run waits on its question: it is kept as an open card, waits in Omar's list, and the Run stays open.
  expect(await close()).toBe(0);
  expect(await close()).toBe(0);
  const cards=()=>JSON.parse(query(`select run_id,kind,title,content,state from public.reply_cards where conversation_id='${conversation}' order by id`));
  expect(cards()).toEqual([{run_id:fake.runs[0].id,kind:'question',title:'اختار زاوية الإعلان',content:{question:'اختار زاوية الإعلان',choices:angles,multiple:false},state:'open'}]);
  expect(await waiting()).toEqual([expect.objectContaining({title:'اختار زاوية الإعلان',asked_by:'Faye',conversation_id:conversation})]);
  expect(await read()).toEqual({pending:true,asking:true,turns:[{author:'person',kind:null,body:'Plan the Meta campaign',cards:null},{author:'agent',kind:'asked',body:'',cards:[{state:'open',answer:null}]}]});

  // A pick: the claim, then the answer delivered once to the same Run, which goes on to its reply.
  const [{id:card}]=JSON.parse(query(`select id from public.reply_cards where conversation_id='${conversation}'`));
  const pick={company,conversation,card:Number(card),choice:1,answerKey:randomUUID(),hermes,engineFor:fake.engineFor};
  expect(await answerQuestion(person,service,pick)).toEqual({state:'claimed'});
  expect(fake.answers).toEqual([{run:fake.runs[0].id,question:`${fake.runs[0].id}_q1`,text:angles[1]}]);
  // The same click again, and a click in a second tab, send nothing.
  expect(await answerQuestion(person,service,pick)).toEqual({state:'claimed'});
  expect(await answerQuestion(person,service,{...pick,choice:0,answerKey:randomUUID()})).toEqual({state:'taken'});
  expect(fake.answers).toHaveLength(1);
  expect(fake.runs).toHaveLength(1);
  expect(agentRows(conversation)).toEqual([{body:`Reply to: Plan the Meta campaign (${angles[1]})`}]);
  expect(await waiting()).toEqual([]);
  // A chat with no Card: the Card its first Run put on the board is untied, so the next answer is logged privately too.
  untie(conversation);
  expect(await read()).toEqual({pending:false,asking:false,turns:[{author:'person',kind:null,body:'Plan the Meta campaign',cards:null},{author:'agent',kind:'asked',body:'',cards:[{state:'answered',answer:angles[1]}]},
   {author:'person',kind:'answer',body:angles[1],cards:null},{author:'agent',kind:null,body:`Reply to: Plan the Meta campaign (${angles[1]})`,cards:null}]});

  // Typed words while the next question is open are its answer: no Run starts and nothing is queued.
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message:'Plan the Google campaign'}))).toEqual({conversation});
  expect(await close()).toBe(0);
  const typed={person:omar,company,conversation,sendKey:randomUUID(),agent,message:'الاتنين مع بعض',hermes,engineFor:fake.engineFor};
  expect(await sendMessage(person,service,typed)).toEqual({conversation,answered:true});
  expect(await sendMessage(person,service,typed)).toEqual({conversation,answered:true});
  expect(fake.runs).toHaveLength(2);
  expect(fake.answers.map(answer=>answer.text)).toEqual([angles[1],'الاتنين مع بعض']);
  // Every message is stored as its turn first (#764): none is left waiting.
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_queued_turns where conversation_id='${conversation}' and started_at is null`))[0].n).toBe(0);
  expect(cards().map((row:{state:string,content:{answer?:string}})=>[row.state,row.content.answer])).toEqual([['answered',angles[1]],['answered','الاتنين مع بعض']]);
  expect(agentRows(conversation).at(-1)).toEqual({body:'Reply to: Plan the Google campaign (الاتنين مع بعض)'});

  // Each answer is logged once, as the person who answered, privately.
  expect((await person.from('company_log').select('actor_id,actor_kind,agent_id,action,details').eq('action','agent_question_answered').eq('agent_id',agent).order('id')).data)
   .toEqual([angles[1],'الاتنين مع بعض'].map(answer=>({actor_id:omar,actor_kind:'person',agent_id:agent,action:'agent_question_answered',details:{question:{text:'اختار زاوية الإعلان',answer},private:true,teller:omar}})));
  expect((await (await memberClient('reviewer@example.com')).person.from('company_log').select('id').eq('action','agent_question_answered').eq('agent_id',agent)).data).toEqual([]);
 } finally { detach(); }
});

// #163: an Agent's Run stops to ask before an action; the fake engine scripts the request and gives its reply the choice.
// The page's own reads find the Agent's Connection unreachable, so the fake engine's closer delivers what the card claimed.
test('integration: a Contributor allows one request once and refuses another from the card, each delivered once and logged, the card keeps its outcome and time after a reload, and a Viewer sees the wait line',async({page})=>{
 test.setTimeout(180000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const asked:Record<string,string>={'Clean up the exports':'delete the old exports','Clean up the backups':'delete the old backups','Clean up the drafts':'delete the old drafts'};
 fake.settings.permissions=input=>Object.hasOwn(asked,input)?[{description:asked[input],command:`rm -r /srv/${input.split(' ').at(-1)}`}]:[];
 fake.settings.reply=(input,_answers,choices)=>`Reply to: ${input} (${choices.join(', ')})`;
 const reviewer='20000000-0000-0000-0000-000000000003';
 const role=(value:'contributor'|'viewer')=>query(`update public.members set role='${value}' where company_id='${company}' and person_id='${reviewer}'`);
 try {
  const {service,person}=await memberClient('reviewer@example.com');
  const conversation=randomUUID();
  const close=()=>withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  const send=async(message:string)=>{
   expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:reviewer,company,conversation,sendKey:randomUUID(),agent,message}))).toEqual({conversation});
   expect(await close()).toBe(0);
  };
  const cards=()=>JSON.parse(query(`select title,content,state,decided_by,decided_at from public.reply_cards where conversation_id='${conversation}' and kind='permission' order by id`));
  // The Run waits on its request: kept as an open card, and the Run stays open. The Agent is on a profile it shares, so
  // the Engine's always is not kept.
  await send('Clean up the exports');
  expect(cards()).toEqual([{title:'delete the old exports',content:{description:'delete the old exports',command:'rm -r /srv/exports',choices:['once','deny']},state:'open',decided_by:null,decided_at:null}]);

  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${conversation}`);
  const exports=page.getByRole('group',{name:'Approval request: delete the old exports'});
  await expect(exports.getByRole('button')).toHaveText(['Don’t allow','Allow once']);
  await expect(exports.locator('.kv__row')).toHaveText('Commandrm -r /srv/exports');
  await expect(page.locator('.convo-status')).toHaveText(/^Faye/);
  await expect(page.locator('.convo-status')).not.toContainText('working on a reply');
  await exports.getByRole('button',{name:'Allow once'}).click();
  const outcome=exports.locator('.card__outcome');
  await expect(outcome).toHaveText(/^Allowed once · \S/);
  await expect(exports.getByRole('button')).toHaveCount(0);
  const allowed=await outcome.textContent();
  const [claimed]=cards();
  expect([claimed.state,claimed.content.choice,claimed.decided_by]).toEqual(['sending','once',reviewer]);
  expect(fake.permits).toEqual([]);

  // The closer delivers the choice once to the same Run, which goes on to its reply under the card.
  expect(await close()).toBe(0);
  expect(await close()).toBe(1);
  expect(fake.permits).toEqual([{run:fake.runs[0].id,permission:`${fake.runs[0].id}_p1`,choice:'once'}]);
  expect(fake.runs).toHaveLength(1);
  expect(agentRows(conversation)).toEqual([{body:'Reply to: Clean up the exports (once)'}]);
  await page.reload();
  await expect(outcome).toHaveText(allowed!);
  expect(new Date((await outcome.locator('time').getAttribute('datetime'))!).getTime()).toBe(new Date(cards()[0].decided_at).getTime());
  await expect(page.locator('.turns > li[data-author="agent"]').last()).toContainText('Reply to: Clean up the exports (once)');

  // The next request is refused from its card.
  await send('Clean up the backups');
  await page.reload();
  const backups=page.getByRole('group',{name:'Approval request: delete the old backups'});
  await backups.getByRole('button',{name:'Don’t allow'}).click();
  await expect(backups.locator('.card__outcome')).toHaveText(/^Not allowed · \S/);
  expect(await close()).toBe(0);
  expect(await close()).toBe(1);
  expect(agentRows(conversation).at(-1)).toEqual({body:'Reply to: Clean up the backups (deny)'});

  // Each decision is logged once, as the person who decided, privately: from "Waiting for OK" to the outcome.
  const logged=(await person.from('company_log').select('actor_id,actor_kind,subject,agent_id,action,details').eq('action','agent_permission_decided').eq('agent_id',agent).order('id')).data!;
  expect(logged).toEqual([['delete the old exports','once'],['delete the old backups','deny']].map(([text,choice])=>({actor_id:reviewer,actor_kind:'person',subject:'agent',agent_id:agent,action:'agent_permission_decided',details:{permission:{text,choice},private:true,teller:reviewer}})));
  const words=(row:Parameters<typeof describeEntry>[0])=>{ const line=describeEntry(row,{agentName:()=>'Faye'}); const {t}=i18n('en'); return [t(line.act[0],...line.act.slice(1).map(part=>typeof part==='object'&&part&&'text' in part?part.text:part)),line.obj,line.from,line.to].map(part=>typeof part==='object'&&part&&'key' in part?t(part.key):part); };
  expect(logged.map(words)).toEqual([['approved Faye’s request','delete the old exports','Waiting for OK','Allowed once'],['refused Faye’s request','delete the old backups','Waiting for OK','Not allowed']]);

  // A Viewer (a Member made one after asking) sees the wait line and no button.
  await send('Clean up the drafts');
  role('viewer');
  await page.reload();
  const drafts=page.getByRole('group',{name:'Approval request: delete the old drafts'});
  await expect(drafts.locator('.card__outcome')).toHaveText('Waiting for someone on the team to approve');
  await expect(drafts.getByRole('button')).toHaveCount(0);
 } finally { role('contributor'); detach(); }
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
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:`I want the ready-made ${template}`}))).toEqual({conversation});
  expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
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
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:writer.id,message:'Write about the tax diploma'}))).toEqual({conversation:theirs});
  expect(fake.runs.at(-1)).toMatchObject({conversation:theirs,instructions:`${writer.instructions}\n\n${noteInstructions('Answer in short points.')}`});
 } finally { query(`delete from public.member_notes where company_id='${company}'`); }
});

// ADR 0016: an Agent Lead makes gets its own Engine profile. Lead's runs stay on the fake engine, which scripts the call;
// reading Lead's profile and making, reading or removing an Agent's go through the real driver to the fake Engine server,
// whose key is Lead's Connection key (the install key on a bundled install) and whose root profile has a model with a
// sign-in that a new profile copies.
async function ownProfiles(profile:string) {
 // The lane's Engine, at the address the Company's Engine record names, with the record's key.
 const hermes=await laneHermes();
 hermes.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}});
 hermes.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'};
 hermes.settings.defaultCredentials['openai-codex']='root-codex-token';
 const fake=fakeEngine();
 const engineFor=(connection:{address:string,profile:string,key:string})=>{
  const driver=driverFor({...connection,address:hermes.address,managementAddress:hermes.managementAddress});
  return {...fake.engineFor(connection),readAgent:driver.readAgent,provideAgent:driver.provideAgent,removeAgent:driver.removeAgent};
 };
 return {hermes,install:{address:hermes.address,key:'test-only-key'},fake,engineFor};
}
type MadeAgent={id:string,instructions:string,profile:string,derived:boolean,tools_confirmed:boolean|null,tools_pending:boolean|null};
const madeBy=(conversation:string,lead:string,call='call-0'):MadeAgent[]=>JSON.parse(query(`select a.id,a.instructions,a.profile,
 a.id=public.lead_agent_id(m.conversation_id,m.run_id,'${call}') as derived,p.tools_confirmed,p.tools_pending
 from public.lead_made_agents m join public.hermes_agents a on a.id=m.agent_id
 left join public.agent_profiles p on p.agent_id=a.id where m.conversation_id='${conversation}' order by m.created_at`));
const managed=(hermes:Awaited<ReturnType<typeof fakeHermes>>)=>hermes.settings.managementRequests.map(request=>`${request.method} ${request.path?.split('?')[0]}`);

test('integration: Lead\'s call makes the Agent one profile of its own, also when two closers race, and its Runs start there without its instructions',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const {hermes,install,fake,engineFor}=await ownProfiles(profile);
 try {
  fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template:'writer'}}];
  const {service,person}=await clients();
  const conversation=randomUUID();
  expect(await withEngineContract(engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want the ready-made writer'}))).toEqual({conversation});
  // A reader and the worker close the run at once: both may carry the call out, and one Agent is made.
  const close=()=>withEngineContract(engineFor,()=>closeOpenRuns(service,{conversation}));
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  const made=madeBy(conversation,lead);
  expect(made).toHaveLength(1);
  const [agent]=made;
  const own=`ag-${agent.id.replaceAll('-','')}`;
  expect(agent).toEqual({id:agent.id,instructions:instructionsOf('writer').replaceAll('{company}','RS Learning'),profile:own,derived:true,tools_confirmed:true,tools_pending:false});
  expect([...hermes.settings.profiles.keys()].filter(name=>name.startsWith('ag-'))).toEqual([own]);
  const kept=hermes.settings.profiles.get(own)!;
  expect([kept.soul,kept.key,kept.config]).toEqual([agent.instructions,'test-only-key',toolConfig({profile:own})]);
  const asked=managed(hermes);
  for(const step of ['POST /api/profiles',`PUT /api/env`,`PUT /api/config`,'GET /api/model/options']) expect([1,2]).toContain(asked.filter(request=>request===step).length);
  expect(asked.filter(request=>request.startsWith('DELETE'))).toEqual([]);
  expect(JSON.parse(query(`select actor_id,action,details->>'agent_name' as name from public.company_log where company_id='${company}' and agent_id='${agent.id}'`)))
   .toEqual([{actor_id:omar,action:'agent_requested',name:roleTemplates.writer.name}]);

  // The same run and call carried out again (a closer stopped before the close) answer the Agent without the Engine.
  const before=hermes.settings.managementRequests.length;
  expect(await runToolCall({db:service,engine:engineFor({address:hermes.address,profile,key:'test-only-key'}),profile,conversation,run:fake.runs[0].id},
   {id:'call-0',name:'create_agent',arguments:{template:'writer'}})).toEqual({state:'created',agent:agent.id});
  expect(managed(hermes).slice(before)).toEqual([]);
  expect(madeBy(conversation,lead)).toHaveLength(1);

  // The worker gives the Agent's own profile its Company's shared folder before its first Run (#122).
  await keepSharedSkills(service,{});
  const theirs=randomUUID();
  expect(await withEngineContract(engineFor,()=>sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:agent.id,message:'Write about the tax diploma'}))).toEqual({conversation:theirs});
  expect(fake.connections.at(-1)).toMatchObject({profile:own,key:'test-only-key'});
  expect(fake.runs.at(-1)).toMatchObject({conversation:theirs});
  expect(fake.runs.at(-1)!.instructions,'no instructions are sent').toBeNull();
  expect(await withEngineContract(engineFor,()=>closeOpenRuns(service,{conversation:theirs}))).toBe(1);
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
  const {hermes,install,fake,engineFor}=await ownProfiles(profile); set(hermes);
  try {
   fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template:'writer'}}];
   const conversation=randomUUID();
   expect(await withEngineContract(engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'I want the ready-made writer'}))).toEqual({conversation});
   expect(await withEngineContract(engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
   const [agent]=madeBy(conversation,lead);
   expect(agent,why).toMatchObject({profile,derived:true,tools_confirmed:null});
   expect(managed(hermes).filter(request=>request.startsWith('DELETE')),why).toEqual([]);
   const theirs=randomUUID();
   expect(await withEngineContract(engineFor,()=>sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:agent.id,message:'Write about the tax diploma'}))).toEqual({conversation:theirs});
   expect(fake.runs.at(-1)!.instructions,why).toBe(agent.instructions);
   expect(await withEngineContract(engineFor,()=>closeOpenRuns(service,{conversation:theirs}))).toBe(1);
   expect(agentRows(theirs),why).toEqual([{body:'Reply to: Write about the tax diploma'}]);
  } finally { await hermes.close(); }
 }
});

// #121: an Agent Lead made on its own profile's fallback runs on the Company's profile, as every Agent did before #120.
// The worker moves it to the profile the Engine kept under its reserved name once that profile can answer; the
// Conversation keeps its record, and its next Run starts on the Agent's own profile with that record as its history.
test('integration: an Agent moved to its own profile keeps its Conversation, and its next Run carries the record as history and is answered',async()=>{
 test.setTimeout(120000);
 const {profile,lead}=bundledLead();
 const {hermes,install,fake,engineFor}=await ownProfiles(profile);
 try {
  hermes.settings.seedModel=null;
  fake.settings.toolCalls=()=>[{id:'call-0',name:'create_agent',arguments:{template:'writer'}}];
  const {service,person}=await clients();
  const asked=randomUUID();
  expect(await withEngineContract(engineFor,()=>sendMessage(person,service,{person:omar,company,conversation:asked,sendKey:randomUUID(),agent:lead,message:'I want the ready-made writer'}))).toEqual({conversation:asked});
  expect(await withEngineContract(engineFor,()=>closeOpenRuns(service,{conversation:asked}))).toBe(1);
  const [agent]=madeBy(asked,lead);
  expect(agent).toMatchObject({profile,tools_confirmed:null});
  const own=`ag-${agent.id.replaceAll('-','')}`;
  const theirs=randomUUID();
  query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${theirs}','${company}','${omar}','${agent.id}','Writer')`);
  query(`insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${theirs}','person','${omar}','Omar','Write about the tax diploma','${randomUUID()}','before-move',now()-interval '10 minutes'),
   ('${company}','${theirs}','agent',null,'Writer','The tax diploma post.',null,'before-move',now()-interval '10 minutes')`);
  const record=()=>JSON.parse(query(`select author,body from public.conversation_messages where conversation_id='${theirs}' order by id`));
  const before=record();

  // Its own profile gets a model, standing in for the sign-in that lets it answer.
  Object.assign(hermes.settings.profiles.get(own)!,{provider:'openai-codex',model:'gpt-5.5'});
  // The worker makes the Company's shared space (#122), makes the Agent's own profile, which does not take the Agent
  // before it reads the space's folder, gives it that folder, and then moves the Agent.
  await keepSharedSkills(service,{});
  expect((await moveAgentProfiles(service)).moved).toBe(0);
  await keepSharedSkills(service,{});
  expect((await moveAgentProfiles(service)).moved).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(query(`select a.profile from public.hermes_agents a where a.id='${agent.id}'`))).toEqual([{profile:own}]);
  expect(JSON.parse(query(`select a.profile from public.hermes_agents a where a.id='${lead}'`))).toEqual([{profile}]);
  expect(record()).toEqual(before);
  expect(JSON.parse(query(`select action from public.company_log where agent_id='${agent.id}' and action='agent_own_space'`))).toEqual([{action:'agent_own_space'}]);

  const onEngine=(connection:{address:string,profile:string,key:string})=>driverFor({...connection,address:hermes.address,managementAddress:hermes.managementAddress});
  expect(await withEngineContract(onEngine,()=>sendMessage(person,service,{person:omar,company,conversation:theirs,sendKey:randomUUID(),agent:agent.id,message:'One more, shorter'}))).toEqual({conversation:theirs});
  expect(hermes.settings.requests.filter(request=>request.method==='POST').at(-1)?.path).toBe(`/p/${own}/v1/runs`);
  expect(hermes.settings.runs.at(-1)!.history).toEqual(before.map(({author,body}:{author:string,body:string})=>({role:author==='agent'?'assistant':'user',content:body})));
  expect(await withEngineContract(onEngine,()=>closeOpenRuns(service,{conversation:theirs}))).toBe(1);
  expect(record()).toEqual([...before,{author:'person',body:'One more, shorter'},{author:'agent',body:'Reply to: One more, shorter'}]);
 } finally { await hermes.close(); }
});

// #144: the first Run of a new chat with an Agent other than the main one puts its Card on the board, with its log row;
// the chat says so once, also after a reload and a second Run, and its corner pill names the Card's column, follows it
// when it moves, shows the column alone on a phone, in Arabic too, and opens the board on the Card.
test('a new chat with an Agent puts its Card on the board, and the chat\'s line and pill follow it there',async({page})=>{
 test.setTimeout(180000);
 const fake=fakeEngine(); const {service,person}=await clients(); const {agent,detach}=attachAgent();
 const language=(value:'en'|'ar')=>query(`update public.people set language='${value}' where id='${omar}'`);
 try {
  const conversation=randomUUID();
  const send=async(message:string)=>{
   expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message}))).toEqual({conversation});
   expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
  };
  const cards=()=>JSON.parse(query(`select c.id,c.title,c.agent_id,s.board_column from public.work_cards c join public.work_stages s on s.id=c.stage_id where c.conversation_id='${conversation}'`));
  await send('Plan the launch week\nThree posts and one reel');
  const [card]=cards();
  expect(cards()).toEqual([{id:card.id,title:'Plan the launch week',agent_id:agent,board_column:'progress'}]);
  expect(JSON.parse(query(`select action,actor_kind from public.company_log where card_id=${card.id}`))).toEqual([{action:'card_created',actor_kind:'system'}]);

  language('en');
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
  const kinds=()=>page.locator('.turns > li').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-author')||row.getAttribute('data-kind')));
  const line=page.locator('.turns > li[data-kind="boarded"]'), pill=page.locator('.chat__corner .corner-pill');
  // #297: the chat shows one boarded line, in the transcript the reader sees. A page that has just reloaded can hold a
  // second, hidden copy of the transcript in the block it streamed in until React reveals it (#172); the case asks for
  // the drawn page, and there is no hidden copy left once it is there.
  const boardedOnce=()=>expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('li[data-kind="boarded"]')].map(node=>({
    streamed:node.closest('div[id^="S:"]')?.id??null,hidden:!!node.closest('[hidden]'),shown:node.getBoundingClientRect().height>0,
  })))).toEqual([{streamed:null,hidden:false,shown:true}]);
  await boardedOnce();
  await expect(line).toHaveText('This card was added to the board under “In progress”');
  expect(await kinds()).toEqual(['person','agent','boarded']);
  await expect(pill).toHaveAccessibleName('On the board: In progress');
  await expect(pill.locator('.corner-pill__lbl')).toHaveText('On the board:');
  await send('Add a teaser');
  expect(cards()).toHaveLength(1);
  await page.reload();
  await boardedOnce();
  await expect(page.locator('.msg[data-author=agent]')).toHaveCount(2);
  expect(await kinds()).toEqual(['person','agent','boarded','person','agent']);

  query(`select public.move_work_card_to_column('${company}',${card.id},'planned')`);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(pill).toHaveAccessibleName('On the board: Planned');
  await page.setViewportSize({width:390,height:900});
  await expect(pill.locator('.corner-pill__lbl')).toBeHidden();
  await expect(pill.locator('.corner-pill__col')).toHaveText('Planned');
  language('ar');
  for(const width of [390,1440]) {
   await page.setViewportSize({width,height:900});
   await page.reload();
   await boardedOnce();
   await expect(pill).toHaveAccessibleName('على اللوحة: متخطط');
   await expect(pill.locator('.corner-pill__lbl')).toBeVisible({visible:width===1440});
   await expect(line).toHaveText('البطاقة دي اتضافت للوحة في «شغالين عليه»');
  }

  language('en');
  await page.reload();
  await boardedOnce();
  await pill.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
  const shown=page.locator(`#board-cols .kcard[data-card-id="${card.id}"]`);
  await expect(shown.locator('a')).toBeFocused();
  await expect(page.getByRole('group',{name:'Filter by agent'}).getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(shown.locator('.kcard__foot')).toHaveText('Faye· Marketing');
 } finally { language('en'); detach(); }
});

// #147: a Card follows a handover. A chat with Lead puts no Card on the board by itself (#144): when Lead hands the job
// to another Agent the Card appears for that Agent under In progress, titled from the chat's first message and tied to
// it, once, and the chat says so under the handover's answer. A Chat that already has a Card gives it the Agent handed
// the work, so its foot shows that Agent's job, and the handover's log row is on the Card for another Contributor.
test('a Card follows Lead\'s handover: the Agent handed the work owns it and a second handover moves it, with the chat\'s line and the Card\'s Log',async({page,browser})=>{
 test.setTimeout(240000);
 const fake=await laneHermes();
 const {lead}=bundledLead();
 const {service,person}=await clients();
 const target=attachTarget('Salma','Runs the March launch.');
 const next=attachTarget('Tarek','Writes the launch email.');
 const language=(value:'en'|'ar')=>query(`update public.people set language='${value}' where id in ('${omar}','20000000-0000-0000-0000-000000000003')`);
 const opened:{close:()=>Promise<void>}[]=[];
 const member=async(email:string)=>{ const context=await browser.newContext(); opened.push(context); const other=await context.newPage(); await signIn(other,email,'/c/rs-learning/work/board'); return other; };
 const conversation=randomUUID();
 const handoff=(name:string,goal:string)=>`On it: I handed the job to ${name}.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'hand_to_agent',arguments:{agent:name,goal,context:'EGP 9,000 for 30 days.'}})}\n\`\`\``;
 fake.settings.reply=input=>input.startsWith('Lead in the team is handing you a job')?'Three ad sets, 30 days, EGP 9,000.'
  :input.startsWith('You handed this job to')?'Ads planned the March intake: three ad sets, 30 days, EGP 9,000.'
  :input.includes('Now the launch email')?handoff('Tarek','Write the March launch email')
  :handoff('Salma','Plan the Meta ads for the March intake');
 // The handover's two Runs move here as well as in the worker (both reach the lane's one Hermes, and a leg is started
 // once), so the test never waits on the worker's next pass.
 const drive=async()=>{ await closeOpenRuns(service,{conversation}); await driveHandovers(service,{conversation}); };
 type Handover={id:number,state:string,to_agent:string,goal:string,target_outcome:string|null};
 const handovers=():Handover[]=>JSON.parse(query(`select id,state,to_agent,goal,target_outcome from public.agent_handovers where conversation_id='${conversation}' order by id`));
 const settle=async()=>expect.poll(async()=>{ await drive(); const rows=handovers(); return rows.length>0&&rows.every(row=>row.state==='done'||row.state==='failed'); },{timeout:60000}).toBe(true);
 const cards=()=>JSON.parse(query(`select c.id,c.title,c.agent_id,s.board_column from public.work_cards c join public.work_stages s on s.id=c.stage_id where c.conversation_id='${conversation}'`));
 const rows=(card:number):{actor_id:string,actor_kind:string,agent_id:string,action:string,details:{agent_name:string,to_name:string,goal:string}}[]=>JSON.parse(query(`select actor_id,actor_kind,agent_id,action,details from public.company_log where card_id=${card} and action='agent_handed_to' order by id`));
 try {
  language('en');
  await page.setViewportSize({width:1440,height:900});
  // One message to Lead, which hands the Meta ads to Salma.
  expect(await sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'Plan the March intake'})).toEqual({conversation});
  await settle();
  expect(handovers().map(row=>({state:row.state,to_agent:row.to_agent,target_outcome:row.target_outcome})))
   .toEqual([{state:'done',to_agent:target.agent,target_outcome:'completed'}]);
  const [card]=cards();
  expect(cards()).toEqual([{id:card.id,title:'Plan the March intake',agent_id:target.agent,board_column:'progress'}]);
  expect(rows(card.id)).toEqual([{actor_id:lead,actor_kind:'agent',agent_id:target.agent,action:'agent_handed_to',
   details:{agent_name:'Lead',to_name:'Salma',goal:'Plan the Meta ads for the March intake'}}]);
  // Closing the Runs again adds no Card and no row.
  expect(await closeOpenRuns(service,{conversation})).toBe(0);
  expect(cards()).toHaveLength(1);

  // The chat says so under the handover's answer, and its pill opens the Card.
  await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
  const kinds=()=>page.locator('.turns > li').evaluateAll(turns=>turns.map(turn=>turn.getAttribute('data-author')||turn.getAttribute('data-kind')));
  const line=page.locator('.turns > li[data-kind="boarded"]'), pill=page.locator('.chat__corner .corner-pill');
  // #475: the row names both Agents, Salma's answer follows under its own name "to Lead", then Lead's own reply.
  expect(await kinds()).toEqual(['person','agent','agent','agent','boarded']);
  await expect(page.locator('.turns [data-handover] .handed__t')).toHaveText('Lead asked Salma');
  const answer=page.locator('.turns > li[data-kind="handed"]');
  await expect(answer.locator('.sender bdi').first()).toHaveText('Salma');
  await expect(answer.locator('.sender__to')).toHaveText('to Lead');
  await expect(answer.locator('.bubble')).toHaveText('Three ad sets, 30 days, EGP 9,000.');
  await expect(line).toHaveText('This card was added to the board under “In progress”');
  await expect(pill).toHaveAccessibleName('On the board: In progress');

  // Another Contributor reads the handover's row on the Card's Log.
  const reviewer=await member('reviewer@example.com');
  const onCard=(on:typeof page)=>on.locator(`#board-cols .kcard[data-card-id="${card.id}"]`);
  await reviewer.goto(`/c/rs-learning/work/board?card=${card.id}`);
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('handed to Salma');
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('Plan the Meta ads for the March intake');
  await reviewer.goto('/c/rs-learning/work/board');
  await expect(onCard(reviewer).locator('.kcard__agent')).toContainText('Salma');
  await expect(onCard(reviewer).locator('.kcard__job')).toContainText('Runs the March launch.');

  // A second handover in the same chat gives the same Card the other Agent, and its own row on the Card.
  language('en');
  expect(await sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent:lead,message:'Now the launch email'})).toEqual({conversation});
  await expect.poll(async()=>{ await drive(); return handovers().length; },{timeout:60000}).toBe(2);
  await settle();
  expect(handovers().map(row=>({state:row.state,to_agent:row.to_agent}))).toEqual([{state:'done',to_agent:target.agent},{state:'done',to_agent:next.agent}]);
  expect(cards()).toEqual([{id:card.id,title:'Plan the March intake',agent_id:next.agent,board_column:'progress'}]);
  expect(rows(card.id).map(row=>row.details.to_name)).toEqual(['Salma','Tarek']);
  await page.reload();
  await expect(page.locator('.turns > li[data-kind="boarded"]')).toHaveCount(1);
  await reviewer.goto(`/c/rs-learning/work/board?card=${card.id}`);
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('handed to Tarek');
  await expect(reviewer.locator('.sheet .lg-wrap')).toContainText('Write the March launch email');
  await reviewer.goto('/c/rs-learning/work/board');
  await expect(onCard(reviewer).locator('.kcard__agent')).toContainText('Tarek');
  await expect(onCard(reviewer).locator('.kcard__job')).toContainText('Writes the launch email.');
 } finally {
  language('en'); for(const context of opened) await context.close();
  target.detach(); next.detach(); await fake.close();
 }
});

// #475 (decision 0057): any Agent hands over, not only Lead, and to an Agent the person cannot see. A Contributor talks
// to Salma; Salma's Run is offered hand_to_agent naming the Company's other Agents with their jobs, asks Tarek (hidden
// from the Contributor), Tarek works on its own profile, and Salma replies. The Contributor's chat draws "Salma asked
// Tarek", Tarek's answer under its own name "to Salma", then Salma's reply, though Tarek stays hidden from them.
test('any Agent hands a job to another Agent of its Company, one hidden from the person included, and the chat draws both',async({page})=>{
 test.setTimeout(240000);
 const fake=await laneHermes();
 const salma=attachTarget('Salma','Writes the ad copy.');
 const tarek=attachTarget('Tarek','Reads the campaign numbers.');
 const reviewer='20000000-0000-0000-0000-000000000003';
 query(`delete from public.member_agent_access where person_id='${reviewer}' and agent_id='${tarek.agent}'`);
 const conversation=randomUUID();
 const ask=`Ask Tarek.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'hand_to_agent',arguments:{agent:'Tarek',goal:'Last campaign\'s leads and cost per lead',context:'For the March copy.'}})}\n\`\`\``;
 fake.settings.reply=input=>input.startsWith('Salma in the team is handing you a job')?'1,240 leads at EGP 7.30 each.'
  :input.startsWith('You handed this job to Tarek')?'The copy leads with 1,240 leads at EGP 7.30 each.'
  :ask;
 const {service}=await clients();
 const {person}=await memberClient('reviewer@example.com');
 const drive=async()=>{ await closeOpenRuns(service,{conversation}); await driveHandovers(service,{conversation}); };
 const handed=()=>JSON.parse(query(`select from_agent,to_agent,state,target_outcome from public.agent_handovers where conversation_id='${conversation}'`));
 try {
  expect(await sendMessage(person,service,{person:reviewer,company,conversation,sendKey:randomUUID(),agent:salma.agent,message:'Write the March ad copy'})).toEqual({conversation});
  // The tool Salma's Run was sent, as the Engine reads it in the Run's instructions (the Engine driver (lib/engine/)), names the
  // Company's other Agents, Tarek with its job among them, never Salma.
  const sent=fake.settings.runs.find(run=>JSON.stringify(run.input).includes('Write the March ad copy'));
  const offered=(sent?.instructions??'').split('\n- hand_to_agent: ')[1]??'';
  const schema=offered.slice(offered.indexOf('Its arguments, as JSON Schema: ')+'Its arguments, as JSON Schema: '.length).split('\n')[0];
  const enumOf=JSON.parse(schema).properties.agent.enum as string[];
  expect(enumOf).toContain('Tarek');
  expect(enumOf).not.toContain('Salma');
  expect(sent?.instructions).toContain('- Tarek: Reads the campaign numbers.');
  await expect.poll(async()=>{ await drive(); return handed()[0]?.state; },{timeout:60000}).toBe('done');
  expect(handed()).toEqual([{from_agent:salma.agent,to_agent:tarek.agent,state:'done',target_outcome:'completed'}]);
  // The tool's block is the Engine's, never the chat's: Salma's message keeps its words alone.
  expect(agentRows(conversation)).toEqual([{body:'Ask Tarek.'},{body:'The copy leads with 1,240 leads at EGP 7.30 each.'}]);

  await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${conversation}`);
  const kinds=()=>page.locator('.turns > li').evaluateAll(turns=>turns.map(turn=>turn.getAttribute('data-author')+(turn.getAttribute('data-kind')?`:${turn.getAttribute('data-kind')}`:'')));
  // Salma's chat put its own Card on the board with its first reply (#144); the handover leaves that Card Salma's.
  await expect.poll(kinds).toEqual(['person','agent','null:boarded','agent:handed','agent']);
  expect(JSON.parse(query(`select agent_id from public.work_cards where conversation_id='${conversation}'`))).toEqual([{agent_id:salma.agent}]);
  // The handover, kept before that first reply made the Card, is on the Card's log once.
  expect(JSON.parse(query(`select l.actor_id,l.agent_id from public.company_log l join public.work_cards w on w.id=l.card_id where w.conversation_id='${conversation}' and l.action='agent_handed_to'`))).toEqual([{actor_id:salma.agent,agent_id:tarek.agent}]);
  await expect(page.locator('.turns [data-handover] .handed__t')).toHaveText('Salma asked Tarek');
  await expect(page.locator('.turns [data-handover] .handed__d')).toHaveText('Last campaign\'s leads and cost per lead');
  const answer=page.locator('.turns > li[data-kind="handed"]');
  await expect(answer.locator('.sender bdi').first()).toHaveText('Tarek');
  await expect(answer.locator('.sender__to')).toHaveText('to Salma');
  await expect(answer.locator('.bubble')).toHaveText('1,240 leads at EGP 7.30 each.');
  await expect(page.locator('.turns > li').last().locator('.bubble')).toHaveText('The copy leads with 1,240 leads at EGP 7.30 each.');
 } finally {
  salma.detach(); tarek.detach(); await fake.close();
 }
});
