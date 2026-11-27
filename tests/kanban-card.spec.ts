import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#835): a Card on the board opens in the approved Card window (design-reference-card: openCard,
// renderCardWin) over the board, two columns, and full screen in one column on a phone, with everything the Company's
// fake Engine keeps about it: its description as Markdown with its to-do items and their count, its Agent, its column
// and symbol, what it waits for, its summary when done, and the Comments, Activity and Runs tabs. Its address opens it
// on load, through sign-in; a Viewer reads it and is offered nothing that writes; a tab the Engine stops answering for
// keeps what it last read while the rest of the window still draws.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const seo=randomUUID(), seoProfile=`ag-${seo.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004';
const board='/c/rs-learning/work/board';
let fake:Awaited<ReturnType<typeof laneHermes>>;
const cards:Record<string,string>={};
const brief=['## Steps','- [x] Read last month’s numbers','- [ ] Draft three ads','- [ ] Send them for review','','Keep the **price** in every ad: [the course page](https://example.com/course).'].join('\n');

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
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}');
  end $$;`);
 const kanban=fake.settings.kanban;
 cards.page=kanban.task({title:'Course page copy',status:'running',assignee:adsProfile}).id;
 cards.ads=kanban.task({title:'December ad copy',status:'todo',assignee:adsProfile,body:brief,tenant:'December campaign'}).id;
 kanban.link(cards.page,cards.ads);
 cards.report=kanban.task({title:'Weekly report',status:'done',assignee:adsProfile,body:'Numbers for the week.'}).id;
 const asked=kanban.run(cards.report,{profile:adsProfile,status:'blocked',outcome:'blocked',summary:'Which week should I cover?',ended_at:Math.floor(Date.now()/1000)});
 kanban.event(cards.report,'claimed',{run_id:asked.id},asked.id);
 kanban.event(cards.report,'blocked',{reason:'Which week?'},asked.id);
 kanban.comment(cards.report,adsProfile,'Which week should I cover?');
 kanban.comment(cards.report,'Omar Abdo','The last one, 29 Oct to 4 Nov.');
 kanban.event(cards.report,'unblocked',null);
 const finished=kanban.run(cards.report,{profile:adsProfile,status:'done',outcome:'completed',summary:'Sent the weekly report for 29 Oct to 4 Nov to the team.',ended_at:Math.floor(Date.now()/1000)});
 kanban.event(cards.report,'claimed',{run_id:finished.id},finished.id);
 kanban.event(cards.report,'completed',null,finished.id);
 cards.hidden=kanban.task({title:'Seo keywords for the diploma',status:'ready',assignee:seoProfile}).id;
});
test.afterAll(async()=>{ await fake?.close(); });

const windowOf=(page:Page)=>page.getByRole('dialog');
const cardLink=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"] a`);
const at=(path:string)=>new RegExp(`${path.replace('?','\\?')}$`);

test('a click or Enter opens a Card over the board at an address that reloads; Escape and Close give the Card the keyboard back',async({page})=>{
 await signIn(page,'omar@example.com',board);
 const sheet=windowOf(page);
 await cardLink(page,cards.ads).click();
 await expect(sheet).toBeVisible();
 await expect(page).toHaveURL(at(`${board}?card=${cards.ads}`));
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('December ad copy');
 await expect(page.locator(`#board-cols .kcard[data-card="${cards.ads}"]`)).toBeAttached();
 await page.keyboard.press('Escape');
 await expect(sheet).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page,cards.ads)).toBeFocused();

 await page.keyboard.press('Enter');
 await expect(sheet).toBeVisible();
 await expect(page).toHaveURL(at(`${board}?card=${cards.ads}`));
 await page.reload();
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('December ad copy');
 await expect(page.locator(`#board-cols .kcard[data-card="${cards.ads}"]`)).toBeAttached();
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 await expect(sheet).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page,cards.ads)).toBeFocused();
});

test('the window opens over the board in two columns, and full screen in one column on a phone',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',`${board}?card=${cards.ads}`);
 const sheet=windowOf(page);
 const details=sheet.getByRole('complementary',{name:'Card details'});
 await expect(details).toBeVisible();
 const [wide,top,side]=await Promise.all([sheet.boundingBox(),sheet.locator('.cw-top').boundingBox(),details.boundingBox()]);
 expect(wide!.width).toBeLessThan(1440);
 // The details sit beside the description, at the reading direction's end.
 expect(side!.x).toBeGreaterThanOrEqual(top!.x+top!.width-1);
 expect(Math.abs(side!.y-top!.y)).toBeLessThan(40);
 await page.setViewportSize({width:390,height:844});
 await expect.poll(async()=>(await sheet.boundingBox())!.width).toBe(390);
 await sheet.evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
 const [phone,phoneTop,phoneSide]=await Promise.all([sheet.boundingBox(),sheet.locator('.cw-top').boundingBox(),details.boundingBox()]);
 // The window rises into place as it opens: its box is read once it has settled, to the pixel.
 expect(Object.values(phone!).map(Math.round)).toEqual([0,0,390,844]);
 // One column: the details below the description, as wide as it.
 expect(phoneSide!.y).toBeGreaterThan(phoneTop!.y+phoneTop!.height-1);
 expect(phoneSide!.x).toBeLessThan(phoneTop!.x+1);
});

