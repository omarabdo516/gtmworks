import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn, openNavigation, closeNavigation, chooseCompany } from './sign-in';
import { idle } from './navigation-measure';
import { i18n } from '../lib/i18n.mjs';
import { sections } from '../lib/navigation';

const quote=(sql:string|number)=>`'${String(sql).replaceAll("'","''")}'`;

// The approved reference's sidebar (#284): four entries, then the Agents with Lead first, then recent chats.
const labels=["Chats","Marketing board","Numbers","Activity log"];
async function navLabels(page:import('@playwright/test').Page) {
 await openNavigation(page);
 return page.locator('.sidebar .sb-nav .sb-item').allInnerTexts();
}
for(const width of [1440,390]) test(`company frame order, placeholders, LTR and every section inside the new shell at ${width}px`,async({page})=>{
 test.setTimeout(180000);
 await page.setViewportSize({width,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await expect(page.locator('.sidebar .switch')).toHaveCount(1);
 await expect(page.locator('.topbar')).toHaveText("Home");
 await expect(page.locator('.topbar .mobile-menu')).toHaveCount(1);
 expect(await navLabels(page)).toEqual(labels);
 await expect(page.locator('.sidebar .sb-label').first()).toHaveText("Agents");
 await expect(page.locator('.sidebar .sb-nav a[aria-current=page]')).toHaveText("Numbers");
 const layout=await page.locator('.sidebar').evaluate(sidebar=>{
  const active=sidebar.querySelector('.sb-nav [aria-current=page]')!,icon=active.querySelector('svg')!,label=active.querySelector('.od-fill')!;
  return {left:sidebar.getBoundingClientRect().left,dir:getComputedStyle(sidebar).direction,iconLeft:icon.getBoundingClientRect().right<=label.getBoundingClientRect().left};
 });
 expect(layout).toMatchObject({left:0,dir:'ltr',iconLeft:true});
 await closeNavigation(page);
 await page.screenshot({path:`test-results/screenshots/frame-home-${width}.png`,fullPage:true});
 const routes=Object.keys(sections).filter(path=>path!=='work/new');
 for(const path of routes) {
  await page.goto(`/c/rs-learning/${path}`);
  expect(await navLabels(page),path).toEqual(labels);
  await closeNavigation(page);
  const leaf={'settings/members':'members','settings/work':'workSettings','settings/agents':'agents'}[path as string];
  if(leaf) {
   const crumbs=page.locator('.topbar [data-slot="breadcrumb"] li:not([role="presentation"])');
   await expect(crumbs,path).toHaveCount(3);
   await expect(crumbs.nth(1),path).toHaveText(i18n().t('settings'));
   await expect(crumbs.nth(2),path).toHaveText(i18n().t(leaf));
   await expect(crumbs.nth(1).locator('a'),path).toHaveAttribute('href','/c/rs-learning/settings');
  } else await expect(page.locator('.topbar'),path).toHaveText(i18n().t(sections[path]));
 }
 // Sections without a sidebar entry still open, by their address, inside the same shell.
 const placeholders=[['recurring',"No routines yet"],['skills',"No skills yet"],['connections',"No connections yet"],['search',"Search is not available yet"]];
 for(const [path,text] of placeholders) {
  await page.goto(`/c/rs-learning/${path}`);
  await expect(page.locator('.content .empty')).toHaveText(text);
  expect(await navLabels(page),path).toEqual(labels);
  await closeNavigation(page);
 }
 await openNavigation(page);
 await page.locator('.sidebar .sb-nav').getByRole('link',{name:"Activity log",exact:true}).click();
 await expect(page.locator('.content .empty')).toHaveText("No activity log yet");
 await openNavigation(page);
 await page.locator('.sidebar .sb-nav').getByRole('link',{name:"Marketing board",exact:true}).click();
 await expect(page).toHaveURL(/\/work\/board$/);
 await openNavigation(page);
 await page.getByRole('button',{name:"Account menu",exact:true}).click();
 await page.getByRole('menu').getByRole('menuitem',{name:/^Settings/}).click();
 await expect(page).toHaveURL(/\/settings$/);
 // New chat opens the main Agent's empty Conversation (or says no agent is attached yet).
 await openNavigation(page);
 await page.getByRole('link',{name:"New chat",exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat$/);
 await expect(page.locator('.chat .empty-chat')).toBeVisible();
 await expect(page.locator('.sidebar .sb-nav a[aria-current=page]')).toHaveText("Chats");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
});

test('Viewer has the same navigation, New chat included, without new card on every company section',async({page})=>{
 test.setTimeout(180000);
 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 for(const path of Object.keys(sections)) {
  await page.goto(`/c/rs-learning/${path}`);
  expect(await navLabels(page),path).toEqual(labels);
  await expect(page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true})).toBeVisible();
  await expect(page.locator('.sidebar').getByText("New card",{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:"+ New card",exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);
 }
});

test('Home has four parts in order and missing sources show unavailable, never zero',async({page})=>{
 await signIn(page,'multi@example.com','/c/aleem/home');
 expect(await page.locator('.home-dashboard > section').evaluateAll(parts=>parts.map(part=>part.getAttribute('aria-label')))).toEqual(["Agents","Work figures","Last 14 days","Latest updates"]);
 await expect(page.locator('.home-agents article')).toHaveCount(4);
 await expect(page.locator('.home-agents article p')).toHaveText(Array(4).fill("Not working now"));
 await expect(page.locator('.stats .label')).toHaveText(["Awaiting your approval","Published this week","Bookings this week","Stopped cards"]);
 await expect(page.locator('.home-charts h2')).toHaveText(["Delivered work","Cards by stage","First-time acceptance"]);
 await expect(page.locator('.home-recent h2')).toHaveText(["Recent activity","Recent cards"]);
 const missing=page.locator('.stats .stat:nth-child(n+2) strong, .acceptance-chart p');
 await expect(missing).toHaveCount(4);
 await expect(missing).toHaveText(Array(4).fill("Unavailable"));
 for(const item of await missing.all()) await expect(item).not.toHaveText(/^0(?:%|\s*)$/);
 await expect(page.locator('.stats .stat').first().locator('strong')).toHaveText('0'); // A real empty approval queue.
 await expect(page.locator('.content')).not.toContainText(/Spend|Run count/);
 await chooseCompany(page,'rs-learning');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 const current=page.locator('.home-agents article').filter({has:page.getByRole('heading',{name:"Writer",exact:true})}).getByRole('link');
 await expect(current).toBeVisible();
 const cardPath=await current.getAttribute('href');
 await page.goto('/c/rs-learning/work/list');
 const assigned=page.locator('.table tbody tr').filter({has:page.locator(`a[href="${cardPath}"]`)});
 await expect(assigned.locator('td').last()).toHaveText('وكيل المحتوى');
 // The Inbox count sits on the Marketing board entry and opens the Inbox.
 await page.goto('/c/rs-learning/approvals');
 await expect(page.locator('.approvals')).toBeVisible();
 const count=await page.locator('.approval-card').count();
 const badge=page.locator('.sidebar .sb-count[href$="/approvals"]');
 if(count) {
  await expect(badge).toHaveText(String(count));
  await expect(badge).toHaveAccessibleName(`${count} things waiting on you`);
  await page.goto('/c/rs-learning/work/board');
  await openNavigation(page);
  await badge.click();
  await expect(page).toHaveURL(/\/approvals$/);
 } else await expect(badge).toHaveCount(0);
 await openNavigation(page);
 await page.locator('.sidebar .sb-nav a[href$="/home"]').click();
 await expect(page.locator('.stats strong').first()).toHaveText(String(count));
});

test('owner assigns a new Contributor agent through settings, Home follows renames, and demotion clears the key',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const current=page.locator('.home-agents article').filter({has:page.getByRole('heading',{name:"Writer",exact:true})}).getByRole('link');
 await expect(current).toBeVisible();
 const cardPath=await current.getAttribute('href');
 const title=await current.textContent();
 const card=Number(cardPath!.split('/').pop());
 const person=randomUUID();
 const initialName=`وكيل اختبار مستقل ${person}`;
 const renamed='كاتب المحتوى بعد تغيير الاسم';
 // Supabase CLI targets the local test database by default; never pass --remote.
 const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
 const [writer]=JSON.parse(query("select m.company_id,m.person_id from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning' and m.agent_role='writer' and m.removed_at is null"));
 try {
  query(`do $$ begin
   update public.members set agent_role=null where company_id=${quote(writer.company_id)} and person_id=${quote(writer.person_id)};
   insert into auth.users(id) values (${quote(person)});
   insert into public.people(id,name) values (${quote(person)},${quote(initialName)});
   insert into public.members(company_id,person_id,role) values (${quote(writer.company_id)},${quote(person)},'contributor');
   update public.work_cards set next_actor=${quote(person)} where company_id=${quote(writer.company_id)} and id=${quote(card)};
   end $$;`);
  await page.goto('/c/rs-learning/settings/members');
  const member=page.locator('.member-row').filter({has:page.locator('strong',{hasText:initialName})});
  const picker=member.getByRole('combobox',{name:"Agent role",exact:true});
  await expect(picker).toHaveValue('');
  await expect(picker.locator('option')).toHaveText(["No agent role","Account manager","Writer","Designer","Critic"]);
  await picker.selectOption('designer');
  await member.getByRole('button',{name:"Save",exact:true}).click();
  await expect(page.getByRole('status')).toHaveText("This agent role is assigned to another active member in the company. Remove that assignment first.");
  expect(JSON.parse(query(`select agent_role from public.members where company_id=${quote(writer.company_id)} and person_id=${quote(person)}`))[0].agent_role).toBeNull();
  await picker.selectOption('writer');
  await member.getByRole('button',{name:"Save",exact:true}).click();
  await expect(page.getByRole('status')).toHaveText("Change saved.");
  await expect(picker).toHaveValue('writer');
  await expect(page.locator('.detail-row').filter({hasText:initialName}).filter({hasText:'Agent role: No agent role to Writer'})).toHaveCount(1);
  const [audit]=JSON.parse(query(`select actor_id,after_data->>'agent_role' as agent_role from public.member_audit where company_id=${quote(writer.company_id)} and person_id=${quote(person)} and action='UPDATE' order by id desc limit 1`));
  expect(audit).toEqual({actor_id:'20000000-0000-0000-0000-000000000001',agent_role:'writer'});
  await openNavigation(page);
  await page.locator('.nav a[href$="/home"]').click();
  await expect(current).toHaveAttribute('href',cardPath!);
  await expect(current).toHaveText(title!);
  expect(query(`update public.people set name=${quote(renamed)} where id=${quote(person)} returning name;`)).toContain(renamed);
  await page.reload();
  await expect(current).toHaveAttribute('href',cardPath!);
  await expect(current).toHaveText(title!);
  await page.goto('/c/rs-learning/work/list');
  const assigned=page.locator('.table tbody tr').filter({has:page.locator(`a[href="${cardPath}"]`)});
  await expect(assigned.locator('td').last()).toHaveText(renamed);
  await page.goto('/c/rs-learning/settings/members');
  const renamedMember=page.locator('.member-row').filter({has:page.locator('strong',{hasText:new RegExp(`^${renamed}$`)})});
  await renamedMember.getByRole('combobox',{name:"Role",exact:true}).selectOption('viewer');
  await renamedMember.getByRole('button',{name:"Save",exact:true}).click();
  await expect(page.getByRole('status')).toHaveText("Change saved.");
  await expect(renamedMember.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0);
  expect(JSON.parse(query(`select role,agent_role from public.members where company_id=${quote(writer.company_id)} and person_id=${quote(person)}`))[0]).toEqual({role:'viewer',agent_role:null});
 } finally {
  query(`do $$ begin
   update public.work_cards set next_actor=${quote(writer.person_id)} where company_id=${quote(writer.company_id)} and id=${quote(card)};
   update public.members set agent_role=null,removed_at=now() where company_id=${quote(writer.company_id)} and person_id=${quote(person)};
   update public.members set agent_role='writer' where company_id=${quote(writer.company_id)} and person_id=${quote(writer.person_id)};
   end $$;`);
 }
});

test('recent cards record actual opens only, newest three per person and company, with persistent reopen order',async({page,context,browser})=>{
 await signIn(page,'multi@example.com','/c/rs-learning/work/board');
 await idle(page);
 await expect(page.locator('.recent-cards')).toHaveCount(0); // Prefetched cards are not opened.
 for(const id of [1,2,3,4]) {
  await page.goto(`/c/rs-learning/work/board/${id}`);
  await expect(page.locator('.recent-cards a').first()).toHaveAttribute('href',`/c/rs-learning/work/board/${id}`);
 }
 const hrefs=()=>page.locator('.recent-cards a').evaluateAll(links=>links.map(link=>link.getAttribute('href')));
 expect(await hrefs()).toEqual([4,3,2].map(id=>`/c/rs-learning/work/board/${id}`));
 await page.goto('/c/rs-learning/work/board/1');
 await expect(page.locator('.recent-cards a').first()).toHaveAttribute('href','/c/rs-learning/work/board/1');
 expect(await hrefs()).toEqual([1,4,3].map(id=>`/c/rs-learning/work/board/${id}`));
 await chooseCompany(page,'aleem');
 await expect(page).toHaveURL(/\/c\/aleem\/work\/board$/);
 await expect(page.locator('.recent-cards')).toHaveCount(0);
 // Aleem has no agent granted yet, so its card comes from the board's stage form, not from a message to an agent.
 await page.getByRole('button',{name:'+ Add card'}).first().click();
 await page.getByLabel('Card title').fill(`بطاقة عليم ${Date.now()}`);
 await page.getByRole('button',{name:"Create card",exact:true}).click();
 await expect(page).toHaveURL(/\/c\/aleem\/work\/board\/\d+$/);
 const otherCard=new URL(page.url()).pathname;
 await expect(page.locator('.recent-cards a')).toHaveAttribute('href',otherCard);
 await page.goto('/c/aleem/home');
 await expect(page.locator('.recent-cards a')).toHaveAttribute('href',otherCard);
 await chooseCompany(page,'rs-learning');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 await expect(page.locator('.recent-cards a')).toHaveCount(3);
 expect(await hrefs()).toEqual([1,4,3].map(id=>`/c/rs-learning/work/board/${id}`));
 await expect(page.locator('.recent-cards')).not.toContainText('بطاقة عليم');
 const another=await browser.newContext({baseURL:'http://127.0.0.1:3000'});
 const otherPage=await another.newPage();
 await signIn(otherPage,'reviewer@example.com','/c/aleem/home'); // No access to Aleem.
 expect((await otherPage.goto('/c/aleem/home'))?.status()).toBe(404);
 await otherPage.goto('/c/rs-learning/home');
 await expect(otherPage.locator('.recent-cards')).toHaveCount(0);
 await another.close();
 await context.clearCookies();
 await signIn(page,'multi@example.com','/c/rs-learning/home');
 await expect(page.locator('.recent-cards a')).toHaveCount(3);
 expect(await hrefs()).toEqual([1,4,3].map(id=>`/c/rs-learning/work/board/${id}`));
});

test('agency list keeps the current company actions and inbox count in the sidebar',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await chooseCompany(page,'');
 await expect(page).toHaveURL(/\/all-brands$/);
 await expect(page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true})).toBeVisible();
 const badge=page.locator('.sidebar .sb-count[href$="/approvals"]');
 const count=await badge.count()?Number(await badge.textContent()):0;
 await page.goto('/c/rs-learning/approvals');
 await expect(page.locator('.approvals')).toBeVisible();
 expect(await page.locator('.approval-card').count()).toBe(count);
 await page.goto('/all-brands');
 await openNavigation(page);
 await page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat$/);
});

