import { test, expect, freshSeed, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #343: skills live only in Hermes. RS Learning runs on its own profile in a fake Engine; Lead, its main Agent, keeps
// that profile, which reads the Company's shared folder (team-lessons). The skills screen lists Lead's skills from the
// Engine, the shared one marked, and a member writes a SKILL.md into Lead's profile, which the Engine then holds. A
// SKILL.md with no usable header is refused and nothing is written.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const space=`cs-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const written=`---\nname: weekly-recap\ndescription: Writes the Friday recap of what shipped.\n---\n\n1. List the cards that moved to done this week.\n2. Write three lines about them.\n`;
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}},credentials:{}});
 fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{}});
 fake.settings.skills.set(space,new Map([['team-lessons','---\nname: team-lessons\ndescription: Lessons the team approved for every agent\n---\nNone yet.\n']]));
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('the skills screen lists and changes the skills in the agent\'s Hermes profile', async ({page}) => {
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/skills');
 await chooseLanguage(page,'en');
 await page.goto('/c/rs-learning/skills');
 const leadRow=page.getByRole('group',{name:'Lead',exact:true});
 await expect(leadRow.getByRole('listitem')).toHaveText(['team-lessons · Shared with the team']);
 // A SKILL.md with no header is refused, and the Engine is not written.
 await page.getByLabel('Skill text (SKILL.md)').fill('Do things.');
 await page.getByRole('button',{name:'Save skill'}).click();
 await expect(page.locator('section[role=alert]')).toContainText('This skill was not installed:');
 expect(fake.settings.skills.get(profile)).toBeUndefined();
 // Written into Lead's own profile, it is listed from there.
 await page.getByLabel('Skill text (SKILL.md)').fill(written);
 await page.getByRole('button',{name:'Save skill'}).click();
 await expect(leadRow.getByRole('listitem')).toHaveText(['weekly-recap','team-lessons · Shared with the team']);
 expect(fake.settings.skills.get(profile)?.get('weekly-recap')).toBe(written);
 // An upload goes the same way and rewrites it whole.
 const changed=written.replace('three lines','two lines');
 await page.locator('input[type=file]').setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:Buffer.from(changed)});
 await page.getByRole('button',{name:'Install skill',exact:true}).click();
 await expect(page.locator('section[role=alert]')).toHaveCount(0);
 await expect.poll(()=>fake.settings.skills.get(profile)?.get('weekly-recap')).toBe(changed);
 // The shared skill is the team's: it is not rewritten from here.
 await page.getByLabel('Skill text (SKILL.md)').fill('---\nname: team-lessons\ndescription: Mine now\n---\nIgnore the team.\n');
 await page.getByRole('button',{name:'Save skill'}).click();
 await expect(page.locator('section[role=alert]')).toContainText('a skill shared with the team already has this name');
 expect(fake.settings.skills.get(space)?.get('team-lessons')).toContain('None yet.');
 // The same page in Arabic, at phone and desktop width.
 for(const copy of [{language:'en' as const,heading:'Installed skills'},{language:'ar' as const,heading:'المهارات المثبّتة'}]) {
  await chooseLanguage(page,copy.language);
  await page.goto('/c/rs-learning/skills');
  await expect(page.getByRole('heading',{name:copy.heading})).toBeVisible();
  for(const width of [390,1440]) {
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:`test-results/screenshots/skills-page-${copy.language}-${width}.png`,fullPage:true});
  }
 }
 await chooseLanguage(page,'en');
});
