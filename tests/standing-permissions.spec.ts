import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #166: an Agent's "Standing permissions" through the whole app. RS Learning: Lead, the main Agent, on the Company's
// profile; Ads and SEO each on a profile of their own in the lane's fake Engine, whose app tool on an untrusted server
// asks before it runs, keeps an Always allow in that profile's command_allowlist and asks no more while it is there, as
// the pinned release does. The Owner allows Ads's tool always in its chat; the row shows in Ads's settings and at the end
// of its Activity tab with who allowed it and when, and on SEO nowhere; Revoke removes it in both places, says so, logs
// one row and the next call asks again. A Contributor and a Viewer read the rows with no Revoke and the route refuses
// them, a Manager is offered it, and a Manager the Agent is hidden from gets nothing.
// The database side is proven in supabase/tests/standing_permissions.sql, the driver in
// tests/hermes-standing-permissions.test.mjs and the service in tests/standing-permissions.test.mjs.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6a000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
const entry='mcp:meta-ads/create_campaign';
const asking='Launch the June campaign';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const allowlist=(agent:string)=>fake.settings.profiles.get(own(agent))?.config?.command_allowlist??[];

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads),own(seo)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.approvals=input=>input.includes(asking)?[{app:{server:'meta-ads',tool:'create_campaign'}}]:[];
 const reply=(input:string,_answers:unknown[],choices:(string|null)[])=>`Reply to: ${input} (${choices.map(choice=>choice??'not allowed').join(', ')})`;
 fake.settings.reply=reply as unknown as typeof fake.settings.reply;
 query(`update public.people set language='en' where id::text like '20000000-%'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${own(ads)}'),
    ('${seo}','${company}','${id(6)}','SEO','Writes the blog.',false,'${own(seo)}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${ads}','${company}',true),('${seo}','${company}',true);
   set local session_replication_role=origin;
  end $$;`);
  // Ads is shown to every Member; SEO to nobody but the Owner.
  query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${company}' and removed_at is null and role<>'owner' on conflict do nothing`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const details=async(page:Page,agent:string,name:string)=>{
 await page.goto(`/c/rs-learning/chat/${agent}`);
 const panel=page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
 await expect(panel).toBeVisible();
 return panel;
};
const settings=async(page:Page,agent:string)=>{ await page.goto(`/c/rs-learning/settings?section=agents&agent=${agent}`); return page.locator('#sov-agent-panel'); };
// Asks Ads to launch: its Run stops to ask before the app's tool, and the card shows under the message.
async function launch(page:Page) {
 await page.goto(`/c/rs-learning/chat/${ads}`);
 await page.getByLabel('Message',{exact:true}).fill(asking);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
}
const shot=async(page:Page,name:string)=>{ if(process.env.STANDING_SHOTS) await page.screenshot({path:`${process.env.STANDING_SHOTS}/${name}.png`}); };
const revokes=()=>JSON.parse(query(`select actor_id,agent_id,details from public.company_log where company_id='${company}' and action='agent_permission_revoked' order by id`));

test('after Always allow, the Agent\'s settings and its Activity tab show one row for the tool with who allowed it and when; another Agent shows none',async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await launch(page);
 const card=page.locator('.reply-card--permission');
 await expect(card).toBeVisible({timeout:20000});
 await card.getByRole('button',{name:'Always allow',exact:true}).click();
 await expect(page.locator('.msg[data-author=agent]:not([data-kind])')).toContainText(`Reply to: ${asking} (always)`,{timeout:20000});
 expect(allowlist(ads)).toEqual([entry]);
 expect(allowlist(seo),'another Agent\'s profile is not widened').toEqual([]);

 const panel=await details(page,ads,'Ads');
 const section=panel.getByRole('region',{name:'Standing permissions',exact:true});
 await expect(section.locator('.sp-row')).toHaveCount(1);
 await expect(section.locator('.panel-row__t')).toHaveText('Meta Ads · create_campaign');
 await expect(section.locator('.panel-row__d')).toHaveText(/^Allowed by عمر · Today · /);
 await expect(section.getByRole('button',{name:'Revoke: Meta Ads · create_campaign',exact:true})).toBeVisible();
 await section.scrollIntoViewIfNeeded(); await shot(page,'1-activity-tab');
 expect(await panel.locator('.dp-sec').last().getAttribute('class'),'it closes the Activity tab').toContain('sp');

 const page2=await settings(page,ads);
 const inSettings=page2.getByRole('region',{name:'Standing permissions',exact:true});
 await expect(inSettings.locator('.panel-row__t')).toHaveText('Meta Ads · create_campaign');
 await expect(inSettings.locator('.panel-row__d')).toHaveText(/^Allowed by عمر · Today · /);
 await inSettings.scrollIntoViewIfNeeded(); await shot(page,'2-settings');
 await expect(page2.locator('section[aria-labelledby="set-h-settingsTools"] + section.sp'),'it sits after Tools').toHaveCount(1);

 const other=await details(page,seo,'SEO');
 await expect(other.getByText('Standing permissions')).toHaveCount(0);
 await expect((await settings(page,seo)).getByText('Standing permissions')).toHaveCount(0);
});

