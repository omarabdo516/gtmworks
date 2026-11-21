import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #167, on the app: the Contributor asks Lead for work that belongs to Agents hidden from them. Lead's card asks whether
// to request each; "Ask" and "No, never mind" each read their outcome, toast, give the message field the focus and hold
// after a reload, and a second press changes nothing. "Ask" waits in the Owner's and the Manager's "Waiting on you"; the
// Manager opens Reach, which then shows in the Contributor's sidebar with a line in their chat, and the Owner says no to
// Quill, which stays hidden. The hidden Agents' names never reach the Contributor's page. The cards are made by calling
// agent_ask_to_open directly, as the run's close does (tests/agent-tools.test.mjs proves the tool's call).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const [omar,manager,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003'];
const profile=`co-${company.replaceAll('-','')}`;
const [lead,reach,quill]=[randomUUID(),randomUUID(),randomUUID()];
const [adsTalk,againTalk,articlesTalk]=[randomUUID(),randomUUID(),randomUUID()];
const said='That job belongs to another agent in the company, and that agent isn’t available to you. Should I ask مدير (Manager) to open it for you?';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const turn=(talk:string,run:string,asked:string,minutes:number,answer=said)=>`('${company}','${talk}','person','${reviewer}',null,'مراجع','${asked}',gen_random_uuid(),'${run}',now()-interval '${minutes} minutes'),
  ('${company}','${talk}','agent',null,'${lead}','Lead','${answer}',null,'${run}',now()-interval '${minutes-1} minutes')`;
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}'),
   ('${reach}','${company}','${randomUUID()}','Reach','Campaigns and ads',false,'access-spec-reach'),
   ('${quill}','${company}','${randomUUID()}','Quill','Articles',false,'access-spec-quill');
  insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${reach}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
   ('${adsTalk}','${company}','${reviewer}','${lead}','Lead'),('${againTalk}','${company}','${reviewer}','${lead}','Lead'),('${articlesTalk}','${company}','${reviewer}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ${turn(adsTalk,'acc-1','Run a Meta campaign for the new course',30)},
   ${turn(againTalk,'acc-2','Plan the ads for Ramadan',20)},
   ${turn(articlesTalk,'acc-3','Write an article about our new course',10,said.replace('مدير (Manager)','عمر (Owner)'))};
 end $$;`);
 for(const [talk,run,job] of [[adsTalk,'acc-1','Campaigns and ads'],[againTalk,'acc-2','Campaigns and ads'],[articlesTalk,'acc-3','Articles']])
  query(`select public.agent_ask_to_open('${talk}','${run}','call-0','${job}')`);
});
test.afterAll(async()=>{ await fake?.close(); });

const card=(page:Page)=>page.getByRole('group',{name:'Ask مدير for it'});
const rows=()=>JSON.parse(query(`select conversation_id,state,pressed_at is not null as pressed,answered_by from public.agent_access_requests where company_id='${company}' order by id`)) as {conversation_id:string,state:string,pressed:boolean,answered_by:string|null}[];
const stateOf=(talk:string)=>rows().find(row=>row.conversation_id===talk)?.state;
// Nothing of a hidden Agent reaches the page: not its name, in the page's text or its markup.
const neverNamed=async(page:Page,...names:string[])=>{ const html=await page.content(); for(const name of names) expect(html,name).not.toContain(name); };

test('the Contributor\'s card asks under Lead\'s turn; "Ask" and "No, never mind" each read their outcome, toast, give back the focus and hold after a reload',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${adsTalk}`);
 const asking=card(page);
 await expect(asking.locator('.card__title')).toHaveText('Ask مدير for it?');
 await expect(asking.locator('.card__sub')).toHaveText('مدير (Manager) chooses which agents each person works with.');
 await expect(asking.getByRole('button')).toHaveText(['No, never mind','Ask مدير']);
 await expect(page.locator('.turn--agent .bubble').last()).toHaveText(said);
 await neverNamed(page,'Reach','Quill');
 await asking.getByRole('button',{name:'Ask مدير'}).click();
 await expect(asking.locator('.card__outcome')).toHaveText(/^Sent to مدير · .+\. You’ll get an answer here when they approve\.$/);
 await expect(page.locator('.toast-host')).toContainText('Request sent to مدير');
 await expect(page.locator('.composer__input')).toBeFocused();
 expect(stateOf(adsTalk)).toBe('asked');
 await page.reload();
 await expect(card(page).locator('.card__outcome')).toHaveText(/^Sent to مدير · /);
 await expect(card(page).getByRole('button')).toHaveCount(0);

 // A second press, from a tab that still drew the buttons, changes nothing.
 const id=(JSON.parse(query(`select id from public.agent_access_requests where conversation_id='${adsTalk}'`)) as {id:number}[])[0].id;
 const again=await page.request.post('/api/conversations',{data:{company,conversation:adsTalk,intent:'access',card:id,ask:false},headers:{origin:new URL(page.url()).origin}});
 expect(await again.json()).toMatchObject({state:'asked',first:false});
 expect(stateOf(adsTalk)).toBe('asked');

 await page.goto(`/c/rs-learning/conversations/${againTalk}`);
 await card(page).getByRole('button',{name:'No, never mind'}).click();
 await expect(card(page).locator('.card__outcome')).toHaveText('OK, no request was sent.');
 await expect(page.locator('.toast-host')).toContainText('No request sent');
 await expect(page.locator('.composer__input')).toBeFocused();
 await page.reload();
 await expect(card(page).locator('.card__outcome')).toHaveText('OK, no request was sent.');
 expect(stateOf(againTalk)).toBe('dismissed');

 await page.goto(`/c/rs-learning/conversations/${articlesTalk}`);
 await page.getByRole('group',{name:'Ask عمر for it'}).getByRole('button',{name:'Ask عمر'}).click();
 await expect(page.getByRole('group',{name:'Ask عمر for it'}).locator('.card__outcome')).toHaveText(/^Sent to عمر · /);
 await expect(page.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead']);
 await neverNamed(page,'Reach','Quill');
});

