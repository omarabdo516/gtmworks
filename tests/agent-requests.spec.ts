import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { openNavigation, signIn } from './sign-in';

// The requests are kept by calling lead_request_agent directly; the engine side is proven in
// tests/engine-conversation.spec.ts.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const [omar,manager,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003'];
const profile=`co-${company.replaceAll('-','')}`;
const [lead,managerTalk,reviewerTalk]=[randomUUID(),randomUUID(),randomUUID()];
const whatsapp='I want someone to follow up our WhatsApp leads before they go cold';
const blog='I want someone to write our blog every week';
const reason='Ads follows WhatsApp leads now, let’s try that for a month first.';
// The driver reaches the management listener on port 9119 beside the Hermes address; this file's fake takes a loopback
// address of its own, so it never shares the port with another file's.
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 // A retry, or a repeat of this serial file, starts it again from the seed, so its rows are inserted once.
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  // Saved through the Owner's route so its key is encrypted.
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${managerTalk}','${company}','${manager}','${lead}','Lead'),('${reviewerTalk}','${company}','${reviewer}','${lead}','Lead');
   insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
    ('${company}','${managerTalk}','person','${manager}',null,'مدير','${whatsapp}',gen_random_uuid(),'ask-1',now()-interval '10 minutes'),
    ('${company}','${managerTalk}','agent',null,'${lead}','Lead','I prepared your request and sent it to the Owner. No agent exists yet; their answer will show here.',null,'ask-1',now()-interval '9 minutes'),
    ('${company}','${reviewerTalk}','person','${reviewer}',null,'مراجع','${blog}',gen_random_uuid(),'ask-2',now()-interval '8 minutes'),
    ('${company}','${reviewerTalk}','agent',null,'${lead}','Lead','I prepared your request and sent it to the Owner. No agent exists yet; their answer will show here.',null,'ask-2',now()-interval '7 minutes');
  end $$;`);
  query(`select public.lead_request_agent('${managerTalk}','ask-1','call-0','WhatsApp Leads','Follows up the WhatsApp leads.',array['WhatsApp Business'])`);
  query(`select public.lead_request_agent('${reviewerTalk}','ask-2','call-0','Blog Writer','Writes the blog every week.',array['WordPress'])`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const requestCard=(page:Page,name:string)=>page.getByRole('group',{name:`Agent request: ${name}`});
const requests=()=>JSON.parse(query(`select agent_name,state,answered_by,reason from public.lead_agent_requests order by id`));

test('a Member\'s request waits in the Owner\'s "Waiting on you" only, and in their own Conversation as not made yet',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 const asked=requestCard(page,'WhatsApp Leads');
 await expect(asked.locator('.badge--req')).toHaveText('Agent request from مدير');
 for(const text of ['Follows up the WhatsApp leads.','WhatsApp Business','Publish anything',`«${whatsapp}»`,'مدير and the Owner']) await expect(asked).toContainText(text);
 await expect(asked.getByRole('button')).toHaveText(['No','Make it']);
 await expect(requestCard(page,'Blog Writer').locator('.badge--req')).toHaveText('Agent request from مراجع');

 for(const email of ['manager@example.com','reviewer@example.com']) {
  const context=await browser.newContext(); const other=await context.newPage();
  try {
   await signIn(other,email,'/c/rs-learning/approvals');
   await expect(other.locator('.approvals')).toBeVisible();
   await expect(other.locator('.ac-card')).toHaveCount(0);
  } finally { await context.close(); }
 }

 await page.context().clearCookies();
 await signIn(page,'manager@example.com',`/c/rs-learning/conversations/${managerTalk}`);
 const mine=requestCard(page,'WhatsApp Leads');
 await expect(mine.locator('.badge--req')).toHaveText('Request · not made yet');
 await expect(mine.locator('.card__outcome')).toHaveText('Not made yet. When عمر says yes it shows in your agents, and I’ll tell you here.');
 await expect(mine.getByRole('button')).toHaveCount(0);
});

test('the Owner makes one, and says no to the other only with a reason',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 await requestCard(page,'WhatsApp Leads').getByRole('button',{name:'Make it'}).click();
 await expect(requestCard(page,'WhatsApp Leads')).toHaveCount(0);
 await expect(page.locator('.sidebar .agent-tile').filter({hasText:'WhatsApp Leads'})).toHaveCount(1);
 const [made]=JSON.parse(query(`select a.id,a.speciality,array_to_string(a.apps,'|') as apps,a.requested_by,a.profile,(select count(*)::int from public.member_agent_access m where m.agent_id=a.id and m.person_id='${manager}') as shown
  from public.lead_made_agents l join public.hermes_agents a on a.id=l.agent_id where l.conversation_id='${managerTalk}' and l.run_id='ask-1'`));
 expect(made).toMatchObject({speciality:'Follows up the WhatsApp leads.',apps:'WhatsApp Business',requested_by:manager,profile,shown:1});

 const refused=requestCard(page,'Blog Writer');
 await refused.getByRole('button',{name:'No'}).click();
 const why=refused.getByRole('textbox',{name:'Why not?'});
 await expect(why).toBeFocused();
 await expect(refused.locator('.set-hint')).toHaveText('The reason goes to مراجع in their chat with Lead.');
 await refused.getByRole('button',{name:'Send the no'}).click();
 await expect(refused.locator('.set-err')).toHaveText('Write the reason, so مراجع knows why.');
 await expect(why).toHaveAttribute('aria-invalid','true');
 await expect(why).toBeFocused();
 expect(requests()).toEqual([{agent_name:'WhatsApp Leads',state:'made',answered_by:omar,reason:null},{agent_name:'Blog Writer',state:'waiting',answered_by:null,reason:null}]);
 await refused.getByRole('button',{name:'Cancel'}).click();
 await expect(refused.getByRole('button')).toHaveText(['No','Make it']);
 await refused.getByRole('button',{name:'No'}).click();
 await refused.getByRole('textbox',{name:'Why not?'}).fill(reason);
 await refused.getByRole('button',{name:'Send the no'}).click();
 await expect(requestCard(page,'Blog Writer')).toHaveCount(0);
 expect(requests()).toEqual([{agent_name:'WhatsApp Leads',state:'made',answered_by:omar,reason:null},{agent_name:'Blog Writer',state:'declined',answered_by:omar,reason}]);
});

test('each Member reads the Owner\'s answer in their Conversation with Lead',async({page})=>{
 await signIn(page,'manager@example.com',`/c/rs-learning/conversations/${managerTalk}`);
 const made=page.getByRole('group',{name:'Agent request: WhatsApp Leads'});
 await expect(made.locator('.badge--made')).toHaveText('Made after عمر said yes');
 await expect(made.locator('.card__outcome span').first()).toContainText('now shows for مدير.');
 await expect(page.locator('[data-kind="decided"][data-decision="made"] .bubble')).toHaveText('عمر said yes to your request, and WhatsApp Leads was made. You’ll find it in your agents: open it and give it its first job.');
 await openNavigation(page);
 await expect(page.locator('.sidebar .agent-tile').filter({hasText:'WhatsApp Leads'})).toHaveCount(1);
 await made.getByRole('link',{name:'Open WhatsApp Leads'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\/[0-9a-f-]{36}$/);
 await expect(page.locator('.chat #btn-details')).toHaveAccessibleName(/WhatsApp Leads/);
 await page.context().clearCookies();

 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${reviewerTalk}`);
 const declined=page.getByRole('group',{name:'Agent request: Blog Writer'});
 await expect(declined.locator('.hcard__top .badge')).toHaveText('عمر said no');
 await expect(declined.locator('.card__outcome')).toContainText(`Reason: «${reason}»`);
 await expect(page.locator('[data-kind="decided"][data-decision="declined"] .bubble')).toHaveText(`عمر said no to Blog Writer for now. Reason: «${reason}» If you want to change the request and send it again, tell me here.`);
});

