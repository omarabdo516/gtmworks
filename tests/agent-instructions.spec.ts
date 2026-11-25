import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #176: "How it works" on an Agent's page is the text of its own Engine profile's SOUL.md outside the team's rules
// section. The Owner edits and saves it with the page's save bar, the counter counts the whole file against the size the
// Engine loads, and the change is one row of the Company log with no text. A Manager reads the same words read-only, and
// the server refuses their save (Omar, 2026-11-18: only the Owner edits it).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const saved='You are Lead.\nWrite short posts.\nNever promise a date.';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 // The main Agent keeps the Company's own profile: How it works is the SOUL.md there.
 fake.settings.profiles.set(profile,{soul:'You are Lead.\nWrite short posts.\n',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','Marketing lead',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const agentPage=(email:string,page:Page)=>signIn(page,email,`/c/rs-learning/settings?agent=${lead}`);

test('the Owner edits the standing instructions, saves them, and each save is one row of the log without them',async({page})=>{
 await agentPage('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const field=overlay.locator('#set-instr'), count=overlay.locator('#set-instr-count'), bar=overlay.locator('#dp-savebar');
 await expect(field).toHaveValue('You are Lead.\nWrite short posts.');
 await expect(count).toHaveText(/^[0-9,]+\s*\/\s*20,000$/);
 // No placeholder: the reference's examples name demo Agents (#176).
 await expect(field).not.toHaveAttribute('placeholder');
 // A click or a fill that lands before the page's code arrives is repeated until the field answers (the bar appears).
 await expect(async()=>{ await field.fill(saved); await expect(bar).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 // The counter counts the whole file as it is typed.
 await expect(count).toHaveText(`${new Intl.NumberFormat('en-US').format(saved.length)} / 20,000`);
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(bar).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 expect(fake.settings.profiles.get(profile)?.soul).toBe(saved);
 expect(JSON.parse(query(`select jsonb_build_object('field',details->>'field','agent',details->>'agent_name','actor',actor_id,
  'old',details ? 'old','new',details ? 'new') as row from public.company_log where action='agent_setting_changed' order by id desc limit 1`))[0].row)
  .toEqual({field:'instructions',agent:'Lead',actor:'20000000-0000-0000-0000-000000000001',old:false,new:false});
 // The page reads the Engine's file again, with the lines kept.
 await page.reload();
 await expect(page.getByRole('dialog',{name:'Settings'}).locator('#set-instr')).toHaveValue(saved);
});

test('a Manager reads the same words with no field, and the server refuses their save',async({page})=>{
 await agentPage('manager@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.locator('#set-how')).toContainText('You are Lead.');
 await expect(overlay.locator('#set-how')).toContainText('Never promise a date.');
 await expect(overlay.locator('#set-instr')).toHaveCount(0);
 await expect(overlay.locator('#dp-savebar')).toBeHidden();
 await expect(overlay.getByText('Standing instructions are changed by the Owner only.')).toBeVisible();
 const refused=await page.request.post('/api/agent-page',{data:{company,agent:lead,changes:{instructions:'Changed by a Manager.'}}});
 expect(refused.status()).toBe(403);
 expect(fake.settings.profiles.get(profile)?.soul).toBe(saved);
});