test('"Ask" waits in the Owner\'s and the Manager\'s "Waiting on you", naming who asks for which Agent; the Manager sees only the Agent they see',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 const forReach=page.getByRole('group',{name:'مراجع asks to work with Reach'});
 await expect(forReach).toContainText('مراجع asked to work with Reach');
 await expect(forReach).toContainText('Campaigns and ads');
 await expect(forReach.getByRole('button')).toHaveText(['No','Open it for مراجع']);
 await expect(page.getByRole('group',{name:'مراجع asks to work with Quill'})).toBeVisible();
 await expect(page.locator('.mcard[data-kind="agent_access"]')).toHaveCount(2);
 const context=await browser.newContext(); const other=await context.newPage();
 try {
  await signIn(other,'manager@example.com','/c/rs-learning/approvals');
  await expect(other.locator('.mcard[data-kind="agent_access"]')).toHaveCount(1);
  await expect(other.getByRole('group',{name:'مراجع asks to work with Reach'})).toBeVisible();
  // The Manager opens it: the item leaves every list.
  await other.getByRole('group',{name:'مراجع asks to work with Reach'}).getByRole('button',{name:'Open it for مراجع'}).click();
  await expect(other.locator('.mcard[data-kind="agent_access"]')).toHaveCount(0);
 } finally { await context.close(); }
 await page.reload();
 await expect(page.locator('.mcard[data-kind="agent_access"]')).toHaveCount(1);
 // The Owner says no to Quill.
 await page.getByRole('group',{name:'مراجع asks to work with Quill'}).getByRole('button',{name:'No'}).click();
 await expect(page.locator('.mcard[data-kind="agent_access"]')).toHaveCount(0);
 expect(rows().map(row=>[row.state,row.answered_by])).toEqual([['opened',manager],['dismissed',null],['declined',omar]]);
 expect(JSON.parse(query(`select agent_id from public.member_agent_access where company_id='${company}' and person_id='${reviewer}'`))).toEqual([{agent_id:reach}]);
 expect(JSON.parse(query(`select action,actor_id,agent_id from public.company_log where company_id='${company}' and action in ('agent_opened_for','agent_kept_hidden') order by id`)))
  .toEqual([{action:'agent_opened_for',actor_id:manager,agent_id:reach},{action:'agent_kept_hidden',actor_id:omar,agent_id:quill}]);
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.log-page')).toContainText('opened an agent for مراجع');
});

test('the Contributor sees Reach in the sidebar and both answers in their chats, and Quill stays hidden',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${adsTalk}`);
 await expect(page.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead','Reach']);
 await expect(page.locator('[data-kind="decided"][data-decision="opened"] .bubble')).toHaveText('مدير said yes to your request, and Reach now works with you. You’ll find it in your agents: open it and give it the job.');
 await page.goto(`/c/rs-learning/conversations/${articlesTalk}`);
 await expect(page.locator('[data-kind="decided"][data-decision="kept"] .bubble')).toHaveText('عمر said no to your request for now, so that agent stays unavailable to you. If you still need the work done, tell me here.');
 await neverNamed(page,'Quill');
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.log-page')).toContainText('opened an agent for مراجع');
 await expect(page.locator('.log-page')).not.toContainText('kept an agent closed');
});
