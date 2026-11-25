import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// Selecting several Cards and archiving them at once (#672; design-reference-card: the board's select icon, .bsel,
// bsel-all, bsel-archive, the Done column's "Archive everything in Done", cwArchive's "N archived" and cwUndo). The
// seed's RS Learning: card 1 in Ideas, 2 in Planned, 3 and 4 In progress, 5 waiting in review for the Owner's approval.
// The tests share the file's data in order; each puts back what it archived.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql)) as Record<string,unknown>[];
const board='/c/rs-learning/work/board';
const company='10000000-0000-0000-0000-000000000001';
const titleOf=(id:number)=>String(rows(`select title from public.work_cards where id=${id}`)[0].title);
const onBoard=(page:Page,id:number)=>page.locator(`#board-cols .kcard[data-card-id="${id}"]`);
const inColumn=(page:Page,column:string,id:number)=>page.locator(`#board-cols [data-column="${column}"] .kcard[data-card-id="${id}"]`);
const pick=(page:Page,id:number)=>onBoard(page,id).getByRole('button');
const toggle=(page:Page)=>page.getByRole('button',{name:'Select several cards'});
const bar=(page:Page)=>page.getByRole('region',{name:'Selecting cards'});
const toast=(page:Page)=>page.locator('.toast');
const confirmOf=(page:Page)=>page.getByRole('dialog',{name:/^Archive/});

test('with the keyboard: select mode, a Card, "Select all shown", Escape on the confirmation archives nothing, Cancel ends it',async({page})=>{
 // First in the file: card 5 still waits for its approval, so the confirmation is what stands before archiving all.
 await signIn(page,'reviewer@example.com',board);
 await toggle(page).focus();
 await page.keyboard.press('Enter');
 const all=bar(page).getByRole('button',{name:'Select all shown'});
 await expect(all).toBeFocused();
 await pick(page,1).focus();
 await page.keyboard.press('Space');
 await expect(pick(page,1)).toHaveAttribute('aria-pressed','true');
 await expect(bar(page)).toContainText('1 selected');
 await all.focus();
 await page.keyboard.press('Enter');
 const shown=await page.locator('#board-cols .kcard').count();
 await expect(bar(page)).toContainText(`${shown} selected`);
 const archive=bar(page).getByRole('button',{name:'Archive'});
 await expect(archive).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(confirmOf(page).getByRole('heading')).toHaveText(`Archive ${shown} cards?`);
 await page.keyboard.press('Escape');
 await expect(confirmOf(page)).toHaveCount(0);
 await expect(onBoard(page,1)).toBeVisible();
 await expect(bar(page)).toContainText(`${shown} selected`);
 await bar(page).getByRole('button',{name:'Cancel'}).focus();
 await page.keyboard.press('Enter');
 await expect(bar(page)).toHaveCount(0);
 await expect(toggle(page)).toBeFocused();
 await expect(onBoard(page,1).getByRole('link')).toBeVisible();
});

test('with the mouse: several Cards selected ask once for what stops across them, archive together, and one Undo restores them all',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await toggle(page).click();
 await expect(bar(page)).toContainText('0 selected');
 await expect(bar(page).getByRole('button',{name:'Archive'})).toBeDisabled();
 // A Card in select mode is one press that selects it, not a link to open it.
 await pick(page,1).click();
 await pick(page,2).click();
 await pick(page,5).click();
 await expect(pick(page,1)).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await pick(page,5).click();
 await expect(pick(page,5)).toHaveAttribute('aria-pressed','false');
 await pick(page,5).click();
 await expect(bar(page)).toContainText('3 selected');
 await bar(page).getByRole('button',{name:'Archive'}).click();
 const confirm=confirmOf(page);
 await expect(confirm.getByRole('heading')).toHaveText('Archive 3 cards?');
 await expect(confirm.getByRole('listitem')).toHaveText([`The approval of “${titleOf(5)}” ends with no decision`]);
 await confirm.getByRole('button',{name:'Archive and stop'}).click();
 await expect(toast(page)).toContainText('3 archived');
 for(const id of [1,2,5]) await expect(onBoard(page,id)).toHaveCount(0);
 await expect(bar(page)).toHaveCount(0);
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(toast(page)).toContainText('3 restored');
 await expect(inColumn(page,'ideas',1)).toBeVisible();
 await expect(inColumn(page,'planned',2)).toBeVisible();
 // The approval ended with the archive (#671), so card 5 is back where it was sent for approval from.
 await expect(inColumn(page,'progress',5)).toBeVisible();
});

