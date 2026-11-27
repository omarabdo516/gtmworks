// The install owner's Hermes dashboard on the pinned Engine (#869, spec #866, #915), run by the install proof's proxy
// area in a Node container against the HTTPS proxy in front of the install, after first run made the install owner, the
// first Administrator, and their Company. It is Probe B's gate check (docs/engine-probes/engine-dashboard.md) on the
// product's own gate:
// - the install owner loads the dashboard's first page, an inner page, the code its first page names, a lazily loaded page's
//   code at the root /assets/ for the page that asks for it, an API route, and a socket through gtmworks's web server;
// - a Manager, a Contributor, a Viewer and an Administrator who is not the install owner (#915) of the same Company, an
//   Owner of another Company only, all made here, and a
//   signed-out person each get the missing page there (the answer for a Company that does not exist) on a page, a code
//   file and an API route, and no socket;
// - no answer to any of them, and no socket's upgrade or frames, holds the Engine's key (ENGINE_KEY, given by name);
// - the dashboard's live parts close with the Role (#870): the install owner opens the chat, its terminal and the
//   board's event stream; within five seconds of their Role being changed every one is closed and gets nothing after
//   that line, the terminal included, and a new one is refused; given the Role back, a new board stream reports the next
//   Card.
// - the dashboard is in gtmworks's colours and the Owner's language (#872): gtmworks's theme, light and dark, is the
//   default of this new Company's Engine, with gtmworks's name where Hermes shows its wordmark, and paints its first
//   page; the page is in the Owner's language and colour scheme, and in Arabic, right to left and dark on its next load
//   once they changed both; a theme the Owner picks in the dashboard is theirs (the area then starts the Engine's theme
//   hook again and finds the pick kept).
//   APP_ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SIGN_IN_EMAIL, SIGN_IN_PASSWORD, ENGINE_KEY, and
//   SUPABASE_URL where the sign-in and the database are not behind APP_ORIGIN (a local app, not an install).
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

const origin=process.env.APP_ORIGIN, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const email=process.env.SIGN_IN_EMAIL, password=process.env.SIGN_IN_PASSWORD, engineKey=process.env.ENGINE_KEY;
assert.ok(origin&&anon&&service&&email&&password&&engineKey,'APP_ORIGIN, the two keys, SIGN_IN_EMAIL, SIGN_IN_PASSWORD and ENGINE_KEY are set');
// The install runs self-hosted, where the app's sign-in keeps the session in this cookie (lib/supabase-settings.mjs).
const cookieName='sb-gtmworks-auth-token';

