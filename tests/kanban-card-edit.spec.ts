import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#837): a person changes a Card after it is made, on the Company's fake Engine: its title and description,
// one to-do ticked in place, its publishing date, the Card it waits for and its column, carried on the board or chosen
// in the Card window's status, with Undo; and the board filters by Project, the Engine's tenant, and by Assignee. In
// progress and Waiting on you are the work's own, and a move the Engine does not take leaves the Card where it was with
// its reason in one line. A Viewer is offered none of this and is refused on the server.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const seo=randomUUID(), seoProfile=`ag-${seo.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004', contributor='20000000-0000-0000-0000-000000000003';
const board='/c/rs-learning/work/board';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}'),('${seo}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}'),
    ('${seo}','${rs}','Seo','Writes for search.',false,'${seoProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}'),('${rs}','${contributor}','${ads}');
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const kanban=()=>fake.settings.kanban;
const task=(id:string)=>kanban().tasks.find(found=>found.id===id)!;
const put=(fields:Record<string,unknown>)=>kanban().task(fields).id as string;
const windowOf=(page:Page)=>page.getByRole('dialog');
const cardOn=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"]`);
const inColumn=(page:Page,column:string,id:string)=>page.locator(`#board-cols .col[data-column="${column}"] .kcard[data-card="${id}"]`);
const toast=(page:Page)=>page.locator('.toast');
// Carry a Card with the mouse into a column (design-reference-card: pointerdown, dragMove, pointerup).
// The board is wide enough for all five columns, so neither end scrolls the other out of view.
async function carry(page:Page,id:string,column:string) {
 await page.setViewportSize({width:1680,height:900});
 const source=cardOn(page,id);
 await expect(source).toBeVisible();
 const target=page.locator(`#board-cols .col[data-column="${column}"] .col__body`);
 const [from,to]=[(await source.boundingBox())!,(await target.boundingBox())!];
 await page.mouse.move(from.x+from.width/2,from.y+20);
 await page.mouse.down();
 await page.mouse.move(from.x+from.width/2+8,from.y+20,{steps:2});
 await page.mouse.move(to.x+to.width/2,to.y+40,{steps:12});
 await page.mouse.up();
}

