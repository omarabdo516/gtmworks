import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { signIn } from './sign-in';

// #24, team channels: the Manager makes one with chosen Members and Agents, each Member's unread count rises and clears,
// and a channel's Agent hidden from a Member elsewhere is called there but never reached directly. Every Role, the read
// positions and who sees a channel are proven in supabase/tests/team_channels.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const id=(n:number)=>`6b100000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(n=>id(10+n));
let channel='';

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 query(`do $$ begin
  update public.people set language='en' where id::text like '20000000-%';
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${id(1)}','Lead','General',true,'team-lead'),
   ('${ads}','${company}','${id(2)}','Meta Ads','Runs the Meta ads.',false,'team-ads'),
   ('${seo}','${company}','${id(3)}','SEO','Writes the blog.',false,'team-seo');
  insert into public.member_agent_access(company_id,person_id,agent_id) values
   ('${company}','20000000-0000-0000-0000-000000000002','${ads}'),('${company}','20000000-0000-0000-0000-000000000002','${seo}'),
   ('${company}','20000000-0000-0000-0000-000000000003','${ads}');
 end $$;`);
});
async function as(browser:Browser,email:string,path:string) {
 const context=await browser.newContext(); const page=await context.newPage();
 await signIn(page,email,path);
 return {page,close:()=>context.close()};
}
const channels=(page:Page)=>page.locator('.sidebar .ch-item');

