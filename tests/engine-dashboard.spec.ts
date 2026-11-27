import { test, expect, freshSeed, type Page, type APIRequestContext } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #869 (spec #866): the install owner (#915, decision 0081), an Owner, opens the dashboard from Settings and is in their Company's own Hermes dashboard, served by the
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
// The Settings row that opens it (#915): named as a technical tool, the install owner's alone.
const row='Engine logs and system (advanced)';
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
 const link=page.locator('#sov-nav').getByRole('link',{name:row,exact:true});
 await expect(link).toBeVisible();
 // In the existing row style, in the Engine group.
 await expect(link).toHaveClass(/sb-item sov-nav__i/);
 await expect(page.locator('#sov-nav-l-engine').locator('..').getByRole('link',{name:row,exact:true})).toBeVisible();
 const pages=page.context().pages().length;
 await link.click();
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

// #872: the dashboard is in gtmworks's colours with no choice made by the person, in their own light or dark (the fake
// Engine's dashboard applies its active theme, gtmworks's own theme file, as Hermes does), and in their gtmworks language,
// read again on each load: Arabic right to left. A theme the Owner picks in the dashboard is theirs and stays.
const owner='20000000-0000-0000-0000-000000000001';
const canvas={light:'rgb(250, 250, 250)',dark:'oklch(0.185 0 0)'};
const backgroundOf=(page:Page)=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
test('the dashboard is in gtmworks\'s colours in the person\'s light or dark, and in their language, Arabic right to left, on its next load',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 try {
  await page.goto('/c/rs-learning/hermes/');
  await expect(page.locator('#engine-theme')).toHaveText('gtmworks');
  // The seeded Owner follows the device; this device is light.
  expect(await backgroundOf(page)).toBe(canvas.light);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('html')).toHaveAttribute('dir','ltr');
  await expect(page.locator('#to-sessions')).toHaveText('Sessions');
  await page.emulateMedia({colorScheme:'dark'});
  await expect.poll(()=>backgroundOf(page)).toBe(canvas.dark);
  await page.emulateMedia({colorScheme:'light'});
  // Their gtmworks theme and language changed: the dashboard's next load follows both.
  query(`update public.people set theme='dark',language='ar' where id='${owner}'`);
  await page.reload();
  await expect(page.locator('#engine-theme')).toHaveText('gtmworks');
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  // What Hermes translated is in Arabic; what it has not stays in English.
  await expect(page.locator('#to-sessions')).toHaveText('الجلسات');
  await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
  expect(await backgroundOf(page)).toBe(canvas.dark);
  query(`update public.people set theme='light',language='en' where id='${owner}'`);
  await page.emulateMedia({colorScheme:'dark'});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir','ltr');
  await expect(page.locator('#to-sessions')).toHaveText('Sessions');
  // The page paints with the theme once the dashboard has read it, which the theme line shows.
  await expect(page.locator('#engine-theme')).toHaveText('gtmworks');
  expect(await backgroundOf(page)).toBe(canvas.light);
 } finally { query(`update public.people set theme='device',language='en' where id='${owner}'`); }
});

test('a theme the Owner picks in the dashboard is kept for them',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 try {
  await page.goto('/c/rs-learning/hermes/');
  await expect(page.locator('#engine-theme')).toHaveText('gtmworks');
  await page.locator('#pick-theme').selectOption('default');
  await expect(page.locator('#engine-theme')).toHaveText('default');
  await page.reload();
  await expect(page.locator('#engine-theme')).toHaveText('default');
  expect(await backgroundOf(page)).toBe('rgb(4, 28, 28)');
  expect(fake.settings.dashboardTheme).toBe('default');
 } finally { fake.settings.dashboardTheme='gtmworks'; }
});

for(const [who,email] of [['a Manager','manager@example.com'],['a Contributor','reviewer@example.com'],['a Viewer','viewer@example.com'],['an Owner of another Company only','multi@example.com'],['a signed-out person','']] as const) {
 test(`${who} gets the missing page on the dashboard's page, code and API, opens no socket, and has no Hermes row`,async({page})=>{
  if(email) {
   await signIn(page,email,'/c/rs-learning/settings');
   await expect(page.locator('#sov-nav')).toBeVisible();
   await expect(page.locator('#sov-nav').getByRole('link',{name:row,exact:true})).toHaveCount(0);
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
 // multi is made the install owner here, so the one thing refused is the Company they are no Administrator of.
 query(`update public.install_owner set person_id='${multi}'`);
 try {
  await signIn(page,'multi@example.com','/c/aleem/settings');
  // multi owns Aleem: its dashboard opens for them.
  await page.goto('/c/aleem/hermes/');
  await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
  const missing=await missingAnswer(page.request,'/c/no-such-company/hermes');
  expect(await missingAnswer(page.request,'/assets/sessions.js',{referer:new URL('/c/rs-learning/hermes/',page.url()).href})).toEqual(missing);
  expect(await missingAnswer(page.request,'/assets/sessions.js')).toEqual(missing);
  expect(await socketOpens(page,'/c/rs-learning/hermes/api/ws?ticket=any')).toBe(false);
 } finally { query(`update public.install_owner set person_id='${owner}'`); }
});

// #915 (decision 0081): every setting is drawn in gtmworks, and the Engine's own dashboard is the install owner's alone.
// An Administrator who is not the install owner sees gtmworks's own settings and no row, and their own Company's
// dashboard is the missing page to them, on its page, its code, its API and its socket.
test('an Administrator who is not the install owner has no row and gets the missing page on their own Company\'s dashboard',async({page})=>{
 await signIn(page,'multi@example.com','/c/aleem/settings');
 await expect(page.locator('#sov-nav')).toBeVisible();
 await expect(page.locator('#sov-nav').getByRole('link',{name:'Backup'})).toBeVisible();
 await expect(page.locator('#sov-nav').getByRole('link',{name:row,exact:true})).toHaveCount(0);
 await page.locator('#sov-find').fill('advanced');
 await expect(page.locator('#sov-nav').getByRole('link',{name:row,exact:true})).toHaveCount(0);
 const missing=await missingAnswer(page.request,'/c/no-such-company/hermes');
 expect(missing.status).toBe(404);
 const before=fake.settings.dashboardRequests.length;
 for(const path of ['/c/aleem/hermes','/c/aleem/hermes/sessions','/c/aleem/hermes/api/status'])
  expect(await missingAnswer(page.request,path),path).toEqual(missing);
 expect(await missingAnswer(page.request,'/assets/sessions.js',{referer:new URL('/c/aleem/hermes/sessions',page.url()).href})).toEqual(missing);
 expect(await socketOpens(page,'/c/aleem/hermes/api/ws?ticket=any')).toBe(false);
 expect(fake.settings.dashboardRequests.length).toBe(before);
});
