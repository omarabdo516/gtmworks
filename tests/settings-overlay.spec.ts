import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn, openNavigation, emailLink } from './sign-in';

// The settings overlay (#26): opened from the account menu over the page, closed back to it, one address per state,
// the company's real Agents (the main one first), and the Owner's agent controls checked again on the server.
const company='10000000-0000-0000-0000-000000000003';
const owner='20000000-0000-0000-0000-000000000001';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// The sections in their groups (#612): Company, Agents and Engine, then Backups, Your account and About on their own.
// Backup is the Owner's alone (#33).
const sections=['Company','Members','Company knowledge','Agents','Learning','Recurring tasks','Apps','Providers','Usage','Backups','Your account','About'];
const staffSections=sections.filter(section=>section!=='Backups');

test('the account menu opens Settings over the page, Escape and the close button return to it',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 for(const close of ['button','Escape']) {
  await openNavigation(page);
  const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
  // A click that lands while the page is still being swapped in is repeated until the menu opens.
  await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
  await settings.click();
  const overlay=page.getByRole('dialog',{name:'Settings'});
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/c\/rs-learning\/settings$/);
  await expect(overlay.getByRole('heading',{name:'Company',exact:true})).toBeVisible();
  await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(sections);
  await expect(overlay.locator('#sov-nav-company')).toHaveAttribute('aria-current','page');
  await overlay.locator('#sov-nav-account').click();
  await expect(page).toHaveURL(/\?section=account$/);
  await expect(overlay.getByRole('heading',{name:'Your account',exact:true})).toBeVisible();
  // The Backup section is the Owner's read-only page (#33): what the archive holds and leaves out, and the commands.
  await overlay.locator('#sov-nav-backup').click();
  await expect(overlay.getByRole('heading',{name:'Backups',exact:true})).toBeVisible();
  await expect(overlay.getByRole('heading',{name:'What a backup holds'})).toBeVisible();
  if(close==='button') await overlay.getByRole('button',{name:'Close settings and go back'}).click();
  else await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
  await expect(overlay).toHaveCount(0);
 }
});

// #612: Settings open over the page the person is on. On a wide screen a floating dialog with its breadcrumb leaves that
// page in view behind it, out of reach; on a phone it covers the window. Closing finds the page as it was left: the same
// drawing of it, not one drawn again, with the focus back on the account button that opened Settings.
test('Settings open over the board, which stays as it was left, and closing gives the focus back to the account button',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const board=page.locator('.work-root');
 await expect(board).toBeVisible();
 // A mark only this drawing of the board carries: a board drawn again would not have it.
 await board.evaluate(node=>node.setAttribute('data-kept','yes'));
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await settings.click();
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings$/);
 const crumbs=overlay.getByRole('navigation',{name:'Breadcrumb'}).getByRole('listitem');
 await expect(crumbs).toHaveText(['Settings','Company']);
 // A floating dialog: the board shows around it, and nothing of the board can be reached while it is open.
 const box=(await overlay.boundingBox())!, view=page.viewportSize()!;
 expect(box.x).toBeGreaterThan(0); expect(box.y).toBeGreaterThan(0); expect(box.x+box.width).toBeLessThan(view.width);
 await expect(board).toHaveAttribute('data-kept','yes');
 await expect(page.locator('[data-workspace]')).toHaveAttribute('inert','');
 await overlay.locator('#sov-nav-members').click();
 await expect(page).toHaveURL(/\?section=members$/);
 await expect(overlay.getByRole('heading',{name:'Members',exact:true})).toBeVisible();
 await expect(crumbs).toHaveText(['Settings','Company','Members']);
 await expect(crumbs.last()).toHaveAttribute('aria-current','page');
 await overlay.locator('#sov-nav-about').click();
 await expect(crumbs).toHaveText(['Settings','About']);
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 await expect(overlay).toHaveCount(0);
 await expect(board).toHaveAttribute('data-kept','yes');
 await expect(page.locator('[data-workspace]')).not.toHaveAttribute('inert');
 await expect(page.locator('#btn-me')).toBeFocused();
});

