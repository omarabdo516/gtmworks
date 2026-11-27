import { test, expect, freshSeed, type Page, type Browser } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#841): what waits on a person from the Company's Engine board is in their Waiting on you and under the bell
// (the sidebar's count beside Marketing board), worked out from the board read after the page's first content, and
// nothing about a Card is written to the waiting list's table. A question on a Card given to a Member waits on them
// alone; one on a Card a person made, with no Member on it, on its maker; one on a Card an Agent made on its own, on
// every Administrator and Manager; a review on those who may decide it, never a Contributor; a Card given to a Member on
// them until it is done or given to someone else. On the board's Waiting on you column the hand marks the Cards that wait
// on the reader, and a Card that waits on someone else names them. Answering, passing or finishing takes the row away
// from everyone it was shown to, with no reload. With the Engine stopped the bell keeps its last count. The list's other
// rows are as they were; the old board's approvals are no part of it.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const seo=randomUUID(), seoProfile=`ag-${seo.replaceAll('-','')}`;
const [omar,manager,reviewer,viewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'];
const emails={omar:'omar@example.com',manager:'manager@example.com',reviewer:'reviewer@example.com',viewer:'viewer@example.com'};
type Reader=keyof typeof emails;
let fake:Awaited<ReturnType<typeof laneHermes>>;
const cards:Record<string,string>={};
const titles={
 given:'Shoot the course reel',agentAsks:'Google Ads numbers for October',makerAsks:'Plan the December ads',review:'SEO article: online accounting course',
 hiddenReview:'Seo keywords for the diploma',planned:'Write the alumni email',passed:'Spring offer copy',
};
// Who each Card waits on, by the rules above (the Manager does not see Seo, so its review is not theirs).
const waitsOn:Record<Reader,(keyof typeof titles)[]>={omar:['agentAsks','review','hiddenReview'],manager:['agentAsks','review'],reviewer:['given','makerAsks','planned'],viewer:[]};

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   update public.people set language='en' where id in ('${omar}','${manager}','${reviewer}','${viewer}');
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}'),('${seo}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}'),
    ('${seo}','${rs}','Seo','Writes for search.',false,'${seoProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${manager}','${ads}'),('${rs}','${reviewer}','${ads}'),('${rs}','${viewer}','${ads}');
  end $$;`);
 const kanban=fake.settings.kanban;
 const put=(name:keyof typeof titles,fields:Record<string,unknown>)=>{ cards[name]=kanban.task({title:titles[name],...fields}).id; };
 put('given',{status:'blocked'});
 put('agentAsks',{status:'blocked',assignee:adsProfile});
 put('makerAsks',{status:'blocked',assignee:adsProfile});
 put('review',{status:'review',assignee:adsProfile});
 put('hiddenReview',{status:'review',assignee:seoProfile});
 put('planned',{status:'todo'});
 // The rows gtmworks keeps beside the Cards (#836): the Member a Card is given to and the person who made it.
 query(`insert into public.kanban_cards(company_id,task_id,assignee,made_by) values
  ('${rs}','${cards.given}','${reviewer}','${omar}'),('${rs}','${cards.makerAsks}',null,'${reviewer}'),('${rs}','${cards.review}',null,'${reviewer}'),
  ('${rs}','${cards.planned}','${reviewer}','${omar}')`);
 // A question the Agent asked on its Card (#838), which the Card's window shows with its answer box.
 const asked=kanban.run(cards.agentAsks,{profile:adsProfile,status:'blocked',outcome:'blocked',summary:'Which month do the numbers cover?',ended_at:Math.floor(Date.now()/1000)});
 kanban.event(cards.agentAsks,'blocked',{reason:'Which month do the numbers cover?'},asked.id);
});
test.afterAll(async()=>{ await fake?.close(); });

const inbox='/c/rs-learning/approvals';
const list=(page:Page)=>page.locator('.col[data-column="waiting"]');
const listed=(page:Page)=>list(page).locator('.kcard[data-card]');
const bell=(page:Page)=>page.locator('.sidebar .sb-count[href$="/approvals"]');
const bellCount=async(page:Page)=>{ await expect(bell(page).locator('.sb-count__n')).toHaveText(/^\d+$/); return Number(await bell(page).locator('.sb-count__n').textContent()); };
const columnCount=(page:Page)=>list(page).locator('.col__count');
const boardTile=(page:Page,id:string)=>page.locator(`#board-cols .col[data-column="waiting"] .kcard[data-card="${id}"]`);
async function as(browser:Browser,who:Reader,path=inbox) { const page=await browser.newPage(); await signIn(page,emails[who],path); return page; }
// The reader's list holds the board's Cards that wait on them, and the bell counts what the list holds.
async function holds(page:Page,names:(keyof typeof titles)[]) {
 await expect.poll(async()=>(await listed(page).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-card')))).sort()).toEqual(names.map(name=>cards[name]).sort());
 const shown=Number(await columnCount(page).textContent());
 await expect(bell(page).locator('.sb-count__n')).toHaveText(String(shown));
 return shown;
}

test('each reader\'s Waiting on you and bell hold the board\'s Cards that wait on them, after the page\'s first content, and nothing else of the board',async({browser})=>{
 const before=rows(`select count(*)::int as n from public.waiting_items where company_id='${rs}'`)[0].n;
 // An item of another kind waits on Omar as before; the old board's approval in review (seed Card 5) is no part of the list.
 const stamp=Date.now();
 query(`select public.add_waiting_item('${rs}','${omar}','test_kind','Another kind ${stamp}','',1)`);
 try {
  for(const who of Object.keys(emails) as Reader[]) {
   const answers:string[]=[];
   const page=await browser.newPage();
   page.on('response',response=>{ if(response.url().includes(inbox)&&response.request().resourceType()==='document') void response.text().then(body=>answers.push(body),()=>{}); });
   try {
    // For the Owner the Engine is slow: the page, its other rows and the bell's place are drawn first, and the board's
    // Cards and the bell's count follow once the board has answered (ADR 0030).
    if(who==='omar') fake.settings.managedDelay=(method,path)=>method==='GET'&&path.startsWith('/api/plugins/kanban/board')?2500:null;
    await signIn(page,emails[who],inbox);
    if(who==='omar') {
     await expect(list(page).locator('.mcard').filter({hasText:`Another kind ${stamp}`})).toBeVisible();
     await expect(listed(page)).toHaveCount(0);
     await expect(bell(page).locator('.sb-count__n')).toHaveText('');
     fake.settings.managedDelay=null;
    }
    const shown=await holds(page,waitsOn[who]);
    expect(shown,who).toBeGreaterThanOrEqual(waitsOn[who].length);
    // The page's own answer holds none of the board: the list's Cards arrive after, from the board read.
    for(const title of Object.values(titles)) expect(answers.join(''),`${who}: ${title}`).not.toContain(title);
    if(who==='omar') {
     await expect(list(page).locator('.mcard').filter({hasText:`Another kind ${stamp}`})).toBeVisible();
     await expect(list(page).locator('.kcard[data-card-id]')).toHaveCount(0);
    }
    // Each Card of the list wears the hand and opens over the board.
    for(const name of waitsOn[who]) await expect(list(page).locator(`.kcard[data-card="${cards[name]}"] [data-sym="onYou"]`)).toHaveCount(1);
    if(waitsOn[who][0]) {
     await list(page).locator(`.kcard[data-card="${cards[waitsOn[who][0]]}"] a`).click();
     await expect(page).toHaveURL(new RegExp(`/work/board\\?card=${cards[waitsOn[who][0]]}$`));
     await expect(page.getByRole('dialog')).toBeVisible();
    }
   } finally { fake.settings.managedDelay=null; await page.close(); }
  }
  // Nothing about a Card was written to the waiting list's table.
  expect(rows(`select count(*)::int as n from public.waiting_items where company_id='${rs}'`)[0].n).toBe(Number(before)+1);
  expect(rows(`select count(*)::int as n from public.waiting_items where ${Object.values(titles).map(title=>`title like '%${title.replaceAll("'","''")}%'`).join(' or ')}`)[0].n).toBe(0);
 } finally {
  query(`update public.waiting_items set resolved_at=now() where resolved_at is null and title like '%${stamp}'`);
 }
});

test('on the board\'s Waiting on you the hand marks the Cards that wait on the reader, and a Card that waits on someone else names them',async({browser})=>{
 const named={omar:{given:'Waiting on مراجع',makerAsks:'Waiting on مراجع'},reviewer:{agentAsks:'Waiting on an Administrator or a Manager',review:'Waiting on an Administrator or a Manager'}};
 for(const who of ['omar','reviewer','viewer'] as Reader[]) {
  const page=await as(browser,who,'/c/rs-learning/work/board');
  try {
   for(const name of ['given','agentAsks','makerAsks','review'] as const) {
    const tile=boardTile(page,cards[name]);
    await expect(tile,`${who}: ${name}`).toBeVisible();
    const mine=waitsOn[who].includes(name);
    await expect(tile.locator('[data-sym="onYou"]'),`${who}: ${name}`).toHaveCount(mine?1:0);
    if(mine) await expect(tile.locator('[data-sym="onYou"]')).toHaveAttribute('title','On you');
    const label=(named as Record<string,Record<string,string>>)[who]?.[name];
    if(label) await expect(tile).toHaveAccessibleName(new RegExp(` · ${label} · `));
   }
   // A Card given to the reader wears the hand in its own column until it is done.
   await expect(page.locator(`#board-cols .col[data-column="planned"] .kcard[data-card="${cards.planned}"] [data-sym="onYou"]`)).toHaveCount(who==='reviewer'?1:0);
   if(who==='viewer') await expect(page.locator('#col-waiting')).toHaveText('Waiting on the team');
  } finally { await page.close(); }
 }
 // The Owner in Arabic: the hand's name in Egyptian Arabic.
 query(`update public.people set language='ar' where id='${omar}'`);
 try {
  const page=await as(browser,'omar','/c/rs-learning/work/board');
  try { await expect(boardTile(page,cards.review).locator('[data-sym="onYou"]')).toHaveAttribute('title','عليك انت'); } finally { await page.close(); }
 } finally { query(`update public.people set language='en' where id='${omar}'`); }
});

test('answering, finishing and passing take the row away for everyone it was shown to, with no reload',async({browser})=>{
 const [owner,lead,mona]=await Promise.all([as(browser,'omar'),as(browser,'manager'),as(browser,'reviewer')]);
 try {
  for(const [page,who] of [[owner,'omar'],[lead,'manager'],[mona,'reviewer']] as const) await holds(page,waitsOn[who]);
  const counts=await Promise.all([owner,lead,mona].map(bellCount));
  // Omar answers the Agent's question in the Card's window, opened from his list.
  await owner.locator(`.col[data-column="waiting"] .kcard[data-card="${cards.agentAsks}"] a`).click();
  const callout=owner.getByRole('dialog').getByRole('region',{name:'Has a question'});
  await callout.getByRole('textbox',{name:'Your answer'}).fill('October, the whole month.');
  await callout.getByRole('button',{name:'Send answer'}).click();
  await expect(owner.getByRole('dialog').locator('.cw-status')).toContainText('In progress');
  // The Manager, who was shown it too, loses the row and one from the bell, with no reload.
  await expect(lead.locator(`.col[data-column="waiting"] .kcard[data-card="${cards.agentAsks}"]`)).toHaveCount(0);
  await expect(bell(lead).locator('.sb-count__n')).toHaveText(String(counts[1]-1));
  // The Card given to Mona is done: it leaves her list.
  fake.settings.kanban.move(cards.planned,'done');
  await expect(mona.locator(`.col[data-column="waiting"] .kcard[data-card="${cards.planned}"]`)).toHaveCount(0);
  await expect(bell(mona).locator('.sb-count__n')).toHaveText(String(counts[2]-1));
  // The review is passed on the Engine: it leaves the Owner's and the Manager's lists.
  fake.settings.kanban.move(cards.review,'done');
  for(const [page,was] of [[owner,counts[0]-1],[lead,counts[1]-1]] as const) {
   await expect(page.locator(`.col[data-column="waiting"] .kcard[data-card="${cards.review}"]`)).toHaveCount(0);
   await expect(bell(page).locator('.sb-count__n')).toHaveText(String(was-1));
  }
 } finally { await Promise.all([owner,lead,mona].map(page=>page.close())); }
});

test('a Card given to a Member waits on them until it is given to someone else',async({browser})=>{
 const card=fake.settings.kanban.task({title:titles.passed,status:'todo'}).id;
 query(`insert into public.kanban_cards(company_id,task_id,assignee,made_by) values ('${rs}','${card}','${reviewer}','${omar}')`);
 const mona=await as(browser,'reviewer');
 try {
  await expect(list(mona).locator(`.kcard[data-card="${card}"]`)).toHaveCount(1);
  // Omar gives it to the Manager.
  const owner=await as(browser,'omar','/c/rs-learning/work/board');
  try {
   const answer=await owner.request.patch('/api/board/cards',{data:{company:rs,card,assignee:`member:${manager}`}});
   expect(answer.status()).toBe(200);
  } finally { await owner.close(); }
  await mona.reload();
  await expect(listed(mona).first()).toBeVisible();
  await expect(list(mona).locator(`.kcard[data-card="${card}"]`)).toHaveCount(0);
  const lead=await as(browser,'manager');
  try { await expect(list(lead).locator(`.kcard[data-card="${card}"] [data-sym="onYou"]`)).toHaveCount(1); } finally { await lead.close(); }
 } finally { await mona.close(); }
});

test('with the Engine stopped the bell keeps its last count, and the list its Cards; the page still draws without it',async({browser})=>{
 const page=await as(browser,'omar');
 try {
  const shown=await holds(page,['hiddenReview']);
  const count=await bellCount(page);
  expect(count).toBe(shown);
  fake.settings.managementStatus=503;
  // The board is read again (the window comes back to it) and the Engine does not answer.
  const refused=page.waitForResponse(response=>response.url().includes('/api/board?')&&response.status()===503);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await refused;
  await expect(bell(page).locator('.sb-count__n')).toHaveText(String(count));
  await expect(list(page).locator(`.kcard[data-card="${cards.hiddenReview}"]`)).toHaveCount(1);
  // Another page of the Company keeps it too: the Shell stays as it was drawn.
  await page.locator('.sidebar').getByRole('link',{name:'Activity log',exact:true}).click();
  await expect(page).toHaveURL(/\/log$/);
  await expect(bell(page).locator('.sb-count__n')).toHaveText(String(count));
  // A fresh load while the Engine does not answer still draws the page and the list's other rows; the board's Cards are
  // not there to count.
  await page.goto(inbox);
  await expect(list(page)).toBeVisible();
  await expect(list(page).locator('.kcard[data-card]')).toHaveCount(0);
 } finally { fake.settings.managementStatus=200; await page.close(); }
});