const api=process.env.SUPABASE_URL||origin;
const asService={apikey:service,Authorization:`Bearer ${service}`,'content-type':'application/json'};
async function json(path,init={}) {
 const answer=await fetch(`${api}${path}`,init);
 const text=await answer.text();
 assert.ok(answer.ok,`${init.method??'GET'} ${path}: HTTP ${answer.status} ${text.slice(0,300)}`);
 return text?JSON.parse(text):null;
}
async function sessionOf(who,secret) {
 const session=await json('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email:who,password:secret})});
 return {person:session.user.id,cookie:`${cookieName}=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`};
}
const cookieOf=async(who,secret)=>(await sessionOf(who,secret)).cookie;
// Every answer read here, so none is found to hold the Engine's key.
const seen=[];
async function get(path,{cookie='',referer='',method='GET',json:sent=undefined}={}) {
 const answer=await fetch(`${origin}${path}`,{method,redirect:'manual',body:sent===undefined?undefined:JSON.stringify(sent),headers:{...(cookie?{cookie}:{}),...(referer?{referer}:{}),...(method==='GET'?{}:{origin}),...(sent===undefined?{}:{'content-type':'application/json'})}});
 const body=await answer.text();
 seen.push(`${path} ${JSON.stringify([...answer.headers])} ${body}`);
 return {status:answer.status,body,type:answer.headers.get('content-type')??''};
}
// Whether a socket opens: the web server answers the upgrade with 101 once the Engine has.
function socketOpens(path,cookie) {
 const url=new URL(path,origin);
 const request=url.protocol==='https:'?httpsRequest:httpRequest;
 return new Promise(resolve=>{
  const asked=request(url,{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),origin:url.origin,...(cookie?{cookie}:{})}});
  asked.setTimeout(15000,()=>{ asked.destroy(); resolve(`timed out`); });
  asked.on('upgrade',(_answer,socket)=>{ socket.destroy(); resolve(101); });
  asked.on('response',answer=>{ answer.resume(); resolve(answer.statusCode); });
  asked.on('error',error=>resolve(error.message));
  asked.end();
 });
}
// Every socket opened here, its upgrade's head and every byte it got, so none is found to hold the Engine's key either.
const sockets=[];
// A socket kept open: every byte it gets, the time it closed, and the bytes it got after `line` once that is set.
function liveSocket(path,cookie) {
 const url=new URL(path,origin);
 const request=url.protocol==='https:'?httpsRequest:httpRequest;
 return new Promise((resolve,reject)=>{
  const asked=request(url,{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),origin:url.origin,cookie}});
  asked.setTimeout(15000,()=>asked.destroy(new Error(`${path} did not open`)));
  asked.on('upgrade',(answer,socket,early)=>{
   asked.setTimeout(0);
   const live={path,socket,head:JSON.stringify(answer.rawHeaders),text:early.toString('latin1'),closedAt:null,line:null,after:0};
   sockets.push(live);
   socket.on('data',data=>{ live.text+=data.toString('latin1'); if(live.line&&Date.now()>live.line) live.after+=data.length; });
   socket.on('close',()=>{ live.closedAt??=Date.now(); });
   socket.on('error',()=>{});
   resolve(live);
  });
  asked.on('response',answer=>{ answer.resume(); reject(new Error(`${path}: HTTP ${answer.statusCode}`)); });
  asked.on('error',reject);
  asked.end();
 });
}
const until=async(what,done,within)=>{ const end=Date.now()+within; while(!done()) { assert.ok(Date.now()<end,what); await new Promise(resolve=>setTimeout(resolve,200)); } };

const {person:ownerId,cookie:owner}=await sessionOf(email,password);
// The Owner's own Company: first run made one.
const [{company,companies:{slug}}]=await json(`/rest/v1/members?select=company:company_id,companies(slug)&person_id=eq.${ownerId}&role=eq.owner&removed_at=is.null&limit=1`,{headers:asService});
const prefix=`/c/${slug}/hermes`;
const missing=await get('/c/no-such-company/hermes',{cookie:owner});
assert.equal(missing.status,404,'a Company that does not exist has no dashboard');

