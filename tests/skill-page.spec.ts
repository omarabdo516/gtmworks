import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #181: a learned Skill's page inside Settings › Learning. The pinned Engine has no management route over its Skill
// ledger (engine.md), so the page shows the Skill's current text in one column under "Steps", beside whose Skill it is
// with that Agent's learning mode; the link always reads "See the steps" and no restore is drawn. Both the Agent's page
// (#180) and the Learning list (#28) open it, Back returns to Learning with the row's link focused, a Contributor reads
// it, and a Viewer has no Learning section, no link and no page.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const fixture=JSON.parse(readFileSync('tests/engine-schema.json','utf8'));
const company='10000000-0000-0000-0000-000000000001';
const lead=randomUUID();
const writer=randomUUID();
const profile=`co-${company.replaceAll('-','')}`;
const writerProfile=`ag-${writer.replaceAll('-','')}`;
const space=`cs-${company.replaceAll('-','')}`;
const skill='weekly-recap';
const content=`---\nname: ${skill}\ndescription: Writes the Friday recap.\n---\n\nSend the Friday recap to the team.\nDo not use emojis.\n`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.configDefaults=fixture.defaults;
 fake.settings.configSchema={fields:fixture.schema,category_order:[]};
 for(const name of [profile,writerProfile,space]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:name===space?null:fake.settings.key,config:{},credentials:{}});
 fake.settings.skills.set(profile,new Map([[skill,content]]));
 fake.settings.learnedSkills.set(profile,new Set([skill]));
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${writer}','${company}');
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}'),
    ('${writer}','${company}','${randomUUID()}','Writer','Writing',false,'${writerProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const overlayOf=(page:import('@playwright/test').Page)=>page.getByRole('dialog',{name:'Settings'});
const agentPage=(email:string,page:import('@playwright/test').Page)=>signIn(page,email,`/c/rs-learning/settings?agent=${lead}`);
const learningPage=(email:string,page:import('@playwright/test').Page)=>signIn(page,email,'/c/rs-learning/settings?section=learning');
const skillPage=(page:import('@playwright/test').Page)=>page.getByRole('dialog',{name:'Settings'});

test('the Agent page\'s learned Skill opens its page, and Back returns to Learning with that row focused', async ({page}) => {
 await agentPage('omar@example.com',page);
 const overlay=overlayOf(page);
 const row=overlay.locator('section[aria-labelledby="set-h-skills"] li').filter({hasText:skill});
 const see=row.getByRole('link',{name:'See the steps'});
 await expect(see).toBeVisible();
 await see.click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/settings\\?section=learning&agent=${lead}&skill=${skill}$`));
 const skillScreen=skillPage(page);
 await expect(skillScreen.getByRole('heading',{name:skill})).toBeVisible();
 await expect(skillScreen.getByText('A skill of Lead · Learns on its own')).toBeVisible();
 await expect(skillScreen.getByRole('heading',{name:'Steps'})).toBeVisible();
 await expect(skillScreen.locator('.sk-col ol li')).toHaveText(['---',`name: ${skill}`,'description: Writes the Friday recap.','---','Send the Friday recap to the team.','Do not use emojis.']);
 // One column: the reference's Before/After, its version and its Why are not read, and no restore is drawn.
 await expect(skillScreen.locator('.sk-col')).toHaveCount(1);
 await expect(skillScreen.locator('.sk-diff--one')).toHaveCount(1);
 await expect(skillScreen.getByText(/Before|After|version|Why/)).toHaveCount(0);
 await expect(skillScreen.getByRole('button',{name:/Restore|previous version/})).toHaveCount(0);
 // Opening the page puts the focus on Back; Back lands on the learned row's own link.
 await expect(skillScreen.locator('#sov-skill-back')).toBeFocused();
 await skillScreen.locator('#sov-skill-back').click();
 await expect(skillScreen.getByRole('heading',{name:'Learning',exact:true})).toBeVisible();
 await expect(skillScreen.locator(`[id="ln-see-${lead}:${skill}"]`)).toBeFocused();
});

test('the Learning list\'s learned Skill opens the same page, which a Contributor reads with no restore', async ({page}) => {
 await learningPage('reviewer@example.com',page);
 const overlay=overlayOf(page);
 await expect(overlay.getByRole('heading',{name:'Learning',exact:true})).toBeVisible();
 const row=overlay.locator('.ln-row').filter({hasText:skill});
 await row.getByRole('link',{name:'See the steps'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/settings\\?section=learning&agent=${lead}&skill=${skill}$`));
 await expect(skillPage(page).getByRole('heading',{name:skill})).toBeVisible();
 await expect(skillPage(page).getByRole('heading',{name:'Steps'})).toBeVisible();
 await expect(skillPage(page).getByText('Send the Friday recap to the team.'))
  .toBeVisible();
 await expect(skillPage(page).getByRole('button',{name:/Restore|previous version/})).toHaveCount(0);
});

test('a Manager reads the Skill page too, and no restore is drawn for them either', async ({page}) => {
 await agentPage('manager@example.com',page);
 const overlay=overlayOf(page);
 await overlay.locator('section[aria-labelledby="set-h-skills"] li').filter({hasText:skill}).getByRole('link',{name:'See the steps'}).click();
 await expect(skillPage(page).getByRole('heading',{name:skill})).toBeVisible();
 await expect(skillPage(page).getByRole('button',{name:/Restore|previous version/})).toHaveCount(0);
});

test('a Viewer has no Learning section, no link, and cannot open the page\'s address', async ({page}) => {
 await agentPage('viewer@example.com',page);
 const overlay=overlayOf(page);
 await expect(overlay.getByRole('heading',{name:/^Skills/})).toBeVisible();
 await expect(overlay.locator('#sov-nav-learning')).toHaveCount(0);
 await expect(overlay.getByRole('link',{name:'See the steps'})).toHaveCount(0);
 // The address is refused: it draws the Viewer's own first section, never the Skill's text.
 await page.goto(`/c/rs-learning/settings?section=learning&agent=${lead}&skill=${skill}`);
 await expect(overlay.getByRole('heading',{name:'Learning',exact:true})).toHaveCount(0);
 await expect(overlay.getByRole('heading',{name:skill})).toHaveCount(0);
 await expect(overlay.getByRole('heading',{name:'Steps'})).toHaveCount(0);
 await expect(overlay.getByText('Send the Friday recap to the team.')).toHaveCount(0);
});
