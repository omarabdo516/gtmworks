import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { signIn, openNavigation, chooseCompany, openMoreSection } from './sign-in';
import { idle } from './navigation-measure';
import { i18n } from '../lib/i18n.mjs';
import { sections } from '../lib/navigation';
import { appOrigin } from './lane.mjs';
import { motionTable } from './motion-table.mjs';

const quote=(sql:string|number)=>`'${String(sql).replaceAll("'","''")}'`;

// The approved reference's sidebar (#284): four entries, then the Agents with Lead first, then recent chats.
const labels=["Chats","Marketing board","Numbers","Activity log"];
async function navLabels(page:import('@playwright/test').Page) {
 await openNavigation(page);
 return page.locator('.sidebar .sb-nav .sb-item').allInnerTexts();
}

// Every button under the shell either is a part that moves (its row in tests/motion-table.mjs, whose own motion
// tests/components/motion.test.tsx checks) or swaps at once; none takes app/globals.css's 160ms fade (#128, #271). The
// board's own view tabs are the one exception.
// A time as milliseconds: `0.15s` and `150ms` both read 150.
const milliseconds=(time:string)=>Math.round(parseFloat(time)*(time.trim().endsWith('ms')?1:1000));
// Every time the product's stylesheets write outside app/globals.css (the motion tokens in app/tokens.css included).
const productTimes=new Set(readdirSync('app').filter(file=>file.endsWith('.css')&&file!=='globals.css')
 .flatMap(file=>[...readFileSync(`app/${file}`,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(?<![\w.#-])(\d*\.?\d+m?s)\b/g)].map(([,time])=>milliseconds(time))));
test('every button on the Conversation, the board and the settings overlay is a listed moving part or swaps at once',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 const parts=[...new Set(motionTable.map(row=>row.built.replace(/::(?:before|after)$/,'')))];
 const sweep=async(where:string)=>{
  await idle(page);
  const buttons=await page.locator('.gw').first().evaluate((_,parts)=>[...document.querySelectorAll('.gw :is(button, .button)')].filter(button=>!button.matches('.work-toolbar .tabs .button')).map(button=>({
   button:`${button.tagName.toLowerCase()}.${String(button.className).trim().replaceAll(/\s+/g,'.')}[${button.getAttribute('aria-label')??button.textContent?.trim().slice(0,24)}]`,
   listed:parts.some(part=>button.matches(part)),
   transitionDuration:getComputedStyle(button).transitionDuration,
  })),parts);
  expect(buttons.length,`${where} has buttons`).toBeGreaterThan(0);
  for(const {button,listed,transitionDuration} of buttons) {
   if(!listed) expect.soft(transitionDuration,`${where}: ${button} has no row and swaps at once`).toMatch(/^0s(, 0s)*$/);
   else {
    // A listed part moves on the product's own times: each duration is one its stylesheets write (#271), and none is
    // app/globals.css's 160ms fade winning over the part's rule (the motion tokens are 150ms, 200ms and 280ms).
    const durations=transitionDuration.split(', ').map(milliseconds);
    expect.soft(durations,`${where}: ${button} takes app/globals.css's 160ms fade`).not.toContain(160);
    expect.soft(durations.filter(duration=>duration>0&&!productTimes.has(duration)),`${where}: ${button} moves on a time no stylesheet under app/ writes`).toEqual([]);
   }
  }
 };
 // The seed attaches no Agent, so the Conversation would show no head pill, composer or details: RS Learning gets a Lead
 // on an Engine nobody answers at, which draws them all, and loses it again after.
 const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
 const [company,connection,lead]=['10000000-0000-0000-0000-000000000001',randomUUID(),randomUUID()];
 query(`do $$ begin
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values (${quote(lead)},${quote(company)},${quote(connection)},'Lead','General',true,'sweep-lead');
 end $$;`);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/chat');
  await expect(page.locator('#btn-details')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('.details .dp-tabs')).toBeVisible();
  await page.locator('.sidebar #btn-me').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await sweep('the Conversation');
  await page.goto('/c/rs-learning/work/board');
  await expect(page.locator('.board-view')).toBeVisible();
  await sweep('the board');
  await page.goto('/c/rs-learning/settings');
  await expect(page.locator('.sov')).toBeVisible();
  await sweep('the settings overlay');
 } finally {
  query(`do $$ begin delete from public.hermes_agents where id=${quote(lead)}; end $$;`);
 }
});

// The sections the reference has no page for yet open by their address and say so, and a settings page's trail leads
// back to Settings. The rest of each address's shell is checked by the Viewer's walk below and by language.spec.ts.
test('a section not built yet says so at its address, and a settings page\'s trail leads back to Settings',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 for(const [path,text] of [['recurring',"No routines yet"],['skills',"No skills yet"],['connections',"No connections yet"],['search',"Search is not available yet"],['history',"No activity log yet"]]) {
  await page.goto(`/c/rs-learning/${path}`);
  await expect(page.locator('.content .empty'),path).toHaveText(text);
 }
 // A Card opens in its window over the board (#678): the top bar stays the board's, with no crumb of the Card.
 const cardCrumbs=page.locator('.topbar [data-slot="breadcrumb"] li:not([role="presentation"])');
 await page.goto('/c/rs-learning/work/board');
 const boardCrumbs=await cardCrumbs.allInnerTexts();
 await page.goto('/c/rs-learning/work/board/1');
 await expect(page.locator('.cw[open]')).toBeVisible();
 expect(await cardCrumbs.allInnerTexts()).toEqual(boardCrumbs);
 for(const [path,leaf] of [['settings/members','members'],['settings/work','workSettings']]) {
  await page.goto(`/c/rs-learning/${path}`);
  const crumbs=page.locator('.topbar [data-slot="breadcrumb"] li:not([role="presentation"])');
  await expect(crumbs,path).toHaveCount(3);
  await expect(crumbs.nth(1),path).toHaveText(i18n().t('settings'));
  await expect(crumbs.nth(2),path).toHaveText(i18n().t(leaf));
  await expect(crumbs.nth(1).locator('a'),path).toHaveAttribute('href','/c/rs-learning/settings');
 }
 // Settings > Agents went with the pasted Hermes (#342): its address is not found.
 await page.goto('/c/rs-learning/settings/agents');
 await expect(page.getByRole('heading',{name:'Page not found'})).toBeVisible();
});

test('Viewer has the same navigation, New chat included, without new card on every company section',async({page})=>{
 test.setTimeout(180000);
 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 // Usage is the Owner's and the Managers' (#32): it has no page for a Viewer, and usage.spec.ts proves the refusal, so
 // the walk leaves that one address out; every other section is the same frame as it is for the other Roles.
 for(const path of Object.keys(sections).filter(path=>path!=='usage')) {
  await page.goto(`/c/rs-learning/${path}`);
  // Settings is the full-window overlay (#26) over the same frame, which stays behind it, inert.
  if(path==='settings') await expect(page.locator('[inert] .sidebar .sb-nav .sb-item')).toHaveText(labels);
  else {
   expect(await navLabels(page),path).toEqual(labels);
   await expect(page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true})).toBeVisible();
  }
  await expect(page.locator('.sidebar').getByText("New card",{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:"+ New card",exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);
 }
});

test('Home has four parts in order and missing sources show unavailable, never zero',async({page})=>{
 await signIn(page,'multi@example.com','/c/aleem/home');
 expect(await page.locator('.home-dashboard > section').evaluateAll(parts=>parts.map(part=>part.getAttribute('aria-label')))).toEqual(["Agents","Work figures","Last 14 days","Latest updates"]);
 // Home lists the Company's real Agents: Aleem has none, so its Agents section stays and is simply empty.
 await expect(page.locator('.home-agents article')).toHaveCount(0);
 await expect(page.locator('.stats .label')).toHaveText(["Awaiting your approval","Published this week","Bookings this week","Stopped cards"]);
 await expect(page.locator('.home-charts h2')).toHaveText(["Delivered work","Cards by status","First-time acceptance"]);
 await expect(page.locator('.home-recent h2')).toHaveText(["Recent activity","Recent cards"]);
 const missing=page.locator('.stats .stat:nth-child(n+2) strong, .acceptance-chart p');
 await expect(missing).toHaveCount(4);
 await expect(missing).toHaveText(Array(4).fill("Unavailable"));
 for(const item of await missing.all()) await expect(item).not.toHaveText(/^0(?:%|\s*)$/);
 await expect(page.locator('.stats .stat').first().locator('strong')).toHaveText('0'); // A real empty approval queue.
 await expect(page.locator('.content')).not.toContainText(/Spend|Run count/);
 await chooseCompany(page,'rs-learning');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 // The seed gives RS Learning no real Agents, so Home has none; the Writer's Cards still show in the work list's
 // Assignee column (#677): its own Card, and the Card in review it sent there.
 await expect(page.locator('.home-agents article')).toHaveCount(0);
 await page.goto('/c/rs-learning/work/list');
 const assigned=page.locator('.table tbody tr').filter({has:page.locator('td:last-child',{hasText:'وكيل المحتوى'})});
 await expect(assigned).toHaveCount(2);
 // The Inbox count sits on the Marketing board entry and opens the Inbox.
 await page.goto('/c/rs-learning/approvals');
 await expect(page.locator('.approvals')).toBeVisible();
 const count=await page.locator('.approval-card').count();
 // The entry stays at zero too, so the Inbox is always one click away.
 const badge=page.locator('.sidebar .sb-count[href$="/approvals"]');
 await expect(badge).toHaveText(String(count));
 await expect(badge).toHaveAccessibleName(count?`${count} things waiting on you`:'Nothing waiting on you');
 await page.goto('/c/rs-learning/work/board');
 await openNavigation(page);
 await badge.click();
 await expect(page).toHaveURL(/\/approvals$/);
 // Home has no sidebar entry; it opens from the account menu's "More sections" (#8).
 await openMoreSection(page,'home');
 await expect(page.locator('.stats strong').first()).toHaveText(String(count));
});

test('owner assigns a new Contributor agent through settings, the work list follows its rename, and demotion clears the key',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/list');
 // The Writer's own Card (seed Card 1), not the Card in review it is also the assignee of (#677).
 const writerRow=page.locator('.table tbody tr').filter({has:page.locator('td:last-child',{hasText:'وكيل المحتوى'})}).filter({has:page.locator('a[href$="/work/board?card=1"]')});
 await expect(writerRow).toHaveCount(1);
 const current=writerRow.getByRole('link');
 await expect(current).toBeVisible();
 const cardPath=await current.getAttribute('href');
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
  await expect(page.getByRole('status').filter({hasText:"This agent role is assigned to another active member in the company. Remove that assignment first."})).toHaveText("This agent role is assigned to another active member in the company. Remove that assignment first.");
  expect(JSON.parse(query(`select agent_role from public.members where company_id=${quote(writer.company_id)} and person_id=${quote(person)}`))[0].agent_role).toBeNull();
  await picker.selectOption('writer');
  await member.getByRole('button',{name:"Save",exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:"Change saved."})).toHaveText("Change saved.");
  await expect(picker).toHaveValue('writer');
  await expect(page.locator('.detail-row').filter({hasText:initialName}).filter({hasText:'Agent role: No agent role to Writer'})).toHaveCount(1);
  const [audit]=JSON.parse(query(`select actor_id,after_data->>'agent_role' as agent_role from public.member_audit where company_id=${quote(writer.company_id)} and person_id=${quote(person)} and action='UPDATE' order by id desc limit 1`));
  expect(audit).toEqual({actor_id:'20000000-0000-0000-0000-000000000001',agent_role:'writer'});
  await page.goto('/c/rs-learning/work/list');
  const assigned=page.locator('.table tbody tr').filter({has:page.locator(`a[href="${cardPath}"]`)});
  // The next actor's name, beside its first letter as a person's (#697: a legacy role agent shows its name's first letter).
  const nextActor=assigned.locator('td').last().locator('span:not(.avatar)');
  await expect(assigned.locator('td').last().locator('.avatar')).toHaveText(Array.from(initialName)[0]);
  await expect(nextActor).toHaveText(initialName);
  expect(query(`update public.people set name=${quote(renamed)} where id=${quote(person)} returning name;`)).toContain(renamed);
  await page.reload();
  await expect(nextActor).toHaveText(renamed);
  await page.goto('/c/rs-learning/settings/members');
  const renamedMember=page.locator('.member-row').filter({has:page.locator('strong',{hasText:new RegExp(`^${renamed}$`)})});
  await renamedMember.getByRole('combobox',{name:"Member role",exact:true}).selectOption('viewer');
  await renamedMember.getByRole('button',{name:"Save",exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:"Change saved."})).toHaveText("Change saved.");
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
 const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
 const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as {id:number}[]; };
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
 // The Card's window is modal (#678): it is closed before the sidebar is used.
 await page.getByRole('dialog').getByRole('button',{name:'Close the card'}).click();
 await expect(page.locator('.cw[open]')).toHaveCount(0);
 await chooseCompany(page,'aleem');
 await expect(page).toHaveURL(/\/c\/aleem\/work\/board$/);
 await expect(page.locator('.recent-cards')).toHaveCount(0);
 // A Card of Aleem's, filed straight into the seed's Ideas stage (Aleem has no agent to add one from the board).
 const [aleemCard]=rows(`insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000003',id,${quote(`بطاقة عليم ${Date.now()}`)} from public.work_stages where company_id='10000000-0000-0000-0000-000000000003' and kind='ideas' returning id`);
 await page.goto(`/c/aleem/work/board/${aleemCard.id}`);
 await expect(page).toHaveURL(new RegExp(`/c/aleem/work/board/${aleemCard.id}$`));
 const otherCard=new URL(page.url()).pathname;
 await expect(page.locator('.recent-cards a')).toHaveAttribute('href',otherCard);
 await page.goto('/c/aleem/home');
 await expect(page.locator('.recent-cards a')).toHaveAttribute('href',otherCard);
 await chooseCompany(page,'rs-learning');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 await expect(page.locator('.recent-cards a')).toHaveCount(3);
 expect(await hrefs()).toEqual([1,4,3].map(id=>`/c/rs-learning/work/board/${id}`));
 await expect(page.locator('.recent-cards')).not.toContainText('بطاقة عليم');
 const another=await browser.newContext({baseURL:appOrigin});
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

test('the company switcher lists only the person\'s companies, and the old all-companies list is not found',async({page})=>{
 // Omar is the Owner of all three seeded companies; there is no list of every company beyond them.
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await openNavigation(page);
 await page.getByLabel(/Choose company|اختيار الشركة/).click();
 await expect(page.locator('[data-company-slug]')).toHaveCount(3);
 await expect(page.locator('[data-company-slug=""]')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true})).toBeVisible();
 const badge=page.locator('.sidebar .sb-count[href$="/approvals"]');
 const count=Number(await badge.textContent());
 await page.goto('/c/rs-learning/approvals');
 await expect(page.locator('.approvals')).toBeVisible();
 expect(await page.locator('.approval-card').count()).toBe(count);
 await page.goto('/c/rs-learning/home');
 await openNavigation(page);
 await page.locator('.sidebar').getByRole('link',{name:"New chat",exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat$/);
 expect((await page.goto('/all-brands'))?.status()).toBe(404);
});