// #612: a session that ran out while the board stayed open. Settings opened over it go to sign in, and back to Settings.
test('Settings opened over a page after the session ran out go to sign in, then back to Settings',async({page,context})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await context.clearCookies();
 await settings.click();
 await expect(page).toHaveURL(/\/sign-in\?next=%2Fc%2Frs-learning%2Fsettings$/);
 await page.getByLabel('Email',{exact:true}).fill('omar@example.com');
 await page.getByLabel('Password',{exact:true}).fill('local-seed-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings$/);
 await expect(page.getByRole('dialog',{name:'Settings'})).toBeVisible();
});

// #612: on a phone the account button sits in the navigation drawer, which is closed again once Settings are open, so
// closing them gives the focus to the button that opens the drawer.
test('on a phone, closing Settings opened from the account menu gives the focus to the menu button',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await settings.click();
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 // The dialog takes the focus in the same pass that starts listening for Escape.
 await expect.poll(()=>overlay.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 await expect(overlay).toHaveCount(0);
 await expect(page.locator('.mobile-menu')).toBeFocused();
});

test('on a phone Settings cover the whole window, and the open page is the breadcrumb’s last crumb',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByRole('heading',{name:'Members',exact:true})).toBeVisible();
 expect(await overlay.boundingBox()).toEqual({x:0,y:0,width:390,height:844});
 await expect(overlay.getByRole('navigation',{name:'Breadcrumb'}).getByRole('listitem').filter({visible:true})).toHaveText(['Settings','Members']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
 // Moving between pages keeps one dialog, which neither enters again nor drops the focus from the section just chosen.
 await overlay.locator('#sov-nav-agents').click();
 await expect(page).toHaveURL(/\?section=agents$/);
 await expect(page.locator('.sov-root')).toHaveCount(1);
 await expect(overlay.locator('#sov-nav-agents')).toBeFocused();
});

// #342: the bundled Hermes is the only Hermes. No Settings section, menu entry or address connects another one.
test('Settings offer no way to connect an outside Hermes, in any section, the account menu or the old address',async({page})=>{
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(sections);
 // Each section is drawn before the next click (#630): the breadcrumb's last crumb names it, so no click lands on a page
 // being replaced.
 const lastCrumb=overlay.getByRole('navigation',{name:'Breadcrumb'}).getByRole('listitem').last();
 for(const item of await overlay.locator('.sov-nav .sb-item').all()) {
  const name=(await item.textContent())!.trim();
  await item.click();
  await expect(item).toHaveAttribute('aria-current','page');
  await expect(lastCrumb).toHaveText(name);
  await expect(overlay.getByLabel(/Hermes address|Engine address|API key/i)).toHaveCount(0);
  await expect(overlay.getByRole('button',{name:/^Connect (a )?Hermes|^Attach agent$/i})).toHaveCount(0);
 }
 await page.goto('/c/rs-learning/home');
 await openNavigation(page);
 await expect(page.getByRole('menuitem',{name:/Agent keys|Hermes connection/i})).toHaveCount(0);
 expect((await page.goto('/c/rs-learning/settings/agents'))?.status()).toBe(404);
 expect((await page.request.post('/api/hermes-connections',{data:{company:'10000000-0000-0000-0000-000000000001',intent:'save'}})).status()).toBe(404);
});