test('a Contributor and a Viewer read the row with no Revoke and the route refuses them; a Manager is offered it, and one the Agent is hidden from gets nothing',async({page})=>{
 fake.settings.profiles.get(own(seo))!.config={command_allowlist:['recursive delete']};
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,email,'/c/rs-learning/home');
  const section=(await settings(page,ads)).getByRole('region',{name:'Standing permissions',exact:true});
  await expect(section.locator('.panel-row__t')).toHaveText('Meta Ads · create_campaign');
  await expect(section.locator('.panel-row__d')).toHaveText(/^Allowed by عمر · /);
  await expect(section.getByRole('button')).toHaveCount(0);
  await section.scrollIntoViewIfNeeded(); await shot(page,`3-read-only-${email.split('@')[0]}`);
  const panel=await details(page,ads,'Ads');
  await expect(panel.getByRole('region',{name:'Standing permissions',exact:true}).getByRole('button')).toHaveCount(0);
  const refused=await page.request.post('/api/agent-permissions',{data:{company,agent:ads,entry}});
  expect(refused.status(),email).toBe(403);
 }
 expect(allowlist(ads)).toEqual([entry]);

 await page.context().clearCookies();
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await expect((await settings(page,ads)).getByRole('button',{name:'Revoke: Meta Ads · create_campaign',exact:true})).toBeVisible();
 const hidden=await page.request.post('/api/agent-permissions',{data:{company,agent:seo,entry:'recursive delete'}});
 expect(hidden.status(),'an Agent the Manager does not see is not found').toBe(404);
 expect(allowlist(seo)).toEqual(['recursive delete']);
 expect(revokes()).toEqual([]);
});

test('Revoke removes the row in both places, says the Agent will ask again, writes one log row, and the same tool\'s next call asks again',async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const panel=await details(page,ads,'Ads');
 await panel.getByRole('button',{name:'Revoke: Meta Ads · create_campaign',exact:true}).click();
 await expect(page.locator('.toast').filter({hasText:'Permission revoked. The agent will ask you again'})).toBeVisible();
 await expect(panel.getByRole('region',{name:'Standing permissions',exact:true})).toHaveCount(0);
 await shot(page,'4-revoked-toast');
 await expect(page.locator('#dp-settings'),'the focus goes where the reference sends it').toBeFocused();
 expect(allowlist(ads)).toEqual([]);
 expect(revokes()).toEqual([{actor_id:omar,agent_id:ads,details:{agent_name:'Ads',permission:{text:'Meta Ads · create_campaign',entry}}}]);
 await expect((await settings(page,ads)).getByText('Standing permissions')).toHaveCount(0);
 await expect((await details(page,ads,'Ads')).getByText('Standing permissions')).toHaveCount(0);

 // The Company log reads the reference's line.
 await page.goto(`/c/rs-learning/log?who=a:${ads}`);
 const line=page.getByRole('listitem').filter({hasText:'revoked a permission of Ads “Meta Ads · create_campaign”'});
 await expect(line).toHaveCount(1);
 await expect(line).toHaveText(/from\s*Standing\s*to\s*Will ask again/);
 await shot(page,'5-log');

 await launch(page);
 await expect(page.locator('.reply-card--permission'),'once revoked, the same tool asks again').toBeVisible({timeout:20000});
 await shot(page,'6-asks-again');
 await page.locator('.reply-card--permission').getByRole('button',{name:'Allow once',exact:true}).click();
 await expect(page.locator('.msg[data-author=agent]:not([data-kind])')).toContainText(`Reply to: ${asking} (once)`,{timeout:20000});
 expect(allowlist(ads)).toEqual([]);
});
