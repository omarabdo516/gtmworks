import { Readable } from 'node:stream';
import { companyEngine } from './engine/handle.mjs';
import { askedFromPath, crossSiteWrite, isAddressHeader } from './app-origin.mjs';
import { personOf, sessionOf } from './cookie-session.mjs';
import { routePermission } from './route-permissions.mjs';
import { i18n } from './i18n.mjs';
import { dashboardRefusal, refusals, refusedAnswer, wantsPage } from './engine-dashboard-refusals.mjs';

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
// - Four things are refused there (#871, lib/engine-dashboard-refusals.mjs), each on its route before anything reaches
//   the Engine, with a page that says gtmworks manages it and where: showing a key, updating Hermes, importing a backup,
//   and making, renaming or deleting a profile. And no answer holds the Engine's own key, whichever route is asked: an
//   answer is read whole before it goes on (an event stream as it comes, cut before the key), and one that holds the
//   key is refused as showing it.
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

/** The way back to gtmworks's Settings, put first in the dashboard's page in the person's language.
 * @param {string} html @param {{slug:string,language:'en'|'ar'}} at */
function withWayBack(html,{slug,language}) {
 const {t}=i18n(language);
 const dir=language==='ar'?'rtl':'ltr';
 const link=`<a id="gtmworks-back" href="/c/${slug}/settings" lang="${language}" dir="${dir}" style="position:fixed;z-index:2147483647;inset-block-end:16px;inset-inline-end:16px;padding:6px 12px;border:1px solid #dedede;border-radius:999px;background:#ffffff;color:#262626;font:500 13px/20px system-ui,sans-serif;text-decoration:none;box-shadow:0 1px 2px rgba(0,0,0,.06)">${t('engineDashboardBack')}</a>`;
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
// The most of one answer read whole before it goes on: more than the Engine serves of a file (hermes_cli/web_server.py,
// _MANAGED_FILE_MAX_BYTES, 100 MB). An answer past it is refused, as one that cannot be read cannot be let through.
const readLimit=128*1024*1024;
/** The answer's body, read whole, or null past the limit. @param {import('node:http').IncomingMessage} answer */
async function readWhole(answer) {
 const chunks=[]; let size=0;
 for await(const chunk of answer) { size+=chunk.length; if(size>readLimit) { answer.destroy(); return null; } chunks.push(chunk); }
 return Buffer.concat(chunks);
}
/** @param {any} db @param {string} person @returns {Promise<'en'|'ar'>} */
const languageOf=async(db,person)=>(await db.from('people').select('language').eq('id',person).maybeSingle()).data?.language==='ar'?'ar':'en';

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
 // One of the four: refused here, and nothing of it reaches the Engine.
 const refused=async(/** @type {import('./engine-dashboard-refusals.mjs').DashboardRefusal} */ refusal)=>
  refusedAnswer(refusal,{slug:at.company.slug,language:await languageOf(db,person),page:wantsPage(request.headers)});
 const refusal=code?null:dashboardRefusal(request.method,path);
 if(refusal) return refused(refusal);
 const body=request.method==='GET'||request.method==='HEAD'?null:Buffer.from(await request.arrayBuffer());
 let answer;
 try { answer=await at.engine.dashboard.request({method:request.method,path,headers:{...engineBound(request.headers),...(code?{}:{'x-forwarded-prefix':prefix})},body}); }
 catch { return new Response('Service unavailable',{status:503,headers:{'Cache-Control':'no-store'}}); }
 const back=new Headers();
 for(let index=0;index<answer.rawHeaders.length;index+=2) if(!droppedBack.has(answer.rawHeaders[index].toLowerCase())) back.append(answer.rawHeaders[index],answer.rawHeaders[index+1]);
 const status=answer.statusCode??502;
 const guard=at.engine.dashboard;
 if(guard.holdsKey(Buffer.from(JSON.stringify([...back])))) { answer.destroy(); return refused(refusals.keyShown); }
 if(request.method==='HEAD'||[101,103,204,304].includes(status)) { answer.resume(); return new Response(null,{status,headers:back}); }
 // An event stream never ends to be read whole: it goes on as it comes, and ends before the key would pass.
 if(/^text\/event-stream\b/i.test(back.get('content-type')??'')) {
  const cut=guard.keyCut(); answer.on('error',error=>cut.destroy(error)); answer.pipe(cut);
  return new Response(/** @type {ReadableStream} */(Readable.toWeb(cut)),{status,headers:back});
 }
 const whole=await readWhole(answer);
 if(!whole||guard.holdsKey(whole)) return refused(refusals.keyShown);
 back.delete('content-length');
 if(!code&&request.method==='GET'&&status===200&&/^text\/html\b/i.test(back.get('content-type')??''))
  return new Response(withWayBack(whole.toString('utf8'),{slug:at.company.slug,language:await languageOf(db,person)}),{status,headers:back});
 return new Response(whole,{status,headers:back});
}

/**
 * The web server's dashboard sockets: an upgrade under a Company's dashboard path is asked about as a request is, from
 * the session cookie it came with, and joined to the Engine's socket when the person may open it; anything else gets
 * the missing page's status. Returns the handler the web server gives each such upgrade.
 */
export function dashboardSockets() {
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
   if(!signer) return missing(socket);
   const at=await admitted(signer.db,{slug:dashboardSlug(asked.pathname),person:signer.person,allowed:company=>routePermission(signer.db,dashboardRoute,'GET',company,signer.person)});
   if(!at) return missing(socket);
   const prefix=dashboardPrefix(at.company.slug);
   // None of the four is a socket; a socket asked on one of their routes is refused all the same (#871).
   if(dashboardRefusal('GET',asked.pathname.slice(prefix.length)||'/')) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
   await at.engine.dashboard.socket({path:`${asked.pathname.slice(prefix.length)||'/'}${asked.search}`,headers:{...engineBound(headers,{upgrade:true}),'x-forwarded-prefix':prefix}},socket,head);
  } catch { if(!socket.destroyed) missing(socket); }
 };
}
