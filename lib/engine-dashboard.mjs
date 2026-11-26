import { Readable } from 'node:stream';
import { companyEngine } from './engine/handle.mjs';
import { askedFromPath, crossSiteWrite, isAddressHeader } from './app-origin.mjs';
import { personOf, sessionOf } from './cookie-session.mjs';
import { routePermission } from './route-permissions.mjs';
import { i18n } from './i18n.mjs';

// The Owner's Hermes dashboard (#869, spec #866, ADR 0033 item 4): the Engine's own dashboard, served under a path of
// the Company through Hermes's own support for a reverse proxy at a sub-path, behind gtmworks's gate. This module is the
// gate; Probe B proved its shape on the pinned Engine (docs/engine-probes/engine-dashboard.md).
//
// - Every request and every socket upgrade under /c/<slug>/hermes is asked about, and the answer is gtmworks's own rule
//   for an active Owner of that Company: the route-to-permission table's entry for the dashboard's route
//   (lib/route-permissions.mjs, Owner), read from the database on each request. Anything else is the missing page, the
//   same answer as for a Company that does not exist (ADR 0004): signed out, another Role, another Company's Owner.
// - The dashboard's lazily loaded pages ask for their code at the root, /assets/<file>, not under the prefix. Such a
//   file is served to the person the dashboard page that asked for it (its Referer, on gtmworks's own address) is open
//   to, by the same rule.
// - What goes to the Engine is the browser's request without gtmworks's cookie, any authorization or any address a
//   client claims; the Engine handle adds the Engine's key (lib/engine/transport.mjs). What comes back carries no cookie
//   of the Engine's. The browser never holds the key.
// - The dashboard's first page carries a way back to gtmworks's Settings, in the person's own language.
// - It is in the person's gtmworks language and their light or dark, read on each load of a first page (#872). The
//   dashboard takes its language only from localStorage['hermes-locale'] (Hermes's i18n), so the page sets it before the
//   dashboard's code runs, and is marked with that language and direction for its first paint: Arabic right to left, and
//   what Hermes has not translated stays in English. Its colours are gtmworks's theme (scripts/engine-dashboard-theme.yaml),
//   the Engine's default; each colour there holds a light and a dark value, and the page's colour scheme, the person's
//   own (light, dark, or the device's), picks one. The theme itself is never chosen here: one the Owner picks in the
//   dashboard is theirs.
//
// The HTTP requests are answered by the dashboard's route handlers (app/c/[slug]/hermes, app/assets), so the person's
// session is refreshed by the app's middleware as on any page. The sockets are carried by gtmworks's own web server
// (scripts/web-server.mjs, ADR 0029), where a change of Role can reach them.

const dashboardRoute='app/c/[slug]/hermes/[[...path]]/route.ts';
/** The path a Company's dashboard is served under. @param {string} slug */
const dashboardPrefix=slug=>`/c/${slug}/hermes`;
/** The Company whose dashboard a path is under, if any. @param {string|null|undefined} pathname */
export const dashboardSlug=pathname=>/^\/c\/([a-z0-9-]+)\/hermes(?:\/|$)/.exec(pathname??'')?.[1]??null;
/** The Company whose dashboard page asked for a code file at the root. @param {Headers} headers */
export const askingSlug=headers=>dashboardSlug(askedFromPath(headers));

/** The missing page: every refusal of the dashboard, the same as for a Company that does not exist (ADR 0004). */
const dashboardMissing=()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});