test('the keyboard alone opens Settings from the account menu, moves between sections and closes it with Escape',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 // Opening the menu puts focus on the chosen language, as the reference does (#173), and Home moves it to the first item,
 // Settings. A key press that lands while the page is still being swapped in is repeated until the menu opens.
 const chosen=page.getByRole('menu').getByRole('menuitemradio',{name:/^English/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').press('Enter'); await expect(chosen).toBeFocused({timeout:2000}); }).toPass({timeout:30000});
 await page.keyboard.press('Home');
 await expect(settings).toBeFocused();
 await page.keyboard.press('Enter');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings$/);
 await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(sections);
 // Focus moves into the overlay, so Tab walks the overlay's own controls and reaches the sections.
 await expect.poll(()=>overlay.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 const agents=overlay.locator('#sov-nav-agents');
 // The close button, Find a setting (#613), then Company, Members and Company knowledge come before Agents (#612).
 for(let presses=0;presses<7&&!await agents.evaluate(node=>node===document.activeElement);presses++) await page.keyboard.press('Tab');
 await expect(agents).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=agents$/);
 await expect(overlay.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 await expect(overlay).toHaveCount(0);
});

test('the Owner sees the company’s real Agents, main first, and makes another one main from its page',async({page})=>{
 // One Agent per connection in a company: two connections.
 const [first,second,lead,ads]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${first}','Lead','Marketing lead',true,'overlay-${first.slice(0,8)}'),('${ads}','${company}','${second}','Ads','Ads agent',false,'overlay-${second.slice(0,8)}')`);
 try {
  await signIn(page,'omar@example.com','/c/aleem/home');
  await page.goto('/c/aleem/settings?section=agents');
  const overlay=page.getByRole('dialog',{name:'Settings'});
  const rows=overlay.locator('.sov-ag');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Lead');
  await expect(rows.nth(0)).toContainText('Main');
  await expect(rows.nth(1)).toContainText('Ads agent');
  await rows.nth(1).click();
  await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}$`));
  // Name and Role are the reference's read-only rows: the Engine writes neither on a named profile (#161).
  await expect(overlay.locator('#set-name-val')).toHaveText('Ads · @ads');
  await expect(overlay.locator('#set-role-val')).toHaveText('Ads agent');
  // The Memory tab (#193) is a real tab with its own address; with no Engine profile to read it says so.
  await overlay.locator('#sov-tab-memory').click();
  await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}&tab=memory$`));
  await expect(overlay.locator('#sov-tab-memory')).toHaveAttribute('aria-selected','true');
  await expect(overlay.locator('#sov-agent-panel')).toContainText(/What Ads remembers|Its memory can’t be read right now/);
  await overlay.locator('#sov-tab-settings').click();
  await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}$`));
  await expect(overlay.locator('#set-name-val')).toHaveText('Ads · @ads');
  await overlay.locator('#set-make-main').click();
  await expect(page.locator('.toast')).toHaveText('Ads is now the main agent. It shows first for everyone');
  await expect(overlay.locator('.dp-id__name')).toContainText('Main');
  await expect.poll(()=>JSON.parse(query(`select is_default from public.hermes_agents where id='${ads}'`))[0].is_default).toBe(true);
  // The main Agent cannot be deleted here; the others can, after typing the name.
  await expect(overlay.locator('#danger-delete')).toHaveCount(0);
  await overlay.locator('#sov-back').click();
  await expect(rows.nth(0)).toContainText('Ads');
 } finally {
  query(`delete from public.hermes_agents where id in ('${lead}','${ads}')`);
 }
});

test('the Owner renames the Company from Settings; other Roles read the name and the server refuses them',async({page,browser})=>{
 const name=()=>JSON.parse(query(`select name from public.companies where id='${company}'`))[0].name as string;
 const original=name(), renamed=`Aleem Studio ${Date.now()}`;
 try {
  await signIn(page,'omar@example.com','/c/aleem/home');
  await page.goto('/c/aleem/settings?section=company');
  const overlay=page.getByRole('dialog',{name:'Settings'});
  const field=overlay.locator('#co-name');
  await expect(field).toHaveValue(original);
  const save=overlay.getByRole('button',{name:'Save',exact:true});
  await expect(save).toBeDisabled(); // nothing changed yet
  await field.fill('   ');
  await expect(save).toBeDisabled();
  await field.fill(`  ${renamed}  `);
  await save.click();
  // The settings header shows the new name once the page has been read again; the toast says it, and no inline line does.
  await expect(overlay.locator('.sov__co')).toHaveText(renamed);
  await expect(page.locator('.toast')).toHaveText(`The company is now called ${renamed}`);
  await expect(overlay.locator('#co-name-status')).toHaveCount(0);
  expect(name()).toBe(renamed);
  await expect(field).toHaveValue(renamed);
  // The Company keeps its address.
  await expect(page).toHaveURL(/\/c\/aleem\/settings\?section=company$/);
  // The Activity log shows who renamed it, the old name and the new one.
  await page.goto('/c/aleem/log');
  const row=page.locator('.lgp-body .lg-row').filter({hasText:'renamed the company'}).filter({hasText:renamed}).first();
  await expect(row.locator('.lg-name')).toHaveText('عمر');
  await expect(row.locator('.lg-val--old')).toHaveText(original);
  await expect(row.locator('.lg-change .lg-val').last()).toHaveText(renamed);

  // A Contributor of the same Company sees the name as text, and the server refuses their rename.
  const other=await browser.newContext(); const contributor=await other.newPage();
  try {
   await signIn(contributor,'multi@example.com','/c/aleem/home');
   await contributor.goto('/c/aleem/settings?section=company');
   const theirs=contributor.getByRole('dialog',{name:'Settings'});
   await expect(theirs.locator('.ro-text')).toHaveText(renamed);
   await expect(theirs.locator('#co-name')).toHaveCount(0);
   const refused=await contributor.request.post('/api/company-name',{data:{company,name:'Taken over'}});
   expect(refused.status()).toBe(403);
   expect(await refused.json()).toEqual({error:'companyRenameNotAllowed'});
  } finally { await other.close(); }
  expect(name()).toBe(renamed);
 } finally {
  query(`update public.companies set name='${original.replaceAll("'","''")}' where id='${company}'`);
 }
});