test('on a narrow screen the sidebar collapses behind the menu button and slides in over a scrim',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 const sidebar=page.locator('.sidebar');
 await expect(sidebar).toHaveCount(1);
 await expect(sidebar).toBeHidden();
 await expect(page.locator('.scrim')).toBeHidden();
 await page.locator('.mobile-menu').click();
 await expect(page.locator('.mobile-menu')).toHaveAttribute('aria-expanded','true');
 await expect(sidebar).toBeVisible();
 await expect(page.locator('.scrim')).toBeVisible();
 // While open it holds the keyboard: focus starts inside it, and Tab and Shift+Tab wrap inside it.
 const inside=()=>page.evaluate(()=>!!document.activeElement?.closest('.sidebar'));
 expect(await inside()).toBe(true);
 // The page behind the open drawer is inert, so assistive technology does not reach it either.
 await expect(page.locator('.app-content')).toHaveJSProperty('inert',true);
 const count=await sidebar.locator('a[href],button:not([disabled])').count();
 for(let step=0;step<count+2;step++) { await page.keyboard.press('Tab'); expect(await inside(),`Tab ${step}`).toBe(true); }
 for(let step=0;step<count+2;step++) { await page.keyboard.press('Shift+Tab'); expect(await inside(),`Shift+Tab ${step}`).toBe(true); }
 // Escape closes it and gives focus back to the menu button.
 await page.keyboard.press('Escape');
 await expect(sidebar).toBeHidden();
 await expect(page.locator('.mobile-menu')).toBeFocused();
 await expect(page.locator('.app-content')).toHaveJSProperty('inert',false);
 // Tapping the scrim closes it and also gives focus back; following a link closes it on the new page.
 await page.locator('.mobile-menu').click();
 await page.locator('.scrim').click({position:{x:380,y:450}});
 await expect(sidebar).toBeHidden();
 await expect(page.locator('.mobile-menu')).toBeFocused();
 await page.locator('.mobile-menu').click();
 await sidebar.getByRole('link',{name:"Marketing board",exact:true}).click();
 await expect(page).toHaveURL(/\/work\/board$/);
 await expect(sidebar).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('the sidebar holds the keyboard only while it covers the page',async({page})=>{
 const sidebar=page.locator('.sidebar');
 const inside=()=>page.evaluate(()=>!!document.activeElement?.closest('.sidebar'));
 // Beside the page the sidebar never covers anything: Tab walks out of it into the page.
 const tabLeaves=async(label:string)=>{
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.scrim')).toBeHidden();
  await expect(page.locator('.app-content')).toHaveJSProperty('inert',false);
  await sidebar.locator('a[href]').first().focus();
  const count=await sidebar.locator('a[href],button:not([disabled])').count();
  let left=false;
  for(let step=0;step<count+2&&!left;step++) { await page.keyboard.press('Tab'); left=!await inside(); }
  expect(left,`${label}: Tab leaves the sidebar`).toBe(true);
 };
 // A drawer left open on a narrow screen lets go of the keyboard once the screen widens.
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.setViewportSize({width:1440,height:900});
 await tabLeaves('widened');
 // Narrowing again covers the page with the still-open drawer, which holds the keyboard again until Escape.
 await page.setViewportSize({width:390,height:900});
 await expect(page.getByRole('dialog')).toBeVisible();
 await sidebar.locator('a[href]').first().focus();
 const count=await sidebar.locator('a[href],button:not([disabled])').count();
 for(let step=0;step<count+2;step++) { await page.keyboard.press('Tab'); expect(await inside(),`narrowed Tab ${step}`).toBe(true); }
 await page.keyboard.press('Escape');
 await expect(sidebar).toBeHidden();
 // On a wide screen the menu button still opens and Escape closes the sidebar, without trapping Tab.
 await page.setViewportSize({width:1440,height:900});
 await openNavigation(page);
 await expect(page.locator('.mobile-menu')).toHaveAttribute('aria-expanded','true');
 await tabLeaves('wide');
 await closeNavigation(page);
});

test('mobile recent cards record opens while the drawer stays closed',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'reviewer@example.com','/c/rs-learning/work/board');
 await idle(page);
 for(const id of [3,4]) {
  await page.locator(`.card a[href$="/board/${id}"]`).click();
  await expect(page.locator('.modal')).toBeVisible();
  await idle(page);
  await page.locator('.close-card').click();
  await expect(page.locator('.modal')).toHaveCount(0);
 }
 await openNavigation(page);
 await page.locator('.sidebar .sb-nav a[href$="/home"]').click();
 await openNavigation(page);
 await expect(page.locator('.recent-cards a').first()).toHaveAttribute('href','/c/rs-learning/work/board/4');
 expect(await page.locator('.recent-cards a').evaluateAll(links=>links.slice(0,2).map(link=>link.getAttribute('href')))).toEqual([4,3].map(id=>`/c/rs-learning/work/board/${id}`));
});

test('the recent cards endpoint refuses what it cannot trust and never reads for a stranger',async({request})=>{
 const url='/api/recent-cards',company=randomUUID();
 expect((await request.post(url,{data:'company=1',headers:{'content-type':'text/plain'}})).status()).toBe(415);
 expect((await request.post(url,{data:{company:'not-a-company'}})).status()).toBe(400);
 expect((await request.post(url,{data:{company,cardId:-1}})).status()).toBe(400);
 expect((await request.post(url,{data:{company}})).status()).toBe(401);
});
