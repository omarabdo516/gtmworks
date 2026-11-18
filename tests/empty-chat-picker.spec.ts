import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #171: a known Agent's empty chat offers the picker: the faces of every Agent this Member sees, the heading and the line
// about "@", one chip per Agent with the main Agent first and the opened one pressed, and the reference's two general
// suggestions. Picking a chip turns the page into that Agent's empty chat with no navigation, its chip pressed and
// focused, and a message then starts the Conversation with the picked Agent.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const reviewer='20000000-0000-0000-0000-000000000003';
const viewer='20000000-0000-0000-0000-000000000004';
const id=(n:number)=>`67000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const connection=(n:number)=>`68000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const chat=(n:number)=>`63000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
// Lead is the main Agent; Meta Ads has a ready-made role, so its second suggestion starts from its own sentence. SEO is
// hidden from the Member and the Viewer; Analyst has no Conversation with either yet.
const [lead,ads,seo,copy,analyst]=[11,12,13,14,15].map(n=>id(n));
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
  update public.people set language='en' where id in ('${reviewer}','${viewer}');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,template,profile) values
   ('${lead}','${company}','${connection(1)}','Lead','General',true,null,'pick-lead'),
   ('${ads}','${company}','${connection(2)}','Meta Ads','Runs the Meta ads.',false,'writer','pick-ads'),
   ('${seo}','${company}','${connection(3)}','SEO','Writes the blog.',false,null,'pick-seo'),
   ('${copy}','${company}','${connection(4)}','Copy','Writes the copy.',false,null,'pick-copy'),
   ('${analyst}','${company}','${connection(5)}','Analyst','Reads the numbers.',false,null,'pick-analyst');
  insert into public.member_agent_access(company_id,person_id,agent_id) values
   ('${company}','${reviewer}','${ads}'),('${company}','${reviewer}','${copy}'),('${company}','${reviewer}','${analyst}'),
   ('${company}','${viewer}','${ads}'),('${company}','${viewer}','${copy}'),('${company}','${viewer}','${analyst}');
 end $$;`);
 // The Member already writes to Meta Ads and Copy; the Viewer reads Meta Ads. Analyst is new to both, SEO is hidden.
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values
  ('${chat(1)}','${company}','${reviewer}','${ads}','Meta Ads','2026-06-10T09:00:00Z'),
  ('${chat(2)}','${company}','${reviewer}','${copy}','Copy','2026-06-10T09:00:00Z'),
  ('${chat(3)}','${company}','${viewer}','${ads}','Meta Ads','2026-06-10T09:00:00Z')`);
 fake=await laneHermes();
});
test.afterAll(async()=>{ await fake.close(); });

const chips=(page:Page)=>page.locator('.agent-picker .chip');
const field=(page:Page)=>page.getByRole('textbox',{name:'Message'});

test('an Agent the Member writes to offers one chip for every Agent they see, the main Agent first, the opened one pressed and the hidden one absent',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/chat/${ads}`);
 await expect(page.locator('.empty-chat h2')).toHaveText('What should we work on today?');
 await expect(page.locator('.empty-chat p')).toHaveText('Pick the agent you want to talk to, or type @ in your message to call any of them.');
 await expect(page.locator('.empty-chat__faces svg')).toHaveCount(4);
 await expect(page.getByRole('group',{name:'Pick an agent'})).toBeVisible();
 await expect(chips(page)).toHaveText(['Lead','Analyst','Copy','Meta Ads']);
 await expect(chips(page).filter({hasText:'Meta Ads'})).toHaveAttribute('aria-pressed','true');
 await expect(chips(page).filter({hasText:'Lead'})).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('.agent-picker')).not.toContainText('SEO');
 await expect(page.getByRole('button',{name:'Tell me what you can do',exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Start with a first job',exact:false})).toContainText('Write a 1,500-word article on a question our customers often ask');
});

test('picking a chip turns the page into that Agent\'s empty chat with no navigation, the chip pressed and focused, and the title, the details and the placeholder follow it',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/chat/${ads}`);
 await chips(page).filter({hasText:'Copy'}).click();
 await expect(page).toHaveURL(`/c/rs-learning/chat/${ads}`);
 await expect(chips(page).filter({hasText:'Copy'})).toHaveAttribute('aria-pressed','true');
 await expect(chips(page).filter({hasText:'Copy'})).toBeFocused();
 await expect(page.getByRole('button',{name:'New chat · Details: Copy'})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Details: Copy'})).toBeVisible();
 await expect(field(page)).toHaveAttribute('placeholder','Write to Copy…');
 // The picked Agent's own suggestions follow it, and one fills the composer without sending anything.
 await page.getByRole('button',{name:'Tell me what you can do',exact:false}).click();
 await expect(field(page)).toHaveValue('Tell me what you can do: and the tools you need');
 await expect(page).toHaveURL(`/c/rs-learning/chat/${ads}`);
 // The main Agent's chip shows its own state, with no picker.
 await page.getByRole('button',{name:'Lead',exact:true}).click();
 await expect(page.getByText('The team’s main point of contact. Need a new agent? Tell it and it prepares the request for Omar.',{exact:true})).toBeVisible();
 await expect(field(page)).toHaveAttribute('placeholder','Write to Lead…');
 await expect(page.locator('.empty-chat h2')).toBeFocused();
 await expect(page.locator('.agent-picker')).toHaveCount(0);
});

test('picking an Agent not written to yet shows the new Agent\'s empty chat',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/chat/${ads}`);
 await chips(page).filter({hasText:'Analyst'}).click();
 await expect(page.locator('.empty-chat h2')).toHaveText('Analyst');
 await expect(page.getByText('Reads the numbers. · Works with the whole team',{exact:true})).toBeVisible();
 await expect(page.getByText('Give it a first job. It’ll ask you for anything missing and get it done.',{exact:true})).toBeVisible();
 await expect(field(page)).toHaveAttribute('placeholder','Write to Analyst…');
 await expect(page.locator('.agent-picker')).toHaveCount(0);
});

test('a Viewer sees the faces, the line and the picker, and no suggestions',async({browser})=>{
 const context=await browser.newContext(); const seen=await context.newPage();
 try {
  await signIn(seen,'viewer@example.com',`/c/rs-learning/chat/${ads}`);
  await expect(seen.locator('.empty-chat h2')).toHaveText('What should we work on today?');
  await expect(seen.locator('.agent-picker .chip')).toHaveCount(4);
  await expect(seen.locator('.suggest')).toHaveCount(0);
  await expect(seen.getByRole('note').filter({hasText:'view-only'})).toBeVisible();
 } finally { await context.close(); }
});

test('a message sent after picking starts the Conversation with the picked Agent',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/chat/${ads}`);
 await chips(page).filter({hasText:'Analyst'}).click();
 await field(page).fill(`Who is waiting on what today ${randomUUID()}`);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 const started=page.url().split('/').pop()!;
 expect(rows(`select agent_id from public.conversations where id='${started}'`)).toEqual([{agent_id:analyst}]);
});
