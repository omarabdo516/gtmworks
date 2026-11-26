// Probe B of spec #822 (#826, #827): a Company's Engine dashboard behind the install's gateway, open to an active Owner
// of that Company and to nobody else. Run it through run.sh beside it, with the local gtmworks stack up
// (scripts/local-db.sh): its sign-in (GoTrue) and its members table decide who is an Owner. The people the probe makes
// are removed at its end.
import {createServerClient} from '@supabase/ssr';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {engine,main,fail,must,manage,sleep,docker,startRun,waitRun,makeProfile} from '../engine-stack/engine.mjs';

const gateway=process.env.GATEWAY;
const supabase=process.env.SUPABASE_URL;
const anon=process.env.SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const shots=process.env.PROBE_SHOTS||`${process.env.TMPDIR||'/tmp'}/engine-dashboard-shots`;
mkdirSync(shots,{recursive:true});
const base=`${gateway}/engine/rs-learning`;
const A='10000000-0000-0000-0000-000000000001', B='10000000-0000-0000-0000-000000000002';
const say=line=>console.log(line);
const admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};

// --- people and their Roles, in gtmworks's own tables ---------------------------------------------------------------
const made=[];
async function person(label,company,role) {
 const email=`probe-${label}-${randomUUID().slice(0,8)}@example.test`, password=`probe-${randomUUID()}`;
 const created=await fetch(`${supabase}/auth/v1/admin/users`,{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});
 const user=await created.json();
 if(!created.ok) fail(`make ${label}`,`${created.status} ${JSON.stringify(user)}`);
 made.push(user.id);
 for(const [table,row] of [['people',{id:user.id,name:label}],['members',{company_id:company,person_id:user.id,role}]]) {
  const put=await fetch(`${supabase}/rest/v1/${table}`,{method:'POST',headers:{...admin,Prefer:'resolution=merge-duplicates'},body:JSON.stringify(row)});
  if(!put.ok) fail(`write ${table} for ${label}`,`${put.status} ${await put.text()}`);
 }
 return {email,password,id:user.id};
}
async function setRole(id,company,role) {
 const changed=await fetch(`${supabase}/rest/v1/members?company_id=eq.${company}&person_id=eq.${id}`,{method:'PATCH',headers:{...admin,Prefer:'return=representation'},body:JSON.stringify({role})});
 if(!changed.ok) fail(`change the Role to ${role}`,`${changed.status} ${await changed.text()}`);
 return (await changed.json())[0]?.role;
}
async function cleanup() {
 for(const id of made) {
  await fetch(`${supabase}/rest/v1/members?person_id=eq.${id}`,{method:'DELETE',headers:admin});
  await fetch(`${supabase}/rest/v1/people?id=eq.${id}`,{method:'DELETE',headers:admin});
  await fetch(`${supabase}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:admin});
 }
}
// The cookies the app's own sign-in sets (@supabase/ssr, as lib/supabase.ts uses it).
async function signIn({email,password}) {
 const jar=new Map();
 const client=createServerClient(supabase,anon,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>value?jar.set(name,value):jar.delete(name))}});
 const {error}=await client.auth.signInWithPassword({email,password});
 if(error) fail(`sign ${email} in`,error.message);
 return [...jar].map(([name,value])=>({name,value}));
}
const header=cookies=>cookies.map(({name,value})=>`${name}=${value}`).join('; ');
const get=(path,cookies=[])=>fetch(`${gateway}${path}`,{headers:cookies.length?{Cookie:header(cookies)}:{},redirect:'manual'}).then(async response=>({status:response.status,body:await response.text(),headers:response.headers}));

await main(async()=>{
 say(`engine ${engine.image}`);
 say(`date ${new Date().toISOString().slice(0,10)}`);
 const missing=await get('/engine/no-such-company/');
 say(`a path that does not exist (/engine/no-such-company/): ${missing.status} ${missing.body.trim().slice(0,80)}`);
 try {
  const ownerA=await person('owner-a',A,'owner');
  const ownerB=await person('owner-b',B,'owner');
  const people=[
   ['an active Owner of Company A',ownerA],
   ['a Manager of A (seed)',{email:'manager@example.com',password:'local-seed-password'}],
   ['a Contributor of A (seed)',{email:'reviewer@example.com',password:'local-seed-password'}],
   ['a Viewer of A (seed)',{email:'viewer@example.com',password:'local-seed-password'}],
   ['an Owner of Company B only',ownerB],
   ['a signed-out person',null],
  ];
  say('');
  say('| Who | First page | An API route (/api/status) | Same as the missing page |');
  say('| --- | --- | --- | --- |');
  const jar={};
  for(const [label,who] of people) {
   const cookies=who?await signIn(who):[];
   jar[label]=cookies;
   const page=await get('/engine/rs-learning/',cookies), route=await get('/engine/rs-learning/api/status',cookies);
   const same=page.status===missing.status&&page.body===missing.body&&route.status===missing.status&&route.body===missing.body;
   say(`| ${label} | ${page.status} | ${route.status} | ${same?'yes':'no'} |`);
   const owner=label.startsWith('an active Owner');
   if(owner&&(page.status!==200||route.status!==200)) fail('an active Owner of A opens the dashboard',`${page.status} ${route.status} ${route.body.slice(0,200)}`);
   if(!owner&&!same) fail(`${label} gets the missing-page answer`,`${page.status} ${page.body.slice(0,120)} / ${route.status} ${route.body.slice(0,120)}`);
  }

  // --- the Owner's browser ----------------------------------------------------------------------------------------
  const browser=await chromium.launch();
  try {
   const context=await browser.newContext({viewport:{width:1280,height:800}});
   await context.addCookies(jar['an active Owner of Company A'].map(({name,value})=>({name,value,url:gateway})));
   const page=await context.newPage();
   const seen={statuses:[],urls:[],setCookies:[],sockets:[]};
   page.on('response',response=>{ if(response.url().startsWith(gateway)) { seen.statuses.push(`${response.status()} ${new URL(response.url()).pathname}`); const set=response.headers()['set-cookie']; if(set) seen.setCookies.push(set); } });
   page.on('request',request=>seen.urls.push(request.url()));
   await page.goto(`${base}/`,{waitUntil:'networkidle'});
   await page.screenshot({path:`${shots}/01-first-page.png`});
   const first={title:await page.title(),path:new URL(page.url()).pathname,text:(await page.locator('body').innerText()).slice(0,120).replace(/\s+/g,' ')};
   // The theme: the canvas the page paints, with no choice made by the person.
   const paint=await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,root:getComputedStyle(document.documentElement).getPropertyValue('--background-base').trim(),
    bootstrap:!!document.getElementById('hermes-theme-bootstrap')}));
   say('');
   say(`the Owner's first page: ${first.path} "${first.title}", body: ${first.text}`);
   say(`its paint: body background ${paint.body}, --background-base ${paint.root}, the theme's first-paint block ${paint.bootstrap?'present':'absent'}`);
   // A second page inside it, by its own navigation.
   await page.goto(`${base}/sessions`,{waitUntil:'networkidle'});
   await page.screenshot({path:`${shots}/02-second-page.png`});
   const failed=seen.statuses.filter(line=>!/^(2|3)\d\d /.test(line));
   say(`a second page (${new URL(page.url()).pathname}): ${(await page.locator('body').innerText()).slice(0,100).replace(/\s+/g,' ')}; responses through the gateway that were not 2xx/3xx: ${JSON.stringify(failed.slice(0,8))}`);
   if(!new URL(page.url()).pathname.startsWith('/engine/rs-learning')) fail('the dashboard stays under the Company\'s path',page.url());

   // --- the live parts: the board and the chat, each in a page of its own that stays open ----------------------
   const live=async(path,label)=>{
    const tab=await context.newPage();
    const sockets=[];
    tab.on('websocket',socket=>{
     const one={path:new URL(socket.url()).pathname,query:[...new URL(socket.url()).searchParams.keys()],frames:0,first:'',closed:false,label};
     sockets.push(one); seen.sockets.push(one); seen.urls.push(socket.url());
     socket.on('framereceived',frame=>{ one.frames++; if(!one.first) one.first=String(frame.payload).slice(0,120); });
     socket.on('close',()=>{ one.closed=true; });
    });
    tab.on('request',request=>seen.urls.push(request.url()));
    await tab.goto(`${base}${path}`,{waitUntil:'networkidle'});
    await sleep(3000);
    return {tab,sockets};
   };
   const board=await live('/kanban','board');
   const frames=list=>list.reduce((sum,one)=>sum+one.frames,0);
   const boardBefore=frames(board.sockets);
   await must('make a Card for the board\'s stream',manage('/api/plugins/kanban/tasks',{method:'POST',body:{title:'A Card the board stream reports'}}));
   await sleep(5000);
   await board.tab.screenshot({path:`${shots}/03-board.png`});
   const chat=await live('/chat','chat');
   await chat.tab.screenshot({path:`${shots}/04-chat.png`});
   const show=list=>JSON.stringify(list.map(one=>({path:one.path,query:one.query,frames:one.frames,first:one.first.slice(0,70)})));
   say(`the board's sockets through the gateway: ${show(board.sockets)}; frames after a Card was made: ${frames(board.sockets)-boardBefore}`);
   say(`the chat's sockets through the gateway: ${show(chat.sockets)}`);
   if(!(frames(board.sockets)>boardBefore)) fail('the board\'s event socket delivers an event through the gateway',show(board.sockets));
   if(!chat.sockets.some(one=>one.path.endsWith('/api/ws')&&one.frames>0)) fail('the chat socket delivers an event through the gateway',show(chat.sockets));

   // --- what the browser holds ------------------------------------------------------------------------------------
   const held=await chat.tab.evaluate(()=>({token:typeof window.__HERMES_SESSION_TOKEN__==='string'?window.__HERMES_SESSION_TOKEN__:null,
    local:Object.keys(localStorage).map(key=>[key,localStorage.getItem(key).slice(0,60)]),session:Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key).slice(0,60)])}));
   const cookies=await context.cookies();
   const urlCredentials=[...new Set(seen.urls.flatMap(url=>[...new URL(url).searchParams].filter(([key])=>/token|ticket|key|auth/i.test(key)).map(([key])=>`${new URL(url).pathname}?${key}=`)))];
   const keyAnywhere=JSON.stringify({held,cookies,urls:seen.urls,setCookies:seen.setCookies,sockets:seen.sockets}).includes(engine.key);
   say(`what the browser holds: cookies ${JSON.stringify(cookies.map(c=>c.name))}; Set-Cookie from the dashboard through the gateway ${JSON.stringify(seen.setCookies)}; window.__HERMES_SESSION_TOKEN__ ${held.token===null?'absent':'present'}; localStorage ${JSON.stringify(held.local)}; sessionStorage ${JSON.stringify(held.session)}; credentials in addresses ${JSON.stringify(urlCredentials)}; the Engine's own key anywhere in the browser: ${keyAnywhere?'yes':'no'}`);
   if(keyAnywhere) fail('the Engine\'s key stays out of the browser','found');

   // --- Arabic -----------------------------------------------------------------------------------------------------
   await page.evaluate(()=>localStorage.setItem('hermes-locale','ar'));
   await page.goto(`${base}/sessions`,{waitUntil:'networkidle'});
   const arabic=await page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,direction:getComputedStyle(document.body).direction,
    nav:[...document.querySelectorAll('nav a, aside a')].slice(0,3).map(a=>a.textContent.trim())}));
   await page.screenshot({path:`${shots}/04-arabic.png`});
   say(`in Arabic: lang=${arabic.lang} dir=${arabic.dir||'(none)'} body direction ${arabic.direction}; first links ${JSON.stringify(arabic.nav)}`);
   await page.evaluate(()=>localStorage.setItem('hermes-locale','en'));

   // --- the Role is taken away -------------------------------------------------------------------------------------
   const ticket=await page.evaluate(async base=>{ const r=await fetch(`${base}/api/auth/ws-ticket`,{method:'POST'}); return {status:r.status,body:await r.json().catch(()=>null)}; },base);
   const open=[...board.sockets,...chat.sockets].filter(one=>!one.closed).length;
   say(`before the change: a WebSocket ticket minted through the gateway: ${ticket.status}; sockets open: ${open}`);
   say(`the Owner's Role changed to ${await setRole(ownerA.id,A,'manager')}`);
   const afterPage=await page.goto(`${base}/`);
   const afterApi=await page.evaluate(async base=>{ const out={}; for(const [name,path,init] of [['status','/api/status',{}],['config','/api/config',{}],['ticket','/api/auth/ws-ticket',{method:'POST'}]]) { const r=await fetch(`${base}${path}`,init); out[name]=r.status; } return out; },base);
   const stale=await page.evaluate(async([base,t])=>new Promise(done=>{ const ws=new WebSocket(`${base.replace(/^http/,'ws')}/api/plugins/kanban/events?ticket=${encodeURIComponent(t)}`); ws.onopen=()=>{ ws.close(); done('opened'); }; ws.onerror=()=>done('refused'); setTimeout(()=>done('no answer'),8000); }),[base,ticket.body?.ticket||'']);
   const boardAt=frames(board.sockets), ptyAt=frames(chat.sockets.filter(one=>one.path.endsWith('/api/pty')));
   await must('make a Card after the change',manage('/api/plugins/kanban/tasks',{method:'POST',body:{title:'A Card made after the Role changed'}}));
   // Keys typed into the chat's terminal after the change: they reach the Engine only over the socket opened before.
   await chat.tab.mouse.click(640,400);
   await chat.tab.keyboard.type('still here?');
   await sleep(5000);
   const stillOpen=[...board.sockets,...chat.sockets].filter(one=>!one.closed).map(one=>one.path.replace('/engine/rs-learning',''));
   const grew=[`board +${frames(board.sockets)-boardAt}`,`pty +${frames(chat.sockets.filter(one=>one.path.endsWith('/api/pty')))-ptyAt}`];
   say(`after the change, the same browser: the first page ${afterPage?.status()}, ${JSON.stringify(afterApi)}, the ticket minted before the change on a new socket: ${stale}; sockets opened before the change still open: ${JSON.stringify(stillOpen)}; frames they got after it: ${JSON.stringify(grew)}`);
   if(afterPage?.status()!==404||Object.values(afterApi).some(status=>status!==404)||stale==='opened') fail('nothing the browser holds opens the dashboard after the Role changes',JSON.stringify({page:afterPage?.status(),afterApi,stale}));
   // The record's answer for a socket already open: the gate is asked at the upgrade only, so it stays open and works.
   // If this changes (the Engine or the gateway closes it), the record must be read again.
   if(!stillOpen.length||!grew.some(one=>!/\+0$/.test(one))) fail('the record names sockets opened before the change as still working',JSON.stringify({stillOpen,grew}));
   await page.screenshot({path:`${shots}/05-after-role.png`});
   await setRole(ownerA.id,A,'owner');

   // --- a write of the terminal backend from the dashboard ---------------------------------------------------------
   const context2=await browser.newContext();
   await context2.addCookies(jar['an active Owner of Company A'].map(({name,value})=>({name,value,url:gateway})));
   const page2=await context2.newPage();
   await page2.goto(`${base}/config`,{waitUntil:'networkidle'});
   const write=await page2.evaluate(async base=>{ const r=await fetch(`${base}/api/config`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{terminal:{backend:'local'}}})}); return `${r.status} ${(await r.text()).slice(0,80)}`; },base);
   const run=await startRun(null,`Where am I?\nCALL terminal {"command":"hostname; id -un"}\nREPLY done`);
   await waitRun(null,run.run_id);
   const page3=await must('read the terminal Run',manage(`/api/sessions/${run.run_id}/messages?order=latest&limit=10`));
   const ran=page3.messages.findLast(message=>message.role==='tool')?.content||'';
   const inSandbox=ran.includes(process.env.SANDBOX_HOSTNAME)&&/\bpn\b/.test(ran);
   say(`a write of terminal.backend=local from the dashboard: ${write}; the next terminal command ran: ${ran.slice(0,200)} (the Work sandbox is ${process.env.SANDBOX_HOSTNAME}: ${inSandbox?'there':'not there'})`);
   if(!inSandbox) fail('after a write of the terminal backend from the dashboard, a command still runs in the Work sandbox',ran);
   // --- what an Owner can reach there that gtmworks does not give: tried, not only read ---------------------------
   await makeProfile('ag-probe');
   const reach=await page2.evaluate(async base=>{
    const json=async r=>({status:r.status,body:await r.json().catch(()=>null)});
    const out={};
    out.reveal=await json(await fetch(`${base}/api/env/reveal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'API_SERVER_KEY',profile:'ag-probe'})}));
    out.files=await json(await fetch(`${base}/api/files?path=${encodeURIComponent('/opt/data')}`));
    out.messaging=await json(await fetch(`${base}/api/messaging/platforms`));
    out.mcp=await json(await fetch(`${base}/api/mcp/servers`));
    out.plugins=await json(await fetch(`${base}/api/dashboard/plugins`));
    const ticket=(await (await fetch(`${base}/api/auth/ws-ticket`,{method:'POST'})).json()).ticket;
    out.hostTerminal=await new Promise(done=>{ const ws=new WebSocket(`${base.replace(/^http/,'ws')}/api/host-terminal?ticket=${encodeURIComponent(ticket)}`);
     let first=''; ws.onmessage=event=>{ first||=String(event.data).slice(0,80); };
     ws.onopen=()=>setTimeout(()=>{ ws.close(); done({opened:true,first}); },2000); ws.onclose=event=>done({opened:false,code:event.code,reason:event.reason}); setTimeout(()=>done({opened:false,code:'no answer'}),8000); });
    return out;
   },base);
   const revealed=reach.reveal.body?.value;
   say(`the Engine's key, revealed from the dashboard (POST /api/env/reveal, API_SERVER_KEY of an Agent's profile): ${reach.reveal.status}, ${revealed===engine.key?'the value is the Engine\'s own key':'the value is not the Engine\'s key'}`);
   say(`the Engine's files (GET /api/files?path=/opt/data): ${reach.files.status} ${JSON.stringify(reach.files.body)?.slice(0,160)}`);
   say(`messaging platforms: ${reach.messaging.status} ${JSON.stringify(reach.messaging.body)?.slice(0,160)}`);
   say(`MCP servers: ${reach.mcp.status} ${JSON.stringify(reach.mcp.body)?.slice(0,120)}; dashboard plugins: ${reach.plugins.status} ${JSON.stringify(reach.plugins.body)?.slice(0,120)}`);
   say(`a shell on the Engine (/api/host-terminal): ${JSON.stringify(reach.hostTerminal)}`);
   if(reach.reveal.status!==200||revealed!==engine.key) fail('the record names the Engine\'s key as readable from the dashboard',`${reach.reveal.status}`);
   await context2.close();
  } finally {
   await browser.close();
  }
  say(`the gate's decisions: ${JSON.stringify(Object.entries(JSON.parse(docker('exec',process.env.GATE_CONTAINER,'wget','-qO-','http://127.0.0.1:8080/decisions')).reduce((all,one)=>{ const key=`${one.allowed?'allowed':'refused'}${one.upgrade?' (WebSocket)':''}`; all[key]=(all[key]||0)+1; return all; },{})))}`);
 } finally {
  await cleanup();
 }
 say('probe complete');
});
