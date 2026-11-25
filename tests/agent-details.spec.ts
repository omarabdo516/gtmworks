import { test, expect, freshSeed, type Locator, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const viewer='20000000-0000-0000-0000-000000000004';
const reviewer='20000000-0000-0000-0000-000000000003';
const id=(n:number)=>`69000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [leadConnection,adsConnection,seoConnection,lead,ads,seo,conversation]=[1,2,3,4,5,6,7].map(id);
// Copy (#184) has a Card with an item waiting on Omar, and the Contributor and the Viewer are shown it.
const [copyConnection,copy]=[12,13].map(id);
// The files (#21): one on a Meta Ads Card, one in Omar's own Conversation with it and one in the Contributor's.
const paths={card:`${company}/agent-details/${randomUUID()}.pdf`,mine:`${company}/conversations/${conversation}/${randomUUID()}.csv`,theirs:`${company}/conversations/${id(11)}/${randomUUID()}.txt`};
const bytes=Buffer.from('June audiences\n');
const stage=(column:string)=>`(select id from public.work_stages where company_id='${company}' and board_column='${column}' order by position limit 1)`;

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(({},testInfo)=>{
 // A retry, or a repeat of this serial file, starts it again from the seed, so its rows are inserted once.
 freshSeed(testInfo);
 // Copy, Lead and SEO are made today, so none of them is asleep (#699: an Agent made over 7 days ago with no work for 7
 // days sleeps): the states below are waiting, working and idle.
 query(`do $$ declare card bigint; begin
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,profile) values
   ('${copy}','${company}','${copyConnection}','Copy','Writes the copy.',false,now(),null,'details-copy'),
   ('${lead}','${company}','${leadConnection}','Lead','General',true,now(),null,'details-lead'),
   ('${ads}','${company}','${adsConnection}','Meta Ads','Runs the Meta ads.',false,'2026-06-10T09:01:00Z','${omar}','details-ads'),
   ('${seo}','${company}','${seoConnection}','SEO','Writes the blog.',false,now(),null,'details-seo');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${id(9)}','${company}','${omar}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${id(9)}','person','${omar}',null,'Omar','I want someone to handle our Meta ads','${id(10)}','details-made','2026-06-10T09:00:00Z'),
   ('${company}','${id(9)}','agent',null,'${lead}','Lead','Done.',null,'details-made','2026-06-10T09:01:00Z');
  insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${id(9)}','details-made','call-0','${company}','${ads}','2026-06-10T09:01:00Z');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${viewer}','${ads}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${ads}','Meta Ads');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${conversation}','person','${omar}','Omar',E'Plan the June campaign\\nwith three ads','${id(8)}','details-run',now()-interval '5 minutes');
  insert into public.work_cards(company_id,stage_id,title,agent_id) values ('${company}',${stage('progress')},'June campaign','${ads}') returning id into card;
  insert into public.work_checklist(company_id,card_id,title,done) values ('${company}',card,'Pick the audience',true),('${company}',card,'Write the ad copy',false);
  insert into public.work_cards(company_id,stage_id,title,agent_id) values ('${company}',${stage('planned')},'Retargeting ads','${ads}');
  insert into public.work_cards(company_id,stage_id,title,agent_id) values ('${company}',${stage('ideas')},'Spring copy','${copy}') returning id into card;
  insert into public.waiting_items(company_id,person_id,kind,title,card_id) values ('${company}','${omar}','question','Which tone for spring?',card);
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${viewer}','${copy}'),('${company}','${reviewer}','${copy}');
  -- Two earlier changes of Meta Ads in the company log, as log_agent_event writes them, dated in the past.
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   select '${company}','${omar}','person',p.name,'agent','${ads}',x.action,'{"agent_name":"Meta Ads"}','hermes_agent_audit',nextval('public.agent_log_ids'),x.at
   from public.people p,(values ('agent_added',now()-interval '1 minute'),('rename_hermes_agent',now()-interval '10 days')) x(action,at) where p.id='${omar}';
 end $$;`);
});
// The bytes go into the Company's folder with the local stack's service key, as an upload leaves them.
const serviceStorage=async()=>{
 const status=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'});
 const value=(name:string)=>status.match(new RegExp(`^${name}="(.*)"$`,'m'))![1];
 return createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false}}).storage.from('creatives');
};
test.beforeAll(async()=>{
 const storage=await serviceStorage();
 for(const path of Object.values(paths)) expect((await storage.upload(path,bytes,{contentType:'text/plain',upsert:true})).error).toBeNull();
 query(`do $$ declare card bigint; message bigint; begin
  select id into card from public.work_cards where company_id='${company}' and title='June campaign';
  insert into public.work_comments(company_id,card_id,body,author_id) values ('${company}',card,'The brief','${omar}') returning id into message;
  insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path,created_by,created_at) values ('${company}',card,message,'june-brief.pdf','application/pdf',88064,'${paths.card}','${omar}','2026-06-10T09:00:00Z');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${reviewer}','${ads}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${id(11)}','${company}','${reviewer}','${ads}','Meta Ads');
  insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path,created_at) values
   ('${company}','${conversation}','audiences.csv','text/csv',18432,'${paths.mine}','2026-06-12T09:00:00Z'),
   ('${company}','${id(11)}','reviewer-notes.txt','text/plain',300,'${paths.theirs}','2026-06-13T09:00:00Z');
 end $$;`);
});
const fileId=(name:string)=>JSON.parse(query(`select id from public.conversation_attachments where name='${name}'`))[0].id as number;

async function openDetails(page:Page,email:string,agent:string,name:string) {
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${agent}`);
 const details=page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
 await expect(details).toBeVisible();
 return details;
}
const tab=(details:Locator,name:string)=>details.getByRole('tab',{name,exact:true});