test('a Manager and a Viewer cannot rename their Company, on the page or on the server',async({page})=>{
 const rs='10000000-0000-0000-0000-000000000001';
 const name=()=>JSON.parse(query(`select name from public.companies where id='${rs}'`))[0].name as string;
 const original=name();
 for(const email of ['manager@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  await signIn(page,email,'/c/rs-learning/home');
  if(email==='manager@example.com') {
   await page.goto('/c/rs-learning/settings?section=company');
   const overlay=page.getByRole('dialog',{name:'Settings'});
   await expect(overlay.locator('.ro-text').first()).toHaveText(original);
   await expect(overlay.locator('#co-name')).toHaveCount(0);
  }
  const refused=await page.request.post('/api/company-name',{data:{company:rs,name:`Renamed by ${email}`}});
  expect(refused.status()).toBe(403);
 }
 expect(name()).toBe(original);
});

test('a Viewer sees only the Agents and their account, read only, and no Owner controls',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=company');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(['Agents','Your account','About']);
 // Asking for the Company section falls back to the Viewer's first one.
 await expect(overlay.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 await expect(overlay.getByText('Read only',{exact:true})).toBeVisible();
 await expect(overlay.locator('#set-make-main, #danger-delete')).toHaveCount(0);
 for(const section of ['usage','backup','models']) {
  await page.goto(`/c/rs-learning/settings?section=${section}`);
  await expect(overlay.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 }
});

// What each Role is shown in Settings (#26), over a main Agent and one other in RS Learning. Every selector of a surface
// is checked for every Role: on screen when the Role's row names it, absent otherwise. A Viewer has no Company section.
const rsLearning='10000000-0000-0000-0000-000000000001';
const surfaces={
 company:['#co-name','.ro-text','.ro-note:not(.sov-warn)'],
 members:['.ro-note:not(.sov-warn)','.sov-ta table','.inv-sec .inv-open','[aria-labelledby=co-h-mem] .panel-row'],
 agents:['a[href$="/chat?new=agent"]','.ro-note','.talk-tip a'],
 agent:['#set-make-main','#danger-pause','#danger-delete','.ro-note','.talk-tip a'],
};
const roleViews=[
 {role:'Owner',email:'omar@example.com',sections,readOnly:false,movesMain:true,company:['#co-name'],members:['.sov-ta table','.inv-sec .inv-open'],agents:['a[href$="/chat?new=agent"]','.talk-tip a'],agent:['#set-make-main','#danger-pause','#danger-delete','.talk-tip a']},
 {role:'Manager',email:'manager@example.com',sections:staffSections,readOnly:false,movesMain:false,company:['.ro-text'],members:['.sov-ta table'],agents:['a[href$="/chat?new=agent"]','.talk-tip a'],agent:['.talk-tip a']},
 {role:'Contributor',email:'reviewer@example.com',sections:staffSections.filter(section=>section!=='Usage'),readOnly:true,movesMain:false,company:['.ro-text','.ro-note:not(.sov-warn)'],members:['.ro-note:not(.sov-warn)','[aria-labelledby=co-h-mem] .panel-row'],agents:['a[href$="/chat?new=agent"]','.ro-note','.talk-tip a'],agent:['.ro-note','.talk-tip a']},
 {role:'Viewer',email:'viewer@example.com',sections:['Agents','Your account','About'],readOnly:true,movesMain:false,company:null,members:null,agents:['.ro-note'],agent:['.ro-note']},
];

for(const view of roleViews) test(`${view.role}: Settings shows only what the Role allows, and only the Owner's request moves the main mark`,async({page})=>{
 const [first,second,lead,ads]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${rsLearning}','${first}','Lead','Marketing lead',true,'overlay-${first.slice(0,8)}'),('${ads}','${rsLearning}','${second}','Ads','Ads agent',false,'overlay-${second.slice(0,8)}')`);
 // Ads is shown to every Member (#15), so each Role reads both Agents and the difference is only what it may do.
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${rsLearning}' and removed_at is null and role<>'owner'`);
 const main=()=>JSON.parse(query(`select id from public.hermes_agents where company_id='${rsLearning}' and is_default`)).map((row:{id:string})=>row.id);
 try {
  await signIn(page,view.email,'/c/rs-learning/home');
  const overlay=page.getByRole('dialog',{name:'Settings'});
  // Called once the surface is drawn, so an absent selector is read from the finished page.
  const shows=async(surface:keyof typeof surfaces,named:string[])=>{
   for(const selector of surfaces[surface]) {
    const found=overlay.locator(selector), why=`${view.role} ${surface}: ${selector}`;
    if(named.includes(selector)) await expect(found.first(),why).toBeVisible(); else await expect(found,why).toHaveCount(0);
   }
  };
  await page.goto('/c/rs-learning/settings?section=company');
  await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(view.sections);
  await expect(overlay.getByRole('heading',{name:view.company?'Company':'Agents',exact:true})).toBeVisible();
  await expect(overlay.locator('.sov-ro').filter({hasText:'Read only'})).toHaveCount(view.readOnly?1:0);
  if(view.company) await shows('company',view.company);
  if(view.members) {
   await page.goto('/c/rs-learning/settings?section=members');
   await expect(overlay.getByRole('heading',{name:'Members',exact:true})).toBeVisible();
   await shows('members',view.members);
  }
  await page.goto('/c/rs-learning/settings?section=agents');
  await expect(overlay.locator('.sov-ag')).toHaveCount(2);
  await shows('agents',view.agents);
  await page.goto(`/c/rs-learning/settings?agent=${ads}`);
  await expect(overlay.locator('#set-name-val')).toHaveText('Ads · @ads');
  // Pause and Delete are in Advanced, closed until opened (#615).
  await expect(overlay.locator('#set-advanced')).not.toHaveAttribute('open');
  await overlay.locator('#set-g-advanced').click();
  await shows('agent',view.agent);
  // The pinned Engine has no paused state for a profile, so Pause stays "Soon" and opens nothing (#177); force, as Playwright waits on aria-disabled.
  // Delete's confirm is drawn after the click on Pause, so a confirm Pause opened would be drawn by then too.
  if(view.agent.includes('#danger-pause')) {
   const pause=overlay.locator('#danger-pause');
   await expect(pause).toHaveAttribute('aria-disabled','true');
   await expect(pause).toHaveAttribute('title','Soon');
   await pause.click({force:true});
   await overlay.locator('#danger-delete').click();
   await expect(overlay.getByRole('group',{name:'Delete Ads'})).toBeVisible();
   await expect(overlay.locator('.danger-confirm')).toHaveCount(1);
   await expect(pause).not.toHaveAttribute('aria-expanded','true');
   await overlay.locator('#danger-delete').click();
   await expect(overlay.locator('.danger-confirm')).toHaveCount(0);
  }
  // The same request from every Role: the server checks the Role again, whatever the page offered.
  const answer=await page.request.post('/api/hermes-agents',{data:{company:rsLearning,intent:'default',agent:ads}});
  expect(answer.status()).toBe(view.movesMain?200:403);
  expect(main()).toEqual([view.movesMain?ads:lead]);
 } finally {
  query(`delete from public.hermes_agents where id in ('${lead}','${ads}')`);
 }
});

// #185: the Owner invites from the Team table without leaving the page; the invited person is a row marked "Invite sent"
// for the Owner and the Managers, and their ordinary Member row once they accept from the email.
test('the Owner invites a Member from the Team table, the row says Invite sent, and becomes a Member row when accepted',async({page,context,browser})=>{
 const local=`team-invite-${Date.now()}`, email=`${local}@example.com`;
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const address=page.url();
 await overlay.getByRole('button',{name:'Invite a member'}).click();
 await expect(overlay.locator('#inv-email')).toBeFocused();
 await overlay.locator('#inv-email').fill(email);
 await overlay.locator('#inv-role').selectOption('viewer');
 await overlay.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText(`Invite sent to ${email}`);
 await expect(overlay.locator('#inv-toggle')).toBeFocused();
 const invited=overlay.locator('.ta-table tbody tr').filter({hasText:email});
 await expect(invited.locator('.ta-role')).toHaveText(`Viewer · ${email}`);
 await expect(invited.locator('.ta-pending')).toHaveText('Invite sent');
 expect(page.url()).toBe(address);
 // The same email in another letter case is already invited: the error shows under the field and nothing is sent.
 await overlay.getByRole('button',{name:'Invite a member'}).click();
 await overlay.locator('#inv-email').fill(email.toUpperCase());
 await overlay.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(overlay.locator('#inv-email-err')).toHaveText('This email has already been invited.');
 await expect(overlay.locator('.ta-table tbody tr').filter({hasText:email})).toHaveCount(1);
 // signIn empties the local mailbox, so the invitation's link is read before the Manager signs in.
 const link=await emailLink(page,email);

 const other=await browser.newContext(); const manager=await other.newPage();
 try {
  await signIn(manager,'manager@example.com','/c/rs-learning/settings?section=members');
  const theirs=manager.getByRole('dialog',{name:'Settings'});
  await expect(theirs.locator('.ta-table tbody tr').filter({hasText:email}).locator('.ta-pending')).toHaveText('Invite sent');
  await expect(theirs.locator('#inv-toggle')).toHaveCount(0);
 } finally { await other.close(); }

 await context.clearCookies(); await page.goto(link);
 await page.getByLabel('New password').fill('team-invited-password'); await page.getByLabel('Confirm password').fill('team-invited-password');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\//);
 await context.clearCookies();
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
 const joined=overlay.locator('.ta-table tbody tr').filter({hasText:local});
 await expect(joined.locator('.ta-role')).toHaveText('Viewer');
 await expect(joined.locator('.ta-pending')).toHaveCount(0);
 await expect(overlay.locator('.ta-table tbody tr').filter({hasText:email})).toHaveCount(0);
});

// ADR 0018: Agent levels are gone. In place of the level choice the Company section says in one line what every Agent
// can use, in both languages, and offers nothing to pick.
test('Company settings say what every agent can use and offer no level choice, in English and Arabic',async({page})=>{
 query(`update public.people set language='en' where id='${owner}'`);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/settings');
  const overlay=page.getByRole('dialog',{name:'Settings'});
  const line=overlay.locator('section[aria-labelledby="co-h-tools"]');
  await expect(line.locator('#co-h-tools')).toHaveText('What every agent can use');
  await expect(line).toContainText('Every agent of the company works in its work sandbox with a terminal, files and code.');
  await expect(line).toContainText('Anything published or spent through gtmworks still waits for a person’s approval.');
  // What they are is the section's help behind its "i" (#614); no level, policy or switch of any kind is left where the
  // level choice was.
  await expect(line.locator('input,select,button:not(.info__btn),[role=radio],[role=combobox],[role=slider]')).toHaveCount(0);
  await expect(overlay.getByLabel(/level/i)).toHaveCount(0);

  query(`update public.people set language='ar' where id='${owner}'`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  const arabic=page.getByRole('dialog',{name:'الإعدادات'});
  const say=arabic.locator('section[aria-labelledby="co-h-tools"]');
  await expect(say.locator('#co-h-tools')).toHaveText('كل الوكلاء بيستخدموا إيه');
  await expect(say).toContainText('كل وكيل في الشركة بيشتغل في صندوق شغل الشركة، ومعاه تيرمنال وملفات وتشغيل كود.');
  await expect(say).toContainText('لسه بتستنى موافقة حد.');
  await expect(say.locator('input,select,button:not(.info__btn),[role=radio],[role=combobox],[role=slider]')).toHaveCount(0);
 } finally { query(`update public.people set language='en' where id='${owner}'`); }
});

// #169: a Viewer may do none of what raises these toasts, so their screens raise none, and the routes that would answer a
// permitted Member refuse them before any change is made.
test('a Viewer raises none of the toasts, on the screens or through the routes',async({page})=>{
 const rs='10000000-0000-0000-0000-000000000001';
 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 for(const path of ['/c/rs-learning/settings?section=company','/c/rs-learning/settings?section=knowledge','/c/rs-learning/settings?section=apps','/c/rs-learning/settings?section=agents','/c/rs-learning/approvals']) {
  await page.goto(path);
  await expect(page.locator('.toast')).toHaveCount(0);
 }
 // The same requests a permitted Member sends are refused for the Viewer, and no toast follows them.
 expect((await page.request.post('/api/company-name',{data:{company:rs,name:'Taken over'}})).status()).toBe(403);
 const madeToast=await page.request.post('/api/agent-toast',{data:{company:rs,agent:'10000000-0000-0000-0000-000000000099'}});
 expect(madeToast.status()).toBe(200);
 expect(await madeToast.json()).toEqual({shown:false});
 await page.goto('/c/rs-learning/settings?section=knowledge');
 await expect(page.locator('.toast')).toHaveCount(0);
});

// #130: the overlay leaves with the dialog's exit (design-reference: sovClose, .sov.is-closing) and only then returns to
// the page it was opened from; moving between sections plays neither its entrance again nor its exit. A Viewer's close
// is the same.
for(const who of [{role:'Owner',email:'omar@example.com',sections:['account','agents','company']},{role:'Viewer',email:'viewer@example.com',sections:['account','agents','account']}]) test(`${who.role}: Settings opened from the board leaves with its exit, then is gone, then the board returns; three sections play one entrance`,async({page})=>{
 await signIn(page,who.email,'/c/rs-learning/work/board');
 await page.evaluate(()=>{
  const seen:string[][]=[]; Object.assign(window,{seen});
  // The entrance, and any other animation of the overlay, from animationstart: the overlay stays, so the event comes
  // however late the frame. The exit from the closing class, with the animation it gives: the leave is a timer (useLeave
  // in lib/motion.ts), and a frame later than it (a busy CI runner) hides the overlay before animationstart is ever sent
  // (#595, as ready-made-roles.spec.ts, #526). So the event skips only the exit of an overlay already closing, which the
  // observer has recorded; an exit started without the closing class (a section change) is still recorded.
  document.addEventListener('animationstart',event=>{ const part=event.target as Element; if(part.classList.contains('sov')&&!(event.animationName==='gw-modal-out'&&part.classList.contains('is-closing'))) seen.push([event.animationName,location.pathname]); });
  new MutationObserver(()=>{
   const part=document.querySelector('.sov'), root=document.querySelector('.sov-root');
   if(part?.matches('.is-closing')&&!seen.some(([what])=>what==='closing')) seen.push(['closing',...part.getAnimations().map(run=>{ const {delay,duration}=run.effect!.getTiming(); return `${(run as CSSAnimation).animationName} ${run.playState} delay ${delay}ms for ${duration}ms`; }),location.pathname]);
   if(root?.hasAttribute('hidden')&&!seen.some(([what])=>what==='gone')) seen.push(['gone',location.pathname]);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
 });
 const seen=()=>page.evaluate(()=>(window as unknown as {seen:string[][]}).seen);
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await settings.click();
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 for(const section of who.sections) {
  await overlay.locator(`#sov-nav-${section}`).click();
  await expect(overlay.locator(`#sov-nav-${section}`)).toHaveAttribute('aria-current','page');
 }
 expect(await seen()).toEqual([['gw-fade-in','/c/rs-learning/settings']]);
 await overlay.getByRole('button',{name:'Close settings and go back'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 await expect(overlay).toHaveCount(0);
 expect(await seen()).toEqual([['gw-fade-in','/c/rs-learning/settings'],['closing','gw-modal-out running delay 0ms for 190ms','/c/rs-learning/settings'],['gone','/c/rs-learning/settings']]);
});

test('with reduced motion Settings leave at once, with no exit, by Escape',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(settings).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await settings.click();
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 // In the frame after Escape the overlay is out of the page, never marked closing.
 const after=await page.evaluate(()=>new Promise<[boolean,boolean]>(resolve=>{
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  requestAnimationFrame(()=>resolve([!!document.querySelector('.sov-root:not([hidden])'),!!document.querySelector('.sov.is-closing')]));
 }));
 expect(after).toEqual([false,false]);
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
});

// Finding a setting by name (#613), through the app as the server draws each Role's Settings.
test('the Owner finds a setting by name with /, opens it with an empty search, and a name nothing has says so until cleared',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=account');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const find=overlay.getByRole('searchbox',{name:'Find a setting'});
 const shown=overlay.locator('.sov-nav .sb-item');
 await expect(shown).toHaveText(sections);
 // A key pressed before the page has hydrated does nothing, so it is pressed again until the search takes the focus.
 await expect(async()=>{ await overlay.locator('.sov__title').click(); await page.keyboard.press('/'); await expect(find).toBeFocused({timeout:2000}); }).toPass({timeout:30000});
 await expect(find).toHaveValue('');
 await page.keyboard.type('back');
 await expect(shown).toHaveText(['Backups']);
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=backup$/);
 await expect(overlay.locator('#sov-nav-backup')).toHaveAttribute('aria-current','page');
 // The section opened starts with an empty search and every section listed.
 await expect(find).toHaveValue('');
 await expect(shown).toHaveText(sections);
 await find.fill('nothing like this');
 await expect(overlay.locator('.sov-find__none')).toHaveText(/No setting matches “nothing like this”\./);
 await expect(shown).toHaveCount(0);
 await overlay.getByRole('button',{name:'Clear search'}).click();
 await expect(shown).toHaveText(sections);
 // A slash typed in a field of the page stays in that field.
 await overlay.locator('#sov-nav-account').click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=account$/);
 const note=overlay.locator('#ac-note');
 await note.click();
 await page.keyboard.type('a/b');
 await expect(note).toBeFocused();
 await expect(note).toHaveValue(/a\/b$/);
 await expect(find).toHaveValue('');
});

test('in Arabic a Viewer finds their sections by their Arabic names and never one the Role may not open',async({page})=>{
 const viewer=`(select id from auth.users where email='viewer@example.com')`;
 query(`update public.people set language='ar' where id=${viewer}`);
 try {
  await signIn(page,'viewer@example.com','/c/rs-learning/settings?section=account');
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  const overlay=page.getByRole('dialog',{name:'الإعدادات'});
  const find=overlay.getByRole('searchbox',{name:'دوّر على إعداد'});
  const shown=overlay.locator('.sov-nav .sb-item');
  await expect(shown).toHaveText(['الوكلاء','حسابك','عن gtmworks']);
  await expect(async()=>{ await overlay.locator('.sov__title').click(); await page.keyboard.press('/'); await expect(find).toBeFocused({timeout:2000}); }).toPass({timeout:30000});
  await page.keyboard.type('الوكلا');
  await expect(shown).toHaveText(['الوكلاء']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=agents$/);
  for(const hidden of ['الاستهلاك','النسخ الاحتياطي','الشركة','التطبيقات']) {
   await find.fill(hidden);
   await expect(overlay.locator('.sov-find__none')).toHaveText(new RegExp(`مفيش إعداد فيه «${hidden}»`));
   await expect(shown).toHaveCount(0);
  }
  await overlay.getByRole('button',{name:'امسح البحث'}).click();
  await expect(shown).toHaveText(['الوكلاء','حسابك','عن gtmworks']);
 } finally { query(`update public.people set language='en' where id=${viewer}`); }
});