test('a Member renames a Card, edits its description, ticks one to-do and sets its date: each changes the Engine, the to-do only its own line',async({page})=>{
 const id=put({title:'December ads',status:'todo',body:'## Steps\n- [ ] Draft three ads\n- [ ] Send them for review'});
 await signIn(page,'omar@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 // The title is a button that becomes a field; Enter saves it on the Engine.
 await sheet.getByRole('button',{name:'December ads'}).click();
 const field=sheet.getByRole('textbox',{name:'Card title'});
 await expect(field).toBeFocused();
 await field.fill('December ad copy');
 await field.press('Enter');
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('December ad copy');
 await expect(sheet.getByRole('button',{name:'December ad copy'})).toBeFocused();
 expect(task(id).title).toBe('December ad copy');
 await expect(cardOn(page,id)).toHaveAccessibleName(/^December ad copy/);
 // An empty title is not saved and says why; Escape leaves the field without closing the Card.
 await sheet.getByRole('button',{name:'December ad copy'}).click();
 await field.fill('  ');
 await sheet.getByRole('button',{name:'Save',exact:true}).click();
 await expect(sheet.getByRole('alert')).toHaveText('A card needs a title, even two words.');
 await field.press('Escape');
 await expect(sheet).toBeVisible();
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('December ad copy');
 // The description's Markdown is edited in place and saved with Done; the title stays as it is.
 await sheet.getByRole('button',{name:'Edit the description'}).click();
 const text=sheet.getByRole('textbox',{name:'Description'});
 await expect(text).toHaveValue('## Steps\n- [ ] Draft three ads\n- [ ] Send them for review');
 await text.fill('## Steps\n- [ ] Draft three ads\n- [ ] Send them for review\n- [ ] Post the winner');
 await sheet.getByRole('button',{name:'Done',exact:true}).click();
 const description=sheet.locator('.de');
 await expect(description.getByRole('checkbox',{name:'Post the winner'})).toHaveAttribute('aria-checked','false');
 expect([task(id).title,task(id).body]).toEqual(['December ad copy','## Steps\n- [ ] Draft three ads\n- [ ] Send them for review\n- [ ] Post the winner']);
 // Meanwhile the Agent ticks the first to-do and adds a note; the person ticks the third: only that line changes.
 task(id).body='## Steps\n- [x] Draft three ads\n- [ ] Send them for review\n- [ ] Post the winner\nAds: drafts are in.';
 await description.getByRole('checkbox',{name:'Post the winner'}).click();
 await expect(description.getByRole('checkbox',{name:'Post the winner'})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>task(id).body).toBe('## Steps\n- [x] Draft three ads\n- [ ] Send them for review\n- [x] Post the winner\nAds: drafts are in.');
 await expect(description.getByRole('checkbox',{name:'Draft three ads'})).toHaveAttribute('aria-checked','true');
 await expect(description.locator('.de-prog')).toHaveText('2/3 done');
 // The publishing date is gtmworks's, in the row beside the Card.
 const details=sheet.getByRole('complementary',{name:'Card details'});
 await details.getByLabel('Publishing date').fill('2026-12-24');
 await expect.poll(()=>rows(`select publish_on::text as day from public.kanban_cards where task_id='${id}'`)[0]?.day).toBe('2026-12-24');
 // The Card window as a person sees it while writing, and the board's filters, kept as screenshots of the run.
 await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/card-edit-${width}.png`}); }
 await page.setViewportSize({width:1280,height:720});
 // The Engine's delete is never asked for.
 expect(fake.settings.managementRequests.some(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/plugins/kanban/tasks'))).toBe(false);
});

test('two people editing one Card: the second save does not undo the first one\'s other field, and a save over a change made since keeps the words and says so',async({page,browser})=>{
 const id=put({title:'Launch email',status:'todo',body:'Tell the old students.'});
 await signIn(page,'omar@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 // Omar starts on the description.
 await sheet.getByRole('button',{name:'Edit the description'}).click();
 await sheet.getByRole('textbox',{name:'Description'}).fill('Tell the old students about the new group.');
 const context=await browser.newContext(); const other=await context.newPage();
 try {
  // The Manager renames it meanwhile.
  await signIn(other,'manager@example.com',`${board}?card=${id}`);
  const theirs=windowOf(other);
  await theirs.getByRole('button',{name:'Launch email'}).click();
  await theirs.getByRole('textbox',{name:'Card title'}).fill('Launch email to old students');
  await theirs.getByRole('textbox',{name:'Card title'}).press('Enter');
  await expect(theirs.getByRole('heading',{level:2})).toHaveText('Launch email to old students');
  // Omar's save keeps the Manager's title.
  await sheet.getByRole('button',{name:'Done',exact:true}).click();
  await expect(sheet.locator('.de')).toHaveText('Tell the old students about the new group.');
  expect([task(id).title,task(id).body]).toEqual(['Launch email to old students','Tell the old students about the new group.']);
  await expect(sheet.getByRole('heading',{level:2})).toHaveText('Launch email to old students');
  // The Manager opens the description from what they read, Omar changes it, and the Manager's save is refused:
  // Omar's words stay on the Engine, the Manager's stay in their field, and the window says why.
  await theirs.getByRole('button',{name:'Edit the description'}).click();
  await theirs.getByRole('textbox',{name:'Description'}).fill('Only the 2025 group.');
  await sheet.getByRole('button',{name:'Edit the description'}).click();
  await sheet.getByRole('textbox',{name:'Description'}).fill('Tell the old students about the new group, with the price.');
  await sheet.getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(()=>task(id).body).toBe('Tell the old students about the new group, with the price.');
  await theirs.getByRole('button',{name:'Done',exact:true}).click();
  await expect(theirs.getByRole('alert')).toHaveText('Someone changed this while you were editing. Your words are still here: check the card, then save again.');
  await expect(theirs.getByRole('textbox',{name:'Description'})).toHaveValue('Only the 2025 group.');
  expect(task(id).body).toBe('Tell the old students about the new group, with the price.');
 } finally { await context.close(); }
});

test('a drop into Ideas, Planned or Done moves the Card on the Engine, with Undo; the keyboard and the Card\'s status do the same',async({page})=>{
 const id=put({title:'Reel: a day at the academy',status:'todo'});
 await signIn(page,'omar@example.com',board);
 await expect(inColumn(page,'planned',id)).toBeVisible();
 await carry(page,id,'done');
 await expect(toast(page)).toContainText('Moved to “Done”');
 await expect(inColumn(page,'done',id)).toBeVisible();
 expect(task(id).status).toBe('done');
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(toast(page)).toContainText('Back in “Planned”');
 await expect(inColumn(page,'planned',id)).toBeVisible();
 expect(task(id).status).toBe('ready');
 await carry(page,id,'ideas');
 await expect(inColumn(page,'ideas',id)).toBeVisible();
 expect(task(id).status).toBe('triage');
 // Shift and the arrow toward the reading end is the next column a person moves a Card into; the Card keeps the keyboard.
 await cardOn(page,id).locator('a').focus();
 await page.keyboard.press('Shift+ArrowRight');
 await expect(inColumn(page,'planned',id)).toBeVisible();
 await expect(inColumn(page,'planned',id).locator('a')).toBeFocused();
 await page.keyboard.press('Shift+ArrowRight');
 await expect(inColumn(page,'done',id)).toBeVisible();
 expect(task(id).status).toBe('done');
 // The Card window's status: a menu of the columns, In progress and Waiting on you not offered, each saying why.
 await cardOn(page,id).locator('a').click();
 const sheet=windowOf(page);
 await sheet.getByRole('button',{name:'Status: Done'}).click();
 const menu=sheet.getByRole('menu',{name:'Status'});
 await expect(menu.getByRole('menuitemradio',{name:/^In progress/})).toHaveAttribute('aria-disabled','true');
 await expect(menu.getByRole('menuitemradio',{name:/^Waiting on you/})).toHaveAttribute('aria-disabled','true');
 await menu.getByRole('menuitemradio',{name:'Ideas'}).click();
 await expect(sheet.getByRole('button',{name:'Status: Ideas'})).toBeVisible();
 expect(task(id).status).toBe('triage');
 await page.screenshot({path:'test-results/screenshots/card-status-1280.png'});
});

test('a drop the Engine does not take leaves the Card where it was and says why in one line',async({page})=>{
 const first=put({title:'Course page',status:'todo'});
 const then=put({title:'Email after the course page',status:'todo'});
 kanban().link(first,then);
 await signIn(page,'omar@example.com',board);
 await expect(inColumn(page,'planned',then)).toBeVisible();
 // In progress is the work's own: carried over it, the column is refused and says why; dropped there, nothing moves.
 const patches=()=>fake.settings.managementRequests.filter(request=>request.method==='PATCH'&&String(request.path).endsWith(then)).length;
 const before=patches();
 await carry(page,then,'progress');
 await expect(toast(page)).toHaveText('A card moves to “In progress” on its own when its Agent starts it.');
 await expect(inColumn(page,'planned',then)).toBeVisible();
 await carry(page,then,'waiting');
 await expect(toast(page)).toHaveText('“Waiting on you” fills up on its own when an Agent asks you something or hands in its work.');
 await expect(inColumn(page,'planned',then)).toBeVisible();
 expect(patches()).toBe(before);
 // The Engine refuses Done for a Card that waits for an open one: it stays in Planned.
 await carry(page,then,'done');
 await expect(toast(page)).toHaveText('It waits for another card that isn’t done yet, so it can’t be done.');
 await expect(inColumn(page,'planned',then)).toBeVisible();
 expect(task(then).status).toBe('todo');
});

test('a Card set to wait for another stays out of the dispatcher\'s reach until the first is done, then starts',async({page})=>{
 const first=put({title:'Landing page for the diploma',status:'todo'});
 const then=put({title:'Ads for the diploma',status:'ready',assignee:adsProfile});
 await signIn(page,'omar@example.com',`${board}?card=${then}`);
 const sheet=windowOf(page);
 const details=sheet.getByRole('complementary',{name:'Card details'});
 await details.getByRole('button',{name:'Wait for another card'}).click();
 await sheet.getByRole('menu',{name:'Wait for another card'}).getByRole('menuitem',{name:/^Landing page for the diploma/}).click();
 await expect(details.getByRole('link',{name:'Landing page for the diploma · Planned'})).toBeVisible();
 await expect(sheet.locator('.cw-status').getByRole('img',{name:'Waiting for another card'})).toBeVisible();
 expect(task(then).status).toBe('todo');
 // The dispatcher's own tick passes it by.
 kanban().dispatch();
 expect(task(then).status).toBe('todo');
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 // The first is done by a person's drop: the Engine frees the second, gtmworks asks for a tick, and Ads starts on it.
 const ticks=kanban().ticks;
 await carry(page,first,'done');
 await expect(inColumn(page,'progress',then)).toBeVisible();
 expect(task(then).status).toBe('running');
 expect(kanban().ticks).toBe(ticks+1);
 // A Card no longer waiting for another is ready again.
 const other=put({title:'Follow-up post',status:'todo'});
 const last=put({title:'Thank-you post',status:'todo'});
 kanban().link(other,last);
 await page.goto(`${board}?card=${last}`);
 await details.getByRole('button',{name:'Stop waiting for Follow-up post'}).click();
 await expect(details.getByRole('link',{name:/^Follow-up post/})).toHaveCount(0);
 expect(task(last).status).toBe('ready');
});

// Restored from projects.spec.ts, which #834 cut with the old board: a Project is the Engine's tenant, a name.
test('a Project name set on a Card appears in the board\'s filter, and the filter shows only its Cards',async({page})=>{
 const name=`Spring launch ${Date.now()}`;
 await signIn(page,'omar@example.com',board);
 await page.getByRole('button',{name:'New card'}).click();
 const dialog=page.getByRole('dialog',{name:'New card'});
 await dialog.getByPlaceholder('Title').fill('Spring launch ads');
 await dialog.getByRole('textbox',{name:'Project'}).fill(name);
 await dialog.getByRole('button',{name:'Add card'}).click();
 await expect(dialog).toHaveCount(0);
 const made=kanban().tasks.find(found=>found.title==='Spring launch ads')!;
 expect(made.tenant).toBe(name);
 const all=await page.locator('#board-cols .kcard').count();
 expect(all).toBeGreaterThan(1);
 await page.getByRole('button',{name:'Project',exact:true}).click();
 await page.getByRole('menu',{name:'Project'}).getByRole('menuitemradio',{name}).click();
 await expect(page.locator('#board-cols .kcard')).toHaveCount(1);
 await expect(cardOn(page,made.id)).toBeVisible();
 await expect(page.getByRole('button',{name:`Project: ${name}`})).toBeFocused();
 // A Card made while the board shows a Project is made in it.
 await page.getByRole('button',{name:'New card'}).click();
 await expect(dialog.getByRole('textbox',{name:'Project'})).toHaveValue(name);
 await dialog.getByPlaceholder('Title').fill('Spring launch email');
 await dialog.getByRole('button',{name:'Add card'}).click();
 await expect(page.locator('#board-cols .kcard')).toHaveCount(2);
 // The Card window names its Project, read only: the Engine takes a Card's Project only when it is made.
 await cardOn(page,made.id).locator('a').click();
 await expect(windowOf(page).getByRole('complementary',{name:'Card details'})).toContainText(`Project:${name}`);
 await windowOf(page).getByRole('button',{name:'Close the card',exact:true}).click();
 await page.getByRole('button',{name:`Project: ${name}`}).click();
 await page.getByRole('menu',{name:'Project'}).getByRole('menuitemradio',{name:'No project'}).click();
 await expect(cardOn(page,made.id)).toHaveCount(0);
 await page.getByRole('button',{name:'Clear filters'}).click();
 await expect(page.locator('#board-cols .kcard')).toHaveCount(all+1);
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/board-filters-${width}.png`}); }
 await page.setViewportSize({width:1280,height:720});
});