// The Owner: the first page, under the Company's path, with the way back, and the code it names.
const first=await get(prefix,{cookie:owner});
assert.equal(first.status,200,`the Owner's first page: HTTP ${first.status} ${first.body.slice(0,300)}`);
assert.match(first.body,new RegExp(`__HERMES_BASE_PATH__="${prefix}"`),'the Engine served the page under the Company\'s path');
assert.match(first.body,/id="gtmworks-back"/,'the page shows the way back to gtmworks');
const entry=first.body.match(new RegExp(`src="(${prefix}/assets/[^"]+\\.js)"`))?.[1];
assert.ok(entry,'the first page names its code under the Company\'s path');
const code=await get(entry,{cookie:owner,referer:`${origin}${prefix}`});
assert.equal(code.status,200,`the first page's code: HTTP ${code.status}`);
// An inner page, opened at its own address, and a lazily loaded page's code, which it asks for at the root.
const inner=await get(`${prefix}/sessions`,{cookie:owner});
assert.equal(inner.status,200,`the Owner's inner page: HTTP ${inner.status}`);
const chunk=[...code.body.matchAll(/assets\/([A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js)/g)].map(([,name])=>name).find(name=>!entry.endsWith(name));
assert.ok(chunk,'the first page\'s code names a lazily loaded page\'s code');
const lazy=await get(`/assets/${chunk}`,{cookie:owner,referer:`${origin}${prefix}/sessions`});
assert.equal(lazy.status,200,`a lazily loaded page's code at the root, for the page that asked: HTTP ${lazy.status}`);
assert.equal((await get(`/assets/${chunk}`,{cookie:owner})).status,404,'the root code for no dashboard page is the missing page');
// An API route, and a socket: the chat's, opened with a ticket the dashboard mints.
const status=await get(`${prefix}/api/status`,{cookie:owner});
assert.equal(status.status,200,`the Owner's API route: HTTP ${status.status} ${status.body.slice(0,200)}`);
assert.match(status.type,/json/);
const ticket=await get(`${prefix}/api/auth/ws-ticket`,{cookie:owner,method:'POST'});
assert.equal(ticket.status,200,`a socket ticket: HTTP ${ticket.status} ${ticket.body.slice(0,200)}`);
assert.equal(await socketOpens(`${prefix}/api/ws?ticket=${encodeURIComponent(JSON.parse(ticket.body).ticket)}`,owner),101,'the Owner\'s socket opens through gtmworks');
console.log(`The Owner of ${slug} opened the dashboard's first page, an inner page, their code, a lazily loaded page's code, an API route and a socket`);

// gtmworks's theme is the default on this new Company's Engine, with no choice made by the Owner: the Engine lists it,
// with each colour's light and dark value, and paints the first page with it before its code runs.
const themes=JSON.parse((await get(`${prefix}/api/dashboard/themes`,{cookie:owner})).body);
assert.equal(themes.active,'gtmworks',`gtmworks's theme is the dashboard's default: ${JSON.stringify(themes.active)}`);
const ours=themes.themes.find(theme=>theme.name==='gtmworks')?.definition;
const palette=ours?.palette;
assert.match(ours?.customCSS??'',/content: "gtmworks";/,'the theme shows gtmworks\'s name where Hermes shows its wordmark');
assert.equal(palette?.background?.hex,'light-dark(#fafafa, oklch(0.185 0 0))','the canvas, light and dark');
assert.equal(palette?.midground?.hex,'light-dark(#262626, oklch(0.96 0 0))','the ink, light and dark');
assert.match(first.body,/<style id="hermes-theme-bootstrap">[^<]*--background-base:light-dark\(#fafafa, oklch\(0\.185 0 0\)\)/,'the first paint is gtmworks\'s canvas');
// The first page is in the Owner's language and colour scheme; once they change both, the next load follows them.
const {language,theme}=(await json(`/rest/v1/people?select=language,theme&id=eq.${ownerId}`,{headers:asService}))[0];
const marked=(page,lang,dir,scheme)=>{
 assert.match(page.body,new RegExp(`<html lang="${lang}" dir="${dir}" style="color-scheme:${scheme}"`),`the page is marked ${lang}, ${dir}, ${scheme}`);
 assert.ok(page.body.includes(`localStorage.setItem("hermes-locale","${lang}")`),`the dashboard is told the language ${lang}`);
};
marked(first,language==='ar'?'ar':'en',language==='ar'?'rtl':'ltr',{light:'light',dark:'dark'}[theme]??'light dark');
try {
 await json(`/rest/v1/people?id=eq.${ownerId}`,{method:'PATCH',headers:asService,body:JSON.stringify({language:'ar',theme:'dark'})});
 const arabic=await get(prefix,{cookie:owner});
 assert.equal(arabic.status,200);
 marked(arabic,'ar','rtl','dark');
 assert.match(arabic.body,/id="gtmworks-back"[^>]*>ارجع لـ gtmworks</,'the way back is in Arabic');
} finally { await json(`/rest/v1/people?id=eq.${ownerId}`,{method:'PATCH',headers:asService,body:JSON.stringify({language,theme})}); }
// A theme the Owner picks in the dashboard is theirs.
const picked=await get(`${prefix}/api/dashboard/theme`,{cookie:owner,method:'PUT',json:{name:'mono'}});
assert.equal(picked.status,200,`the Owner picks a theme: HTTP ${picked.status} ${picked.body.slice(0,200)}`);
assert.equal(JSON.parse((await get(`${prefix}/api/dashboard/themes`,{cookie:owner})).body).active,'mono','the Owner\'s pick is the dashboard\'s theme');
console.log('The dashboard is in gtmworks\'s theme by default, light and dark, in the Owner\'s language and colour scheme, Arabic right to left, and the Owner picked another theme');

// Every other kind of person: a Manager, a Contributor and a Viewer of the same Company, and a signed-out person.
const people=[];
for(const role of ['manager','contributor','viewer']) {
 const address=`dashboard-${role}@example.com`, secret=`dashboard-${role}-password`;
 const [made]=[await json('/auth/v1/admin/users',{method:'POST',headers:asService,body:JSON.stringify({email:address,password:secret,email_confirm:true})})];
 await json('/rest/v1/people',{method:'POST',headers:{...asService,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:made.id,name:role})});
 await json('/rest/v1/members',{method:'POST',headers:asService,body:JSON.stringify({company_id:company,person_id:made.id,role})});
 people.push([`a ${role}`,await cookieOf(address,secret)]);
}
// An Administrator of this Company who is not the install owner (#915, decision 0081): every setting is gtmworks's own
// for them, and the Engine's dashboard is the missing page.
{
 const address='dashboard-administrator@example.com', secret='dashboard-administrator-password';
 const made=await json('/auth/v1/admin/users',{method:'POST',headers:asService,body:JSON.stringify({email:address,password:secret,email_confirm:true})});
 await json('/rest/v1/people',{method:'POST',headers:{...asService,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:made.id,name:'administrator'})});
 await json('/rest/v1/members',{method:'POST',headers:asService,body:JSON.stringify({company_id:company,person_id:made.id,role:'owner'})});
 people.push(['an Administrator who is not the install owner',await cookieOf(address,secret)]);
}
// An Owner of another Company only: an Owner, but not of this Company.
{
 const address='dashboard-other-owner@example.com', secret='dashboard-other-owner-password';
 const made=await json('/auth/v1/admin/users',{method:'POST',headers:asService,body:JSON.stringify({email:address,password:secret,email_confirm:true})});
 await json('/rest/v1/people',{method:'POST',headers:{...asService,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:made.id,name:'other owner'})});
 // A Company needs an Engine record; this one's is never asked, as its Owner is refused here before any Engine is.
 const [engine]=await json('/rest/v1/company_engines',{method:'POST',headers:{...asService,Prefer:'return=representation'},body:JSON.stringify({address:'http://127.0.0.1:9',key_encrypted:'never-asked'})});
 const [other]=await json('/rest/v1/companies',{method:'POST',headers:{...asService,Prefer:'return=representation'},body:JSON.stringify({id:randomUUID(),slug:'dashboard-other-company',name:'Another Company',engine_id:engine.id})});
 await json('/rest/v1/members',{method:'POST',headers:asService,body:JSON.stringify({company_id:other.id,person_id:made.id,role:'owner'})});
 people.push(['an Owner of another Company only',await cookieOf(address,secret)]);
}
people.push(['a signed-out person','']);
for(const [who,cookie] of people) {
 for(const path of [prefix,`${prefix}/sessions`,entry,`${prefix}/api/status`]) {
  const answer=await get(path,{cookie});
  assert.deepEqual({status:answer.status,body:answer.body},{status:missing.status,body:missing.body},`${who} gets the missing page at ${path}`);
 }
 const root=await get(`/assets/${chunk}`,{cookie,referer:`${origin}${prefix}/sessions`});
 assert.deepEqual({status:root.status,body:root.body},{status:missing.status,body:missing.body},`${who} gets the missing page for the root code`);
 assert.equal((await get(`${prefix}/api/auth/ws-ticket`,{cookie,method:'POST'})).status,404,`${who} mints no socket ticket`);
 assert.equal(await socketOpens(`${prefix}/api/ws?ticket=any`,cookie),404,`${who} opens no socket`);
}
console.log('A Manager, a Contributor, a Viewer, an Administrator who is not the install owner, an Owner of another Company only and a signed-out person each got the missing page and no socket');

