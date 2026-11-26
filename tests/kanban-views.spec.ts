import { test, expect, freshSeed, laneRows, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#845): the list and the calendar show the same Cards as the board, read from the Company's fake Engine
// through the board's own read. A Card made on the board is in the list and, with its publishing date, on that day of
// the calendar; a change of its date there moves it with no reload of the page's frame. The list's filters by Assignee,
// status and Project keep the Cards the board holds with that Assignee, in that column or of that Project (the Engine's
// tenant). An archived Card is in neither view. Both draw their frame in the page's first answer and keep the last good
// read when the Engine stops (the last case, which ends with an empty Engine). A Viewer reads both and changes no date;
// a person of another Company finds neither.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001', aleem='10000000-0000-0000-0000-000000000003';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const manager='20000000-0000-0000-0000-000000000002';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const cards:Record<string,string>={};
// This month and a day in it, as the calendar opens on the month it is now.
const month=new Date().toISOString().slice(0,7);
const day=(n:number)=>`${month}-${String(n).padStart(2,'0')}`;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${rs}' and removed_at is null and role<>'owner';
  end $$;`);
 const put=(name:string,fields:Record<string,unknown>)=>{ cards[name]=fake.settings.kanban.task(fields).id; };
 put('running',{title:'Meta campaign for the course',status:'running',assignee:adsProfile,tenant:'Spring course'});
 put('planned',{title:'Email to old subscribers',status:'ready',tenant:'Spring course'});
 put('idea',{title:'Reel: a day in an accountant’s life',status:'triage'});
 put('review',{title:'SEO article: online accounting course',status:'review',assignee:adsProfile});
 put('mona',{title:'Shoot the reel at the office',status:'ready'});
 put('archived',{title:'Old webinar campaign',status:'archived'});
 query(`insert into public.kanban_cards(company_id,task_id,assignee,publish_on) values ('${rs}','${cards.mona}','${manager}',null),
  ('${rs}','${cards.running}',null,'${day(3)}'),('${rs}','${cards.archived}',null,'${day(4)}');`);
});
test.afterAll(async()=>{ await fake?.close(); });

const board=(page:Page)=>page.locator('#board-cols');
const listTitles=(page:Page)=>page.locator('.table tbody tr td:first-child');
const calendarDay=(page:Page,title:string)=>page.locator('.calendar .day').filter({has:page.getByRole('link',{name:title,exact:true})}).locator('.day__n');
const dateOf=(id:string)=>laneRows(`select publish_on::text as publish_on from public.kanban_cards where company_id='${rs}' and task_id='${id}'`)[0]?.publish_on??null;

test('a Card made on the board is in the list and, with its publishing date, on that day of the calendar',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await page.getByRole('button',{name:'New card'}).click();
 const dialog=page.getByRole('dialog',{name:'New card'});
 await dialog.getByPlaceholder('Title').fill('December ad copy');
 await dialog.getByLabel('Publishing date').fill(day(24));
 await dialog.getByRole('button',{name:'Add card'}).click();
 await expect(board(page).getByRole('article',{name:/^December ad copy/})).toBeVisible();
 await page.getByRole('navigation',{name:'Board views'}).getByRole('link',{name:'List'}).click();
 await expect(page).toHaveURL(/\/work\/list$/);
 const row=page.locator('.table tbody tr').filter({has:page.getByRole('link',{name:'December ad copy',exact:true})});
 await expect(row).toHaveCount(1);
 await expect(row.getByLabel('Publishing date of December ad copy')).toHaveValue(day(24));
 await page.getByRole('navigation',{name:'Board views'}).getByRole('link',{name:'Calendar'}).click();
 await expect(page).toHaveURL(/\/work\/calendar$/);
 await expect(calendarDay(page,'December ad copy')).toHaveText('24');
 await expect(calendarDay(page,'Meta campaign for the course')).toHaveText('3');
 // An undated Card is listed beside the calendar, not in it.
 const undated=page.getByRole('region',{name:'No publishing date'});
 await expect(undated.getByRole('link',{name:'Shoot the reel at the office'})).toBeVisible();
 await expect(page.locator('.calendar').getByText('Shoot the reel at the office')).toHaveCount(0);
});

test('changing a Card\'s publishing date moves it on the calendar with no reload of the page\'s frame',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/work/calendar');
 await expect(calendarDay(page,'Meta campaign for the course')).toHaveText('3');
 await page.evaluate(()=>{ (window as unknown as {stayed:boolean}).stayed=true; });
 const field=page.getByLabel('Publishing date of Meta campaign for the course');
 await field.fill(day(17));
 await field.press('Enter');
 await expect(calendarDay(page,'Meta campaign for the course')).toHaveText('17');
 expect(dateOf(cards.running)).toBe(day(17));
 // An undated Card given a date leaves the list beside the calendar for its day, and back when it is cleared.
 const undated=page.getByRole('region',{name:'No publishing date'});
 const shoot=page.getByLabel('Publishing date of Shoot the reel at the office');
 await shoot.fill(day(5));
 await shoot.press('Enter');
 await expect(calendarDay(page,'Shoot the reel at the office')).toHaveText('5');
 await expect(undated.getByRole('link',{name:'Shoot the reel at the office'})).toHaveCount(0);
 const cleared=page.getByLabel('Publishing date of Shoot the reel at the office');
 await cleared.fill('');
 await cleared.press('Enter');
 await expect(undated.getByRole('link',{name:'Shoot the reel at the office'})).toBeVisible();
 expect(dateOf(cards.mona)).toBeNull();
 // The same page all along: no navigation, the frame kept.
 expect(await page.evaluate(()=>(window as unknown as {stayed?:boolean}).stayed)).toBe(true);
 // The Engine was only read: the date is gtmworks's, and nothing was written there.
 expect(fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban/tasks')&&request.method!=='GET'&&request.method!=='POST')).toEqual([]);
});

test('the list\'s filters by Assignee, status and Project keep the same Cards as the board\'s',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(board(page).getByRole('article',{name:/^Meta campaign for the course/})).toBeVisible();
 const read=(await (await page.request.get(`/api/board?company=${rs}`)).json()).cards as {title:string,column:string,agent:{name:string}|null,person:{name:string}|null,project:string|null}[];
 const onColumn=async(column:string)=>(await board(page).locator(`.col[data-column="${column}"] .kcard__title`).allInnerTexts()).sort();
 const ofAgent=async(name:string)=>(await board(page).locator(`.kcard:has(.kt-face[title="${name}"]) .kcard__title`).allInnerTexts()).sort();
 const waiting=await onColumn('waiting'); const adsCards=await ofAgent('Ads'); const monaCards=await ofAgent('مدير');
 await page.goto('/c/rs-learning/work/list');
 await expect(listTitles(page)).toHaveCount(read.length);
 const listed=async()=>(await listTitles(page).allInnerTexts()).map(title=>title.trim()).sort();
 await page.getByRole('combobox',{name:'Status'}).selectOption({label:'Waiting on you'});
 await expect.poll(listed).toEqual(waiting);
 await page.getByRole('combobox',{name:'Status'}).selectOption({label:'All'});
 await page.getByRole('combobox',{name:'Assignee'}).selectOption({label:'Ads'});
 await expect.poll(listed).toEqual(adsCards);
 expect(adsCards).toEqual(['Meta campaign for the course','SEO article: online accounting course']);
 await page.getByRole('combobox',{name:'Assignee'}).selectOption({label:'مدير'});
 await expect.poll(listed).toEqual(monaCards);
 await page.getByRole('combobox',{name:'Assignee'}).selectOption({label:'All'});
 await page.getByRole('combobox',{name:'Project'}).selectOption({label:'Spring course'});
 await expect.poll(listed).toEqual(read.filter(card=>card.project==='Spring course').map(card=>card.title).sort());
 expect(await listed()).toEqual(['Email to old subscribers','Meta campaign for the course']);
});

test('an archived Card is in neither the list nor the calendar, its date kept',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/list');
 await expect(listTitles(page).first()).toBeVisible();
 await expect(page.locator('.table').getByText('Old webinar campaign')).toHaveCount(0);
 await page.goto('/c/rs-learning/work/calendar');
 await expect(page.locator('.calendar .authored-title').first()).toBeVisible();
 await expect(page.getByText('Old webinar campaign')).toHaveCount(0);
 expect(dateOf(cards.archived)).toBe(day(4));
 // Nor is its date reached: it is on no board.
 expect((await page.request.patch('/api/board/cards',{data:{company:rs,card:cards.archived,publishOn:day(9)}})).status()).toBe(404);
 expect(dateOf(cards.archived)).toBe(day(4));
});

test('a Viewer reads both views and changes no date; a person of another Company finds neither',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/work/calendar');
 await expect(page.locator('.calendar').getByRole('link',{name:'Meta campaign for the course'})).toBeVisible();
 await expect(page.getByLabel(/^Publishing date of/)).toHaveCount(0);
 await page.goto('/c/rs-learning/work/list');
 await expect(page.getByRole('link',{name:'Meta campaign for the course'})).toBeVisible();
 await expect(page.getByLabel(/^Publishing date of/)).toHaveCount(0);
 const before=dateOf(cards.running);
 expect((await page.request.patch('/api/board/cards',{data:{company:rs,card:cards.running,publishOn:day(9)}})).status()).toBe(403);
 expect(dateOf(cards.running)).toBe(before);
 expect((await page.goto('/c/aleem/work/list'))!.status()).toBe(404);
 expect((await page.goto('/c/aleem/work/calendar'))!.status()).toBe(404);
 expect((await page.request.patch('/api/board/cards',{data:{company:aleem,card:cards.running,publishOn:day(9)}})).status()).toBe(404);
});

test('both views draw their frame in the page\'s first answer and keep the last good read when the Engine stops',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 for(const view of ['list','calendar']) {
  const html=await (await page.request.get(`/c/rs-learning/work/${view}`)).text();
  expect(html).toContain('>Marketing board</h1>');
  expect(html).toContain(view==='list'?'>Publishing date':'class="calendar"');
  expect(html).not.toContain('Meta campaign for the course');
 }
 await page.goto('/c/rs-learning/work/list');
 await expect(page.getByRole('link',{name:'Meta campaign for the course'})).toBeVisible();
 await fake.close();
 try {
  const again=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect((await again).status()).toBe(503);
  await expect(page.getByRole('status').filter({hasText:'Couldn’t refresh the board. Showing what it last read.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Meta campaign for the course'})).toBeVisible();
  // The calendar, opened from the list, keeps the same read.
  await page.getByRole('navigation',{name:'Board views'}).getByRole('link',{name:'Calendar'}).click();
  await expect(page).toHaveURL(/\/work\/calendar$/);
  await expect(page.locator('.calendar').getByRole('link',{name:'Meta campaign for the course'})).toBeVisible();
  // A view opened with no Engine at all has nothing to keep, and says the board could not be read, its frame drawn.
  await page.goto('/c/rs-learning/work/calendar');
  await expect(page.getByRole('alert').filter({hasText:'The board couldn’t be read. Trying again.'})).toBeVisible();
  await expect(page.locator('.calendar .day__n').first()).toHaveText('1');
 } finally { fake=await laneHermes(); }
});
