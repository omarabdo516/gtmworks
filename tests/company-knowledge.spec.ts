import { test, expect, freshSeed, type Locator } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { knowledgeSkill } from '../lib/company-knowledge-skill.mjs';

// The Company knowledge (#27) in the settings overlay: a Manager fills an empty part and clears it again, every edit is
// logged, and a Contributor reads it with no way to change it, on the page or on the server. The text is the shared
// Skill company-knowledge of RS Learning's shared space in a fake Engine (#344), which holds the approved reference's
// brand voice, last edited by the Manager.
const rsLearning='10000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const profile=`co-${rsLearning.replaceAll('-','')}`;
const space=`cs-${rsLearning.replaceAll('-','')}`;
const voice='بنكلّم خريج تجارة أو محاسب في أول طريقه زي زميل أكبر منه بسنتين، مش زي مدرّس.\n• إعلانات مصر بالعامية المصرية، وإعلانات الرياض وجدة بلهجة سعودية خفيفة.\n• المقالات بفصحى بسيطة، والعنوان فيه السنة.\n• اسم RS Learning بيتكتب بالإنجليزي دايماً، من غير ترجمة.\n• مفيش علامات تعجب ولا إيموجي في نص الإعلان.\n• نبدأ بالفايدة اللي هتوصل للطالب، وبعدها تفاصيل الكورس.';
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
// The driver reaches the management listener on port 9119 beside the Engine's address; this file's fake takes a
// loopback address of its own on each lane.
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const skill=()=>fake.settings.skills.get(space)?.get('company-knowledge');
const logged=(part:string)=>rows(`select details from public.company_log where company_id='${rsLearning}' and action='company_knowledge_changed' and details->>'part'='${part}' order by created_at,id`).map(row=>row.details);
const lastEditor=(part:string)=>rows(`select actor_id from public.company_log where company_id='${rsLearning}' and action='company_knowledge_changed' and details->>'part'='${part}' order by id desc limit 1`)[0]?.actor_id;

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{}});
 fake.settings.skills.set(space,new Map([['company-knowledge',knowledgeSkill({voice})]]));
 const lead=randomUUID(); const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${rsLearning}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${rsLearning}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_audit(company_id,actor_id,action,knowledge_part,knowledge_cleared) values ('${rsLearning}','${manager}','company_knowledge_changed','voice',false);
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });
// Edit does nothing until the page has hydrated, so the click is repeated until the text field opens.
const openEditor=(part:Locator)=>expect(async()=>{
 if(!await part.locator('#know-edit').count()) await part.locator('#know-edit-btn').click();
 await expect(part.locator('#know-edit')).toBeVisible({timeout:2000});
}).toPass({timeout:30000});

test('a Manager fills an empty part, cancels and saves with the keyboard, then clears it back to its empty state; each change is logged',async({page})=>{

 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=knowledge&part=audience');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByRole('heading',{name:'Company knowledge',exact:true})).toBeVisible();
 // The page names itself with no paragraph under it; what the page is waits behind its "i" (#614).
 await expect(overlay.locator('.sov-head p')).toHaveCount(0);
 await expect(overlay.locator('#sov-h-info')).toHaveText('What every agent needs to know about the company, in one place. Any edit here reaches all of them.');
 await expect(overlay.locator('.know-tabs .chip')).toHaveText(['Brand voice','Audience','Products and prices','Banned claims','Decisions']);
 await expect(overlay.locator('#know-tab-audience')).toHaveAttribute('aria-pressed','true');
 const part=overlay.locator('.know-page');
 await expect(part.locator('.know-empty')).toHaveText('Nothing is written here yet. Write it once, and every agent reads it from its next job.');
 await expect(part.locator('.know-meta')).toHaveCount(0);

 const edit=part.getByRole('button',{name:'Edit',exact:true});
 const field=part.getByLabel('Edit “Audience”');
 await openEditor(part);
 await expect(field).toBeFocused();
 await expect(field).toHaveValue('');
 await field.fill('  Accounting graduates aged 22 to 30.\n• Cairo, Giza and Alexandria\n- Riyadh and Jeddah\n');
 await part.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText('“Audience” is saved. Every agent reads the new version from its next job.');
 await expect(part.locator('#know-status')).toHaveCount(0);
 await expect(part.locator('.know-body > p')).toHaveText(['Accounting graduates aged 22 to 30.']);
 await expect(part.locator('.know-ul li')).toHaveText(['Cairo, Giza and Alexandria','Riyadh and Jeddah']);
 await expect(part.locator('.know-meta')).toContainText('Last edited by مدير');
 await expect(edit).toBeFocused();
 expect(skill()).toBe(knowledgeSkill({voice,audience:'Accounting graduates aged 22 to 30.\n• Cairo, Giza and Alexandria\n- Riyadh and Jeddah'}));
 expect(lastEditor('audience')).toBe(manager);

 // A link that would leave the changed page keeps the person here, says so, and puts the focus on Save.
 await openEditor(part);
 await field.fill('Something else');
 await overlay.locator('#know-tab-banned').click();
 await expect(page.locator('.toast')).toHaveText('Save the page or cancel the edit first');
 await expect(part.getByRole('button',{name:'Save',exact:true})).toBeFocused();
 await expect(page).toHaveURL(/\/settings\?section=knowledge&part=audience$/);

 // Escape leaves the editor, not Settings, and keeps the saved text.
 await page.keyboard.press('Escape');
 await expect(field).toHaveCount(0);
 await expect(page).toHaveURL(/\/settings\?section=knowledge&part=audience$/);
 await expect(edit).toBeFocused();
 await expect(part.locator('.know-body > p')).toHaveText(['Accounting graduates aged 22 to 30.']);

 // Ctrl+S saves; the same text changes nothing and logs nothing.
 await openEditor(part);
 await page.keyboard.press('Control+s');
 await expect(page.locator('.toast')).toHaveText('Nothing changed.');
 // The toast comes before the editor closes with the text read again; the next edit waits for it to close.
 await expect(part.locator('#know-edit')).toHaveCount(0);
 expect(logged('audience')).toEqual([{part:'audience',cleared:false}]);

 // Saved empty, the part is cleared and shows its empty state again.
 await openEditor(part);
 await field.fill('   ');
 await page.keyboard.press('Control+s');
 await expect(page.locator('.toast')).toHaveText('“Audience” is now empty. From their next job, the agents no longer read it.');
 await expect(part.locator('.know-empty')).toBeVisible();
 await expect(part.locator('.know-body')).toHaveCount(0);
 expect(skill()).toBe(knowledgeSkill({voice}));
 expect(lastEditor('audience')).toBe(manager);
 expect(logged('audience')).toEqual([{part:'audience',cleared:false},{part:'audience',cleared:true}]);

 // The Activity log names the part and says when it was cleared.
 await page.goto('/c/rs-learning/log');
 const entries=page.locator('.lgp-body .lg-row');
 await expect(entries.filter({hasText:'edited “Audience” in the company knowledge'})).toHaveCount(1);
 await expect(entries.filter({hasText:'cleared “Audience” in the company knowledge'})).toHaveCount(1);
});

