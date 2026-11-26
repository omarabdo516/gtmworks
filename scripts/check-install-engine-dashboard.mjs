// The Owner's Hermes dashboard on the pinned Engine (#869, spec #866), run by the install proof's proxy area in a Node
// container against the HTTPS proxy in front of the install, after first run made the Owner and their Company. It is
// Probe B's gate check (docs/engine-probes/engine-dashboard.md) on the product's own gate:
// - the Owner loads the dashboard's first page, an inner page, the code its first page names, a lazily loaded page's
//   code at the root /assets/ for the page that asks for it, an API route, and a socket through gtmworks's web server;
// - a Manager, a Contributor and a Viewer of the same Company, made here, and a signed-out person each get the missing
//   page there (the answer for a Company that does not exist) on a page, a code file and an API route, and no socket;
// - no answer to any of them holds the Engine's key (ENGINE_KEY, given by name).
//   APP_ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SIGN_IN_EMAIL, SIGN_IN_PASSWORD, ENGINE_KEY, and
//   SUPABASE_URL where the sign-in and the database are not behind APP_ORIGIN (a local app, not an install).
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';

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
async function get(path,{cookie='',referer='',method='GET'}={}) {
 const answer=await fetch(`${origin}${path}`,{method,redirect:'manual',headers:{...(cookie?{cookie}:{}),...(referer?{referer}:{}),...(method==='POST'?{origin}:{})}});
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

// Every other kind of person: a Manager, a Contributor and a Viewer of the same Company, and a signed-out person.
const people=[];
for(const role of ['manager','contributor','viewer']) {
 const address=`dashboard-${role}@example.com`, secret=`dashboard-${role}-password`;
 const [made]=[await json('/auth/v1/admin/users',{method:'POST',headers:asService,body:JSON.stringify({email:address,password:secret,email_confirm:true})})];
 await json('/rest/v1/people',{method:'POST',headers:{...asService,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:made.id,name:role})});
 await json('/rest/v1/members',{method:'POST',headers:asService,body:JSON.stringify({company_id:company,person_id:made.id,role})});
 people.push([`a ${role}`,await cookieOf(address,secret)]);
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
console.log('A Manager, a Contributor, a Viewer and a signed-out person each got the missing page and no socket');

// The four refusals on the pinned Engine (#871): each is refused for the Owner on its route with gtmworks's answer, which
// names where gtmworks does it; the update route leaves the Engine's version as it was; writing a key stays open, and the
// Engine's key, written into the root profile's .env as gtmworks writes it into every Agent's, is shown by no route: not
// by a reveal, and not inside a backup archive the Engine made, downloaded by either route that serves one; and a write
// of the terminal backend is answered and has no effect. Where the next command runs is the job's to read from the host.
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
console.log(`On Hermes ${version}, the update, an import, a profile made and one deleted, a key shown and a backup downloaded were each refused, and the version stayed; a key was written; the terminal backend stayed ssh`);

for(const answer of seen) assert.ok(!answer.includes(engineKey),`no answer holds the Engine's key: ${answer.slice(0,120)}`);
console.log(`None of ${seen.length} answers held the Engine's key`);
