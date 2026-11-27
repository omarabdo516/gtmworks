import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { lane } from './lane.mjs';
import { signIn } from './sign-in';

// Spec #831 (#840): an open board follows its Company's Engine live. A Card an Agent or another Member moves on the fake
// Engine moves on the open board within a second, and a comment shows on it, with no reload; the board's changes come
// through gtmworks's own web server (/api/board/events, ADR 0029), never from the Engine, and no frame the browser gets
// holds the Engine's key or address. A board of Company A hears nothing of Company B's Engine. With the Engine's stream
// cut the board reads again on its slow timer, and takes the stream up again when it returns. A person whose membership
// ended stops receiving changes without reloading.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001', aleem='10000000-0000-0000-0000-000000000003';
const viewer='20000000-0000-0000-0000-000000000004';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
// Company B's own Engine, at a loopback address of its own (its record is pointed there).
let other:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 other=await fakeHermes({host:`127.0.0.${130+lane}`,port:8642,managementPort:9119});
 query(`do $$ begin
   update public.company_engines set address='http://127.0.0.${130+lane}:8642' where id=(select engine_id from public.companies where id='${aleem}');
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); await other?.close(); });

const board=(page:Page)=>page.locator('#board-cols');
const inColumn=(page:Page,column:string,id:string)=>board(page).locator(`.col[data-column="${column}"] [data-card="${id}"]`);
// Every socket the page opens, with each text frame it was sent.
function sockets(page:Page) {
 const opened:{url:string,frames:string[],closed:boolean}[]=[];
 page.on('websocket',socket=>{
  const one={url:socket.url(),frames:[] as string[],closed:false}; opened.push(one);
  socket.on('framereceived',frame=>{ if(typeof frame.payload==='string') one.frames.push(frame.payload); });
  socket.on('close',()=>{ one.closed=true; });
 });
 const boards=()=>opened.filter(one=>new URL(one.url).pathname==='/api/board/events');
 return {opened,boards,frames:()=>boards().flatMap(one=>one.frames)};
}
const said=(frames:string[],match:(message:{stream?:string,changed?:string[]})=>boolean)=>frames.some(frame=>{ try { return match(JSON.parse(frame)); } catch { return false; } });

test('a Card moved on the Engine moves on an open board within a second, and a comment shows on it, with no reload',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'December ad copy',status:'ready',assignee:adsProfile});
 const seen=sockets(page);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(inColumn(page,'planned',card.id)).toBeVisible();
 await expect.poll(()=>said(seen.frames(),message=>message.stream==='open')).toBe(true);
 let reloaded=false;
 page.on('framenavigated',frame=>{ if(frame===page.mainFrame()) reloaded=true; });
 // An Agent starts on it.
 const moved=Date.now();
 kanban.move(card.id,'running');
 await expect(inColumn(page,'progress',card.id)).toBeVisible({timeout:1000});
 expect(Date.now()-moved).toBeLessThan(1000);
 await expect(inColumn(page,'progress',card.id).getByRole('img',{name:'Working on it now'})).toBeVisible();
 // Another Member comments on it.
 kanban.comment(card.id,'Mona','Use the new price.');
 await expect(inColumn(page,'progress',card.id).locator('.kt-m')).toHaveText('1',{timeout:1000});
 expect(reloaded).toBe(false);
 // The board's socket is gtmworks's own; nothing the browser was sent on it holds the Engine's key or address.
 expect(seen.opened.length).toBeGreaterThan(0);
 for(const one of seen.opened) expect(new URL(one.url).host,one.url).toBe(new URL(page.url()).host);
 for(const leak of [fake.settings.key,fake.address,fake.managementAddress,new URL(fake.managementAddress).host,adsProfile,rsProfile,'Use the new price.'])
  expect(seen.frames().some(frame=>frame.includes(leak)),leak).toBe(false);
});

test('a board of Company A receives no change of Company B',async({page})=>{
 const seen=sockets(page);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect.poll(()=>said(seen.frames(),message=>message.stream==='open')).toBe(true);
 const theirs=other.settings.kanban.task({title:'Aleem’s own launch plan',status:'ready'});
 other.settings.kanban.move(theirs.id,'running');
 const mine=fake.settings.kanban.task({title:'Weekly report',status:'ready',assignee:adsProfile});
 await expect(inColumn(page,'planned',mine.id)).toBeVisible({timeout:1000});
 // The board's first read can still be on its way when the Card is made and show it before the change does; the
 // change for the reader's own Company comes all the same.
 await expect.poll(()=>said(seen.frames(),message=>message.changed?.includes(mine.id)===true),{timeout:1000}).toBe(true);
 expect(seen.frames().some(frame=>frame.includes(theirs.id))).toBe(false);
 await expect(board(page).getByText('Aleem’s own launch plan')).toHaveCount(0);
});

test('with the Engine\'s stream cut the board still updates on its slow timer, and takes the stream up again when it returns',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Google Ads numbers for October',status:'ready',assignee:adsProfile});
 const seen=sockets(page);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 // Every timer of the page from here on is the test's, so the slow read comes when the test moves the clock.
 await page.clock.install(); await page.reload();
 await expect(inColumn(page,'planned',card.id)).toBeVisible();
 await expect.poll(()=>said(seen.frames(),message=>message.stream==='open')).toBe(true);
 fake.settings.kanbanStreamDown=true;
 try {
  await expect.poll(()=>said(seen.frames(),message=>message.stream==='down')).toBe(true);
  kanban.move(card.id,'blocked');
  // No change comes while the stream is down; the slow timer reads the board again.
  await page.waitForTimeout(1500);
  await expect(inColumn(page,'planned',card.id)).toBeVisible();
  const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board');
  await page.clock.fastForward(31_000);
  expect((await read).status()).toBe(200);
  await expect(inColumn(page,'waiting',card.id)).toBeVisible();
 } finally { fake.settings.kanbanStreamDown=false; }
 // The web server follows the Engine's stream again on its own, and the board goes back to it.
 const before=seen.frames().length;
 await expect.poll(()=>said(seen.frames().slice(before),message=>message.stream==='open'),{timeout:20_000}).toBe(true);
 kanban.move(card.id,'ready');
 await expect(inColumn(page,'planned',card.id)).toBeVisible({timeout:1000});
});

test('a person whose membership ended stops receiving the board\'s changes without reloading',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Meta campaign for the course',status:'ready',assignee:adsProfile});
 const seen=sockets(page);
 await signIn(page,'viewer@example.com','/c/rs-learning/work/board');
 await expect(inColumn(page,'planned',card.id)).toBeVisible();
 await expect.poll(()=>said(seen.frames(),message=>message.stream==='open')).toBe(true);
 kanban.move(card.id,'running');
 await expect(inColumn(page,'progress',card.id)).toBeVisible({timeout:1000});
 query(`update public.members set removed_at=now() where company_id='${rs}' and person_id='${viewer}';`);
 try {
  // Membership is asked again at most every two seconds before a change is sent.
  await page.waitForTimeout(2500);
  const after=seen.frames().length;
  kanban.move(card.id,'done');
  await expect.poll(()=>seen.boards().every(one=>one.closed)).toBe(true);
  expect(said(seen.frames().slice(after),message=>message.changed?.includes(card.id)===true)).toBe(false);
  await expect(inColumn(page,'done',card.id)).toHaveCount(0);
 } finally { query(`update public.members set removed_at=null where company_id='${rs}' and person_id='${viewer}';`); }
});
