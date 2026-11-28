import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { openNavigation, signIn } from './sign-in';

// A Member asks Lead for an Agent from the sidebar, and a Viewer cannot ask. The request Lead prepared in a
// Conversation was a card of the old Conversation record (gone with #883; spec #926 takes requests on).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
// The driver reaches the management listener on port 9119 beside the Hermes address; this file's fake takes a loopback
// address of its own, so it never shares the port with another file's.
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 // A retry, or a repeat of this serial file, starts it again from the seed, so its rows are inserted once.
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  // Saved through the Owner's route so its key is encrypted.
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('a Manager and a Contributor ask for an agent from the sidebar; a Viewer has no button and is told they cannot ask',async({page})=>{
 for(const email of ['manager@example.com','reviewer@example.com']) {
  await signIn(page,email,'/c/rs-learning/home');
  await openNavigation(page);
  const tile=page.locator('.sidebar .agent-tile--new');
  await expect(tile).toHaveText('Ask for an agent');
  await tile.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
  await expect(page.locator('.new-hint[role="note"] .new-hint__t')).toHaveText('Tell Lead what you need an agent for, and it prepares the request for عمر.');
  // #189: every Member who may write reaches the ready-made gallery from the hint line.
  await expect(page.locator('.new-hint__alt')).toHaveText('or pick a ready-made one');
  await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
  await page.context().clearCookies();
 }

 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await expect(page.locator('.sidebar .agent-grid .agent-tile').first()).toBeVisible();
 await expect(page.locator('.sidebar .agent-tile--new')).toHaveCount(0);
 await page.goto('/c/rs-learning/chat?new=agent');
 await expect(page.locator('.ro-line')).toHaveText('Your account is view-only: you read without writing or approving, and you can’t ask for a new agent.');
 await expect(page.locator('.new-hint')).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Message'})).toHaveCount(0);
 await page.goto('/c/rs-learning/settings?section=agents');
 const settings=page.getByRole('dialog',{name:'Settings'});
 await expect(settings.locator('.sov-ag').first()).toBeVisible();
 await expect(settings.getByText('Ask for an agent')).toHaveCount(0);
 await expect(settings.locator('a[href$="/chat?new=agent"]')).toHaveCount(0);
});