// The live parts close with the Role (#870): the install owner's chat, terminal and board stream, the dashboard's one
// person (#915, decision 0081). Within five seconds of their Role being changed every one is closed and gets nothing
// after that line, and a new one is refused; given their Role back, they make the next Card and no closed stream reports it.
async function liveParts(cookie,who) {
 const opened=[];
 for(const path of ['/api/ws',`/api/pty?channel=gtmworks-check-${who}`,'/api/plugins/kanban/events']) {
  const ticket=await get(`${prefix}/api/auth/ws-ticket`,{cookie,method:'POST'});
  assert.equal(ticket.status,200,`a socket ticket for the ${who} ${path}: HTTP ${ticket.status}`);
  const url=new URL(`${prefix}${path}`,origin); url.searchParams.set('ticket',JSON.parse(ticket.body).ticket);
  opened.push(await liveSocket(`${url.pathname}${url.search}`,cookie));
 }
 return {chat:opened[0],terminal:opened[1],board:opened[2],all:opened};
}
// A Card the install owner makes from the dashboard. Hermes's board stream reports it as a `created` task event naming
// the Card by its id, not its title (plugins/kanban/dashboard/plugin_api.py stream_events), so a stream reports the Card
// when it carries that id.
const card=async title=>{
 const made=await get(`${prefix}/api/plugins/kanban/tasks`,{cookie:owner,method:'POST',json:{title}});
 assert.ok(made.status>=200&&made.status<300,`the Owner makes the Card "${title}" from the dashboard: HTTP ${made.status} ${made.body.slice(0,200)}`);
 const id=JSON.parse(made.body).task?.id;
 assert.ok(typeof id==='string'&&id,`the dashboard answers the Card's id: ${made.body.slice(0,200)}`);
 const reported=new RegExp(`"task_id":\\s*"${id.replace(/[^\w-]/g,'\\$&')}"`);
 return live=>reported.test(live.text);
};
const live=await liveParts(owner,'install owner\'s');
await until('the install owner\'s terminal writes to them',()=>live.terminal.text.length>0,30000);
const before=await card('A Card the board stream reports');
await until('the board stream reports the Card',()=>before(live.board),30000);
for(const one of live.all) assert.equal(one.closedAt,null,`${one.path} is open before the change`);
const changed=Date.now();
for(const one of live.all) one.line=changed+5000;
try {
 await json(`/rest/v1/members?company_id=eq.${company}&person_id=eq.${ownerId}`,{method:'PATCH',headers:asService,body:JSON.stringify({role:'manager'})});
 await until('every socket of the Administrator whose Role changed is closed',()=>live.all.every(one=>one.closedAt!==null),7000);
 for(const one of live.all) assert.ok(one.closedAt-changed<5000,`${one.path} closed ${one.closedAt-changed} ms after the change, within five seconds`);
 assert.equal((await get(`${prefix}/api/auth/ws-ticket`,{cookie:owner,method:'POST'})).status,404,'the changed Administrator mints no new ticket');
 assert.equal(await socketOpens(`${prefix}/api/ws?ticket=any`,owner),404,'the changed Administrator opens no new socket');
} finally { await json(`/rest/v1/members?company_id=eq.${company}&person_id=eq.${ownerId}`,{method:'PATCH',headers:asService,body:JSON.stringify({role:'owner'})}); }
const reopened=await liveParts(owner,'install owner\'s reopened');
const after=await card('A Card after the Role changed');
await until('a board stream opened with the Role given back reports the Card',()=>after(reopened.board),30000);
for(const one of reopened.all) one.socket.destroy();
for(const one of live.all) {
 assert.equal(one.after,0,`${one.path} got nothing after the line`);
 assert.ok(!after(one),`${one.path} never reported the Card made after the change`);
}
console.log(`The chat, the terminal and the board stream of the install owner made a Manager closed within ${Math.max(...live.all.map(one=>one.closedAt-changed))} ms and got nothing after; given the Role back, a new board stream reported the next Card`);

