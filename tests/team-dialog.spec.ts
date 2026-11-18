import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn, openNavigation } from './sign-in';

// #187: "Team" in the account menu, for an Owner and a Manager only, opening the Team dialog over the page. The table
// is Settings, Company's, so a switch turned there is the same change and holds at once; the Owner invites from it and
// a Manager has no invite button. A Company worked alone gets the narrower dialog. The dialog's keyboard and closing
// are proven in tests/components/account-menu.test.tsx; the rows behind the table in supabase/tests/
// member_agent_visibility.sql, member_invites.sql.
const company='10000000-0000-0000-0000-000000000001';
const alone='10000000-0000-0000-0000-000000000002';
const omar='20000000-0000-0000-0000-000000000001';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const id=(n:number)=>`67000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(n=>id(10+n));
const names=(page:Page)=>page.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name');

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
  update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004');
  delete from public.member_agent_access where company_id='${company}';
  delete from public.member_invitations where company_id='${company}';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${id(1)}','Lead','General',true,'team-lead'),
   ('${ads}','${company}','${id(2)}','Meta Ads','Runs the Meta ads.',false,'team-ads');
 end $$;`);
});

// Opens the account menu and chooses "Team", as a person does; the menu may still be drawing while the page lands.
async function openTeam(page:Page) {
 await openNavigation(page);
 const item=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Team/});
 await expect(async()=>{ if(!await item.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(item).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const detail=await item.locator('.menu__d').textContent();
 await item.click();
 await expect(page.getByRole('menu')).toHaveCount(0);
 const dialog=page.getByRole('dialog',{name:'Team'});
 await expect(dialog).toBeVisible();
 return {dialog,detail};
}

test('the Owner turns a switch in the Team dialog: Settings reads it and the second Member sees that Agent in the sidebar',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const {dialog,detail}=await openTeam(page);
 expect(detail).toBe('Who works with which agents');
 await expect(dialog.getByRole('heading',{name:'Team',exact:true})).toBeVisible();
 await expect(dialog.getByText(/The company has one set of agents and one memory/)).toBeVisible();
 const row=dialog.locator('.ta-table tbody tr').filter({hasText:'مراجع'});
 await expect(row.getByText('Shown to all').first()).toBeVisible();
 await expect(row.getByRole('switch',{name:'مراجع · Lead'})).toHaveCount(0);
 const toggle=row.getByRole('switch',{name:'مراجع · Meta Ads'});
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await expect(page.getByRole('dialog').locator('.ta-table tbody tr').filter({hasText:'Owner'}).getByText('The Owner sees every agent')).toBeVisible();
 await toggle.click();
 await expect(page.locator('.toast')).toHaveText('Meta Ads now shows for مراجع');
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await expect(toggle).toBeEnabled();

 // The same switch in Settings, Company, read after the change.
 await page.goto('/c/rs-learning/settings?section=company');
 const settingsTable=page.getByRole('dialog',{name:'Settings'}).locator('.ta-table');
 const inSettings=settingsTable.locator('tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'});
 await expect(inSettings).toHaveAttribute('aria-checked','true');

 // The second Member finds the Agent in their sidebar.
 const context=await browser.newContext(); const member=await context.newPage();
 try {
  await signIn(member,'reviewer@example.com','/c/rs-learning/chat');
  await openNavigation(member);
  await expect(names(member)).toHaveText(['Lead','Meta Ads']);
 } finally { await context.close(); }

 // Hidden again, with the same table and the other toast; the Member's sidebar then has Lead alone.
 await inSettings.click();
 await expect(page.locator('.toast')).toHaveText('Meta Ads is hidden from مراجع');
 await expect(inSettings).toHaveAttribute('aria-checked','false');
});

test('the Owner invites a Member from inside the dialog, its errors shown, and the invitation joins the table',async({page})=>{
 const email=`team-${Date.now()}@example.com`;
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const {dialog}=await openTeam(page);
 await dialog.getByRole('button',{name:'Invite a member'}).click();
 const field=dialog.getByLabel('Member’s email');
 await expect(field).toBeFocused();
 await dialog.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(dialog.getByText('Write the member’s email.')).toBeVisible();
 await field.fill('nour@rslearning');
 await dialog.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(dialog.getByText('This email is missing something. Write it in full, like nour@rslearning.com')).toBeVisible();
 await field.fill(email);
 await dialog.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText(`Invite sent to ${email}`);
 // The invited row is drawn in the same dialog, marked as sent.
 const pending=dialog.locator('.ta-table tbody tr').filter({hasText:email});
 await expect(pending).toBeVisible();
 await expect(pending.getByText('Invite sent')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Done'})).toBeVisible();
});

test('a Manager holds the Team table and can turn a switch, and has no invite button',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 const {dialog}=await openTeam(page);
 await expect(dialog.locator('.ta-table')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Invite a member'})).toHaveCount(0);
 await expect(dialog.locator('#inv-email')).toHaveCount(0);
 const toggle=dialog.locator('.ta-table tbody tr').filter({hasText:'عضو'}).getByRole('switch',{name:'عضو · Meta Ads'});
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await toggle.click();
 await expect(page.locator('.toast')).toHaveText('Meta Ads now shows for عضو');
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await expect(toggle).toBeEnabled();
});

test('a Contributor and a Viewer have no Team item',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  await signIn(page,email,'/c/rs-learning/home');
  await openNavigation(page);
  await page.locator('.sidebar #btn-me').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Team/})).toHaveCount(0);
  await page.keyboard.press('Escape');
 }
});

test('a Company worked alone opens the narrower dialog: the Owner’s row, the invite form already open and the note',async({page})=>{
 query(`update public.companies set work_mode='alone' where id='${alone}'`);
 await signIn(page,'omar@example.com','/c/rs-consultations/home');
 const {dialog,detail}=await openTeam(page);
 expect(detail).toBe('Just you for now · invite a member');
 await expect(dialog.getByText(/It’s just you in this workspace for now/)).toBeVisible();
 await expect(dialog.getByText('(you)')).toBeVisible();
 await expect(dialog.getByText('Owner · You see every agent and approve everything')).toBeVisible();
 await expect(dialog.getByLabel('Member’s email')).toBeFocused();
 await expect(dialog.getByText('As soon as someone you invite joins, channels and per-member agents turn on by themselves.')).toBeVisible();
 const box=await page.locator('dialog.team-dlg--solo').boundingBox();
 expect(box?.width).toBeLessThan(700);
 await dialog.getByRole('button',{name:'Done'}).click();
 await expect(page.getByRole('dialog',{name:'Team'})).toHaveCount(0);
 await expect(page.locator('.sidebar #btn-me')).toBeFocused();
});