test('the Owner reads the Agent\'s state, what it is doing for them, its Cards and its log',async({page})=>{
 const details=await openDetails(page,'omar@example.com',ads,'Meta Ads');
 await expect(details.locator('.dp-id__name')).toHaveText('Meta Ads');
 await expect(details.locator('.dp-id__role')).toHaveText('Runs the Meta ads. · Working');
 await expect(details.locator('.fw--lg > .dot')).toHaveClass(/\bdot--working\b/);
 await expect(details.locator('.born')).toContainText('Made on Jun 10 at your request');
 await expect(details.locator('.born').getByRole('link',{name:'See the ask',exact:true})).toHaveAttribute('href',`/c/rs-learning/conversations/${id(9)}`);
 await expect(details.getByRole('link',{name:'Settings for Meta Ads',exact:true})).toBeVisible();
 await expect(details.getByRole('tab')).toHaveText(['Activity','Tasks','Files','Memory','Log']);
 const panel=details.getByRole('tabpanel');
 await expect(panel).toHaveAttribute('aria-labelledby','dp-tab-activity');

 await expect(panel.locator('.dp-label')).toHaveText(['Agent’s screen','Latest activity','Connected tools','Routines']);
 const rows=panel.locator('.panel-row');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0).locator('.panel-row__t')).toHaveText('Working now');
 await expect(rows.nth(0).locator('.panel-row__d').first()).toHaveText('On your request: Plan the June campaign');
 await expect(rows.nth(0).locator('time')).toHaveText(/^(Today|Yesterday) · \d{1,2}:\d{2}\s[AP]M$/);
 await expect(rows.nth(1).locator('.panel-row__t')).toHaveText('عمر added the agent “Meta Ads”');
 await expect(panel).not.toContainText('changed the agent');

 await tab(details,'Activity').focus();
 await page.keyboard.press('ArrowRight');
 await expect(tab(details,'Tasks')).toBeFocused();
 await expect(tab(details,'Tasks')).toHaveAttribute('aria-selected','true');
 await expect(tab(details,'Activity')).toHaveAttribute('aria-selected','false');
 await expect(panel.locator('.dp-label')).toContainText('On the board');
 await expect(panel.getByRole('link',{name:'Open the board',exact:true})).toHaveAttribute('href','/c/rs-learning/work/board');
 const cards=panel.locator('a.panel-row');
 await expect(cards.locator('.panel-row__t')).toHaveText(['Retargeting ads','June campaign']);
 await expect(cards.locator('.panel-row__meta')).toHaveText(['Planned','In progress']);
 await expect(cards.nth(1).locator('.panel-row__d')).toHaveText('Write the ad copy · 50%');

 await page.keyboard.press('ArrowRight');
 await expect(tab(details,'Files')).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(tab(details,'Memory')).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(tab(details,'Log')).toBeFocused();
 await expect(panel.locator('.dp-label > span')).toHaveText('Log 2');
 await expect(panel.locator('.lg-row .lg-line')).toHaveText(['عمر (you) added the agent “Meta Ads”','عمر (you) changed the agent “Meta Ads”']);
 await expect(panel.locator('.lg-forever')).toHaveText('Nothing in the log is ever deleted, not even by the Owner.');
 await page.keyboard.press('ArrowLeft');
 await expect(tab(details,'Memory')).toHaveAttribute('aria-selected','true');
 await tab(details,'Log').click();
 await panel.getByRole('link',{name:'Open the activity log',exact:true}).click();
 // The log is a whole page read on the server, and the address commits when its answer arrives: under the browser
 // suite's four loaded lanes that took longer than five seconds while the page said it was opening. The address is
 // still required exactly, with its Agent filter.
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=a:${ads}$`),{timeout:20000});
 await expect(page.locator('.lgp-count')).toHaveText('2 entries');

 await page.goto(`/c/rs-learning/chat/${ads}`);
 await tab(details,'Tasks').click();
 await cards.filter({hasText:'June campaign'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board\/\d+$/);
 await expect(page.locator('.modal')).toContainText('June campaign');
});

test('the Files tab lists the Agent\'s Card files and the reader\'s own Conversation file, newest first, and opens them',async({page})=>{
 const details=await openDetails(page,'omar@example.com',ads,'Meta Ads');
 await tab(details,'Files').click();
 const panel=details.getByRole('tabpanel');
 await expect(panel).toHaveAttribute('aria-labelledby','dp-tab-files');
 await expect(panel.locator('#dp-files-h > span')).toHaveText('Files 2');
 const rows=panel.locator('.panel-row');
 await expect(rows.locator('.panel-row__t')).toHaveText(['audiences.csv','june-brief.pdf']);
 await expect(rows.locator('.panel-row__d')).toHaveText(['18 KB · Plan the June campaign','86 KB · June campaign']);
 await expect(panel).not.toContainText('reviewer-notes.txt');
 const links=await rows.getByRole('link').evaluateAll(anchors=>anchors.map(anchor=>anchor.getAttribute('href')));
 expect(links).toEqual([`/c/rs-learning/files/conversation/${fileId('audiences.csv')}`,expect.stringMatching(/^\/c\/rs-learning\/files\/\d+$/)]);
 for(const link of links) {
  const opened=await page.request.get(link!);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(await opened.body()).toEqual(bytes);
 }
 expect((await page.request.get(`/c/rs-learning/files/conversation/${fileId('reviewer-notes.txt')}`)).status(),'another Member\'s Conversation file is not found').toBe(404);
 // An address opens the panel on that tab, beside a Conversation too.
 await page.goto(`/c/rs-learning/conversations/${conversation}?tab=files`);
 await expect(tab(details,'Files')).toHaveAttribute('aria-selected','true');
 await expect(panel.locator('.panel-row__t')).toHaveText(['audiences.csv','june-brief.pdf']);
});

test('a Contributor sees the Card file and their own Conversation file, never another Member\'s',async({page})=>{
 const details=await openDetails(page,'reviewer@example.com',ads,'Meta Ads');
 await tab(details,'Files').click();
 const panel=details.getByRole('tabpanel');
 await expect(panel.locator('#dp-files-h > span')).toHaveText('Files 2');
 await expect(panel.locator('.panel-row__t')).toHaveText(['reviewer-notes.txt','june-brief.pdf']);
 await expect(panel).not.toContainText('audiences.csv');
 expect((await page.request.get(`/c/rs-learning/files/conversation/${fileId('reviewer-notes.txt')}`)).status()).toBe(200);
 expect((await page.request.get(`/c/rs-learning/files/conversation/${fileId('audiences.csv')}`)).status()).toBe(404);
});

test('a Viewer\'s panel has only the gear and Close as actions, and no other person\'s request',async({page})=>{
 const details=await openDetails(page,'viewer@example.com',ads,'Meta Ads');
 await expect(details.locator('.dp-id__role')).toHaveText('Runs the Meta ads. · Working');
 await expect(details.locator('.dp-top a')).toHaveCount(1);
 await expect(details.getByRole('link',{name:'Settings for Meta Ads',exact:true})).toHaveAttribute('href',`/c/rs-learning/settings?agent=${ads}`);
 await expect(details.locator('button:not([role=tab])')).toHaveCount(1);
 await expect(details.getByRole('button',{name:'Close details',exact:true})).toBeVisible();
 const panel=details.getByRole('tabpanel');
 await expect(panel.locator('.panel-row').first().locator('.panel-row__d').first()).toHaveText('On a teammate’s request');
 await expect(details).not.toContainText('Plan the June campaign');
 await tab(details,'Tasks').click();
 await expect(panel.locator('a.panel-row .panel-row__t')).toHaveText(['Retargeting ads','June campaign']);
 await tab(details,'Log').click();
 await expect(panel.locator('.lg-row')).toHaveCount(2);
});

test('every file of the Agent is listed, past fifty, and the heading counts what the list holds',async({page})=>{
 query(`do $$ declare card bigint; message bigint; begin
  insert into public.work_cards(company_id,stage_id,title,agent_id) values ('${company}',${stage('planned')},'Many files','${seo}') returning id into card;
  insert into public.work_comments(company_id,card_id,body,author_id) values ('${company}',card,'The files','${omar}') returning id into message;
  insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path,created_by,created_at)
   select '${company}',card,message,'file-'||n||'.txt','text/plain',10,'${company}/agent-details-many/'||n||'.txt','${omar}',timestamptz '2026-06-01T09:00:00Z'+n*interval '1 minute' from generate_series(1,51) n;
 end $$;`);
 const details=await openDetails(page,'omar@example.com',seo,'SEO');
 await tab(details,'Files').click();
 const panel=details.getByRole('tabpanel');
 await expect(panel.locator('#dp-files-h > span')).toHaveText('Files 51');
 await expect(panel.locator('.panel-row')).toHaveCount(51);
 await expect(panel.locator('.panel-row__t').first()).toHaveText('file-51.txt');
 await expect(panel.locator('.panel-row__t').last()).toHaveText('file-1.txt');
});

// A file the Agent handed over in a channel (#715) is every Member's of that channel: the Owner and the Contributor in the
// team channel read its file, the Viewer outside it does not, a person's own file there is not the Agent's, and the
// general channel's file, every Member's, is named by the general channel's word.
const generalChannel='69000000-0000-0000-0000-000000000001'; // supabase/seed.sql
test('the Files tab lists the files the Agent handed over in a channel the reader is a Member of',async({page})=>{
 const [replied,sent,general]=[`${company}/channels/${id(14)}/reply-details`,`${company}/channels/${id(14)}/sent-details`,`${company}/channels/${generalChannel}/reply-details`];
 const storage=await serviceStorage();
 for(const path of [replied,sent,general]) expect((await storage.upload(path,bytes,{contentType:'text/plain',upsert:true})).error).toBeNull();
 query(`do $$ declare m bigint; said bigint; asked bigint; told bigint; begin
  insert into public.channels(id,company_id,kind,name,created_by,create_key) values ('${id(14)}','${company}','team','launch','${omar}','${id(15)}');
  insert into public.channel_people(channel_id,company_id,person_id,added_by) values ('${id(14)}','${company}','${omar}','${omar}'),('${id(14)}','${company}','${reviewer}','${omar}');
  insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values ('${id(14)}','${company}','${copy}','${omar}');
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values ('${company}','${id(14)}','person','${omar}','Omar','@Copy the launch copy','${id(16)}') returning id into m;
  insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to) values ('${company}','${id(14)}','agent','${copy}','Copy','Here it is.',m) returning id into said;
  insert into public.channel_attachments(company_id,channel_id,send_key,message_id,position,name,content_type,size,path,created_at) values
   ('${company}','${id(14)}','${id(16)}',m,0,'brief-notes.txt','text/plain',40,'${sent}','2026-06-14T09:00:00Z'),
   ('${company}','${id(14)}',md5('details-copy-run')::uuid,said,0,'launch-copy.txt','text/plain',2048,'${replied}','2026-06-15T09:00:00Z');
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values ('${company}','${generalChannel}','person','${omar}','Omar','@Copy the plan','${id(17)}') returning id into asked;
  insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to) values ('${company}','${generalChannel}','agent','${copy}','Copy','The plan.',asked) returning id into told;
  insert into public.channel_attachments(company_id,channel_id,send_key,message_id,position,name,content_type,size,path,created_at) values
   ('${company}','${generalChannel}',md5('details-copy-general')::uuid,told,0,'plan.txt','text/plain',300,'${general}','2026-06-13T09:00:00Z');
 end $$;`);
 for(const email of ['omar@example.com','reviewer@example.com']) {
  const details=await openDetails(page,email,copy,'Copy');
  await tab(details,'Files').click();
  const panel=details.getByRole('tabpanel');
  await expect(panel.locator('#dp-files-h > span')).toHaveText('Files 2');
  await expect(panel.locator('.panel-row__t')).toHaveText(['launch-copy.txt','plan.txt']);
  await expect(panel.locator('.panel-row__d')).toHaveText(['2 KB · #launch','300 B · #general']);
  const link=await panel.getByRole('link',{name:'launch-copy.txt'}).getAttribute('href');
  expect(link).toMatch(/^\/c\/rs-learning\/files\/channel\/\d+$/);
  const opened=await page.request.get(link!);
  expect(opened.status()).toBe(200);
  expect(await opened.body()).toEqual(bytes);
  await page.context().clearCookies();
 }
 const details=await openDetails(page,'viewer@example.com',copy,'Copy');
 await tab(details,'Files').click();
 await expect(details.getByRole('tabpanel').locator('.panel-row__t')).toHaveText(['plan.txt']);
});

// Each tile carries the reader's own state of its Agent (#184): Meta Ads has an open Run, Copy an item waiting on Omar,
// Lead and SEO nothing. The Contributor and the Viewer see Copy without the waiting dot, and not SEO, hidden from them.
const tiles=(page:Page)=>page.locator('.sidebar .agent-tile:not(.agent-tile--new)');
for(const [who,email,shown] of [
 ['the Owner','omar@example.com',[['Lead · Main · General · Idle','idle'],['Copy · Writes the copy. · Waiting on you','waiting'],[/^Meta Ads · (New · )?Runs the Meta ads\. · Working$/,'working'],['SEO · Writes the blog. · Idle','idle']]],
 ['a Contributor','reviewer@example.com',[['Lead · Main · General · Idle','idle'],['Copy · Writes the copy. · Idle','idle'],['Meta Ads · Runs the Meta ads. · Working','working']]],
 ['a Viewer','viewer@example.com',[['Lead · Main · General · Idle','idle'],['Copy · Writes the copy. · Idle','idle'],['Meta Ads · Runs the Meta ads. · Working','working']]],
] as const) test(`the sidebar shows ${who} each Agent's state as a dot on its face and at the end of its name`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${lead}`);
 await expect(tiles(page)).toHaveCount(shown.length);
 for(const [index,[label,status]] of shown.entries()) {
  await expect(tiles(page).nth(index)).toHaveAccessibleName(label);
  await expect(tiles(page).nth(index).locator('.fw > .dot')).toHaveClass(`dot dot--${status}`);
 }
});

