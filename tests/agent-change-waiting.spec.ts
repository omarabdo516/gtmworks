import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #178, on the app: while a change an Agent proposed for its own settings (#19) waits for the Owner, Settings says so.
// The Agent's page shows the note under its tabs, naming who proposed what, with "Open the proposal"; the Owner's
// Agents list ends that Agent's row with "Proposal waiting" and the "Agents" entry carries the number of waiting
// proposals. A Manager whose chat the proposal came from reads the note waiting for the Owner by name, and no mark or
// number; a Contributor who sees the Agent but not that chat gets nothing. Each answer removes its note. The proposals
// are kept by calling agent_propose_change directly, as the run's close does (tests/agent-changes.test.mjs proves the
// tool's call), and answered from "Waiting on you" through the fake Engine, as tests/agent-changes.spec.ts does.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const [omar,manager,contributor]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003'];
const co=`co-${hex}`; const space=`cs-${hex}`;
const lead='e9300000-0000-0000-0000-000000000001'; const writer='e9300000-0000-0000-0000-000000000002'; const analyst='e9300000-0000-0000-0000-000000000003';
const profileOf=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
const [managerTalk,ownerTalk]=[randomUUID(),randomUUID()];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 const profile=(soul='')=>({soul,provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 for(const name of [space,co]) fake.settings.profiles.set(name,profile());
 fake.settings.profiles.set(profileOf(writer),profile('You write long posts.'));
 fake.settings.profiles.set(profileOf(analyst),profile('You read the numbers.'));
 query(`do $$ begin
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${writer}','${company}',true),('${analyst}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','e9300000-0000-0000-0000-000000000011','Lead','General',true,'${co}'),
   ('${writer}','${company}','e9300000-0000-0000-0000-000000000012','Writer','Writing',false,'${profileOf(writer)}'),
   ('${analyst}','${company}','e9300000-0000-0000-0000-000000000013','Analyst','Numbers',false,'${profileOf(analyst)}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  -- The Manager and the Contributor both see Writer; only the Manager's chat holds its proposal.
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${writer}'),('${company}','${contributor}','${writer}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
   ('${managerTalk}','${company}','${manager}','${writer}','Writer'),('${ownerTalk}','${company}','${omar}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${managerTalk}','person','${manager}',null,'مدير','The weekly report is late again',gen_random_uuid(),'pw-1',now()-interval '10 minutes'),
   ('${company}','${ownerTalk}','person','${omar}',null,'عمر','Analyst rambles',gen_random_uuid(),'pw-2',now()-interval '8 minutes');
 end $$;`);
 query(`select public.agent_propose_change('${managerTalk}','pw-1','call-0',null,'model',null,'"anthropic/claude-sonnet-5-5"','The weekly report keeps running late.')`);
 query(`select public.agent_propose_change('${ownerTalk}','pw-2','call-0','Analyst','instructions',null,'"You answer in three lines."','Its answers run long.')`);
 // The Owner's chat goes on long after the proposal, so its card is far above the newest message.
 query(`insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
  select '${company}','${ownerTalk}',x.author,case when x.author='person' then '${omar}'::uuid end,case when x.author='agent' then '${lead}'::uuid end,
   case when x.author='person' then 'عمر' else 'Lead' end,repeat('A later line about the weekly report. ',12),case when x.author='person' then gen_random_uuid() end,
   'pw-later-'||n,now()+make_interval(secs=>n*2+case when x.author='agent' then 1 else 0 end)
  from generate_series(1,15) n cross join (values ('person'),('agent')) x(author)`);
});
test.afterAll(async()=>{ await fake?.close(); });

const settings=(agent?:string)=>`/c/rs-learning/settings${agent?`?agent=${agent}`:'?section=agents'}`;
const proposalId=(agent:string)=>JSON.parse(query(`select id from public.agent_change_proposals where agent_id='${agent}'`))[0].id as number;
const note=(page:Page)=>page.locator('.sov-pend');
const agentsEntry=(page:Page)=>page.getByRole('navigation',{name:'Settings sections'}).locator('#sov-nav-agents');
const row=(page:Page,agent:string)=>page.locator(`#sov-ag-${agent}`);