// What a request may carry on to the Engine: none of gtmworks's credentials (its cookie, any authorization), no address
// (lib/app-origin.mjs), none of the connection's own hop-by-hop headers and none of Next's own. Compression is asked of
// nobody: the answer is streamed back as it is, and the web server compresses it for the browser.
const dropped=new Set(['cookie','authorization','connection','keep-alive','proxy-authorization','proxy-connection','te','trailer','transfer-encoding','content-length','accept-encoding','rsc']);
/** @param {Iterable<[string,string]>} entries @param {{upgrade?:boolean}} [options] @returns {Record<string,string>} */
function engineBound(entries,{upgrade=false}={}) {
 /** @type {Record<string,string>} */
 const kept={};
 for(const [raw,value] of entries) {
  const name=raw.toLowerCase();
  if(dropped.has(name)||isAddressHeader(name)||name.startsWith('x-middleware-')||name.startsWith('next-')) continue;
  if(name==='upgrade'&&!upgrade) continue;
  kept[name]=value;
 }
 if(upgrade) kept.connection='Upgrade';
 return kept;
}
// What an answer of the Engine's may carry back: no cookie of its own and no hop-by-hop header.
const droppedBack=new Set(['set-cookie','connection','keep-alive','transfer-encoding','proxy-authenticate','trailer']);

// The colour scheme of each of a person's gtmworks themes (people.theme): the device's follows the device.
/** @type {Record<string,string>} */
const colourSchemes={light:'light',dark:'dark',device:'light dark'};
/**
 * The dashboard's first page in the person's own language and colour scheme, with the way back to gtmworks's Settings
 * put first in its body.
 * @param {string} html @param {{slug:string,language:'en'|'ar',theme:string}} at
 */
