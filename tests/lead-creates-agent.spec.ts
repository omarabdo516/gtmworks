import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn, openNavigation } from './sign-in';

// #13, what people see when Lead makes an Agent: the "new" mark until the Agent is opened, when and at whose request on
// its page, and "New agent" opening Lead's chat ready to type. The made Agents are written as lead_create_agent left
// them: Meta Ads and SEO, both asked for in one Conversation of Omar's. The card under Lead's reply was the old
// Conversation record's (gone with #883).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const id=(n:number)=>`66000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [leadConnection,lead,adsConnection,ads,seoConnection,seo,conversation]=[1,2,3,4,5,6,7].map(id);

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo);
 query(`do $$ begin
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps,profile) values
   ('${lead}','${company}','${leadConnection}','Lead','General',true,null,null,null,'made-lead'),
   ('${ads}','${company}','${adsConnection}','Meta Ads','Runs the Meta ads.',false,'2026-06-10T09:01:00Z','${omar}',array['Meta Ads Manager','Canva'],'made-ads'),
   ('${seo}','${company}','${seoConnection}','SEO','Writes the blog.',false,'2026-06-11T09:01:00Z','${omar}','{}','made-seo');
  -- The Manager is shown both (#15), so the made line is checked from someone who did not ask.
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000002','${ads}'),('${company}','20000000-0000-0000-0000-000000000002','${seo}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${lead}','Lead');
  insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values
   ('${conversation}','made-run-1','call-0','${company}','${ads}','2026-06-10T09:01:00Z'),
   ('${conversation}','made-run-2','call-0','${company}','${seo}','2026-06-11T09:01:00Z');
 end $$;`);
});

test('the list marks a made Agent new, and opening it takes the mark away',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await openNavigation(page);
 const tile=(name:string)=>page.locator('.sidebar .agent-tile').filter({hasText:name});
 // Made in June with no work since, it sleeps (#699) until its chat is opened, which wakes it for this person.
 await expect(tile('Meta Ads')).toHaveAccessibleName('Meta Ads · New · Runs the Meta ads. · Asleep');
 await expect(tile('Meta Ads').locator('.agent-tile__new')).toHaveText('New');
 await expect(tile('SEO').locator('.agent-tile__new')).toHaveText('New');
 await expect(tile('Lead').locator('.agent-tile__new')).toHaveCount(0);

 const opened=page.waitForResponse(response=>response.url().endsWith('/api/agent-opened')&&response.ok());
 await tile('Meta Ads').click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/chat/${ads}$`));
 expect(await (await opened).json()).toEqual({opened:true});
 await page.reload();
 await openNavigation(page);
 await expect(tile('Meta Ads')).toHaveAccessibleName('Meta Ads · Runs the Meta ads. · Idle');
 await expect(tile('Meta Ads').locator('.agent-tile__new')).toHaveCount(0);
 await expect(tile('SEO').locator('.agent-tile__new')).toHaveText('New');
});

test('the Agent\'s page and its details say when it was made and at whose request; only the requester sees it new',async({page,browser})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${seo}`);
 const made=page.getByRole('dialog',{name:'Settings'}).locator('.born--sov');
 await expect(made).toHaveText('Made on Jun 11 at your requestSee the ask');
 await expect(made.getByRole('link',{name:'See the ask'})).toHaveAttribute('href',`/c/rs-learning/conversations/${conversation}`);
 await page.goto(`/c/rs-learning/chat/${seo}`);
 await expect(page.locator('#details .born--panel')).toHaveText('Made on Jun 11 at your requestSee the ask');

 const context=await browser.newContext({timezoneId:'UTC'}); const other=await context.newPage();
 try {
  await signIn(other,'manager@example.com',`/c/rs-learning/settings?agent=${ads}`);
  // Only the person who asked reads the Conversation it was asked in.
  await expect(other.getByRole('dialog',{name:'Settings'}).locator('.born--sov')).toHaveText('Made on Jun 10 at the request of عمر');
  await other.goto(`/c/rs-learning/chat/${ads}`);
  await expect(other.locator('#details .born--panel')).toHaveText('Made on Jun 10 at the request of عمر');
  await openNavigation(other);
  await expect(other.locator('.sidebar .agent-tile').filter({hasText:'SEO'})).toBeVisible();
  await expect(other.locator('.sidebar .agent-tile__new')).toHaveCount(0);
  // Lead, made before #13 and with nobody's request, has no line.
  await other.goto(`/c/rs-learning/settings?agent=${lead}`);
  await expect(other.getByRole('dialog',{name:'Settings'}).locator('#sov-tab-settings')).toBeVisible();
  await expect(other.locator('.born')).toHaveCount(0);
 } finally { await context.close(); }
});

test('"New agent" opens Lead\'s chat with the composer focused and a hint line, and no form',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await page.locator('.sidebar .agent-tile--new').click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
 await expect(page.locator('.new-hint[role="note"] .new-hint__t')).toHaveText('Tell Lead what you need an agent for, in your own words, and it makes it right away.');
 const box=page.getByRole('textbox',{name:'Message'});
 await expect(box).toBeFocused();
 await expect(box).toHaveAttribute('placeholder','e.g. I want someone to follow up on WhatsApp leads');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('main form')).toHaveCount(0);
 // The Owner's "Ask Lead for an agent" in Settings opens the same place.
 await page.goto('/c/rs-learning/settings?section=agents');
 await page.getByRole('dialog',{name:'Settings'}).getByRole('link',{name:'Ask Lead for an agent'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
 await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
 await expect(page.locator('.new-hint[role="note"]')).toBeVisible();
});