test('mobile recent cards record opens while the drawer stays closed',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'reviewer@example.com','/c/rs-learning/work/board');
 await idle(page);
 for(const id of [3,4]) {
  // A Card opens as its sheet over the board (#116), and that open is recorded as one.
  await page.locator(`.card a[href$="/board?card=${id}"]`).click();
  await expect(page.locator('.cw[open]')).toBeVisible();
  await idle(page);
  await page.getByRole('dialog').getByRole('button',{name:'Close the card'}).click();
  await expect(page.locator('.cw')).toHaveCount(0);
 }
 await openMoreSection(page,'home');
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

test('an account menu opened while the next page is still arriving stays open when that page lands',async({page})=>{
 // Every page draws its own shell, so closing a card draws a new one. After a comment (which makes the prepared board
 // stale) the board's data is held back until the menu is open, so the new shell always lands under an open menu.
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/1');
 await expect(page.locator('.cw[open]')).toBeVisible();
 let release!:()=>void; const held=new Promise<void>(resolve=>{release=resolve;});
 let arrived!:()=>void; const asked=new Promise<void>(resolve=>{arrived=resolve;});
 const board=(url:URL)=>url.pathname==='/c/rs-learning/work/board';
 const hold=async(route:import('@playwright/test').Route)=>{ if(route.request().headers()['rsc']==='1') { arrived(); await held; } await route.continue(); };
 await page.route(board,hold);
 try {
  const comment=`Menu stays ${Date.now()}`;
  await page.getByRole('textbox',{name:'Write a comment'}).fill(comment);
  await page.getByRole('button',{name:'Post the comment'}).click();
  await expect(page.locator('.cw[open] #cw-list .lg-note').filter({hasText:comment})).toBeVisible();
  const shell=await page.locator('.shell').elementHandle();
  await page.getByRole('dialog').getByRole('button',{name:'Close the card'}).click();
  await asked;
  // The Card's window is modal (#678): the sidebar answers once it has left.
  await expect(page.locator('.cw[open]')).toHaveCount(0);
  // The menu rises once, as it opens; drawn again on the page that lands, it has risen already (#129).
  await page.evaluate(()=>{ const counted=window as unknown as {rises:number}; counted.rises=0; document.addEventListener('animationstart',event=>{ if((event.target as Element).id==='me-menu') counted.rises++; },true); });
  await page.locator('.sidebar #btn-me').click();
  const menu=page.getByRole('menu');
  await expect(menu).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
  await expect(page.locator('.cw[open]')).toHaveCount(0);
  // The page landed with a new shell, and the menu is still open on it.
  await expect.poll(()=>shell!.evaluate(node=>node.isConnected)).toBe(false);
  await expect(menu).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));
  expect(await page.evaluate(()=>(window as unknown as {rises:number}).rises),'rises from opening to the page that landed').toBe(1);
  await expect(menu).toHaveCSS('animation-name','none');
  await menu.locator('[role=group] a[role=menuitem][href$="/home"]').click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
  await expect(menu).toHaveCount(0);
 } finally { release(); await page.unroute(board,hold); }
});