test('Settings shows the same dot on each Agent, with its state as text in the list and after the role on its page',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=agents');
 const row=(agent:string)=>page.locator(`#sov-ag-${agent}`);
 for(const [agent,status,word] of [[lead,'idle','Idle'],[copy,'waiting','Waiting on you'],[ads,'working','Working'],[seo,'idle','Idle']] as const) {
  await expect(row(agent).locator('.fw > .dot')).toHaveClass(`dot dot--${status}`);
  await expect(row(agent).locator('.panel-row__meta')).toHaveText(word);
 }
 await row(copy).click();
 await expect(page.locator('.sov-agent-id .fw > .dot')).toHaveClass('dot dot--waiting');
 await expect(page.locator('.sov-agent-id .dp-id__role')).toHaveText('Writes the copy. · Waiting on you');
 await page.context().clearCookies();
 await signIn(page,'reviewer@example.com',`/c/rs-learning/settings?agent=${copy}`);
 await expect(page.locator('.sov-agent-id .fw > .dot')).toHaveClass('dot dot--idle');
 await expect(page.locator('.sov-agent-id .dp-id__role')).toHaveText('Writes the copy. · Idle');
});

// The gear (#175): every Role has it; it opens the Agent's page in the settings overlay, read only for a Contributor and
// a Viewer, and closing gives the focus back to it.
const agentPage=(agent:string)=>new RegExp(`/c/rs-learning/settings\\?agent=${agent}$`);
for(const [who,email,reads] of [['the Owner','omar@example.com',false],['a Manager','manager@example.com',false],['a Contributor','reviewer@example.com',true],['a Viewer','viewer@example.com',true]] as const) test(`the gear opens the Agent's settings for ${who}${reads?', read only':''}`,async({page})=>{
 const details=await openDetails(page,email,lead,'Lead');
 await details.getByRole('link',{name:'Settings for Lead',exact:true}).click();
 await expect(page).toHaveURL(agentPage(lead));
 await expect(page.locator('#sov-tab-settings')).toBeFocused();
 await expect(page.locator('.sov-agent-id .dp-id__name')).toHaveText('LeadMain');
 await expect(page.locator('#sov-agent-panel .ro-note')).toHaveText(reads?['Agent settings are changed by the Owner and Managers only.']:[]);
});