// Restored from agent-visibility.spec.ts, which #834 cut with the old board's Agent chips: the Assignee filter.
test('the board\'s Assignee filter offers a Member the Agents they see only, and a Viewer filters by them too',async({page,browser})=>{
 const adsCard=put({title:'Ads runs the launch',status:'todo',assignee:adsProfile});
 put({title:'Seo drafts the blog',status:'todo',assignee:seoProfile});
 await signIn(page,'omar@example.com',board);
 await page.getByRole('button',{name:'Assignee',exact:true}).click();
 const offered=page.getByRole('menu',{name:'Assignee'}).getByRole('menuitemradio');
 await expect(offered).toContainText(['Everyone','Me','No one','Ads','Seo']);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Assignee',exact:true})).toBeFocused();
 const context=await browser.newContext(); const member=await context.newPage();
 try {
  await signIn(member,'viewer@example.com',board);
  await member.getByRole('button',{name:'Assignee',exact:true}).click();
  const theirs=member.getByRole('menu',{name:'Assignee'}).getByRole('menuitemradio');
  await expect(theirs.filter({hasText:'Seo'})).toHaveCount(0);
  await theirs.filter({hasText:'Ads'}).click();
  await expect(member.getByRole('button',{name:'Assignee: Ads'})).toBeFocused();
  const shown=member.locator('#board-cols .kcard');
  await expect(shown.first()).toBeVisible();
  for(const one of await shown.all()) await expect(one).toHaveAccessibleName(/Assignee: Ads/);
  await expect(cardOn(member,adsCard)).toBeVisible();
  await member.getByRole('button',{name:'Assignee: Ads'}).click();
  await member.getByRole('menu',{name:'Assignee'}).getByRole('menuitemradio',{name:'No one'}).click();
  await expect(cardOn(member,adsCard)).toHaveCount(0);
 } finally { await context.close(); }
});