// #129 (design-reference: .menu, rise; openMeMenu, closeMeMenu; .me): the account menu rises 4px and fades in over
// 120ms, and Escape, a press outside it and choosing an item remove it at once; the account row fades its background
// over 150ms and nothing else. With reduced motion the menu is simply there.
test('the account menu rises as it opens and is gone at once when it closes, and the account row fades its background alone',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await idle(page);
 const button=page.locator('.sidebar #btn-me'), menu=page.locator('#me-menu');
 await expect(button).toHaveCSS('transition','background-color 0.15s cubic-bezier(0.2, 0, 0, 1)');
 const gone=()=>page.evaluate(()=>new Promise<boolean>(resolve=>requestAnimationFrame(()=>resolve(!document.getElementById('me-menu')))));
 const closes:[string,()=>Promise<unknown>][]=[
  ['Escape',()=>page.keyboard.press('Escape')],
  // The sidebar's "Agents" heading: a press on it opens nothing.
  ['a press outside it',()=>page.locator('.sidebar .sb-label').filter({hasText:'Agents'}).first().click()],
  ['choosing an item',()=>menu.getByRole('menuitemradio',{name:/^English/}).click()],
 ];
 // The rise's first frame, read as it starts: paused at its beginning, then let go.
 await page.evaluate(()=>{ const seen=window as unknown as {firstFrame?:string[]}; document.addEventListener('animationstart',event=>{
  const element=event.target as HTMLElement; if(element.id!=='me-menu') return;
  const rise=element.getAnimations().find(animation=>(animation as CSSAnimation).animationName==='gw-rise'); if(!rise) { seen.firstFrame=['no gw-rise']; return; }
  rise.pause(); rise.currentTime=0; const {opacity,transform}=getComputedStyle(element); seen.firstFrame=[opacity,transform]; rise.finish();
 },true); });
 for(const [how,close] of closes) {
  await page.evaluate(()=>{ delete (window as unknown as {firstFrame?:string[]}).firstFrame; });
  await button.click();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element=>{ const style=getComputedStyle(element); return [style.animationName,style.animationDuration,style.animationTimingFunction]; }),'the menu as it opens').toEqual(['gw-rise','0.12s','cubic-bezier(0.2, 0, 0, 1)']);
  // The rise starts from opacity 0, 4px down.
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {firstFrame?:string[]}).firstFrame),'the rise starts from opacity 0, 4px down').toEqual(['0','matrix(1, 0, 0, 1, 0, 4)']);
  await close();
  expect(await gone(),`${how} removes the menu by the next frame`).toBe(true);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await button.click();
 await expect(menu).toBeVisible();
 expect(await menu.evaluate(element=>[getComputedStyle(element).animationDuration,getComputedStyle(element).opacity]),'with reduced motion the menu is simply there').toEqual(['0s','1']);
 await expect(button).toHaveCSS('transition-duration','0s');
 await page.keyboard.press('Escape');
 expect(await gone()).toBe(true);
});

