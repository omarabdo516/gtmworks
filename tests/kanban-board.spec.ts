import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { lane } from './lane.mjs';
import { signIn } from './sign-in';

// Spec #831 (#834): the board is the Company's Engine's own Kanban board. A Member opens it and sees the Cards that are
// on their Company's fake Engine in five columns, each with its title, its Agent and its symbol. The frame and the column
// heads come in the page's first answer and the Cards in a request of their own (ADR 0030); with the Engine stopped after
// a good read the board keeps what it last read and says it could not refresh. A Viewer reads it; a person who is not a
// Member finds no such page and no such route. Company A's board never holds a Card of Company B, each on its own Engine,
// and no answer to the browser holds the Engine's key or address.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001', aleem='10000000-0000-0000-0000-000000000003';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const seo=randomUUID(), seoProfile=`ag-${seo.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
// Company B's own Engine, at a loopback address of its own (its record is pointed there).
let other:Awaited<ReturnType<typeof fakeHermes>>;
const cards:Record<string,string>={};

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 other=await fakeHermes({host:`127.0.0.${130+lane}`,port:8642,managementPort:9119});
 query(`do $$ begin
   update public.company_engines set address='http://127.0.0.${130+lane}:8642' where id=(select engine_id from public.companies where id='${aleem}');
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}'),('${seo}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}'),
    ('${seo}','${rs}','Seo','Writes for search.',false,'${seoProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}');
  end $$;`);
 const put=(name:string,fields:Record<string,unknown>)=>{ cards[name]=fake.settings.kanban.task(fields).id; };
 put('idea',{title:'Reel: a day in an accountant’s life',status:'triage'});
 put('planned',{title:'December ad copy',status:'ready',assignee:adsProfile});
 put('running',{title:'Meta campaign for the course',status:'running',assignee:adsProfile});
 put('question',{title:'Google Ads numbers for October',status:'blocked',assignee:adsProfile});
 put('review',{title:'SEO article: online accounting course',status:'review',assignee:adsProfile});
 put('done',{title:'Weekly report',status:'done',assignee:adsProfile});
 put('hidden',{title:'Seo keywords for the diploma',status:'ready',assignee:seoProfile});
 put('archived',{title:'Old webinar campaign',status:'archived'});
 cards.otherCompany=other.settings.kanban.task({title:'Aleem’s own launch plan',status:'running'}).id;
});
test.afterAll(async()=>{ await fake?.close(); await other?.close(); });

const board=(page:Page)=>page.locator('#board-cols');
const column=(page:Page,name:string)=>board(page).locator(`.col[data-column="${name}"]`);
const card=(page:Page,title:string)=>board(page).getByRole('article',{name:new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)});

test('a Member sees every Card on the Company\'s Engine in its column, with its title, its Agent and its symbol',async({page})=>{
 const answers:string[]=[]; const asked:string[]=[];
 page.on('request',request=>asked.push(request.url()));
 page.on('response',response=>{ if(/text|json|javascript/.test(response.headers()['content-type']||'')) void response.text().then(body=>answers.push(body),()=>{}); });
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(page.getByRole('heading',{name:'Marketing board',level:1})).toBeVisible();
 // Five columns, Waiting on you first, and no Live.
 await expect(board(page).locator('.col__name')).toHaveText(['Waiting on you','Ideas','Planned','In progress','Done']);
 await expect(card(page,'Meta campaign for the course')).toBeVisible();
 const placed:Record<string,string>={idea:'ideas',planned:'planned',running:'progress',question:'waiting',review:'waiting',done:'done'};
 for(const [name,where] of Object.entries(placed)) await expect(column(page,where).locator(`[data-card="${cards[name]}"]`),name).toHaveCount(1);
 await expect(column(page,'waiting').locator('.col__count')).toHaveText('2');
 // Its Agent: the face with the Agent's name, which the Card's name also says.
 const running=card(page,'Meta campaign for the course');
 await expect(running.locator('.kt-face')).toHaveAttribute('title','Ads');
 await expect(running).toHaveAccessibleName(/Assignee: Ads/);
 await expect(card(page,'Reel: a day in an accountant’s life')).toHaveAccessibleName(/Assignee: No one/);
 // Its symbol, named for assistive technology and in a tooltip.
 await expect(running.getByRole('img',{name:'Working on it now'})).toHaveAttribute('title','Working on it now');
 await expect(card(page,'Google Ads numbers for October').getByRole('img',{name:'Has a question'})).toBeVisible();
 await expect(card(page,'SEO article: online accounting course').getByRole('img',{name:'Needs review'})).toBeVisible();
 await expect(card(page,'December ad copy').getByRole('img')).toHaveCount(0);
 // An archived Card is on no column.
 await expect(board(page).getByText('Old webinar campaign')).toHaveCount(0);
 // Everything came from gtmworks: the browser never asked the Engine, and nothing it was sent holds the key or the address.
 expect(asked.some(url=>url.startsWith(fake.address)||url.startsWith(fake.managementAddress))).toBe(false);
 const state=await page.request.get(`/api/board?company=${rs}`);
 expect(state.status()).toBe(200);
 answers.push(await state.text(),await page.content());
 for(const leak of [fake.settings.key,fake.address,fake.managementAddress,new URL(fake.managementAddress).host,adsProfile,rsProfile]) expect(answers.some(body=>body.includes(leak)),leak).toBe(false);
});

