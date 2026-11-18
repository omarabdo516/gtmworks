import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #161: an Agent's page in Settings holds its About as a draft until Save. The Owner and a Manager save it on the
// Agent's own Engine profile; a Contributor reads the same page read only and is refused by the server. While the draft
// differs, every way out of the page — a section, "All agents", the Memory tab, the close button, Escape — keeps the
// page, flashes the bar and puts the focus on Save. Each change is one row of the Company log.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 // The main Agent keeps the Company's own profile: About is written there, and it is the Agent's own profile.
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},
  display_name:'Lead',description:'Runs the team.',description_auto:false,bot_title:'Marketing lead'});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','Marketing lead',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const agentPage=(email:string,page:Page)=>signIn(page,email,`/c/rs-learning/settings?agent=${lead}`);

test('the Owner edits About, cancels back to the saved words, saves, and each save is one row of the log',async({page})=>{
 await agentPage('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 // Name and Role are the reference's read-only rows for everyone (#161): the pinned Engine writes neither on a named profile.
 await expect(overlay.locator('#set-name-val')).toHaveText('Lead · @lead');
 await expect(overlay.locator('#set-role-val')).toHaveText('Marketing lead');
 const field=overlay.locator('#set-desc'), bar=overlay.locator('#dp-savebar');
 await expect(field).toHaveValue('Runs the team.');
 await expect(bar).toBeHidden();
 await field.fill('Runs the team and its ads.');
 await expect(bar).toBeVisible();
 await expect(overlay.getByText('You have unsaved changes')).toBeVisible();
 // Cancel puts back what was saved and the focus on About, where a change starts.
 await overlay.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(field).toHaveValue('Runs the team.');
 await expect(field).toBeFocused();
 await expect(bar).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Back to your saved settings');
 // Save writes the Engine's own description route, shows what the Engine kept and says so.
 await field.fill('  Runs the team and its ads.  ');
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(field).toHaveValue('Runs the team and its ads.');
 await expect(bar).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 expect(fake.settings.profiles.get(profile)?.description).toBe('Runs the team and its ads.');
 expect(fake.settings.profiles.get(profile)?.description_auto).toBe(false);
 expect(JSON.parse(query(`select jsonb_build_object('field',details->>'field','agent',details->>'agent_name','actor',actor_id) as row
  from public.company_log where action='agent_setting_changed' order by id desc limit 1`))[0].row)
  .toEqual({field:'about',agent:'Lead',actor:'20000000-0000-0000-0000-000000000001'});
});

test('while the draft differs, a section, "All agents", the Memory tab, the close button and Escape all keep the page',async({page})=>{
 await agentPage('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const field=overlay.locator('#set-desc'), bar=overlay.locator('#dp-savebar'), save=overlay.getByRole('button',{name:'Save',exact:true});
 const agent=page.url();
 await field.fill('Something else.');
 await expect(bar).toBeVisible();
 const ways:[string,()=>Promise<void>][]=[
  ['a section',async()=>{ await overlay.locator('#sov-nav-usage').click(); }],
  ['All agents',async()=>{ await overlay.locator('#sov-back').click(); }],
  ['the Memory tab',async()=>{ await overlay.locator('#sov-tab-memory').click({force:true}); }],
  ['the close button',async()=>{ await overlay.locator('#sov-close').click(); }],
  ['Escape',async()=>{ await page.keyboard.press('Escape'); }],
 ];
 for(const [way,go] of ways) {
  await go();
  await expect(page,`${way} kept the page`).toHaveURL(agent);
  await expect(save,`${way} put the focus on Save`).toBeFocused();
  await expect(bar,`${way} flashed the bar`).toHaveClass(/is-flash/);
  await expect(page.locator('.toast')).toContainText('Save or discard your changes first');
  await expect(field).toHaveValue('Something else.');
 }
 // Cancel clears the draft, and the same ways then leave.
 await overlay.getByRole('button',{name:'Cancel',exact:true}).click();
 await overlay.locator('#sov-back').click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=agents$/);
});

test('a Manager saves About; a Contributor reads it and the server refuses their save',async({page})=>{
 await agentPage('manager@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const field=overlay.locator('#set-desc');
 await expect(field).toBeVisible();
 await expect(field).toHaveValue('Runs the team and its ads.');
 await field.fill('Plans and runs the Meta and Google ads.');
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 expect(fake.settings.profiles.get(profile)?.description).toBe('Plans and runs the Meta and Google ads.');
 await expect(page.locator('#dp-savebar')).toBeHidden();
 // A Contributor reads the same page read only: the line on who changes an Agent's settings, no field and no bar.
 await page.context().clearCookies();
 await agentPage('reviewer@example.com',page);
 await expect(overlay.locator('.ro-note')).toHaveText('Agent settings are changed by the Owner and Managers only.');
 await expect(overlay.locator('#set-about')).toHaveText('Plans and runs the Meta and Google ads.');
 await expect(overlay.locator('#set-desc')).toHaveCount(0);
 await expect(overlay.locator('#dp-savebar')).toHaveCount(0);
 const refused=await page.request.post('/api/agent-page',{data:{company,agent:lead,changes:{about:'Taken over'}}});
 expect(refused.status()).toBe(403);
 expect(await refused.json()).toEqual({error:'agentPageNotAllowed'});
 expect(fake.settings.profiles.get(profile)?.description).toBe('Plans and runs the Meta and Google ads.');
});