test('an open account menu closes when the keyboard takes the person to another company',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await idle(page);
 await page.locator('.sidebar #btn-me').click();
 await expect(page.getByRole('menu')).toBeVisible();
 // Only the keyboard: no press outside the menu and no Back.
 await page.getByLabel('Choose company').press('Enter');
 await page.locator('[data-company-slug="aleem"]').press('Enter');
 await expect(page).toHaveURL(/\/c\/aleem\//);
 await expect(page.locator('.ws').getByText('Aleem')).toBeVisible();
 await expect(page.locator('#me-menu')).toHaveCount(0);
 await expect(page.locator('.sidebar #btn-me')).toHaveAttribute('aria-expanded','false');
});

test('a menu open while its own page lands keeps the item that had focus',async({page})=>{
 // As above: the board's data is held until the menu is open and focus is on one of its items.
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/1');
 await expect(page.locator('.cw[open]')).toBeVisible();
 let release!:()=>void; const held=new Promise<void>(resolve=>{release=resolve;});
 let arrived!:()=>void; const asked=new Promise<void>(resolve=>{arrived=resolve;});
 const board=(url:URL)=>url.pathname==='/c/rs-learning/work/board';
 const hold=async(route:import('@playwright/test').Route)=>{ if(route.request().headers()['rsc']==='1') { arrived(); await held; } await route.continue(); };
 await page.route(board,hold);
 try {
  const comment=`Focus stays ${Date.now()}`;
  await page.getByRole('textbox',{name:'Write a comment'}).fill(comment);
  await page.getByRole('button',{name:'Post the comment'}).click();
  await expect(page.locator('.cw[open] #cw-list .lg-note').filter({hasText:comment})).toBeVisible();
  const shell=await page.locator('.shell').elementHandle();
  await page.getByRole('dialog').getByRole('button',{name:'Close the card'}).click();
  await asked;
  // The Card's window is modal (#678): the sidebar answers once it has left.
  await expect(page.locator('.cw[open]')).toHaveCount(0);
  await page.locator('.sidebar #btn-me').click();
  const menu=page.getByRole('menu');
  await menu.getByRole('menuitemradio',{name:'Dark'}).focus();
  await expect(menu.getByRole('menuitemradio',{name:'Dark'})).toBeFocused();
  release();
  await expect(page.locator('.cw[open]')).toHaveCount(0);
  await expect.poll(()=>shell!.evaluate(node=>node.isConnected)).toBe(false);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio',{name:'Dark'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
 } finally { release(); await page.unroute(board,hold); }
});

