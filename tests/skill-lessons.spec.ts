import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';
// This spec removes every skill it installed, because skills.spec starts from an empty Skills page.
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company=`(select id from public.companies where slug='rs-learning')`;
const cleanUp=()=>{ for(const table of ['skill_lessons','skill_loads','skill_enablements','skill_events','skill_versions','skills']) query(`delete from public.${table} where company_id=${company}`); };
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
test('a lesson an agent left on a card waits in the Inbox, which shows the change, the reason and the card, approving adds it to the skill and rejecting does not', async ({page,browser}) => {
 test.setTimeout(150000);
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/skills');
 cleanUp();
 const outside=await browser.newContext({baseURL:appOrigin});
 try {
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/skills');
  await page.getByRole('button',{name:'Install caption-hooks'}).click();
  const writer=page.getByRole('form',{name:'caption-hooks Writer',exact:true});
  await writer.getByRole('button',{name:'Enable caption-hooks for Writer'}).click();
  await expect(writer.getByText('Enabled',{exact:true})).toBeVisible();
  // Two lessons the Writer left on the first card, as an Agent's run left them before the external-agent API was removed (#341).
  const card=rows(`select id,title from public.work_cards where company_id=${company} order by id limit 1`)[0] as {id:number,title:string};
  query(`insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint)
   select s.company_id,s.id,${card.id},m.person_id,l.lesson,l.reason,1,l.k,'f-'||l.k from public.skills s join public.members m on m.company_id=s.company_id and m.agent_role='writer' and m.removed_at is null,
   (values ('one','Open every hook with the number. Then name the problem.','Hooks that opened with a number were saved more often.'),('two','Never name a price in a hook.','Two captions with prices failed the brand check.')) l(k,lesson,reason)
   where s.company_id=${company} and s.slug='caption-hooks'`);
  const skillText=()=>rows(`select v.version,v.content from public.skill_versions v join public.skills s on s.id=v.skill_id where s.company_id=${company} and s.slug='caption-hooks' order by v.version desc limit 1`)[0] as {version:number,content:string};
  // Nothing is in the skill while the proposals wait.
  expect(skillText().version).toBe(1);
  expect(skillText().content).not.toContain('Open every hook with the number');
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
  // Approving adds the lesson to the skill.
  await page.goto('/c/rs-learning/approvals');
  await page.getByRole('group',{name:'Lesson for caption-hooks'}).filter({hasText:'Open every hook with the number.'}).getByRole('button',{name:'Approve the lesson for caption-hooks'}).click();
  await expect(page.getByRole('group',{name:'Lesson for caption-hooks'})).toHaveCount(1);
  const approved=skillText();
  expect(approved.version).toBe(2);
  expect(approved.content).toContain('## Lessons\n\n- Open every hook with the number. Then name the problem.');
  expect(approved.content).toContain('Name the one problem');
  // Rejecting adds nothing.
  await page.getByRole('button',{name:'Reject the lesson for caption-hooks'}).click();
  await expect(page.getByRole('group',{name:'Lesson for caption-hooks'})).toHaveCount(0);
  const after=skillText();
  expect(after.version).toBe(2);
  expect(after.content).toBe(approved.content);
  expect(after.content).not.toContain('Never name a price');
  const decided=JSON.parse(query(`select status,result_version from public.skill_lessons where company_id=${company} order by id`));
  expect(decided.map((row:{status:string,result_version:number|null})=>`${row.status}:${row.result_version}`)).toEqual(['approved:2','rejected:null']);
 } finally {
  await outside.close();
  await chooseLanguage(page,'en');
  cleanUp();
 }
});
