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
// The files (#21): one on a Meta Ads Card, one in Omar's own Conversation with it and one in the Contributor's.
const paths={card:`${company}/agent-details/${randomUUID()}.pdf`,mine:`${company}/agent-details/${randomUUID()}.csv`,theirs:`${company}/agent-details/${randomUUID()}.txt`};
const bytes=Buffer.from('June audiences\n');
const stage=(column:string)=>`(select id from public.work_stages where company_id='${company}' and board_column='${column}' order by position limit 1)`;

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ declare card bigint; begin
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
   ('${leadConnection}','${company}','${omar}','http://127.0.0.1:9/p/lead','details-lead','no-key','unreachable'),
   ('${adsConnection}','${company}','${omar}','http://127.0.0.1:9/p/ads','details-ads','no-key','unreachable'),
   ('${seoConnection}','${company}','${omar}','http://127.0.0.1:9/p/seo','details-seo','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by) values
   ('${lead}','${company}','${leadConnection}','Lead','General',true,null,null),
   ('${ads}','${company}','${adsConnection}','Meta Ads','Runs the Meta ads.',false,'2026-06-10T09:01:00Z','${omar}'),
   ('${seo}','${company}','${seoConnection}','SEO','Writes the blog.',false,null,null);
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
  insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details,created_at) values
   ('${company}','${omar}','${ads}','ATTACH_HERMES_AGENT','{}',now()-interval '1 minute'),
   ('${company}','${omar}','${ads}','RENAME_HERMES_AGENT','{}',now()-interval '10 days');
 end $$;`);
});
test.beforeAll(async()=>{
 // The bytes go into the Company's folder with the local stack's service key, as an upload leaves them.
 const status=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'});
 const value=(name:string)=>status.match(new RegExp(`^${name}="(.*)"$`,'m'))![1];
 const storage=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false}}).storage.from('creatives');
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
 await expect(details.locator('.face-wrap .dot')).toHaveClass(/\bdot--working\b/);
 await expect(details.locator('.born')).toContainText('Made on Jun 10 at your request');
 await expect(details.locator('.born').getByRole('link',{name:'See the ask',exact:true})).toHaveAttribute('href',`/c/rs-learning/conversations/${id(9)}`);
 await expect(details.getByRole('link',{name:'Settings for Meta Ads',exact:true})).toBeVisible();
 await expect(details.getByRole('tab')).toHaveText(['Activity','Tasks','Files','Memory · Soon','Log']);
 const panel=details.getByRole('tabpanel');
 await expect(panel).toHaveAttribute('aria-labelledby','dp-tab-activity');

 await expect(panel.locator('.dp-label')).toHaveText(['Agent’s screen','Latest activity']);
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
 await expect(tab(details,'Log')).toBeFocused();
 await expect(panel.locator('.dp-label > span')).toHaveText('Log 2');
 await expect(panel.locator('.lg-row .lg-line')).toHaveText(['عمر (you) added the agent “Meta Ads”','عمر (you) changed the agent “Meta Ads”']);
 await expect(panel.locator('.lg-forever')).toHaveText('Nothing in the log is ever deleted, not even by the Owner.');
 await page.keyboard.press('ArrowLeft');
 await expect(tab(details,'Files')).toHaveAttribute('aria-selected','true');
 await tab(details,'Log').click();
 await panel.getByRole('link',{name:'Open the activity log',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=a:${ads}$`));
 await expect(page.locator('.lgp-count')).toHaveText('2 entries');

 await page.goto(`/c/rs-learning/chat/${ads}`);
 await tab(details,'Tasks').click();
 await cards.filter({hasText:'June campaign'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board\/\d+$/);
 await expect(page.locator('.modal')).toContainText('June campaign');
});

test('the Activity tab starts with the Agent\'s screen, empty: the Engine shows none, and it is no button',async({page})=>{
 const details=await openDetails(page,'omar@example.com',ads,'Meta Ads');
 const screen=details.getByRole('tabpanel').locator('section.dp-sec').first();
 await expect(screen.getByRole('heading',{level:3})).toHaveText('Agent’s screen');
 await expect(screen.locator('.scr-thumb.is-static .scr.is-off .scr__off')).toHaveText('Nothing is running on the screen right now.');
 await expect(screen.locator('button, a, [tabindex]')).toHaveCount(0);
});

test('the Files tab lists the Agent\'s Card files and the reader\'s own Conversation file, newest first, and opens them',async({page})=>{
 const details=await openDetails(page,'omar@example.com',ads,'Meta Ads');
 await tab(details,'Files').click();
 const panel=details.getByRole('tabpanel');
 await expect(panel).toHaveAttribute('aria-labelledby','dp-tab-files');
 await expect(panel.locator('.dp-label > span')).toHaveText('Files 2');
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
 await expect(panel.locator('.dp-label > span')).toHaveText('Files 2');
 await expect(panel.locator('.panel-row__t')).toHaveText(['reviewer-notes.txt','june-brief.pdf']);
 await expect(panel).not.toContainText('audiences.csv');
 expect((await page.request.get(`/c/rs-learning/files/conversation/${fileId('reviewer-notes.txt')}`)).status()).toBe(200);
 expect((await page.request.get(`/c/rs-learning/files/conversation/${fileId('audiences.csv')}`)).status()).toBe(404);
});

test('an Agent with nothing yet shows the reference\'s empty states',async({page})=>{
 const details=await openDetails(page,'omar@example.com',seo,'SEO');
 await expect(details.locator('.dp-id__role')).toHaveText('Writes the blog. · Idle');
 await expect(details.locator('.face-wrap .dot')).toHaveClass(/\bdot--idle\b/);
 const panel=details.getByRole('tabpanel');
 await expect(panel.locator('.panel-empty')).toHaveText('Nothing done this week yet. Send it a message and it’ll start.');
 await tab(details,'Tasks').click();
 await expect(panel.locator('.panel-empty')).toHaveText('No cards on the board for this agent yet.');
 await expect(panel.locator('.dp-label')).toHaveCount(0);
 await tab(details,'Files').click();
 await expect(panel.locator('.dp-label > span')).toHaveText('Files 0');
 await expect(panel.locator('.panel-empty')).toHaveText('No files yet. Files from its cards and from your chats with it show here.');
 await tab(details,'Log').click();
 await expect(panel.locator('.dp-label > span')).toHaveText('Log 0');
 await expect(panel.locator('.panel-empty')).toHaveText('Nothing in this agent’s log yet.');
 await expect(panel.locator('.lg-row')).toHaveCount(0);
 await expect(panel.locator('.lg-forever')).toBeVisible();
});

test('a Viewer reads the same panel with no action in it and without another person\'s request',async({page})=>{
 const details=await openDetails(page,'viewer@example.com',ads,'Meta Ads');
 await expect(details.locator('.dp-id__role')).toHaveText('Runs the Meta ads. · Working');
 await expect(details.getByRole('link',{name:'Settings for Meta Ads',exact:true})).toHaveCount(0);
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