test('a Contributor reads the knowledge with no Edit button, and the server refuses their save',async({page,browser})=>{
 const before={skill:skill(),logged:logged('voice')};
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=knowledge');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.locator('#know-tab-voice')).toHaveAttribute('aria-pressed','true');
 await expect(overlay.locator('.ro-note')).toBeVisible();
 await expect(overlay.locator('.know-body')).toContainText('بنكلّم خريج تجارة');
 await expect(overlay.locator('.know-meta')).toContainText('Last edited by مدير');
 await expect(overlay.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
 await overlay.locator('#know-tab-banned').click();
 await expect(page).toHaveURL(/\/settings\?section=knowledge&part=banned$/);
 await expect(overlay.locator('.know-empty')).toHaveText('Nothing is written here yet. An Administrator or a Manager writes it.');

 // The request a Manager's Save sends (here with nothing changed), sent again with the Contributor's session and new text.
 const other=await browser.newContext(); const managerPage=await other.newPage();
 let action:{url:string,headers:Record<string,string>};
 try {
  await signIn(managerPage,'manager@example.com','/c/rs-learning/settings?section=knowledge');
  await openEditor(managerPage.locator('.know-page'));
  const [request]=await Promise.all([managerPage.waitForRequest(request=>!!request.headers()['next-action']),managerPage.locator('#know-save').click()]);
  action={url:request.url(),headers:request.headers()};
  await expect(managerPage.locator('.toast')).toHaveText('Nothing changed.');
 } finally { await other.close(); }
 const refused=await page.request.post(action.url,{headers:action.headers,data:JSON.stringify([rsLearning,'voice','Taken over'])});
 expect(await refused.text()).toContain('companyKnowledgeNotAllowed');
 expect(skill()).toBe(before.skill);
 expect(logged('voice')).toEqual(before.logged);
});

// #630: an Engine that does not answer leaves Settings standing. The part says it cannot be read, with no editor that
// could save over text nobody saw, and the other sections still open from the same overlay.
test('when the Engine does not answer, the part says it cannot be read, with no Edit button, and Settings stay open',async({page})=>{
 fake.settings.managementStatus=503;
 try {
  await signIn(page,'manager@example.com','/c/rs-learning/settings?section=knowledge');
  const overlay=page.getByRole('dialog',{name:'Settings'});
  await expect(overlay.getByRole('heading',{name:'Company knowledge',exact:true})).toBeVisible();
  await expect(overlay.locator('.know-unread')).toHaveText('The Company knowledge can’t be read right now.');
  await expect(overlay.locator('#know-tab-voice')).toHaveAttribute('aria-pressed','true');
  await expect(overlay.locator('#know-edit-btn')).toHaveCount(0);
  await expect(overlay.locator('.know-body')).toHaveCount(0);
  await expect(page.getByText('Could not load this page')).toHaveCount(0);
  await overlay.locator('#sov-nav-members').click();
  await expect(overlay.getByRole('heading',{name:'Members',exact:true})).toBeVisible();
 } finally { fake.settings.managementStatus=200; }
});