test('a Viewer is offered none of these changes and is refused each on the server, with nothing asked of the Engine',async({page})=>{
 const id=put({title:'Webinar invite',status:'todo',assignee:adsProfile,body:'- [ ] Write it'});
 const other=put({title:'Webinar page',status:'todo'});
 await signIn(page,'viewer@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 await expect(sheet.locator('.de').getByRole('checkbox',{name:'Write it'})).toHaveAttribute('aria-disabled','true');
 await expect(sheet.getByRole('button',{name:/^Status/})).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Webinar invite'})).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Edit the description'})).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Wait for another card'})).toHaveCount(0);
 await expect(sheet.locator('input, textarea')).toHaveCount(0);
 const asked=fake.settings.managementRequests.length;
 for(const change of [{title:'Mine',was:'Webinar invite'},{description:'x',was:'- [ ] Write it'},{tick:{index:0,text:'Write it',done:true}},{column:'done'},{waitFor:other},{publishOn:'2026-12-01'}]) {
  const answer=await page.request.patch('/api/board/card/edit',{data:{company:rs,card:id,change}});
  expect(answer.status()).toBe(403);
 }
 expect(fake.settings.managementRequests.slice(asked).filter(request=>request.method!=='GET')).toEqual([]);
 expect([task(id).title,task(id).body,task(id).status]).toEqual(['Webinar invite','- [ ] Write it','todo']);
 // A person of another Company finds no such board.
 const stranger=await page.request.patch('/api/board/card/edit',{data:{company:'10000000-0000-0000-0000-000000000003',card:id,change:{column:'done'}}});
 expect(stranger.status()).toBe(404);
});