function dressed(html,{slug,language,theme}) {
 const {t}=i18n(language);
 const dir=language==='ar'?'rtl':'ltr';
 const scheme=colourSchemes[theme]??colourSchemes.device;
 // The page's own language and direction give way to the person's; the dashboard sets them again from its locale.
 const root=/<html\b([^>]*)>/i.exec(html);
 const own=(root?.[1]??'').replace(/\s(?:lang|dir)=("[^"]*"|'[^']*'|[^\s>]*)/gi,'');
 const opened=`<html lang="${language}" dir="${dir}" style="color-scheme:${scheme}"${own}>`;
 html=root?`${html.slice(0,root.index)}${opened}${html.slice(root.index+root[0].length)}`:`${opened}${html}`;
 const locale=`<script>try{localStorage.setItem("hermes-locale",${JSON.stringify(language)})}catch(e){}</script>`;
 const head=/<head\b[^>]*>/i.exec(html);
 html=head?`${html.slice(0,head.index+head[0].length)}${locale}${html.slice(head.index+head[0].length)}`:html.replace(opened,`${opened}${locale}`);
 const link=`<a id="gtmworks-back" href="/c/${slug}/settings" lang="${language}" dir="${dir}" style="position:fixed;z-index:2147483647;inset-block-end:16px;inset-inline-end:16px;padding:6px 12px;border:1px solid light-dark(#dedede,oklch(1 0 0 / 11%));border-radius:999px;background:light-dark(#ffffff,oklch(0.235 0 0));color:light-dark(#262626,oklch(0.96 0 0));font:500 13px/20px system-ui,sans-serif;text-decoration:none;box-shadow:0 1px 2px rgba(0,0,0,.06)">${t('engineDashboardBack')}</a>`;
 const body=/<body\b[^>]*>/i.exec(html);
 return body?`${html.slice(0,body.index+body[0].length)}${link}${html.slice(body.index+body[0].length)}`:`${link}${html}`;
}

/**
 * The Company and its Engine a request is for, when the person may open its dashboard; null for the missing page.
 * @param {any} db the person's own client @param {{slug:string|null,person:string|null|undefined,allowed:(company:string)=>Promise<'allowed'|'refused'|'failed'>}} asked
 */
async function admitted(db,{slug,person,allowed}) {
 if(!slug||!person) return null;
 const {data:company}=await db.from('companies').select('id,slug').eq('slug',slug).maybeSingle();
 if(!company||await allowed(company.id)!=='allowed') return null;
 const engine=await companyEngine(company.id);
 return engine?{company,engine}:null;
}
/** The person's gtmworks language and theme. @param {any} db @param {string} person @returns {Promise<{language:'en'|'ar',theme:string}>} */
async function preferencesOf(db,person) {
 const {data}=await db.from('people').select('language,theme').eq('id',person).maybeSingle();
 return {language:data?.language==='ar'?'ar':'en',theme:data?.theme??'device'};
}

/**
 * One HTTP request of a dashboard, answered: the Engine's answer, or the missing page. The route handler names the
 * path asked, the Company (from its path or, for a code file at the root, from the page that asked for it) and its own
 * check of the table.
 * @param {Request} request
 * @param {{db:any,person:string|null|undefined,slug:string|null,pathname:string,search:string,code:boolean,allowed:(company:string)=>Promise<'allowed'|'refused'|'failed'>}} asked
 */
export async function dashboardAnswer(request,{db,person,slug,pathname,search,code,allowed}) {
 if(request.method!=='GET'&&request.method!=='HEAD'&&crossSiteWrite(request.headers)) return dashboardMissing();
 const at=await admitted(db,{slug,person,allowed});
 if(!at||!person) return dashboardMissing();
 const prefix=dashboardPrefix(at.company.slug);
 const path=`${code?pathname:pathname.slice(prefix.length)||'/'}${search}`;
 const body=request.method==='GET'||request.method==='HEAD'?null:Buffer.from(await request.arrayBuffer());
 let answer;
 try { answer=await at.engine.dashboard.request({method:request.method,path,headers:{...engineBound(request.headers),...(code?{}:{'x-forwarded-prefix':prefix})},body}); }
 catch { return new Response('Service unavailable',{status:503,headers:{'Cache-Control':'no-store'}}); }
 const back=new Headers();
 for(let index=0;index<answer.rawHeaders.length;index+=2) if(!droppedBack.has(answer.rawHeaders[index].toLowerCase())) back.append(answer.rawHeaders[index],answer.rawHeaders[index+1]);
 const status=answer.statusCode??502;
 if(request.method==='HEAD'||[101,103,204,304].includes(status)) { answer.resume(); return new Response(null,{status,headers:back}); }
 if(!code&&request.method==='GET'&&status===200&&/^text\/html\b/i.test(back.get('content-type')??'')) {
  const chunks=[]; for await(const chunk of answer) chunks.push(chunk);
  back.delete('content-length');
  return new Response(dressed(Buffer.concat(chunks).toString('utf8'),{slug:at.company.slug,...await preferencesOf(db,person)}),{status,headers:back});
 }
 return new Response(/** @type {ReadableStream} */(Readable.toWeb(answer)),{status,headers:back});
}

// How often each open dashboard socket's right is asked again, and how long an answer is waited for (#870). The line
// (spec #866): within five seconds of an Owner's Role being changed, their membership ending or their signing out, every
// dashboard socket that person holds is closed. Nothing tells the web server of such a change (it is written by the app,
// by a person's own database session, or straight into the database), so the right is asked again: the next ask begins
// at most `recheckEvery` after the change and is answered, or counted as a refusal, within `answerWithin`.
const recheckEvery=2000, answerWithin=2000;

/**
 * Whether the person a session names may still open a Company's dashboard: the session is still live with the sign-in
 * (signing out ends it; it runs out at its expiry, and is never refreshed here), and the table's Owner entry still
 * answers for that person. Anything else, a failure to answer included, is no.
 * @param {{token:string,expiresAt:number}} signedIn @param {string} company
 */
async function stillOpen(signedIn,company) {
 if(Date.now()>=signedIn.expiresAt) return false;
 const signer=await personOf(signedIn.token);
 return Boolean(signer)&&await routePermission(signer.db,dashboardRoute,'GET',company,signer.person)==='allowed';
}
/** @param {Promise<boolean>} asked @param {number} within */
const answeredWithin=(asked,within)=>new Promise(resolve=>{
 const late=setTimeout(()=>resolve(false),within);
 asked.then(answer=>{ clearTimeout(late); resolve(answer); },()=>{ clearTimeout(late); resolve(false); });
});

/**
 * The web server's dashboard sockets: an upgrade under a Company's dashboard path is asked about as a request is, from
 * the session cookie it came with, and joined to the Engine's socket when the person may open it; anything else gets
 * the missing page's status. Every socket open is kept with the session and the Company it was opened for, and that
 * person's right is asked again while any is open (#870): once it is gone, every one of those sockets is closed, both
 * the browser's side and the Engine's, so the chat, the terminal and the board's stream get nothing more. A new one is
 * then refused at its upgrade, as any request is. Returns the handler the web server gives each such upgrade.
 */
export function dashboardSockets() {
 /** @typedef {{sockets:Set<import('node:stream').Duplex>,joining:number,ended:boolean,next:NodeJS.Timeout|null}} Held */
 /** The sockets held, by the session they were opened with and their Company. @type {Map<string,Held>} */
 const held=new Map();
 /** @param {string} key @param {Held} group */
 const end=(key,group)=>{
  group.ended=true;
  if(group.next) clearTimeout(group.next);
  if(held.get(key)===group) held.delete(key);
  for(const engine of group.sockets) engine.destroy();
 };
 /** @param {string} key @param {Held} group @param {{token:string,expiresAt:number}} signedIn @param {string} company */
 const ask=async(key,group,signedIn,company)=>{
  group.next=null;
  if(group.ended) return;
  const started=Date.now();
  if(!await answeredWithin(stillOpen(signedIn,company),answerWithin)) { end(key,group); return; }
  if(group.ended) return;
  if(!group.sockets.size&&!group.joining) { held.delete(key); group.ended=true; return; }
  group.next=setTimeout(()=>void ask(key,group,signedIn,company),Math.max(0,recheckEvery-(Date.now()-started)));
 };
 /** @param {{token:string,expiresAt:number}} signedIn @param {string} company */
 const join=(signedIn,company)=>{
  const key=`${company} ${signedIn.token}`;
  let group=held.get(key);
  if(!group) {
   group={sockets:new Set(),joining:0,ended:false,next:null};
   held.set(key,group);
   const asking=group;
   asking.next=setTimeout(()=>void ask(key,asking,signedIn,company),recheckEvery);
  }
  const at=group;
  at.joining++;
  /** @param {import('node:stream').Duplex|null} engine */
  return engine=>{
   at.joining--;
   if(!engine) return;
   if(at.ended) { engine.destroy(); return; }
   at.sockets.add(engine);
   engine.once('close',()=>at.sockets.delete(engine));
  };
 };
 /** @param {import('node:stream').Duplex} socket */
 const missing=socket=>{ socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
 /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head @param {URL} asked */
 return async(request,socket,head,asked)=>{
  socket.on('error',()=>{});
  try {
   const headers=new Headers(Object.entries(request.headers).flatMap(([name,value])=>typeof value==='string'?[[name,value]]:[]));
   if(crossSiteWrite(headers)) return missing(socket);
   const signedIn=await sessionOf(request.headers.cookie??'');
   const signer=signedIn?await personOf(signedIn.token):null;
   if(!signedIn||!signer) return missing(socket);
   const at=await admitted(signer.db,{slug:dashboardSlug(asked.pathname),person:signer.person,allowed:company=>routePermission(signer.db,dashboardRoute,'GET',company,signer.person)});
   if(!at) return missing(socket);
   const prefix=dashboardPrefix(at.company.slug);
   // Kept from before the Engine is asked, so a change made while it answers still closes it.
   const joined=join(signedIn,at.company.id);
   let engine=null;
   try { engine=await at.engine.dashboard.socket({path:`${asked.pathname.slice(prefix.length)||'/'}${asked.search}`,headers:{...engineBound(headers,{upgrade:true}),'x-forwarded-prefix':prefix}},socket,head); }
   finally { joined(engine); }
  } catch { if(!socket.destroyed) missing(socket); }
 };
}