test('a Manager and a Contributor ask for an agent from the sidebar; a Viewer has no button and is told they cannot ask',async({page})=>{
 for(const email of ['manager@example.com','reviewer@example.com']) {
  await signIn(page,email,'/c/rs-learning/home');
  await openNavigation(page);
  const tile=page.locator('.sidebar .agent-tile--new');
  await expect(tile).toHaveText('Ask for an agent');
  await tile.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
  await expect(page.locator('.new-hint[role="note"] .new-hint__t')).toHaveText('Tell Lead what you need an agent for, and it prepares the request for عمر.');
  // #189: every Member who may write reaches the ready-made gallery from the hint line.
  await expect(page.locator('.new-hint__alt')).toHaveText('or pick a ready-made one');
  await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
  await page.context().clearCookies();
 }

 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await expect(page.locator('.sidebar .agent-grid .agent-tile').first()).toBeVisible();
 await expect(page.locator('.sidebar .agent-tile--new')).toHaveCount(0);
 await page.goto('/c/rs-learning/chat?new=agent');
 await expect(page.locator('.ro-line')).toHaveText('Your account is view-only: you read without writing or approving, and you can’t ask for a new agent.');
 await expect(page.locator('.new-hint')).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Message'})).toHaveCount(0);
 await page.goto('/c/rs-learning/settings?section=agents');
 const settings=page.getByRole('dialog',{name:'Settings'});
 await expect(settings.locator('.sov-ag').first()).toBeVisible();
 await expect(settings.getByText('Ask for an agent')).toHaveCount(0);
 await expect(settings.locator('a[href$="/chat?new=agent"]')).toHaveCount(0);
});

test('each step is in the Activity log: the requests, the yes and the no with its reason',async({page})=>{
 expect(JSON.parse(query(`select actor_id,action,details->>'asked_for' as asked_for,details->>'asked_by' as asked_by,details->>'reason' as reason,details->>'agent_name' as agent
  from public.company_log where company_id='${company}' and action in ('agent_request_sent','agent_requested','agent_request_made','agent_request_declined') order by id`))).toEqual([
  {actor_id:manager,action:'agent_request_sent',asked_for:'WhatsApp Leads',asked_by:null,reason:null,agent:'Lead'},
  {actor_id:reviewer,action:'agent_request_sent',asked_for:'Blog Writer',asked_by:null,reason:null,agent:'Lead'},
  {actor_id:manager,action:'agent_requested',asked_for:null,asked_by:null,reason:null,agent:'WhatsApp Leads'},
  {actor_id:omar,action:'agent_request_made',asked_for:null,asked_by:'مدير',reason:null,agent:'WhatsApp Leads'},
  {actor_id:omar,action:'agent_request_declined',asked_for:'Blog Writer',asked_by:'مراجع',reason,agent:'Lead'},
 ]);
 await signIn(page,'omar@example.com','/c/rs-learning/log');
 const log=page.locator('.log-page');
 for(const line of ['asked Lead for an agent','made an agent مدير asked for','Shows for مدير','declined an agent request from مراجع',reason]) await expect(log).toContainText(line);
 await page.context().clearCookies();
 await signIn(page,'manager@example.com','/c/rs-learning/log');
 await expect(page.locator('.log-page')).toContainText('made an agent مدير asked for');
 await expect(page.locator('.log-page')).not.toContainText('Blog Writer');
});
