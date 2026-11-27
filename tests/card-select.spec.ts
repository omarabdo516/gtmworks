import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Selecting several Cards on the Engine's own board and archiving them at once (spec #831, #842; design-reference-card:
// the board's select icon, .bsel, bsel-all, bsel-archive, the Done column's "Archive everything in Done", cwArchive's
// "N archived" and cwUndo), with the keyboard, the mouse and by touch. The board is the Company's fake Engine's: an Idea,
// two Planned Cards with no Agent, a Card Ads works on and a question waiting on a person. The tests share the file's
// data in order; each puts back what it archived.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const board='/c/rs-learning/work/board';
let fake:Awaited<ReturnType<typeof laneHermes>>;
const cards:Record<string,string>={};

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) select m.company_id,m.person_id,a.id from public.members m join public.hermes_agents a on a.company_id=m.company_id
    where m.company_id='${rs}' and m.removed_at is null and m.role<>'owner' on conflict do nothing;
  end $$;`);
 const kanban=fake.settings.kanban;
 cards.idea=kanban.task({title:'Reel: a day in an accountant\'s life',status:'triage'}).id;
 cards.email=kanban.task({title:'Email to old subscribers',status:'ready'}).id;
 cards.ramadan=kanban.task({title:'Ideas for Ramadan',status:'ready'}).id;
 cards.meta=kanban.task({title:'Meta campaign',status:'running',assignee:adsProfile}).id;
 kanban.run(cards.meta,{profile:adsProfile});
 cards.numbers=kanban.task({title:'Google Ads numbers',status:'blocked',assignee:adsProfile}).id;
 // A Card with no Agent shows only where gtmworks's row beside it is (fail closed, ADR 0033): these were made from the board.
 query(`insert into public.kanban_cards(company_id,task_id) values ${[cards.idea,cards.email,cards.ramadan].map(id=>`('${rs}','${id}')`).join(',')} on conflict do nothing`);
});
test.afterAll(async()=>{ await fake?.close(); });

const onBoard=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"]`);
const inColumn=(page:Page,column:string,id:string)=>page.locator(`#board-cols [data-column="${column}"] .kcard[data-card="${id}"]`);
const pick=(page:Page,id:string)=>onBoard(page,id).getByRole('button');
const toggle=(page:Page)=>page.getByRole('button',{name:'Select several cards'});
const bar=(page:Page)=>page.getByRole('region',{name:'Selecting cards'});
const toast=(page:Page)=>page.locator('.toast');
const confirmOf=(page:Page)=>page.getByRole('dialog',{name:/^Archive/});
const status=(id:string)=>fake.settings.kanban.tasks.find(task=>task.id===id)?.status;
// A press before React hydrated the board does nothing: wait until the button has its handlers.
const hydrated=(page:Page,selector:string)=>page.waitForFunction(found=>{
 const control=document.querySelector(found);
 return !!control&&Object.getOwnPropertyNames(control).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
},selector);

test('with the keyboard: select mode, a Card, "Select all shown", Escape on the confirmation archives nothing, Cancel ends it',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await expect(onBoard(page,cards.meta)).toBeVisible();
 await hydrated(page,'button[aria-label="Select several cards"]');
 await toggle(page).focus();
 await page.keyboard.press('Enter');
 const all=bar(page).getByRole('button',{name:'Select all shown'});
 await expect(all).toBeFocused();
 await pick(page,cards.idea).focus();
 await page.keyboard.press('Space');
 await expect(pick(page,cards.idea)).toHaveAttribute('aria-pressed','true');
 await expect(bar(page)).toContainText('1 selected');
 await all.focus();
 await page.keyboard.press('Enter');
 const shown=await page.locator('#board-cols .kcard').count();
 await expect(bar(page)).toContainText(`${shown} selected`);
 const archive=bar(page).getByRole('button',{name:'Archive'});
 await expect(archive).toBeFocused();
 // Ads works on one of them and a question waits on another: archiving them all asks first, in the board's order.
 await page.keyboard.press('Enter');
 await expect(confirmOf(page).getByRole('heading')).toHaveText(`Archive ${shown} cards?`);
 await expect(confirmOf(page).getByRole('listitem')).toHaveText(['The question from Ads on “Google Ads numbers” closes unanswered','Ads stops working on “Meta campaign”']);
 await page.keyboard.press('Escape');
 await expect(confirmOf(page)).toHaveCount(0);
 await expect(onBoard(page,cards.idea)).toBeVisible();
 await expect(bar(page)).toContainText(`${shown} selected`);
 expect(status(cards.meta)).toBe('running');
 await bar(page).getByRole('button',{name:'Cancel'}).focus();
 await page.keyboard.press('Enter');
 await expect(bar(page)).toHaveCount(0);
 await expect(toggle(page)).toBeFocused();
 await expect(onBoard(page,cards.idea).getByRole('link')).toBeVisible();
});

