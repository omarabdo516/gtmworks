import { test, expect, freshSeed, laneRows, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { laneEngineRecords } from './spec-engine-records';
import { lane, workdirOf } from './lane.mjs';
import { signIn } from './sign-in';
import { keepKanbanCards } from '../lib/kanban-card-rows.mjs';
import { upkeepSchedule } from '../lib/upkeep-schedule.mjs';

// Spec #831 (#836): a person makes a Card from the board and gives it to an Agent, to a Member or to nobody, with a
// publishing date. Given to an Agent, the Card is made on the Company's fake Engine with that Agent and gtmworks asks for
// one dispatcher tick, so it is working at once. Given to a Member, it has no Agent on the Engine, so the fake dispatcher
// never claims it, and the board shows the Member's name and face from gtmworks's own row. With nobody it waits. A Card
// has one Assignee at most: giving it to an Agent clears the Member and starts the Agent, and the reverse takes it off
// the dispatcher. An Owner, a Manager and a Contributor make Cards; a Viewer is refused on the server and nothing is made
// on the Engine. A row whose task is gone from the Engine is forgotten by the worker's slow drift check, never by a page.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001', aleem='10000000-0000-0000-0000-000000000003';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const [owner,manager,contributor,viewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'];
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 laneEngineRecords();
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${rs}' and removed_at is null and role<>'owner';
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const board=(page:Page)=>page.locator('#board-cols');
const column=(page:Page,name:string)=>board(page).locator(`.col[data-column="${name}"]`);
const card=(page:Page,title:string)=>board(page).getByRole('article',{name:new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)});
const task=(title:string)=>fake.settings.kanban.tasks.find(found=>found.title===title);
const row=(id:string)=>laneRows(`select assignee,publish_on::text as publish_on,made_by from public.kanban_cards where company_id='${rs}' and task_id='${id}'`)[0];
const kanbanWrites=()=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban')&&request.method!=='GET');
const make=(page:Page,body:Record<string,unknown>)=>page.request.post('/api/board/cards',{data:{company:rs,key:randomUUID(),description:'',assignee:'',publishOn:'',...body}});

