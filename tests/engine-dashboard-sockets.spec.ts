import { test, expect, freshSeed, type BrowserContext } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { dbContainerOf } from './lane.mjs';
import { createServerClient } from '@supabase/ssr';
import WebSocket from 'ws';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #870 (spec #866): the dashboard's live parts, carried by gtmworks's own web server (ADR 0029), work for an Owner and
// stop for a person who is no longer one. Through the gate the dashboard's chat, its terminal and the Kanban board's
// event stream each deliver to the install owner, the dashboard's one person (#915, decision 0081); within five seconds of
// their Role in a Company being changed, their membership ending or their signing out, every socket they hold on that
// Company's dashboard is closed and a new one is refused, while their sockets on another Company's dashboard, where
// nothing changed, stay open and keep delivering.
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const prefix='/c/rs-learning/hermes';
// Another Company the install owner is an Administrator of (the seed makes them one of every Company).
const elsewhere='/c/aleem/hermes';
// The line (spec #866): every socket of the person closed within five seconds of the change.
const line=5000;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
// A change written straight to the lane's database at once, as any writer of members makes it.
const query=(sql:string)=>execFileSync('docker',['exec','-i',dbContainerOf(),'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-qc',sql],{encoding:'utf8'});

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
});
test.afterAll(async()=>{ await fake?.close(); });

type Live={path:string,frames:string[],closedAt:number|null,closed:Promise<void>};
// One of the dashboard's sockets, opened as its page opens it: a ticket minted through the gate, then the upgrade with the
// person's cookies. Resolves once open, or with the status the upgrade was refused with.
async function openSocket(context:BrowserContext,path:string,at=prefix):Promise<Live|number> {
 const origin=new URL(test.info().project.use.baseURL!).origin;
 const minted=await context.request.post(`${at}/api/auth/ws-ticket`,{headers:{origin},maxRedirects:0});
 const ticket=minted.ok()?(await minted.json()).ticket:'refused';
 const cookie=(await context.cookies()).map(({name,value})=>`${name}=${value}`).join('; ');
 const url=new URL(`${at}${path}`,origin); url.searchParams.set('ticket',ticket); url.protocol='ws:';
 const socket=new WebSocket(url.href,{headers:{cookie,origin}});
 const live:Live={path,frames:[],closedAt:null,closed:Promise.resolve()};
 live.closed=new Promise(resolve=>socket.on('close',()=>{ live.closedAt??=Date.now(); resolve(); }));
 socket.on('message',data=>live.frames.push(String(data)));
 socket.on('error',()=>{});
 return new Promise(resolve=>{
  socket.on('open',()=>resolve(live));
  socket.on('unexpected-response',(_request,answer)=>resolve(answer.statusCode??0));
 });
}
const chat='/api/ws', terminal='/api/pty?channel=chat-1', board='/api/plugins/kanban/events?since=0';
async function openAll(context:BrowserContext,at=prefix) {
 const opened=[];
 for(const path of [chat,terminal,board]) {
  const live=await openSocket(context,path,at);
  if(typeof live==='number') throw new Error(`${path} was refused with ${live}`);
  opened.push(live);
 }
 return opened;
}
// A Card made on the board through the gate: the board's stream reports it, by its id as Hermes does, to every open board
// socket. Answers the Card's id.
async function makeCard(context:BrowserContext,title:string,at=prefix):Promise<string> {
 const origin=new URL(test.info().project.use.baseURL!).origin;
 const made=await context.request.post(`${at}/api/plugins/kanban/tasks`,{headers:{origin},data:{title}});
 expect(made.status()).toBe(200);
 return (await made.json()).task.id;
}
// Whether a board stream reported the Card: a `created` event for its id.
const told=(live:Live,card:string)=>live.frames.some(frame=>(JSON.parse(frame).events??[]).some((event:{kind:string,task_id:string})=>event.kind==='created'&&event.task_id===card));
async function signedIn(browser:import('@playwright/test').Browser,email:string) {
 const context=await browser.newContext();
 await signIn(await context.newPage(),email,'/c/rs-learning/settings');
 return context;
}
// Every socket closed within the line from `changed`, and a new one refused with the missing page's status.
async function closedWithin(context:BrowserContext,sockets:Live[],changed:number) {
 await Promise.race([Promise.all(sockets.map(live=>live.closed)),new Promise(resolve=>setTimeout(resolve,line+2000))]);
 for(const live of sockets) {
  expect(live.closedAt,`${live.path} closed`).not.toBeNull();
  expect(live.closedAt!-changed,`${live.path} closed within the line`).toBeLessThan(line);
 }
 expect(await openSocket(context,chat)).toBe(404);
}

test('through the gate, the dashboard\'s chat, its terminal and the board\'s event stream each deliver to an Owner',async({browser})=>{
 const owner=await signedIn(browser,'omar@example.com');
 try {
  const [chatSocket,terminalSocket,boardSocket]=await openAll(owner);
  await expect.poll(()=>chatSocket.frames.some(frame=>frame.includes('gateway.ready'))).toBe(true);
  await expect.poll(()=>terminalSocket.frames.length).toBeGreaterThan(0);
  const card=await makeCard(owner,'A Card the board reports');
  await expect.poll(()=>told(boardSocket,card)).toBe(true);
  // No browser reached the Engine itself: each socket the Engine saw came through gtmworks, with the Engine's key, which
  // no browser holds, under the Company's path, and with none of gtmworks's cookies.
  const upgrades=fake.settings.dashboardRequests.filter(request=>/^\/api\/(ws|pty|plugins\/kanban\/events)\?/.test(request.path));
  expect(upgrades).toHaveLength(3);
  for(const request of upgrades) expect([request.authorization,request.prefix,request.cookie??'']).toEqual([`Bearer ${fake.settings.key}`,prefix,'']);
 } finally { await owner.close(); }
});