test('with the mouse: several Cards selected ask once for what stops across them, archive together, and one Undo restores them all',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await hydrated(page,'button[aria-label="Select several cards"]');
 await toggle(page).click();
 await expect(bar(page)).toContainText('0 selected');
 await expect(bar(page).getByRole('button',{name:'Archive'})).toBeDisabled();
 // A Card in select mode is one press that selects it, not a link to open it.
 await pick(page,cards.idea).click();
 await pick(page,cards.email).click();
 await pick(page,cards.meta).click();
 await expect(pick(page,cards.idea)).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await pick(page,cards.meta).click();
 await expect(pick(page,cards.meta)).toHaveAttribute('aria-pressed','false');
 await pick(page,cards.meta).click();
 await expect(bar(page)).toContainText('3 selected');
 await bar(page).getByRole('button',{name:'Archive'}).click();
 const confirm=confirmOf(page);
 await expect(confirm.getByRole('heading')).toHaveText('Archive 3 cards?');
 await expect(confirm.getByRole('listitem')).toHaveText(['Ads stops working on “Meta campaign”']);
 await confirm.getByRole('button',{name:'Archive and stop'}).click();
 await expect(toast(page)).toContainText('3 archived');
 for(const id of [cards.idea,cards.email,cards.meta]) await expect(onBoard(page,id)).toHaveCount(0);
 await expect(bar(page)).toHaveCount(0);
 expect([status(cards.idea),status(cards.email),status(cards.meta)]).toEqual(['archived','archived','archived']);
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(toast(page)).toContainText('3 restored');
 await expect(inColumn(page,'ideas',cards.idea)).toBeVisible();
 await expect(inColumn(page,'planned',cards.email)).toBeVisible();
 // Undo gives the work back: Ads goes on with Meta campaign.
 await expect(inColumn(page,'progress',cards.meta)).toBeVisible();
});

test('by touch: a tap selects a Card and a tap on Archive archives it, with Undo',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:1024,height:768},hasTouch:true});
 const page=await context.newPage();
 try {
  await signIn(page,'manager@example.com',board);
  await hydrated(page,'button[aria-label="Select several cards"]');
  await toggle(page).tap();
  await pick(page,cards.ramadan).tap();
  await expect(pick(page,cards.ramadan)).toHaveAttribute('aria-pressed','true');
  await bar(page).getByRole('button',{name:'Archive'}).tap();
  await expect(toast(page)).toContainText('Archived');
  await expect(onBoard(page,cards.ramadan)).toHaveCount(0);
  await toast(page).getByRole('button',{name:'Undo'}).tap();
  await expect(toast(page)).toContainText('Restored');
  await expect(inColumn(page,'planned',cards.ramadan)).toBeVisible();
 } finally { await context.close(); }
});

test('"Archive everything in Done" archives exactly the Cards shown in Done, and Undo puts them back; a Viewer has neither control',async({page,browser})=>{
 const kanban=fake.settings.kanban;
 const made=['Spring post','Summer post'].map(title=>{ const id=kanban.task({title,status:'done'}).id; kanban.run(id,{status:'done',outcome:'completed',summary:`${title} is out.`,ended_at:Math.floor(Date.now()/1000)}); return id; });
 // With no Agent, a Card shows where gtmworks's row beside it is (fail closed, ADR 0033).
 const rows=(ids:string[])=>query(`insert into public.kanban_cards(company_id,task_id) values ${ids.map(id=>`('${rs}','${id}')`).join(',')} on conflict do nothing`);
 rows(made);
 await signIn(page,'reviewer@example.com',board);
 for(const id of made) await expect(inColumn(page,'done',id)).toBeVisible();
 // A Card finished on the Engine after the board last read it is not shown, so it is not archived: the board's own
 // reads fail from here on, so it keeps showing what it last read.
 await page.route(/\/api\/board\?company=/,route=>route.abort());
 const late=kanban.task({title:'Autumn post',status:'done'}).id;
 rows([late]);
 kanban.run(late,{status:'done',outcome:'completed',summary:'Autumn post is out.',ended_at:Math.floor(Date.now()/1000)});
 await expect(page.getByText('Couldn’t refresh the board. Showing what it last read.')).toBeVisible();
 {
  await hydrated(page,'button.col__act[aria-label="Archive everything in Done"]');
  await page.getByRole('button',{name:'Archive everything in Done'}).click();
  await expect(toast(page)).toContainText('2 archived');
  expect([status(made[0]),status(made[1]),status(late)]).toEqual(['archived','archived','done']);
  for(const id of made) await expect(onBoard(page,id)).toHaveCount(0);
  // The archive's answer is the board as it now reads, the late Card in it.
  await expect(inColumn(page,'done',late)).toBeVisible();
  await toast(page).getByRole('button',{name:'Undo'}).click();
  await expect(toast(page)).toContainText('2 restored');
  for(const id of made) await expect(inColumn(page,'done',id)).toBeVisible();
  expect([status(made[0]),status(made[1])]).toEqual(['done','done']);
 }

 const reader=await (await browser.newContext()).newPage();
 await signIn(reader,'viewer@example.com',board);
 await expect(inColumn(reader,'done',made[0])).toBeVisible();
 await expect(toggle(reader)).toHaveCount(0);
 await expect(reader.getByRole('button',{name:'Archive everything in Done'})).toHaveCount(0);
 await reader.context().close();
});

test('a selected Card that changed meanwhile is left and named; the others are archived',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await hydrated(page,'button[aria-label="Select several cards"]');
 await toggle(page).click();
 await pick(page,cards.idea).click();
 await pick(page,cards.email).click();
 // Someone else archives the email Card on the Engine before this person presses Archive.
 expect(fake.settings.kanban.status(cards.email,'archived')).toBeNull();
 try {
  await bar(page).getByRole('button',{name:'Archive'}).click();
  await expect(toast(page)).toContainText('Archived');
  await expect(page.getByRole('alert').filter({hasText:'Not archived'})).toContainText('Not archived: “Email to old subscribers”');
  await expect(onBoard(page,cards.idea)).toHaveCount(0);
  await toast(page).getByRole('button',{name:'Undo'}).click();
  await expect(inColumn(page,'ideas',cards.idea)).toBeVisible();
 } finally { fake.settings.kanban.status(cards.email,'ready'); }
});