test('the board\'s frame and column heads are in the page\'s first answer, and its Cards arrive in a request of their own',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const first=await page.request.get('/c/rs-learning/work/board');
 expect(first.status()).toBe(200);
 const html=await first.text();
 for(const head of ['Waiting on you','Ideas','Planned','In progress','Done']) expect(html).toContain(`>${head}</h2>`);
 expect(html).not.toContain('Meta campaign for the course');
 // While the Engine is slow the frame stands with its heads and says the board is being read; the Cards follow.
 fake.settings.managedDelay=(method,path)=>method==='GET'&&path.startsWith('/api/plugins/kanban/board')?1500:null;
 try {
  const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board');
  await page.goto('/c/rs-learning/work/board');
  await expect(board(page).locator('.col__name')).toHaveText(['Waiting on you','Ideas','Planned','In progress','Done']);
  await expect(page.getByRole('status').filter({hasText:'Reading the board…'})).toBeVisible();
  const answer=await read;
  expect(answer.url()).toContain(`company=${rs}`);
  expect(await answer.text()).toContain('Meta campaign for the course');
  await expect(card(page,'Meta campaign for the course')).toBeVisible();
  await expect(page.getByText('Reading the board…')).toHaveCount(0);
 } finally { fake.settings.managedDelay=null; }
});

test('a Viewer reads the board, and a Card of an Agent hidden from them is not on it',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/work/board');
 await expect(board(page).locator('.col__name')).toHaveText(['Waiting on the team','Ideas','Planned','In progress','Done']);
 await expect(card(page,'Meta campaign for the course')).toBeVisible();
 await expect(page.getByRole('note').filter({hasText:'Read only'})).toBeVisible();
 await expect(board(page).getByText('Seo keywords for the diploma')).toHaveCount(0);
 const answer=await (await page.request.get(`/api/board?company=${rs}`)).text();
 expect(answer).toContain('Meta campaign for the course');
 expect(answer).not.toContain('Seo keywords for the diploma');
});

test('a person who is not a Member of the Company finds no board, on the page and on the route',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/home');
 expect((await page.goto('/c/aleem/work/board'))!.status()).toBe(404);
 await expect(page.getByRole('heading',{name:'Page not found'})).toBeVisible();
 const answer=await page.request.get(`/api/board?company=${aleem}`);
 expect(answer.status()).toBe(404);
 expect(await answer.text()).not.toContain('Aleem’s own launch plan');
 expect((await page.request.get('/api/board?company=not-a-company')).status()).toBe(400);
});

test('a Member of two Companies sees each one\'s Cards on its own board, each read from its own Engine',async({page})=>{
 await signIn(page,'omar@example.com','/c/aleem/work/board');
 await expect(card(page,'Aleem’s own launch plan')).toBeVisible();
 await expect(board(page).getByText('Meta campaign for the course')).toHaveCount(0);
 await page.goto('/c/rs-learning/work/board');
 await expect(card(page,'Meta campaign for the course')).toBeVisible();
 await expect(board(page).getByText('Aleem’s own launch plan')).toHaveCount(0);
 const own=await (await page.request.get(`/api/board?company=${rs}`)).text();
 expect(own).not.toContain('Aleem’s own launch plan');
 expect(own).not.toContain(cards.otherCompany);
 const theirs=await (await page.request.get(`/api/board?company=${aleem}`)).text();
 expect(theirs).toContain('Aleem’s own launch plan');
 expect(theirs).not.toContain('Meta campaign for the course');
});

test('with the Engine stopped after a good read, the board keeps the Cards it last read and says it could not refresh',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(card(page,'Meta campaign for the course')).toBeVisible();
 await fake.close();
 try {
  // The board reads again when the window comes back to it; the Engine does not answer.
  const again=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect((await again).status()).toBe(503);
  await expect(page.getByRole('status').filter({hasText:'Couldn’t refresh the board. Showing what it last read.'})).toBeVisible();
  await expect(card(page,'Meta campaign for the course')).toBeVisible();
  await expect(column(page,'waiting').locator('.col__count')).toHaveText('2');
  // A page opened with no Engine at all has nothing to keep, and says the board could not be read.
  await page.goto('/c/rs-learning/work/board');
  await expect(page.getByRole('alert').filter({hasText:'The board couldn’t be read. Trying again.'})).toBeVisible();
  await expect(board(page).locator('.col__name')).toHaveCount(5);
 } finally { fake=await laneHermes(); }
});
