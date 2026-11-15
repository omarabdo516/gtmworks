import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn, openNavigation } from './sign-in';

// The settings overlay (#26): opened from the account menu over the page, closed back to it, one address per state,
// the company's real Agents (the main one first), and the Owner's agent controls checked again on the server.
const company='10000000-0000-0000-0000-000000000003';
const owner='20000000-0000-0000-0000-000000000001';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// The reference's ten sections, the company's nine first and Your account under "You".
const sections=['Company','Agents','Company knowledge','Learning','Subscription and models','Apps','Recurring tasks','Usage','Backups','Your account'];

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
  // Sections whose features come later show their place, empty, marked Soon, with no sample figures.
  await overlay.locator('#sov-nav-backup').click();
  await expect(overlay.locator('.sov-soon').first()).toHaveText('Soon');
  if(close==='button') await overlay.getByRole('button',{name:'Close settings and go back'}).click();
  else await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
  await expect(overlay).toHaveCount(0);
 }
});

test('the keyboard alone opens Settings from the account menu, moves between sections and closes it with Escape',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await openNavigation(page);
 const settings=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Settings/});
 // Opening the menu puts focus on its first item, Settings. A key press that lands while the page is still being
 // swapped in is repeated until the menu opens.
 await expect(async()=>{ if(!await settings.isVisible()) await page.locator('.sidebar #btn-me').press('Enter'); await expect(settings).toBeFocused({timeout:2000}); }).toPass({timeout:30000});
 await page.keyboard.press('Enter');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings$/);
 await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(sections);
 // Focus moves into the overlay, so Tab walks the overlay's own controls and reaches the sections.
 await expect.poll(()=>overlay.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 const agents=overlay.locator('#sov-nav-agents');
 for(let presses=0;presses<5&&!await agents.evaluate(node=>node===document.activeElement);presses++) await page.keyboard.press('Tab');
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
 for(const connection of [first,second]) query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${connection}','${company}','${owner}','http://localhost','overlay-${connection.slice(0,8)}','ciphertext','connected')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${lead}','${company}','${first}','Lead','Marketing lead',true),('${ads}','${company}','${second}','Ads','Ads agent',false)`);
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
  await expect(overlay.locator('#set-name')).toHaveValue('Ads');
  await expect(overlay.locator('#set-role')).toHaveValue('Ads agent');
  // The Memory tab is not built yet: drawn, disabled, saying Soon.
  await expect(overlay.locator('#sov-tab-memory')).toHaveAttribute('aria-disabled','true');
  await expect(overlay.locator('#sov-tab-memory')).toHaveAttribute('title','Soon');
  await overlay.locator('#set-make-main').click();
  await expect(overlay.locator('.dp-id__name')).toContainText('Main');
  await expect.poll(()=>JSON.parse(query(`select is_default from public.hermes_agents where id='${ads}'`))[0].is_default).toBe(true);
  // The main Agent cannot be deleted here; the others can, after typing the name.
  await expect(overlay.locator('#danger-delete')).toHaveCount(0);
  await overlay.locator('#sov-back').click();
  await expect(rows.nth(0)).toContainText('Ads');
 } finally {
  query(`delete from public.hermes_agents where id in ('${lead}','${ads}')`);
  query(`delete from public.hermes_connections where id in ('${first}','${second}')`);
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
  // The settings header shows the new name once the page has been read again, and the confirmation is still there.
  await expect(overlay.locator('.sov__co')).toHaveText(renamed);
  await expect(overlay.locator('#co-name-status')).toHaveText('Name saved.');
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
 await expect(overlay.locator('.sov-nav .sb-item')).toHaveText(['Agents','Your account']);
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
 company:['#co-name','.ro-text','.ro-note:not(.sov-warn)','.sov-ta table','.inv-sec a.inv-open','[aria-labelledby=co-h-mem] .panel-row'],
 agents:['a[href$="/chat?new=agent"]','.ro-note','.talk-tip a'],
 agent:['#set-make-main','#danger-delete','.ro-note','.talk-tip a'],
};
const roleViews=[
 {role:'Owner',email:'omar@example.com',sections,readOnly:false,movesMain:true,company:['#co-name','.sov-ta table','.inv-sec a.inv-open'],agents:['a[href$="/chat?new=agent"]','.talk-tip a'],agent:['#set-make-main','#danger-delete','.talk-tip a']},
 {role:'Manager',email:'manager@example.com',sections,readOnly:false,movesMain:false,company:['.ro-text','.sov-ta table'],agents:['.talk-tip a'],agent:['.talk-tip a']},
 {role:'Contributor',email:'reviewer@example.com',sections,readOnly:true,movesMain:false,company:['.ro-text','.ro-note:not(.sov-warn)','[aria-labelledby=co-h-mem] .panel-row'],agents:['.ro-note','.talk-tip a'],agent:['.ro-note','.talk-tip a']},
 {role:'Viewer',email:'viewer@example.com',sections:['Agents','Your account'],readOnly:true,movesMain:false,company:null,agents:['.ro-note'],agent:['.ro-note']},
];

for(const view of roleViews) test(`${view.role}: Settings shows only what the Role allows, and only the Owner's request moves the main mark`,async({page})=>{
 const [first,second,lead,ads]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
 for(const connection of [first,second]) query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${connection}','${rsLearning}','${owner}','http://localhost','roles-${connection.slice(0,8)}','ciphertext','connected')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${lead}','${rsLearning}','${first}','Lead','Marketing lead',true),('${ads}','${rsLearning}','${second}','Ads','Ads agent',false)`);
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
  await page.goto('/c/rs-learning/settings?section=agents');
  await expect(overlay.locator('.sov-ag')).toHaveCount(2);
  await shows('agents',view.agents);
  await page.goto(`/c/rs-learning/settings?agent=${ads}`);
  await expect(overlay.locator('#set-name')).toHaveValue('Ads');
  await shows('agent',view.agent);
  // The same request from every Role: the server checks the Role again, whatever the page offered.
  const answer=await page.request.post('/api/hermes-agents',{data:{company:rsLearning,intent:'default',agent:ads}});
  expect(answer.status()).toBe(view.movesMain?200:403);
  expect(main()).toEqual([view.movesMain?ads:lead]);
 } finally {
  query(`delete from public.hermes_agents where id in ('${lead}','${ads}')`);
  query(`delete from public.hermes_connections where id in ('${first}','${second}')`);
 }
});

test('the overlay fits a phone: the sections become a row and every control has a 44px tap area',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=account');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
 const nav=await overlay.locator('.sov-nav').evaluate(node=>getComputedStyle(node).flexDirection);
 expect(nav).toBe('row');
 for(const target of await overlay.locator('.sov-nav .sb-item, #sov-close, [role=radio]').all()) {
  const size=await target.evaluate(node=>{
   const own=node.getBoundingClientRect(), ring=getComputedStyle(node,'::before');
   const top=parseFloat(ring.top)||0, bottom=parseFloat(ring.bottom)||0, left=parseFloat(ring.left)||0, right=parseFloat(ring.right)||0;
   return {height:ring.content==='none'?own.height:Math.max(own.height,own.height-top-bottom),width:ring.content==='none'?own.width:Math.max(own.width,own.width-left-right)};
  });
  expect(size.height).toBeGreaterThanOrEqual(44);
  expect(size.width).toBeGreaterThanOrEqual(44);
 }
});