test('the window reads the Card from the Engine: its description with its to-dos, its details, and what it waits for, which opens',async({page})=>{
 await signIn(page,'omar@example.com',`${board}?card=${cards.ads}`);
 const sheet=windowOf(page);
 const description=sheet.locator('.de');
 await expect(description.getByRole('heading',{name:'Steps'})).toBeVisible();
 await expect(description.getByRole('checkbox',{name:'Read last month’s numbers'})).toHaveAttribute('aria-checked','true');
 await expect(description.getByRole('checkbox',{name:'Draft three ads'})).toHaveAttribute('aria-checked','false');
 await expect(description.locator('.de-prog')).toHaveText('1/3 done');
 await expect(description.locator('b')).toHaveText('price');
 await expect(description.getByRole('link',{name:'the course page'})).toHaveAttribute('href','https://example.com/course');
 const details=sheet.getByRole('complementary',{name:'Card details'});
 // A Member who may write reads the Assignee on its menu's button (the menu is the next case's).
 await expect(details.getByRole('button',{name:'Assignee: Ads'})).toBeVisible();
 await expect(details).toContainText('Project:December campaign');
 // It waits for another Card, which its symbol and its details name; the chip opens that Card.
 await expect(sheet.locator('.cw-status')).toContainText('Planned');
 await expect(sheet.locator('.cw-status').getByRole('img',{name:'Waiting for another card'})).toBeVisible();
 const waits=details.getByRole('link',{name:'Course page copy · In progress'});
 await expect(waits).toBeVisible();
 await waits.click();
 await expect(page).toHaveURL(at(`${board}?card=${cards.page}`));
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('Course page copy');
 await expect(sheet.locator('.cw-status')).toContainText('In progress');
 await expect(details.getByRole('link',{name:'December ad copy · Planned'})).toBeVisible();
 // Back returns to the Card it was opened from; Close then goes back to the board as it was.
 await page.goBack();
 await expect(page).toHaveURL(at(`${board}?card=${cards.ads}`));
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('December ad copy');
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 await expect(sheet).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await page.goto(`${board}?card=${cards.page}`);
 // A Card with no comments, activity beyond its making, or Runs says so in each tab.
 await expect(sheet.getByRole('tabpanel')).toHaveText('No comments yet');
});

test('a done Card shows its summary above the tabs, and its comments, activity and Runs from the Engine',async({page})=>{
 await signIn(page,'omar@example.com',`${board}?card=${cards.report}`);
 const sheet=windowOf(page);
 const summary=sheet.locator('.cw-sum');
 await expect(summary).toHaveText('Sent the weekly report for 29 Oct to 4 Nov to the team.');
 const [result,tabs]=await Promise.all([summary.boundingBox(),sheet.getByRole('tablist').boundingBox()]);
 expect(result!.y+result!.height).toBeLessThanOrEqual(tabs!.y);
 await expect(sheet.locator('.cw-status')).toContainText('Done');
 // Comments, each under its author and with its time.
 const panel=sheet.getByRole('tabpanel');
 await expect(sheet.getByRole('tab',{name:'Comments 2'})).toHaveAttribute('aria-selected','true');
 const rows=panel.locator('.lg-row');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0).locator('.lg-name')).toHaveText('Ads');
 await expect(rows.nth(0).locator('.lg-note')).toHaveText('Which week should I cover?');
 await expect(rows.nth(1).locator('.lg-name')).toHaveText('Omar Abdo');
 await expect(rows.nth(1).locator('.lg-time')).toHaveText(/\d{1,2}:\d{2}/);
 // Activity: the Engine's events in words, by the keyboard as a tab list.
 await sheet.getByRole('tab',{name:'Comments 2'}).focus();
 await page.keyboard.press('ArrowRight');
 await expect(sheet.getByRole('tab',{name:/^Activity \d+$/})).toBeFocused();
 await expect(panel.locator('.lg-line')).toHaveText(['Card made','Started working','Stopped on a question','Commented','Commented','Going on again','Started working','Finished']);
 await expect(panel.locator('[data-event="blocked"] .lg-meta')).toContainText('Ads');
 await expect(panel.locator('[data-event="commented"] .lg-meta')).toContainText([/Ads/,/Omar Abdo/]);
 // Runs: each attempt, newest first, with its state and summary.
 await page.keyboard.press('ArrowRight');
 await expect(sheet.getByRole('tab',{name:'Runs 2'})).toHaveAttribute('aria-selected','true');
 await expect(panel.locator('.cw-run__t')).toHaveText(['#2 · Ads · Finished','#1 · Ads · Stopped on a question']);
 await expect(panel.locator('.cw-run__n')).toHaveText(['Sent the weekly report for 29 Oct to 4 Nov to the team.','Which week should I cover?']);
});