test('an open account menu closes when the keyboard opens another page of the same company, even one being prepared',async({page})=>{
 // Numbers is still being prepared (its prefetch is held) when the menu opens; the person then opens it with the keyboard.
 await page.setViewportSize({width:1440,height:900});
 let release!:()=>void; const held=new Promise<void>(resolve=>{release=resolve;});
 let arrived!:()=>void; const asked=new Promise<void>(resolve=>{arrived=resolve;});
 const numbers=(url:URL)=>url.pathname==='/c/rs-learning/numbers';
 const hold=async(route:import('@playwright/test').Route)=>{ if(route.request().headers()['rsc']==='1') { arrived(); await held; } await route.continue(); };
 await page.route(numbers,hold);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  await asked;
  await page.locator('.sidebar #btn-me').click();
  await expect(page.getByRole('menu')).toBeVisible();
  // Only the keyboard: no press outside the menu and no Back.
  await page.locator('.sidebar .nav a[href$="/numbers"]').press('Enter');
  release();
  await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
  await expect(page.locator('.numbers-page')).toBeVisible();
  await expect(page.locator('#me-menu')).toHaveCount(0);
  await expect(page.locator('.sidebar #btn-me')).toHaveAttribute('aria-expanded','false');
 } finally { release(); await page.unroute(numbers,hold); }
});