for(const [where,path] of [['a Conversation',`/c/rs-learning/conversations/${conversation}`],['the Agent\'s empty chat',`/c/rs-learning/chat/${ads}`]] as const) test(`closing the Agent's settings opened from ${where} returns there with the focus on the gear, by the button and by Escape`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',path);
 const gear=page.getByRole('complementary',{name:'Details: Meta Ads',exact:true}).getByRole('link',{name:'Settings for Meta Ads',exact:true});
 for(const close of ['button','Escape']) {
  await gear.click();
  await expect(page).toHaveURL(agentPage(ads));
  await expect(page.locator('#sov-tab-settings')).toBeFocused();
  if(close==='button') await page.getByRole('button',{name:'Close settings and go back',exact:true}).click();
  else await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator('#dp-settings')).toBeFocused();
 }
});

// #612: below 1024px the details panel covers the chat with its own Escape. Settings opened from its gear draw over it,
// and their Escape closes only them: the panel is still open behind, its gear holding the focus.
test('below 1024px Escape closes the Settings opened from the details panel and leaves the panel open',async({page})=>{
 await page.setViewportSize({width:900,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${ads}`);
 await page.locator('#btn-details').click();
 const details=page.getByRole('complementary',{name:'Details: Meta Ads',exact:true});
 await expect(details).toBeVisible();
 await details.getByRole('link',{name:'Settings for Meta Ads',exact:true}).click();
 await expect(page).toHaveURL(agentPage(ads));
 await expect(page.locator('#sov-tab-settings')).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/chat/${ads}$`));
 await expect(page.locator('.sov')).toHaveCount(0);
 await expect(details).toBeVisible();
 await expect(page.locator('#dp-settings')).toBeFocused();
});

test('"All agents" returns to the Agents list with the focus on that Agent\'s row',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${ads}`);
 await page.getByRole('link',{name:'All agents',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=agents$/);
 await expect(page.locator(`#sov-ag-${ads}`)).toBeFocused();
 await page.locator(`#sov-ag-${seo}`).click();
 await expect(page).toHaveURL(agentPage(seo));
 await expect(page.locator('#sov-tab-settings')).toBeFocused();
 await page.getByRole('link',{name:'All agents',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=agents$/);
 await expect(page.locator(`#sov-ag-${seo}`)).toBeFocused();
});

test('a Contributor cannot open the page of an Agent hidden from them: the address shows the Agents list without it',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'reviewer@example.com',`/c/rs-learning/settings?agent=${seo}`);
 await expect(page.locator('.sov-ag .panel-row__t bdi')).toHaveText(['Lead','Copy','Meta Ads']);
 await expect(page.locator(`#sov-ag-${seo}`)).toHaveCount(0);
 await expect(page.locator('.sov-agent-id')).toHaveCount(0);
 await expect(page.getByText('SEO',{exact:true})).toHaveCount(0);
});
