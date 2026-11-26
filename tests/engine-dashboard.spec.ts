import { test, expect, freshSeed, type Page, type APIRequestContext } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #869 (spec #866): an Owner opens "Hermes" from Settings and is in their Company's own Hermes dashboard, served by the
// fake Engine's small dashboard (tests/fake-hermes.mjs dashboardAnswer) under /c/<slug>/hermes through gtmworks's gate:
// its first page, a page whose code is loaded lazily from the root /assets/, an API route and a socket. A Manager, a
// Contributor, a Viewer, an Owner of another Company only and a signed-out person each get the missing page there, on a
// page, on a code file and on an API route, and no socket. The Engine's key never reaches the browser, and gtmworks's own
// cookie never reaches the Engine.
const company='10000000-0000-0000-0000-000000000001';
const aleem='10000000-0000-0000-0000-000000000003';
const multi='20000000-0000-0000-0000-000000000005';
const key='test-only-key';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 // multi@example.com is a Contributor of RS Learning and, here, the Owner of Aleem only.
 query(`update public.members set role='owner' where company_id='${aleem}' and person_id='${multi}'`);
});
test.afterAll(async()=>{ await fake?.close(); });

// What gtmworks answers a path that names no Company: the missing page every refusal must match.
async function missingAnswer(request:APIRequestContext,path:string,headers:Record<string,string>={}) {
 const answer=await request.get(path,{headers,maxRedirects:0});
 return {status:answer.status(),body:await answer.text()};
}
// Whether a socket under the path opens for the cookies the page holds: the fake dashboard's socket speaks first.
async function socketOpens(page:Page,path:string) {
 const cookie=(await page.context().cookies()).map(({name,value})=>`${name}=${value}`).join('; ');
 const origin=new URL(page.url()).origin;
 return new Promise<boolean>(resolve=>{
  const socket=new WebSocket(`${origin.replace(/^http/,'ws')}${path}`,{headers:{cookie,origin}});
  socket.on('message',()=>{ resolve(true); socket.terminate(); });
  socket.on('error',()=>{ resolve(false); });
  socket.on('unexpected-response',()=>{ resolve(false); });
 });
}

test('an Owner opens Hermes from Settings, its inner page and its live socket load, and the way back returns to gtmworks',async({page})=>{
 const answers:{url:string,headers:Record<string,string>,body:string}[]=[];
 page.on('response',async response=>{ try { answers.push({url:response.url(),headers:response.headers(),body:(await response.body()).toString('latin1')}); } catch { /* a redirect or a socket has no body */ } });
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 const row=page.locator('#sov-nav').getByRole('link',{name:'Hermes',exact:true});
 await expect(row).toBeVisible();
 // In the existing row style, in the Engine group.
 await expect(row).toHaveClass(/sb-item sov-nav__i/);
 await expect(page.locator('#sov-nav-l-engine').locator('..').getByRole('link',{name:'Hermes',exact:true})).toBeVisible();
 const pages=page.context().pages().length;
 await row.click();
 // The same tab.
 await expect(page).toHaveURL(/\/c\/rs-learning\/hermes\/?$/);
 expect(page.context().pages().length).toBe(pages);
 await expect(page).toHaveTitle('Hermes Agent - Dashboard');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 await expect(page.locator('#engine-status')).toHaveText(`Engine ${fake.settings.version}`);
 await expect(page.locator('#engine-socket')).toHaveText('gateway.ready');
 expect(fake.settings.dashboardSockets.size).toBe(1);
 // The inner page's code is asked for at the root, as the dashboard's lazily loaded pages ask.
 await page.locator('#to-sessions').click();
 await expect(page.locator('#sessions-page')).toHaveText('Every session of every Agent');
 await expect(page).toHaveURL(/\/c\/rs-learning\/hermes\/sessions$/);
 expect(answers.some(answer=>new URL(answer.url).pathname==='/assets/sessions.js')).toBe(true);
 // Opened afresh at the inner page's own address, it loads too.
 await page.reload();
 await expect(page.locator('#sessions-page')).toBeVisible();

 // Every request reached the Engine with the Engine's key and under the Company's path, none with gtmworks's cookie.
 const asked=fake.settings.dashboardRequests;
 expect(asked.length).toBeGreaterThan(5);
 for(const request of asked) {
  expect(request.authorization).toBe(`Bearer ${key}`);
  expect(request.cookie??'').toBe('');
  if(!request.path.startsWith('/assets/')) expect(request.prefix).toBe('/c/rs-learning/hermes');
 }
 // The browser holds no Engine key: not in an answer's head or body, a cookie, or the page's storage.
 for(const answer of answers) expect(`${JSON.stringify(answer.headers)}${answer.body}`).not.toContain(key);
 expect(JSON.stringify(await page.context().cookies())).not.toContain(key);
 expect(await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage}))).not.toContain(key);

 // The way back is on the dashboard, and returns to the Company's Settings.
 const back=page.getByRole('link',{name:'Back to gtmworks',exact:true});
 await expect(back).toBeVisible();
 await back.click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings/);
});