test('the Owner sees each waiting proposal on its Agent\'s row, its number on Agents and its note, and opens each where it can be answered',async({page})=>{
 await signIn(page,'omar@example.com',settings());
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents 2 waiting for your OK');
 for(const agent of [writer,analyst]) await expect(row(page,agent).locator('.panel-row__meta--wait')).toHaveText('Proposal waiting');
 await expect(row(page,lead).locator('.panel-row__meta--wait')).toHaveCount(0);
 await expect(row(page,lead).locator('.panel-row__meta')).toHaveText(/\S/);
 // The number is on every section, not only Agents.
 await page.goto('/c/rs-learning/settings?section=account');
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents 2 waiting for your OK');

 // An Agent with no proposal shows no note.
 await page.goto(settings(lead));
 await expect(page.getByRole('tablist',{name:'Lead'})).toBeVisible();
 await expect(note(page)).toHaveCount(0);

 // Writer's proposal came from the Manager's chat, which only the Manager may open: it opens in Waiting on you.
 await page.goto(settings(writer));
 await expect(note(page).locator(':scope > span')).toHaveText('Writer proposed New model: anthropic/claude-sonnet-5-5 · waiting for your OK. Nothing changes here before that.');
 await expect(page.locator('#sov-pend + #sov-agent-panel')).toHaveCount(1);
 await page.getByRole('tab',{name:'Memory'}).click();
 await expect(page).toHaveURL(/tab=memory/);
 await expect(note(page)).toBeVisible();
 await note(page).getByRole('link',{name:'Open the proposal'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/approvals#change-${proposalId(writer)}$`));
 await expect(page.locator('.sov')).toHaveCount(0);
 await expect(page.locator(`#change-${proposalId(writer)}`)).toContainText('New model: anthropic/claude-sonnet-5-5');

 // Analyst's was proposed by Lead in the Owner's own chat: it opens there, on its card.
 await page.goto(settings(analyst));
 await expect(note(page).locator(':scope > span')).toHaveText('Lead proposed New core instructions · waiting for your OK. Nothing changes here before that.');
 // The chat lands on the card, then its address is the chat's own again, so a reload opens on the newest message.
 await expect(note(page).getByRole('link',{name:'Open the proposal'})).toHaveAttribute('href',`/c/rs-learning/conversations/${ownerTalk}#change-${proposalId(analyst)}`);
 await note(page).getByRole('link',{name:'Open the proposal'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/conversations/${ownerTalk}$`));
 await expect(page.locator('.sov')).toHaveCount(0);
 // The card is brought into view and focused, not the newest message.
 const card=page.getByRole('group',{name:'Proposed change: Analyst'});
 await expect(card).toBeInViewport();
 await expect(card).toBeFocused();
});

test('the Manager whose chat it came from reads the note waiting for the Owner, with the Agent\'s state on its row and no number',async({page})=>{
 await signIn(page,'manager@example.com',settings());
 await expect(row(page,writer)).toBeVisible();
 await expect(row(page,writer).locator('.panel-row__meta--wait')).toHaveCount(0);
 await expect(row(page,writer).locator('.panel-row__meta')).toHaveText(/\S/);
 await expect(row(page,analyst)).toHaveCount(0);
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents');
 await page.goto(settings(writer));
 await expect(note(page).locator(':scope > span')).toHaveText('Writer proposed New model: anthropic/claude-sonnet-5-5 · waiting for عمر. Nothing changes here before that.');
 await expect(note(page).getByRole('link',{name:'Open the proposal'})).toHaveAttribute('href',`/c/rs-learning/conversations/${managerTalk}#change-${proposalId(writer)}`);
 await note(page).getByRole('link',{name:'Open the proposal'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/conversations/${managerTalk}$`));
 await expect(page.getByRole('group',{name:'Proposed change: Writer'})).toBeVisible();
});

test('a Contributor who sees the Agent but may not open the chat gets no note, no mark and no number',async({page})=>{
 await signIn(page,'reviewer@example.com',settings());
 await expect(row(page,writer)).toBeVisible();
 await expect(page.locator('.panel-row__meta--wait')).toHaveCount(0);
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents');
 await page.goto(settings(writer));
 await expect(page.getByRole('tablist',{name:'Writer'})).toBeVisible();
 await expect(note(page)).toHaveCount(0);
});

test('each answer takes its note, mark and number away',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 await page.locator('.chg-card').filter({hasText:'New model: anthropic/claude-sonnet-5-5'}).getByRole('button',{name:'Approve'}).click();
 await expect(page.locator('.chg-card')).toHaveCount(1);
 await page.goto(settings(writer));
 await expect(page.getByRole('tablist',{name:'Writer'})).toBeVisible();
 await expect(note(page)).toHaveCount(0);
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents 1 waiting for your OK');

 await page.goto('/c/rs-learning/approvals');
 const soul=page.locator('.chg-card').filter({hasText:'New core instructions'});
 await soul.getByRole('button',{name:'Decline'}).click();
 await soul.getByRole('textbox',{name:'Reason for declining'}).fill('Keep it as it is.');
 await soul.getByRole('button',{name:'Decline'}).click();
 await expect(page.locator('.chg-card')).toHaveCount(0);
 await page.goto(settings());
 await expect(agentsEntry(page)).toHaveAccessibleName('Agents');
 await expect(page.locator('.panel-row__meta--wait')).toHaveCount(0);
 await page.goto(settings(analyst));
 await expect(page.getByRole('tablist',{name:'Analyst'})).toBeVisible();
 await expect(note(page)).toHaveCount(0);
 expect(JSON.parse(query(`select state from public.agent_change_proposals where company_id='${company}' order by id`))).toEqual([{state:'approved'},{state:'declined'}]);

 // The Manager's note is gone too.
 await page.context().clearCookies();
 await signIn(page,'manager@example.com',settings(writer));
 await expect(page.getByRole('tablist',{name:'Writer'})).toBeVisible();
 await expect(note(page)).toHaveCount(0);
});