test('a Viewer opens the window and is offered nothing that writes; a Card of an Agent hidden from them, or of another Company, does not open',async({page})=>{
 await signIn(page,'viewer@example.com',`${board}?card=${cards.report}`);
 const sheet=windowOf(page);
 await expect(sheet.locator('.cw-sum')).toBeVisible();
 await expect(sheet.getByRole('img',{name:'Read only'})).toBeVisible();
 await expect(sheet.locator('.ro-line')).toHaveText('Read only');
 await expect(sheet.getByRole('textbox')).toHaveCount(0);
 // Its only buttons close the window and pick a tab; nothing else is a control.
 const names=await sheet.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
 expect(names[0]).toBe('Close the card');
 expect(names.slice(1).every(name=>/^(Comments|Activity|Runs) \d+$/.test(name??''))).toBe(true);
 await expect(sheet.locator('input, textarea, select, [contenteditable="true"], form')).toHaveCount(0);
 await expect(sheet.getByRole('checkbox')).toHaveCount(0);
 // A Card given to an Agent hidden from the Viewer is not on their board, on the page or on the route.
 const hidden=await page.request.get(`/api/board/card?company=${rs}&card=${cards.hidden}`);
 expect(hidden.status()).toBe(404);
 expect(await hidden.text()).not.toContain('Seo keywords');
 await page.goto(`${board}?card=${cards.hidden}`);
 await expect(sheet.getByRole('alert')).toHaveText('This card isn’t on your board. It may have been taken off, or given to an Agent you can’t see.');
 await expect(sheet).not.toContainText('Seo keywords');
 // Aleem's board is closed to the Viewer, who is no Member there: the route finds no Card.
 expect((await page.request.get(`/api/board/card?company=10000000-0000-0000-0000-000000000003&card=${cards.report}`)).status()).toBe(404);
});

test('nothing the browser is sent for a Card names a profile, the Engine\'s address or its key, and a malformed read is refused',async({page})=>{
 const answers:string[]=[];
 page.on('response',response=>{ if(/text|json|javascript/.test(response.headers()['content-type']||'')) void response.text().then(body=>answers.push(body),()=>{}); });
 await signIn(page,'omar@example.com',`${board}?card=${cards.report}`);
 await expect(windowOf(page).locator('.cw-sum')).toBeVisible();
 const read=await page.request.get(`/api/board/card?company=${rs}&card=${cards.report}`);
 expect(read.status()).toBe(200);
 answers.push(await read.text(),await page.content());
 for(const leak of [fake.settings.key,fake.address,fake.managementAddress,adsProfile,rsProfile]) expect(answers.some(body=>body.includes(leak)),leak).toBe(false);
 expect((await page.request.get(`/api/board/card?company=${rs}&card=..%2Fboard`)).status()).toBe(400);
 expect((await page.request.get(`/api/board/card?company=not-a-company&card=${cards.report}`)).status()).toBe(400);
});

test('a tab the Engine stops answering for keeps what it last read, and the rest of the window still draws',async({page})=>{
 await signIn(page,'omar@example.com',`${board}?card=${cards.report}`);
 const sheet=windowOf(page);
 const panel=sheet.getByRole('tabpanel');
 await expect(panel.locator('.lg-row')).toHaveCount(2);
 fake.settings.managedFail=(method,path)=>path.startsWith('/api/plugins/kanban/tasks/')?500:null;
 try {
  // The refused read itself: a read the live stream started before the Engine stopped answering may still come back 200.
  const again=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board/card'&&response.status()===503);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect((await again).status()).toBe(503);
  await expect(sheet.getByRole('status').filter({hasText:'Couldn’t refresh the card. Showing what it last read.'})).toBeVisible();
  await expect(panel.locator('.lg-row')).toHaveCount(2);
  await expect(sheet.locator('.cw-sum')).toBeVisible();
  // A Card opened while the Engine does not answer draws what the board holds of it, and its tabs say they wait.
  await page.goto(`${board}?card=${cards.page}`);
  await expect(sheet.getByRole('heading',{level:2})).toHaveText('Course page copy');
  await expect(sheet.locator('.cw-status')).toContainText('In progress');
  await expect(sheet.getByRole('complementary',{name:'Card details'})).toContainText('Assignee:Ads');
  await expect(panel.getByRole('alert')).toHaveText('The card couldn’t be read from the Engine. Trying again.');
  await expect(sheet.getByRole('tab')).toHaveCount(3);
 } finally { fake.settings.managedFail=null; }
});