// The four refusals on the pinned Engine (#871): each is refused for the Owner on its route with gtmworks's answer, which
// names where gtmworks does it; the update route leaves the Engine's version as it was; writing a key stays open, and the
// Engine's key, written into the root profile's .env as gtmworks writes it into every Agent's, is shown by no route: not
// by a reveal, and not inside a backup archive the Engine made, downloaded by either route that serves one; and a write
// of the terminal backend is answered and has no effect, as is a write of the file tools' write root, which the Engine
// refuses (#893). Where the next command runs is the job's to read from the host.
/** @param {string} method @param {string} path @param {unknown} [body] */
async function call(method,path,body) {
 const answer=await fetch(`${origin}${prefix}${path}`,{method,redirect:'manual',headers:{cookie:owner,origin,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await answer.text();
 seen.push(`${method} ${path} ${JSON.stringify([...answer.headers])} ${text}`);
 let json=null; try { json=JSON.parse(text); } catch { /* a page or a file */ }
 return {status:answer.status,text,json};
}
const versionOf=async()=>(await call('GET','/api/status')).json?.version;
const version=await versionOf();
assert.ok(version,'the dashboard reports the Engine\'s version');
/** @param {string} kind @param {string} method @param {string} path @param {unknown} [body] */
async function refusedAs(kind,method,path,body) {
 const answer=await call(method,path,body);
 assert.equal(answer.status,403,`${method} ${path} is refused: HTTP ${answer.status} ${answer.text.slice(0,200)}`);
 assert.equal(answer.json?.refused,kind,`${method} ${path} is refused as ${kind}`);
 assert.match(answer.json?.where??'',new RegExp(`^/c/${slug}/settings\\?section=`),`${method} ${path} names where gtmworks does it`);
}
await refusedAs('hermesUpdate','POST','/api/hermes/update',{});
await refusedAs('backupImport','POST','/api/ops/import',{archive:'/opt/data/backups/none.zip',force:true});
await refusedAs('agentProfile','POST','/api/profiles',{name:'made-on-the-dashboard'});
await refusedAs('agentProfile','DELETE','/api/profiles/default');
assert.equal(await versionOf(),version,'the Engine\'s version is unchanged after the update route');
const wrote=await call('PUT','/api/env',{key:'API_SERVER_KEY',value:engineKey});
assert.equal(wrote.status,200,`writing a key stays open: HTTP ${wrote.status} ${wrote.text.slice(0,200)}`);
await refusedAs('engineKey','POST','/api/env/reveal',{key:'API_SERVER_KEY'});
await refusedAs('engineKey','POST','/api/env/reveal',{key:'OPENROUTER_API_KEY'});
const backup=await call('POST','/api/ops/backup',{});
assert.equal(backup.status,200,`a backup: HTTP ${backup.status} ${backup.text.slice(0,200)}`);
const archive=backup.json?.archive;
assert.ok(archive,`the backup names its archive: ${backup.text.slice(0,200)}`);
// The backup runs on its own; the archive is whole once its size stops changing.
const folder=archive.slice(0,archive.lastIndexOf('/')), name=archive.slice(archive.lastIndexOf('/')+1);
let size=-1;
for(let left=90;left>0;left--) {
 const entry=(await call('GET',`/api/files?path=${encodeURIComponent(folder)}`)).json?.entries?.find(item=>item.name===name);
 if(entry?.size>0&&entry.size===size) break;
 size=entry?.size??-1;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(size>0,`the backup archive ${archive} was written`);
await refusedAs('engineKey','GET',`/api/ops/backup/download?archive=${encodeURIComponent(archive)}`);
await refusedAs('engineKey','GET',`/api/files/download?path=${encodeURIComponent(archive)}`);
const terminal=await call('PUT','/api/config',{config:{terminal:{backend:'local'}}});
assert.equal(terminal.status,200,`a write of the terminal backend is answered: HTTP ${terminal.status} ${terminal.text.slice(0,200)}`);
assert.equal((await call('GET','/api/config')).json?.terminal?.backend,'ssh','the terminal backend stays the work sandbox\'s');
const writeRoot=await call('PUT','/api/env',{key:'HERMES_WRITE_SAFE_ROOT',value:'/'});
assert.equal(writeRoot.status,400,`the file tools' write root is not written: HTTP ${writeRoot.status} ${writeRoot.text.slice(0,200)}`);
console.log(`On Hermes ${version}, the update, an import, a profile made and one deleted, a key shown and a backup downloaded were each refused, and the version stayed; a key was written; the terminal backend stayed ssh and the write root stayed the work folder`);

for(const answer of seen) assert.ok(!answer.includes(engineKey),`no answer holds the Engine's key: ${answer.slice(0,120)}`);
for(const live of sockets) {
 assert.ok(!live.head.includes(engineKey),`no socket's upgrade holds the Engine's key: ${live.path}`);
 assert.ok(!live.text.includes(engineKey),`no socket's frames hold the Engine's key: ${live.path}`);
}
console.log(`None of ${seen.length} answers and ${sockets.length} sockets held the Engine's key`);