test('the way back is in the person\'s own language',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 query(`update public.people set language='ar' where id='20000000-0000-0000-0000-000000000001'`);
 try {
  await page.goto('/c/rs-learning/hermes/');
  await expect(page.getByRole('link',{name:'ارجع لـ gtmworks',exact:true})).toBeVisible();
 } finally { query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`); }
});

for(const [who,email] of [['a Manager','manager@example.com'],['a Contributor','reviewer@example.com'],['a Viewer','viewer@example.com'],['an Owner of another Company only','multi@example.com'],['a signed-out person','']] as const) {
 test(`${who} gets the missing page on the dashboard's page, code and API, opens no socket, and has no Hermes row`,async({page})=>{
  if(email) {
   await signIn(page,email,'/c/rs-learning/settings');
   await expect(page.locator('#sov-nav')).toBeVisible();
   await expect(page.locator('#sov-nav').getByRole('link',{name:'Hermes',exact:true})).toHaveCount(0);
  } else await page.goto('/sign-in');
  const missing=await missingAnswer(page.request,'/c/no-such-company/hermes');
  expect(missing.status).toBe(404);
  const before=fake.settings.dashboardRequests.length;
  for(const path of ['/c/rs-learning/hermes','/c/rs-learning/hermes/sessions','/c/rs-learning/hermes/assets/index.js','/c/rs-learning/hermes/api/status'])
   expect(await missingAnswer(page.request,path),path).toEqual(missing);
  expect(await missingAnswer(page.request,'/assets/sessions.js',{referer:new URL('/c/rs-learning/hermes/sessions',page.url()).href})).toEqual(missing);
  expect((await page.request.post('/c/rs-learning/hermes/api/auth/ws-ticket',{maxRedirects:0})).status()).toBe(404);
  expect(await socketOpens(page,'/c/rs-learning/hermes/api/ws?ticket=any')).toBe(false);
  // Nothing of theirs reached the Engine.
  expect(fake.settings.dashboardRequests.length).toBe(before);
 });
}

test('an Owner\'s own Company only: a code file asked for from another Company\'s dashboard page is the missing page',async({page})=>{
 await signIn(page,'multi@example.com','/c/aleem/settings');
 // multi owns Aleem: its dashboard opens for them.
 await page.goto('/c/aleem/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 const missing=await missingAnswer(page.request,'/c/no-such-company/hermes');
 expect(await missingAnswer(page.request,'/assets/sessions.js',{referer:new URL('/c/rs-learning/hermes/',page.url()).href})).toEqual(missing);
 expect(await missingAnswer(page.request,'/assets/sessions.js')).toEqual(missing);
 expect(await socketOpens(page,'/c/rs-learning/hermes/api/ws?ticket=any')).toBe(false);
});
