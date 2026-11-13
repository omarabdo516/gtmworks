import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { hashKey } from '../lib/agent-crypto.mjs';
// This spec makes its own Writer key and removes every skill it installed, because skills.spec starts from an empty Skills page.
const writerKey='agt_lessons_spec_writer_key';
const headers={Authorization:`Bearer ${writerKey}`};
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const api='/api/v1/companies/rs-learning';
const company=`(select id from public.companies where slug='rs-learning')`;
const cleanUp=()=>{ for(const table of ['skill_lessons','skill_loads','skill_enablements','skill_events','skill_versions','skills']) query(`delete from public.${table} where company_id=${company}`); };
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption(language);
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
test('an agent proposes a lesson from its run, the Inbox shows the change, the reason and the card, approving adds it to the skill and rejecting does not', async ({page,browser}) => {
 test.setTimeout(150000);
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/skills');
 cleanUp();
 query(`delete from public.agent_keys where key_hash='${hashKey(writerKey)}'`);
 query(`insert into public.agent_keys(company_id,person_id,key_hash) select m.company_id,m.person_id,'${hashKey(writerKey)}' from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning' and m.agent_role='writer' and m.removed_at is null`);
 const outside=await browser.newContext({baseURL:'http://127.0.0.1:3000'});
 try {
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/skills');
  await page.getByRole('button',{name:'Install caption-hooks'}).click();
  const writer=page.getByRole('form',{name:'caption-hooks Writer',exact:true});
  await writer.getByRole('button',{name:'Enable caption-hooks for Writer'}).click();
  await expect(writer.getByText('Enabled',{exact:true})).toBeVisible();
  // The Writer works a card on a run key; a company key proposes nothing.
  const cards=await (await page.request.get(`${api}/cards?next_actor=me`,{headers})).json();
  const card=cards.cards[0] as {id:number,title:string};
  const issued=await page.request.post(`${api}/cards/${card.id}/run-keys`,{headers,data:{ttl_seconds:900}}); expect(issued.status()).toBe(201);
  const run={Authorization:`Bearer ${(await issued.json()).key}`};
  const stamp=Date.now();
  const propose=(skill:string,body:object,key:string|null,auth=run)=>page.request.post(`${api}/skills/${skill}/lessons`,{headers:key?{...auth,'Idempotency-Key':key}:auth,data:body});
  const first={lesson:'Open every hook with the number.\nThen name the problem.',reason:'Hooks that opened with a number were saved more often.'};
  const second={lesson:'Never name a price in a hook.',reason:'Two captions with prices failed the brand check.'};
  expect((await propose('caption-hooks',first,`lesson-company-${stamp}`,headers)).status()).toBe(403);
  expect((await propose('caption-hooks',first,null)).status()).toBe(400);
  expect((await propose('caption-hooks',{lesson:'',reason:'x'},`lesson-empty-${stamp}`)).status()).toBe(400);
  expect((await propose('no-such-skill',first,`lesson-missing-${stamp}`)).status()).toBe(404);
  const proposed=await propose('caption-hooks',first,`lesson-one-${stamp}`); expect(proposed.status()).toBe(201);
  const body=await proposed.json(); expect(body.status).toBe('pending');
  const again=await propose('caption-hooks',first,`lesson-one-${stamp}`); expect(again.status()).toBe(201); expect((await again.json()).id).toBe(body.id);
  expect((await propose('caption-hooks',second,`lesson-one-${stamp}`)).status()).toBe(409);
  expect((await propose('caption-hooks',second,`lesson-two-${stamp}`)).status()).toBe(201);
  const skillText=async()=>{ const response=await page.request.get(`${api}/skills`,{headers:run}); expect(response.status()).toBe(200); return (await response.json()).skills[0] as {version:number,content:string}; };
  // Nothing is in the skill while the proposals wait.
  expect((await skillText()).version).toBe(1);
  expect((await skillText()).content).not.toContain('Open every hook with the number');
  // The Inbox shows each proposal with the change, the reason and the card.
  await page.goto('/c/rs-learning/approvals');
  const lessons=page.getByRole('group',{name:'Lesson for caption-hooks'});
  await expect(lessons).toHaveCount(2);
  const one=lessons.filter({hasText:'Open every hook with the number.'});
  await expect(one).toContainText('Open every hook with the number. Then name the problem.');
  await expect(one).toContainText('Adds this line to the Lessons section of caption-hooks');
  await expect(one).toContainText('Hooks that opened with a number were saved more often.');
  await expect(one.getByRole('link')).toHaveText(card.title);
  await expect(one.getByRole('link')).toHaveAttribute('href',`/c/rs-learning/work/board/${card.id}`);
  // A member who does not manage the company (a Contributor) sees no lessons.
  const contributor=await outside.newPage();
  await signIn(contributor,'reviewer@example.com','/c/rs-learning/approvals');
  // The Inbox opens the board on "Waiting on you" (#16, ADR 0013): its heading shows the page has loaded.
  await expect(contributor.getByRole('heading',{level:2,name:'Waiting on you',exact:true})).toBeVisible();
  await expect(contributor.getByRole('group',{name:'Lesson for caption-hooks'})).toHaveCount(0);
  // The page in both languages, at phone and desktop width, with 44px buttons and no sideways scroll on a phone.
  for(const copy of [{language:'en' as const,heading:'Lessons awaiting approval'},{language:'ar' as const,heading:'دروس تنتظر الموافقة'}]) {
   await chooseLanguage(page,copy.language);
   await page.goto('/c/rs-learning/approvals');
   await expect(page.getByRole('heading',{name:copy.heading})).toBeVisible();
   for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>document.fonts.ready);
    if(width===390) {
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
     for(const button of await page.locator('.skills-controls button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({path:`test-results/screenshots/lessons-inbox-${copy.language}-${width}.png`,fullPage:true});
    // The page scrolls inside its frame, so the page picture can stop above the panel; this picture is the whole Lessons panel.
    await page.locator('section.skills-controls').filter({has:page.getByRole('heading',{name:copy.heading})}).screenshot({path:`test-results/screenshots/lessons-panel-${copy.language}-${width}.png`});
   }
  }
  await chooseLanguage(page,'en');
  await page.setViewportSize({width:1440,height:900});
  // Approving adds the lesson to the skill; the next run reads it.
  await page.goto('/c/rs-learning/approvals');
  await page.getByRole('group',{name:'Lesson for caption-hooks'}).filter({hasText:'Open every hook with the number.'}).getByRole('button',{name:'Approve the lesson for caption-hooks'}).click();
  await expect(page.getByRole('group',{name:'Lesson for caption-hooks'})).toHaveCount(1);
  const approved=await skillText();
  expect(approved.version).toBe(2);
  expect(approved.content).toContain('## Lessons\n\n- Open every hook with the number. Then name the problem.');
  expect(approved.content).toContain('Name the one problem');
  // Rejecting adds nothing.
  await page.getByRole('button',{name:'Reject the lesson for caption-hooks'}).click();
  await expect(page.getByRole('group',{name:'Lesson for caption-hooks'})).toHaveCount(0);
  const after=await skillText();
  expect(after.version).toBe(2);
  expect(after.content).toBe(approved.content);
  expect(after.content).not.toContain('Never name a price');
  const decided=JSON.parse(query(`select status,result_version from public.skill_lessons where company_id=${company} order by id`));
  expect(decided.map((row:{status:string,result_version:number|null})=>`${row.status}:${row.result_version}`)).toEqual(['approved:2','rejected:null']);
 } finally {
  await outside.close();
  query(`update public.agent_keys set revoked_at=now() where key_hash='${hashKey(writerKey)}'`);
  await chooseLanguage(page,'en');
  cleanUp();
 }
});