test('a Member who may write gives an open Card to a Member, to themselves, to an Agent or to nobody from its Assignee menu',async({page})=>{
 const kanban=fake.settings.kanban;
 const task=kanban.task({title:'Course reel script',status:'todo'});
 await signIn(page,'omar@example.com',`${board}?card=${task.id}`);
 const sheet=windowOf(page);
 const assignee=sheet.getByRole('button',{name:'Assignee: No one'});
 await expect(assignee).toBeVisible();
 // The menu opens on the keyboard: "Assign to me" first, then the Agents and the Members, then nobody.
 await assignee.click();
 const menu=sheet.getByRole('menu',{name:'Assignee'});
 await expect(menu.getByRole('menuitemradio',{name:'Assign to me'})).toBeVisible();
 await expect(menu.getByRole('menuitemradio',{name:'Ads'})).toBeVisible();
 await menu.getByRole('menuitemradio',{name:'مدير'}).click();
 await expect(sheet.getByRole('button',{name:'Assignee: مدير'})).toBeFocused();
 // Given to a Member: the Engine has no Agent on it, and the board's Card shows the Member.
 await expect.poll(()=>task.assignee).toBeNull();
 await expect(page.locator(`#board-cols .kcard[data-card="${task.id}"] .kt-face`)).toHaveAttribute('title','مدير');
 await sheet.getByRole('button',{name:'Assignee: مدير'}).click();
 await menu.getByRole('menuitemradio',{name:'Assign to me'}).click();
 await expect(sheet.getByRole('button',{name:'Assignee: عمر'})).toBeVisible();
 // Given to an Agent: the Engine's Card is the Agent's, and the Member is cleared.
 await sheet.getByRole('button',{name:'Assignee: عمر'}).click();
 await menu.getByRole('menuitemradio',{name:'Ads'}).click();
 await expect.poll(()=>task.assignee).toBe(adsProfile);
 await expect(sheet.getByRole('button',{name:'Assignee: Ads'})).toBeVisible();
 await expect(page.locator(`#board-cols .kcard[data-card="${task.id}"] .kt-face`)).toHaveAttribute('title','Ads');
 // Escape closes the menu, not the Card.
 await sheet.getByRole('button',{name:'Assignee: Ads'}).click();
 await page.keyboard.press('Escape');
 await expect(menu).toHaveCount(0);
 await expect(sheet).toBeVisible();
 // A Card an Agent is working now keeps its Agent, and the window says why.
 Object.assign(task,{status:'running',claim_lock:'host:1'});
 await sheet.getByRole('button',{name:'Assignee: Ads'}).click();
 await menu.getByRole('menuitemradio',{name:'No one'}).click();
 await expect(sheet.getByRole('alert')).toHaveText('An Agent is working on this card now. Stop it first, then give it to someone else.');
 await expect(sheet.getByRole('button',{name:'Assignee: Ads'})).toBeVisible();
 expect(task.assignee).toBe(adsProfile);
});

test('an open Card follows the Engine live: a comment added there shows in its window, with no reload',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Course launch email',status:'running',assignee:adsProfile}).id;
 const opened:string[]=[];
 page.on('websocket',socket=>opened.push(new URL(socket.url()).pathname));
 await signIn(page,'omar@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 await expect(sheet.getByRole('tabpanel')).toHaveText('No comments yet');
 await expect.poll(()=>opened.includes('/api/board/events')).toBe(true);
 let reloaded=false;
 page.on('framenavigated',frame=>{ if(frame===page.mainFrame()) reloaded=true; });
 // The Agent working it comments on the Engine, and a person answers; each shows in the open window within seconds.
 kanban.comment(card,adsProfile,'Draft is ready for a look.');
 await expect(sheet.getByRole('tabpanel').locator('.lg-note')).toHaveText(['Draft is ready for a look.'],{timeout:3000});
 await expect(sheet.getByRole('tab',{name:'Comments 1'})).toBeVisible();
 kanban.comment(card,'Mona','Use the new price.');
 await expect(sheet.getByRole('tabpanel').locator('.lg-note')).toHaveText(['Draft is ready for a look.','Use the new price.'],{timeout:3000});
 expect(reloaded).toBe(false);
});
