import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// The board's archived Cards (spec #831, #842; design-reference-card: the board's archive icon, .arch-list, bt-search):
// the archive icon shows the archived Cards of the Company's fake Engine in place of the columns, each with its
// Assignee and when it was made, and Restore puts one back in its column. With more archived Cards than one page holds,
// the list shows fifty, newest made first, "Show more" adds the rest, and its search reads every archived title, so a
// Card past the first page is found and opened.
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
 cards.copy=fake.settings.kanban.task({title:'December ad copy',status:'todo',assignee:adsProfile}).id;
});
test.afterAll(async()=>{ await fake?.close(); });

const toast=(page:Page)=>page.locator('.toast');
const archivedToggle=(page:Page)=>page.getByRole('button',{name:/^Archived( · \d+)?$/});

test('the board\'s archive icon lists archived Cards with their Assignee and when they were made, and Restore puts one back',async({page})=>{
 await signIn(page,'reviewer@example.com',board);
 await page.locator(`#board-cols .kcard[data-card="${cards.copy}"] a`).click();
 const sheet=page.getByRole('dialog');
 await sheet.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('menuitem',{name:'Archive the card'}).click();
 await expect(sheet.getByRole('region',{name:'Archived'})).toBeVisible();
 await sheet.getByRole('button',{name:'Close the card',exact:true}).click();
 await expect(page.locator(`#board-cols .kcard[data-card="${cards.copy}"]`)).toHaveCount(0);
 await archivedToggle(page).click();
 await expect(archivedToggle(page)).toHaveAttribute('aria-pressed','true');
 await expect(archivedToggle(page)).toHaveAccessibleName('Archived · 1');
 await expect(page.locator('#board-cols')).toHaveCount(0);
 const row=page.getByRole('list',{name:'Archived cards'}).getByRole('listitem').filter({hasText:'December ad copy'});
 await expect(row).toContainText('Ads');
 await expect(row).toContainText('Made');
 await row.getByRole('button',{name:'Restore December ad copy'}).click();
 await expect(toast(page)).toContainText('Restored');
 await expect(page.getByText('Nothing archived')).toBeVisible();
 await archivedToggle(page).click();
 await expect(page.locator(`#board-cols [data-column="planned"] .kcard[data-card="${cards.copy}"]`)).toBeVisible();
 expect(fake.settings.kanban.tasks.find(task=>task.id===cards.copy)?.status).toBe('todo');
});

test('the archive list shows fifty archived Cards, newest first, "Show more" adds the rest, and its search finds one past the first page',async({page})=>{
 // Sixty archived Cards, the oldest titled in Arabic.
 const kanban=fake.settings.kanban;
 const made=[kanban.task({title:'مُــهمّة إعلانات ديسمبر',status:'archived'}).id];
 for(let n=2;n<=60;n++) made.push(kanban.task({title:`Archived plan ${String(n).padStart(2,'0')}`,status:'archived'}).id);
 // A Card with no Agent shows only where gtmworks's row beside it is (fail closed, ADR 0033): these were made from the board.
 query(`insert into public.kanban_cards(company_id,task_id) values ${[...made].map(id=>`('${rs}','${id}')`).join(',')} on conflict do nothing`);
 await signIn(page,'reviewer@example.com',board);
 await archivedToggle(page).click();
 await expect(archivedToggle(page)).toHaveAccessibleName('Archived · 60');
 const rows=page.getByRole('list',{name:'Archived cards'}).getByRole('listitem');
 await expect(rows).toHaveCount(50);
 await expect(rows.first()).toContainText('Archived plan 60');
 await expect(rows.last()).toContainText('Archived plan 11');
 await page.getByRole('button',{name:'Show more'}).click();
 await expect(rows).toHaveCount(60);
 await expect(rows.last()).toContainText('مُــهمّة إعلانات ديسمبر');
 await expect(page.getByRole('button',{name:'Show more'})).toHaveCount(0);

 // The search asks the server: from a fresh list of fifty, the oldest Card is found, Arabic marks and tatweel aside.
 await page.reload();
 await archivedToggle(page).click();
 await expect(rows).toHaveCount(50);
 await page.getByRole('button',{name:'Search archived cards'}).click();
 const search=page.getByRole('searchbox',{name:'Search archived cards'});
 await expect(search).toBeFocused();
 await search.fill('مهمه');
 await expect(rows).toHaveCount(1);
 await expect(rows.first()).toContainText('مُــهمّة إعلانات ديسمبر');
 await search.fill('plan 0');
 await expect(rows).toHaveCount(8);
 await search.fill('nothing like it');
 await expect(page.getByText('No archived cards match these filters')).toBeVisible();
 await search.fill('مهمه');
 await rows.first().getByRole('link').click();
 await expect(page.getByRole('dialog').getByRole('region',{name:'Archived'})).toBeVisible();
});
