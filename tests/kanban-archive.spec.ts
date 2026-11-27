import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#842): a Card is archived from its window's More menu with the Engine's own archived status (design-
// reference-card: cwArchive, cwUndo, cwConfirm, cwCalloutHTML's archived branch). It leaves the board and its column's
// count, the window stays on it archived and read only, and Undo puts it back in its column. A Card an Agent is working
// on asks once, naming the Run, and is archived only after "Archive and stop", which stops the Run; restored from the
// archived list it starts nothing. A Card that waited for an archived Card no longer waits. A Viewer has no control to
// archive or restore, and the server refuses them both.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004';
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
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}');
  end $$;`);
 const kanban=fake.settings.kanban;
 cards.copy=kanban.task({title:'December ad copy',status:'ready',assignee:adsProfile}).id;
 cards.email=kanban.task({title:'Email to old subscribers',status:'todo'}).id;
 cards.meta=kanban.task({title:'Meta campaign',status:'running',assignee:adsProfile}).id;
 kanban.run(cards.meta,{profile:adsProfile});
 cards.page=kanban.task({title:'Course page copy',status:'ready',assignee:adsProfile}).id;
 cards.after=kanban.task({title:'Email after the course page',status:'todo'}).id;
 kanban.link(cards.page,cards.after);
 cards.old=kanban.task({title:'Old webinar',status:'archived'}).id;
});
test.afterAll(async()=>{ await fake?.close(); });

const windowOf=(page:Page)=>page.getByRole('dialog').filter({has:page.locator('#cw-title')});
const inColumn=(page:Page,column:string,id:string)=>page.locator(`#board-cols [data-column="${column}"] .kcard[data-card="${id}"]`);
const onBoard=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"]`);
const countOf=(page:Page,column:string)=>page.locator(`#board-cols [data-column="${column}"] .col__count`);
const toast=(page:Page)=>page.locator('.toast');
const status=(id:string)=>fake.settings.kanban.tasks.find(task=>task.id===id)?.status;

test('a Contributor archives a Card from its window\'s More menu with the keyboard: it leaves the board and its count, and Undo puts it back',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await expect(inColumn(page,'planned',cards.copy)).toBeVisible();
 const planned=Number(await countOf(page,'planned').textContent());
 await page.locator(`#board-cols .kcard[data-card="${cards.copy}"] a`).click();
 const sheet=windowOf(page);
 const more=sheet.getByRole('button',{name:'More',exact:true});
 await more.focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('menuitem',{name:'Archive the card'})).toBeFocused();
 await page.keyboard.press('Enter');
 // The window stays on the Card, archived and read only, with the keyboard back on its menu.
 await expect(sheet.getByRole('region',{name:'Archived'})).toBeVisible();
 await expect(more).toBeFocused();
 await expect(toast(page)).toContainText('Archived');
 expect(status(cards.copy)).toBe('archived');
 await expect(sheet.getByRole('button',{name:/^Assignee/})).toHaveCount(0);
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 await expect(onBoard(page,cards.copy)).toHaveCount(0);
 await expect(countOf(page,'planned')).toHaveText(String(planned-1));
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(toast(page)).toContainText('Restored');
 await expect(inColumn(page,'planned',cards.copy)).toBeVisible();
 await expect(countOf(page,'planned')).toHaveText(String(planned));
 expect(status(cards.copy)).toBe('ready');
});