test('"N" opens a new chat with its composer focused from the board, Numbers, the Activity log and a Conversation, and a Viewer\'s does nothing',async({page})=>{
 // RS Learning gets a main Agent, so the new chat has a composer, and a Conversation with it to press "N" in.
 const rs='10000000-0000-0000-0000-000000000001', omar='20000000-0000-0000-0000-000000000001', connection=randomUUID(), agent=randomUUID(), conversation=randomUUID();
 const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${agent}','${rs}','${connection}','Lead','General',true,'new-chat-key')`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${rs}','${omar}','${agent}','Lead')`);
 try {
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  for(const path of ['/c/rs-learning/work/board','/c/rs-learning/numbers','/c/rs-learning/log',`/c/rs-learning/conversations/${conversation}`]) {
   await page.goto(path);
   await idle(page);
   await page.keyboard.press('KeyN');
   await expect(page,path).toHaveURL(/\/c\/rs-learning\/chat$/);
   await expect(page.getByRole('textbox',{name:'Message',exact:true}),path).toBeFocused();
  }
  await page.context().clearCookies();
  await signIn(page,'viewer@example.com','/c/rs-learning/work/board');
  await idle(page);
  await page.keyboard.press('KeyN');
  await idle(page);
  await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 } finally {
  query(`delete from public.conversations where id='${conversation}'`);
  query(`delete from public.hermes_agents where id='${agent}'`);
 }
});
