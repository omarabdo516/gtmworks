import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #179: the Agent's "Thinks with" gets the Engine's eight thinking levels under its model rows. The Owner picks one and
// saves it with the page's bar; the Agent's own profile holds it and the log has one row with the old and the new level.
// A Manager reads the level as text and the server refuses their save. "Subscription and models" shows each Agent's level
// beside its model, and its default level is the reference's read-only Medium with its line for every Role.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const co=`co-${hex}`;
const lead=randomUUID(); const writer=randomUUID();
const writerProfile=`ag-${writer.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 const profile=(config:object)=>({soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
 // The main Agent keeps the Company profile and has no level saved: the Engine reads it as Medium. The Writer's own
 // profile saved Low, so the "Each agent" rows show two different levels. The Company profile's other key proves a save
 // leaves every key it did not change as it was.
 fake.settings.profiles.set(co,profile({memory:{memory_char_limit:2600}}));
 fake.settings.profiles.set(writerProfile,profile({agent:{reasoning_effort:'low'}}));
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  // The Writer's own profile record comes first: its Agent names `ag-` and the guard reads that record (deferred FK).
  query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${writer}','${company}',true);
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${randomUUID()}','Lead','Marketing lead',true,'${co}'),
    ('${writer}','${company}','${randomUUID()}','Writer','Writing',false,'${writerProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${co}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const agentPage=(email:string,page:Page)=>signIn(page,email,`/c/rs-learning/settings?agent=${lead}`);
// A click before React hydrated the control does nothing: wait until the level's radios have their handlers.
const hydrated=(page:Page)=>page.waitForFunction(()=>{
 const radio=document.querySelector('#set-effort-medium');
 return !!radio&&Object.getOwnPropertyNames(radio).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
});
const modelsPage=(email:string,page:Page)=>signIn(page,email,'/c/rs-learning/settings?section=models');
const english=(...ids:string[])=>query(`update public.people set language='en' where id in (${ids.map(id=>`'${id}'`).join(',')})`);

test('the Owner picks a level, saves it with the bar, and the Engine and the log hold it with the old and the new',async({page})=>{
 english('20000000-0000-0000-0000-000000000001');
 await agentPage('omar@example.com',page);
 await hydrated(page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const bar=overlay.locator('#dp-savebar');
 // No level saved reads as the reference's Medium, with its line; all eight of the Engine's levels are offered, and the
 // other four carry no line.
 await expect(overlay.locator('[role=radio][id^="set-effort-"]')).toHaveCount(8);
 await expect(overlay.locator('#set-effort-medium')).toHaveAttribute('aria-checked','true');
 await expect(overlay.locator('#set-effort-hint')).toHaveText('A good balance for most daily work.');
 await expect(bar).toBeHidden();
 await overlay.locator('#set-effort-max').click();
 await expect(overlay.locator('#set-effort-max')).toHaveAttribute('aria-checked','true');
 await expect(overlay.locator('#set-effort-hint')).toHaveText('The slowest, most expensive level. For big calls like a full quarter plan.');
 await expect(bar).toBeVisible();
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(bar).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 // Only the level changed in the Agent's own profile.
 expect(fake.settings.profiles.get(co)?.config?.agent?.reasoning_effort).toBe('max');
 expect(fake.settings.profiles.get(co)?.config?.memory?.memory_char_limit).toBe(2600);
 expect(JSON.parse(query(`select jsonb_build_object('setting',details->>'setting','old',details->>'old','new',details->>'new','agent',details->>'agent_name','actor',actor_id) as row
  from public.company_log where action='agent_setting_changed' and details->>'setting'='agent.reasoning_effort' order by id desc limit 1`))[0].row)
  .toEqual({setting:'agent.reasoning_effort',old:'medium',new:'max',agent:'Lead',actor:'20000000-0000-0000-0000-000000000001'});
 // Reloaded, the page shows what the Engine holds.
 await page.reload();
 await expect(overlay.locator('#set-effort-max')).toHaveAttribute('aria-checked','true');
 await expect(overlay.locator('#set-effort-hint')).toHaveText('The slowest, most expensive level. For big calls like a full quarter plan.');
});

test('"Subscription and models" reads each Agent\'s level beside its model, and the default is read-only Medium with its line',async({page})=>{
 english('20000000-0000-0000-0000-000000000001');
 await modelsPage('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const effort=overlay.locator('section[aria-labelledby="md-h-eff"]');
 await expect(effort.locator('#mdl-eff')).toHaveText('Medium');
 await expect(effort.getByText('A good balance for most daily work.')).toBeVisible();
 await expect(effort.locator('[role=radio]')).toHaveCount(0);
 await expect(overlay.locator(`#mdl-agent-${lead}-model`)).toContainText('Max');
 await expect(overlay.locator(`#mdl-agent-${writer}-model`)).toContainText('Low');
});

test('a Manager reads the level as text, and the server refuses their save',async({page})=>{
 english('20000000-0000-0000-0000-000000000002');
 await agentPage('manager@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.locator('[role=radio][id^="set-effort-"]')).toHaveCount(0);
 await expect(overlay.locator('#set-effort-val')).toHaveText('Max');
 // The page's save bar is not the level's: a Manager has one for the fields they may save on the same page (#161), and
 // the level still has no control and no way in for them (the refusal below).
 const refused=await page.request.post('/api/agent-page',{data:{company,agent:lead,changes:{effort:'low'}}});
 expect(refused.status()).toBe(403);
 expect(await refused.json()).toEqual({error:'agentPageNotAllowed'});
 expect(fake.settings.profiles.get(co)?.config?.agent?.reasoning_effort).toBe('max');
 // The default stays read-only for the Manager too. (The page is already signed in, so the section is opened, not signed in.)
 await page.goto('/c/rs-learning/settings?section=models');
 await expect(overlay.locator('#mdl-eff')).toHaveText('Medium');
 await expect(overlay.locator('[role=radio][id^="mdl-eff-"]')).toHaveCount(0);
});