test('an Owner whose Role is changed has every socket on that Company\'s dashboard closed within five seconds and no new one; their sockets on another Company\'s stay open',async({browser})=>{
 const first=await signedIn(browser,'omar@example.com'), second=await signedIn(browser,'omar@example.com');
 try {
  const firstSockets=await openAll(first), secondSockets=await openAll(second,elsewhere);
  const changed=Date.now();
  query(`update public.members set role='manager' where company_id='${company}' and person_id='${omar}'`);
  await closedWithin(first,firstSockets,changed);
  // The Engine's side of each was closed with it: only the three on the other Company's dashboard are open on the Engine.
  await expect.poll(()=>fake.settings.dashboardSockets.size).toBe(3);
  // Those stayed open through it, and still deliver.
  for(const live of secondSockets) expect(live.closedAt,`the other Company's ${live.path}`).toBeNull();
  const card=await makeCard(second,'A Card after the change',elsewhere);
  await expect.poll(()=>told(secondSockets[2],card)).toBe(true);
  expect(told(firstSockets[2],card)).toBe(false);
 } finally {
  query(`update public.members set role='owner' where company_id='${company}' and person_id='${omar}'`);
  await first.close(); await second.close();
 }
});

test('an Owner whose membership ends has every dashboard socket closed within five seconds and no new one',async({browser})=>{
 const owner=await signedIn(browser,'omar@example.com');
 try {
  const sockets=await openAll(owner);
  const changed=Date.now();
  query(`update public.members set removed_at=now() where company_id='${company}' and person_id='${omar}'`);
  await closedWithin(owner,sockets,changed);
 } finally {
  query(`update public.members set removed_at=null where company_id='${company}' and person_id='${omar}'`);
  await owner.close();
 }
});

test('an Owner who signs out has every dashboard socket closed within five seconds and no new one',async({browser})=>{
 const owner=await signedIn(browser,'omar@example.com');
 try {
  const sockets=await openAll(owner);
  // The session the sockets were opened with ends, as signing out ends it; the browser keeps the cookie it held.
  const page=await owner.newPage();
  const config=await (await page.request.get('/api/config')).json();
  const cookies=await owner.cookies();
  const db=createServerClient(config.url,config.anonKey,{cookieOptions:config.cookieOptions,cookies:{getAll:()=>cookies,setAll:()=>{}}});
  const changed=Date.now();
  expect((await db.auth.signOut({scope:'local'})).error).toBeNull();
  await closedWithin(owner,sockets,changed);
 } finally { await owner.close(); }
});

// #892 (#869, #871 "No response to the browser holds the Engine's key"): every frame the Engine sends a dashboard socket
// is read before it goes on. One that would carry the Engine's own key, as written or in base64, in one frame or split
// over several, is not sent, and the socket closes; what came before it was delivered.
test('a socket frame that would carry the Engine\'s key is not sent, whole or split over frames, and the socket closes',async({browser})=>{
 const owner=await signedIn(browser,'omar@example.com');
 const key=fake.settings.key;
 // Split where both halves are part of the key, whatever its length.
 const middle=Math.floor(key.length/2);
 // The Engine's side of the terminal socket just opened.
 const engineSide=()=>[...fake.settings.dashboardSockets].filter(socket=>socket.path==='/api/pty').at(-1)!;
 const sends:[string,(socket:ReturnType<typeof engineSide>)=>void][]=[
  ['as written',socket=>socket.send(`OPENROUTER=x API_SERVER_KEY=${key}\n`)],
  ['in base64',socket=>socket.send(Buffer.from(`API_SERVER_KEY=${key}`).toString('base64'))],
  ['over two messages',socket=>{ socket.send(key.slice(0,middle)); socket.send(key.slice(middle)); }],
  ['over the fragments of one message',socket=>{ socket.send(key.slice(0,middle),{fin:false}); socket.send(key.slice(middle),{fin:true}); }],
 ];
 try {
  for(const [how,send] of sends) {
   const live=await openSocket(owner,terminal);
   if(typeof live==='number') throw new Error(`the terminal was refused with ${live}`);
   await expect.poll(()=>fake.settings.dashboardSockets.size).toBeGreaterThan(0);
   engineSide().send('a frame before the key');
   // The terminal's own prompt may come before or after it: the marker is waited for itself.
   await expect.poll(()=>live.frames.at(-1),how).toBe('a frame before the key');
   send(engineSide());
   await live.closed;
   expect(live.frames.join(''),how).not.toContain(key);
   expect(live.frames.join(''),how).not.toContain(Buffer.from(key).toString('base64').slice(4,-4));
  }
  // No socket's frames are compressed, which the guard could not read: the browser's offer never reaches the Engine.
  const upgrades=fake.settings.dashboardRequests.filter(request=>request.path.startsWith('/api/pty?'));
  expect(upgrades.length).toBeGreaterThan(0);
  for(const request of upgrades) expect(request.extensions??'').toBe('');
 } finally { await owner.close(); }
});