test('a Card an Agent works on asks once; Cancel archives nothing, "Archive and stop" stops its Run, and Restore from the list starts nothing',async({page})=>{
 await signIn(page,'reviewer@example.com',`${board}?card=${cards.meta}`);
 const sheet=windowOf(page);
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('Meta campaign');
 const archive=async()=>{ await sheet.getByRole('button',{name:'More',exact:true}).click(); await page.getByRole('menuitem',{name:'Archive the card'}).click(); };
 await archive();
 const confirm=page.getByRole('dialog',{name:'Archive the card?'});
 await expect(confirm.getByRole('listitem')).toHaveText(['Ads stops working on “Meta campaign”']);
 await confirm.getByRole('button',{name:'Cancel'}).click();
 await expect(confirm).toHaveCount(0);
 expect(status(cards.meta)).toBe('running');
 await archive();
 await confirm.getByRole('button',{name:'Archive and stop'}).click();
 await expect(sheet.getByRole('region',{name:'Archived'})).toBeVisible();
 expect(status(cards.meta)).toBe('archived');
 const run=fake.settings.kanban.runs.find(found=>found.task_id===cards.meta)!;
 expect([run.status,run.outcome,run.ended_at!=null]).toEqual(['reclaimed','reclaimed',true]);
 await sheet.getByRole('tab',{name:/^Runs/}).click();
 await expect(sheet.locator('.cw-run')).toContainText('Stopped');
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 await expect(onBoard(page,cards.meta)).toHaveCount(0);

 // Restored from the archived list: back on the board, its Run not started again and no tick asked.
 const ticks=fake.settings.kanban.ticks;
 await page.getByRole('button',{name:/^Archived/}).click();
 await page.getByRole('list',{name:'Archived cards'}).getByRole('button',{name:'Restore Meta campaign'}).click();
 await expect(toast(page)).toContainText('Restored');
 await page.getByRole('button',{name:/^Archived/}).click();
 await expect(inColumn(page,'planned',cards.meta)).toBeVisible();
 expect(fake.settings.kanban.ticks).toBe(ticks);
 expect(fake.settings.kanban.runs.filter(found=>found.task_id===cards.meta)).toHaveLength(1);
});

test('a Card that waited for an archived Card no longer waits, and waits again after Undo',async({page})=>{
 await signIn(page,'manager@example.com',board);
 const waits=onBoard(page,cards.after).locator('[data-sym="waits"]');
 await expect(waits).toHaveAttribute('aria-label','Waiting for another card');
 await page.locator(`#board-cols .kcard[data-card="${cards.page}"] a`).click();
 const sheet=windowOf(page);
 await sheet.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('menuitem',{name:'Archive the card'}).click();
 await expect(sheet.getByRole('region',{name:'Archived'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(waits).toHaveCount(0);
 await expect(inColumn(page,'planned',cards.after)).toBeVisible();
 await toast(page).getByRole('button',{name:'Undo'}).click();
 await expect(waits).toBeVisible();
});

test('a Viewer reads the archived list and an archived Card with no control to archive or restore, and the server refuses them both',async({page})=>{
 await signIn(page,'viewer@example.com',board);
 await expect(inColumn(page,'planned',cards.email)).toBeVisible();
 await expect(page.getByRole('button',{name:'Select several cards'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Archive everything/})).toHaveCount(0);
 await page.locator(`#board-cols .kcard[data-card="${cards.email}"] a`).click();
 await expect(windowOf(page).getByRole('heading',{level:2})).toHaveText('Email to old subscribers');
 await expect(windowOf(page).getByRole('button',{name:'More',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/^Archived/}).click();
 const row=page.getByRole('list',{name:'Archived cards'}).getByRole('listitem').filter({hasText:'Old webinar'});
 await expect(row).toBeVisible();
 await expect(row.getByRole('button')).toHaveCount(0);
 await row.getByRole('link').click();
 const sheet=windowOf(page);
 await expect(sheet.getByRole('region',{name:'Archived'})).toBeVisible();
 await expect(sheet.getByRole('region',{name:'Archived'}).getByRole('button')).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'More',exact:true})).toHaveCount(0);
 const archived=await page.request.post('/api/board/archive',{data:{company:rs,cards:[cards.email]}});
 expect(archived.status()).toBe(403);
 const restored=await page.request.patch('/api/board/archive',{data:{company:rs,cards:[cards.old]}});
 expect(restored.status()).toBe(403);
 expect([status(cards.email),status(cards.old)]).toEqual(['todo','archived']);
 // Anyone who is no Member of the Company finds no such board.
 expect((await page.request.get(`/api/board/archive?company=${randomUUID()}`)).status()).toBe(404);
});