test('the Manager makes a channel with chosen Members and Agents and changes its Members; a Contributor has no "+"',async({page,browser})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 const dialog=page.getByRole('dialog',{name:'New channel'});
 // "+" does nothing until the sidebar has hydrated, so the click is repeated until the dialog opens.
 await expect(async()=>{
  if(!await dialog.count()) await page.getByRole('button',{name:'New channel',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Channel name'})).toBeVisible({timeout:2000});
 }).toPass({timeout:30000});
 await dialog.getByRole('textbox',{name:'Channel name'}).fill('#December campaign');
 await expect(dialog.getByText('Shows under channels as: #December campaign')).toBeVisible();
 await dialog.getByRole('checkbox',{name:/^مراجع/}).click();
 await dialog.getByRole('checkbox',{name:/^Meta Ads/}).click();
 await dialog.getByRole('checkbox',{name:/^SEO/}).click();
 await expect(dialog.getByRole('group',{name:/^Members/})).toHaveAccessibleName('Members 2');
 await dialog.getByRole('button',{name:'Create the channel'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/channels\/[0-9a-f-]{36}$/);
 channel=page.url().split('/').at(-1)!;
 await expect(channels(page)).toHaveText(['general','December campaign']);
 await expect(page.locator('.ch-intro')).toContainText('2 members · Meta Ads, SEO');
 expect(rows(`select kind,name from public.channels where id='${channel}'`)).toEqual([{kind:'team',name:'December campaign'}]);
 expect(rows(`select count(*)::int n from public.channel_people where channel_id='${channel}'`)[0].n).toBe(2);

 const details=page.getByRole('complementary',{name:'Channel details'});
 await details.getByRole('button',{name:'Add a member'}).click();
 await details.getByRole('listitem').filter({hasText:'مشاهد'}).getByRole('button',{name:'Add',exact:true}).click();
 await expect(details.getByRole('button',{name:'Remove مشاهد from the channel'})).toBeVisible();
 await details.getByRole('button',{name:'Remove مشاهد from the channel'}).click();
 await expect(details.getByRole('button',{name:'Remove مشاهد from the channel'})).toHaveCount(0);
 await expect(details.getByRole('button',{name:'Remove مدير from the channel'})).toHaveCount(0);
 expect(rows(`select count(*)::int n from public.channel_people where channel_id='${channel}' and person_id='20000000-0000-0000-0000-000000000004'`)[0].n).toBe(0);

 // The Manager made it without the Owner: only who is in a channel can change it, so only the Manager is named.
 const contributor=await as(browser,'reviewer@example.com',`/c/rs-learning/channels/${channel}`);
 try {
  await expect(contributor.page.locator('.ch-intro')).toBeVisible();
  await expect(contributor.page.getByRole('button',{name:'New channel',exact:true})).toHaveCount(0);
  await expect(contributor.page.getByRole('button',{name:/^Remove/})).toHaveCount(0);
  await expect(contributor.page.locator('#details .ch-who')).toHaveText('Members and agents are added and removed by مدير (Manager).');
 } finally { await contributor.close(); }
});

test('the unread count rises on a new message and clears when the Member opens the channel',async({page,browser})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 const item=channels(page).filter({hasText:'December campaign'});
 await expect(item.locator('.sb-unread')).toHaveCount(0);
 const contributor=await as(browser,'reviewer@example.com',`/c/rs-learning/channels/${channel}`);
 try {
  const box=contributor.page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
  await box.fill('Morning, team'); await box.press('Enter');
  await expect(contributor.page.locator('.turn--user .bubble--user')).toHaveText('Morning, team');
  await expect(item.getByLabel('1 new message',{exact:true})).toHaveText('1',{timeout:15000});
  await expect(item).toHaveClass(/is-unread/);
  await box.fill('The brief is ready'); await box.press('Enter');
  await expect(item.getByLabel('2 new messages',{exact:true})).toHaveText('2',{timeout:15000});
  await expect(channels(contributor.page).filter({hasText:'December campaign'}).locator('.sb-unread')).toHaveCount(0);
 } finally { await contributor.close(); }
 await item.click();
 await expect(page.locator('.turn--peer .bubble--peer')).toHaveText(['Morning, team','The brief is ready']);
 await expect(item.locator('.sb-unread')).toHaveCount(0);
 await page.goto('/c/rs-learning/home');
 await expect(channels(page).filter({hasText:'December campaign'})).toBeVisible();
 await expect(channels(page).filter({hasText:'December campaign'}).locator('.sb-unread')).toHaveCount(0);
});

test('a Member calls the channel\'s Agent hidden from them elsewhere, sees its mark, and still cannot open a direct Conversation with it',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/channels/${channel}`);
 await expect(page.locator('.ch-intro__only')).toHaveText('SEO is shown to you in this channel only, and you can call it here. Outside the channel it stays hidden.');
 await expect(page.locator('#details .panel-row').filter({hasText:'SEO'})).toContainText('Shown to you in this channel only');
 await expect(page.locator('.sidebar .agent-tile__name')).toHaveText(['Lead','Meta Ads','Ask for an agent']);
 const box=page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
 await box.fill('@SEO draft the December article'); await box.press('Enter');
 await expect(page.locator('.turn--user .bubble--user').last()).toContainText('draft the December article');
 await expect.poll(()=>rows(`select r.agent_name from public.channel_runs r join public.channel_messages m on m.id=r.message_id where m.body='@SEO draft the December article'`)).toEqual([{agent_name:'SEO'}]);
 expect((await page.goto(`/c/rs-learning/chat/${seo}`))!.status()).toBe(404);
 const refused=await page.request.post('/api/conversations',{data:{company,conversation:randomUUID(),agent:seo,message:'Hello',sendKey:randomUUID()}});
 expect(refused.status()).toBe(404);
 expect(rows(`select count(*)::int n from public.conversations where agent_id='${seo}'`)[0].n).toBe(0);
});

// The database hides the channel (supabase/tests/team_channels.sql); this checks the page and the API answer not found (#338).
test('a Member not in the channel gets not found from its page and its API',async({page})=>{
 await signIn(page,'multi@example.com','/c/rs-learning/home');
 expect((await page.goto(`/c/rs-learning/channels/${channel}`))!.status()).toBe(404);
 expect((await page.request.get(`/api/channels?company=${company}&channel=${channel}`)).status()).toBe(404);
});