test('by touch: a tap selects a Card and a tap on Archive archives it, with Undo',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:1024,height:768},hasTouch:true});
 const page=await context.newPage();
 try {
  await signIn(page,'manager@example.com',board);
  await toggle(page).tap();
  await pick(page,3).tap();
  await expect(pick(page,3)).toHaveAttribute('aria-pressed','true');
  await bar(page).getByRole('button',{name:'Archive'}).tap();
  await expect(toast(page)).toContainText('Archived');
  await expect(onBoard(page,3)).toHaveCount(0);
  await toast(page).getByRole('button',{name:'Undo'}).tap();
  await expect(toast(page)).toContainText('Restored');
  await expect(inColumn(page,'progress',3)).toBeVisible();
 } finally { await context.close(); }
});

test('"Archive everything in Done" archives every Card shown in Done at once, and Undo puts them back; a Viewer has neither control',async({page,browser})=>{
 // Two Cards already published and done, put there as the approval that moved them would (its guard is the database's).
 // They stay in Done for the rest of the file; the next file starts from the seed.
 query(`do $$ begin
  set local session_replication_role=replica;
  insert into public.work_cards(company_id,stage_id,title,board_order) select company_id,id,x,n from public.work_stages, unnest(array['Spring post','Summer post']) with ordinality as made(x,n) where company_id='${company}' and board_column='done';
  set local session_replication_role=origin;
 end $$;`);
 const made=rows(`select id from public.work_cards where company_id='${company}' and title in ('Spring post','Summer post') order by id`).map(row=>Number(row.id));
 await signIn(page,'reviewer@example.com',board);
 for(const id of made) await expect(inColumn(page,'done',id)).toBeVisible();
 await page.getByRole('button',{name:'Archive everything in Done'}).click();
 await expect(toast(page)).toContainText('2 archived');
 for(const id of made) await expect(onBoard(page,id)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Archive everything in Done'})).toHaveCount(0);
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(toast(page)).toContainText('2 restored');
 for(const id of made) await expect(inColumn(page,'done',id)).toBeVisible();

 const viewer=await (await browser.newContext()).newPage();
 await signIn(viewer,'viewer@example.com',board);
 await expect(inColumn(viewer,'done',made[0])).toBeVisible();
 await expect(toggle(viewer)).toHaveCount(0);
 await expect(viewer.getByRole('button',{name:'Archive everything in Done'})).toHaveCount(0);
 await viewer.context().close();
});

test('a selected Card that changed meanwhile is left and named; the others are archived',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await toggle(page).click();
 await pick(page,1).click();
 await pick(page,2).click();
 // Someone else archives card 2 before this person presses Archive.
 query(`update public.work_cards set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000001' where id=2`);
 try {
  await bar(page).getByRole('button',{name:'Archive'}).click();
  await expect(toast(page)).toContainText('Archived');
  await expect(page.getByRole('alert').filter({hasText:'Not archived'})).toContainText(`Not archived: “${titleOf(2)}”`);
  await expect(onBoard(page,1)).toHaveCount(0);
  await toast(page).getByRole('button',{name:'Undo'}).click();
  await expect(inColumn(page,'ideas',1)).toBeVisible();
 } finally { query('update public.work_cards set archived_at=null,archived_by=null where id=2'); }
});