test('an Owner gives a new Card to an Agent: it is made on the Engine with its date and is working at once, not at the dispatcher\'s minute',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(board(page).locator('.col__name')).toHaveCount(5);
 const ticks=fake.settings.kanban.ticks;
 await page.getByRole('button',{name:'New card'}).click();
 const dialog=page.getByRole('dialog',{name:'New card'});
 await dialog.getByPlaceholder('Title').fill('December ad copy');
 await dialog.getByPlaceholder('Description').fill('Three headlines\n- [ ] One for the diploma');
 await dialog.getByRole('button',{name:'Assignee: No one yet'}).click();
 await dialog.getByRole('menuitemradio',{name:'Ads'}).click();
 await expect(dialog.getByRole('img',{name:'Ads starts on it at once'})).toBeVisible();
 await dialog.getByLabel('Publishing date').fill('2026-12-24');
 // New card as a person sees it, kept as screenshots of the run.
 await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/new-card-${width}.png`}); }
 await page.setViewportSize({width:1440,height:900});
 await dialog.getByRole('button',{name:'Add card'}).click();
 await expect(dialog).toHaveCount(0);
 // Working now, in In progress, with its Agent: one tick was asked for, and the Engine's own minute never came.
 const made=card(page,'December ad copy');
 await expect(column(page,'progress').getByRole('article',{name:/^December ad copy/})).toBeVisible();
 await expect(made.getByRole('img',{name:'Working on it now'})).toBeVisible();
 await expect(made.locator('.kt-face')).toHaveAttribute('title','Ads');
 expect(fake.settings.kanban.ticks).toBe(ticks+1);
 const onEngine=task('December ad copy');
 expect([onEngine?.assignee,onEngine?.body,onEngine?.status]).toEqual([adsProfile,'Three headlines\n- [ ] One for the diploma','running']);
 // gtmworks keeps the date and who made it, and no Member: the Agent is the Engine's.
 expect(row(onEngine!.id)).toEqual({assignee:null,publish_on:'2026-12-24',made_by:owner});
});

test('a Contributor gives a Card to themselves: it has no Agent on the Engine, the dispatcher never claims it, and it shows their name and face',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/work/new');
 const dialog=page.getByRole('dialog',{name:'New card'});
 await dialog.getByPlaceholder('Title').fill('Shoot the reel at the office');
 await dialog.getByRole('button',{name:'Assignee: No one yet'}).click();
 await dialog.getByRole('menuitemradio',{name:'Assign to me'}).click();
 await expect(dialog.getByRole('button',{name:'Assignee: مراجع'})).toBeVisible();
 await expect(dialog.getByRole('img',{name:/starts on it at once/})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Add card'}).click();
 // Closing New card leaves the board at its own address.
 await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
 const theirs=card(page,'Shoot the reel at the office');
 await expect(column(page,'planned').getByRole('article',{name:/^Shoot the reel at the office/})).toBeVisible();
 await expect(theirs).toHaveAccessibleName(/Assignee: مراجع/);
 await expect(theirs.locator('.kt-face')).toHaveAttribute('title','مراجع');
 await expect(theirs.locator('.kt-face .lg-av')).toHaveText('م');
 const onEngine=task('Shoot the reel at the office')!;
 expect([onEngine.assignee,onEngine.status]).toEqual([null,'ready']);
 expect(row(onEngine.id)).toEqual({assignee:contributor,publish_on:null,made_by:contributor});
 // The Engine's own dispatcher tick passes it by: no Agent, no claim.
 fake.settings.kanban.dispatch();
 expect(task('Shoot the reel at the office')?.status).toBe('ready');
 await page.reload();
 await expect(column(page,'planned').getByRole('article',{name:/^Shoot the reel at the office/})).toBeVisible();
 // No Agent works it: its one symbol is the hand, for the Card waits on its Member (#841).
 await expect(theirs.getByRole('img')).toHaveCount(1);
 await expect(theirs.getByRole('img')).toHaveAccessibleName('On you');
});

test('a Manager makes a Card for nobody: it waits in Planned, worked by nobody',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/work/board');
 await page.getByRole('button',{name:'New card'}).click();
 const dialog=page.getByRole('dialog',{name:'New card'});
 await dialog.getByPlaceholder('Title').fill('Ideas for Ramadan');
 await dialog.getByPlaceholder('Title').press('Enter');
 await expect(column(page,'planned').getByRole('article',{name:/^Ideas for Ramadan/})).toHaveAccessibleName(/Assignee: No one/);
 const onEngine=task('Ideas for Ramadan')!;
 fake.settings.kanban.dispatch();
 expect([onEngine.assignee,onEngine.status]).toEqual([null,'ready']);
 expect(row(onEngine.id)).toEqual({assignee:null,publish_on:null,made_by:manager});
});

test('giving a Member\'s Card to an Agent removes the Member and starts the Agent; giving an Agent\'s Card to a Member takes it off the dispatcher',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const made=await make(page,{title:'Meta campaign for the course',assignee:`member:${manager}`});
 expect(made.status()).toBe(200);
 const id=(await made.json()).made as string;
 expect(row(id)?.assignee).toBe(manager);
 const toAgent=await page.request.patch('/api/board/cards',{data:{company:rs,card:id,assignee:`agent:${ads}`}});
 expect(toAgent.status()).toBe(200);
 expect([task('Meta campaign for the course')?.assignee,task('Meta campaign for the course')?.status]).toEqual([adsProfile,'running']);
 expect(row(id)?.assignee).toBeNull();
 await page.reload();
 const started=card(page,'Meta campaign for the course');
 await expect(started.locator('.kt-face')).toHaveAttribute('title','Ads');
 await expect(started.getByRole('img',{name:'Working on it now'})).toBeVisible();
 // A Card an Agent is working now keeps it, and nothing changes.
 const busy=await page.request.patch('/api/board/cards',{data:{company:rs,card:id,assignee:`member:${manager}`}});
 expect(busy.status()).toBe(409);
 expect(row(id)?.assignee).toBeNull();
 // An Agent's Card not yet started, given to a Member: the Engine has no Agent on it, and no tick claims it.
 const waiting=fake.settings.kanban.task({title:'Google Ads numbers for October',status:'ready',assignee:adsProfile});
 const toMember=await page.request.patch('/api/board/cards',{data:{company:rs,card:waiting.id,assignee:`member:${manager}`}});
 expect(toMember.status()).toBe(200);
 expect(waiting.assignee).toBeNull();
 expect(row(waiting.id)).toEqual({assignee:manager,publish_on:null,made_by:null});
 fake.settings.kanban.dispatch();
 expect(waiting.status).toBe('ready');
 await page.reload();
 await expect(card(page,'Google Ads numbers for October').locator('.kt-face')).toHaveAttribute('title','مدير');
 // Nobody who is not an active Member, and no Agent the reader does not see, is an Assignee.
 expect((await page.request.patch('/api/board/cards',{data:{company:rs,card:waiting.id,assignee:`member:${randomUUID()}`}})).status()).toBe(400);
 expect((await page.request.patch('/api/board/cards',{data:{company:rs,card:waiting.id,assignee:`agent:${randomUUID()}`}})).status()).toBe(400);
 expect(row(waiting.id)?.assignee).toBe(manager);
});

test('a Viewer is refused New card on the server and nothing is made on the Engine; a person of another Company finds no board',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/work/new');
 await expect(board(page).locator('.col__name')).toHaveCount(5);
 await expect(page.getByRole('dialog',{name:'New card'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New card'})).toHaveCount(0);
 const before=kanbanWrites().length;
 const made=await make(page,{title:'A Viewer\'s card'});
 expect(made.status()).toBe(403);
 expect((await page.request.get(`/api/board/cards?company=${rs}`)).status()).toBe(403);
 const someCard=fake.settings.kanban.task({title:'Weekly report',status:'ready'}).id;
 expect((await page.request.patch('/api/board/cards',{data:{company:rs,card:someCard,assignee:`member:${viewer}`}})).status()).toBe(403);
 // Another Company's board is not theirs to write on.
 expect((await page.request.post('/api/board/cards',{data:{company:aleem,key:randomUUID(),title:'Not mine',description:'',assignee:'',publishOn:''}})).status()).toBe(404);
 expect(kanbanWrites().length).toBe(before);
 expect(task('A Viewer\'s card')).toBeUndefined();
 expect(laneRows(`select 1 from public.kanban_cards where task_id='${someCard}'`)).toEqual([]);
});

test('a row whose task is gone from the Engine stays through a page read and is forgotten by the slow drift check',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const made=await make(page,{title:'Old webinar campaign',assignee:`member:${contributor}`,publishOn:'2026-12-01'});
 const id=(await made.json()).made as string;
 // Gone from the Engine (its own dashboard deleted it), not archived.
 fake.settings.kanban.tasks.splice(fake.settings.kanban.tasks.findIndex(found=>found.id===id),1);
 await page.reload();
 await expect(card(page,'December ad copy')).toBeVisible();
 await expect(board(page).getByText('Old webinar campaign')).toHaveCount(0);
 expect(row(id)?.assignee).toBe(contributor);
 const env=execFileSync('npx',['--no-install','supabase','status','-o','env',...(lane?['--workdir',workdirOf(lane)]:[])],{encoding:'utf8'});
 const value=(name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1];
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 expect(await keepKanbanCards(service,{memory:{drift:0},health:upkeepSchedule()})).toEqual({forgotten:1});
 expect(row(id)).toBeUndefined();
 // Every other row stays, and the Engine was never asked to delete a Card.
 expect(row(task('Shoot the reel at the office')!.id)?.assignee).toBe(contributor);
 expect(fake.settings.managementRequests.filter(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/plugins/kanban/tasks'))).toEqual([]);
});
