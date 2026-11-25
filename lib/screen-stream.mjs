import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { combineChunks, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { supabaseSettings } from './supabase-settings.mjs';
import { engineOf } from './company-engine.mjs';
import { engineFor } from './engine.mjs';
import { permitted } from './route-permissions.mjs';
import { crossSiteWrite } from './app-origin.mjs';

// The live stream of an Agent's Screen (#713, ADR 0029): the one WebSocket gtmworks carries itself, at
// /api/display/ws on its own address. The browser never reaches the Engine (ADR 0011): gtmworks's web server takes the
// upgrade (scripts/web-server.mjs), checks the person as the page would, and opens a viewer on the Engine contract for
// the Agent's own profile, which it keeps for as long as the browser's socket is open.
//
// One socket carries both: binary frames are the Screen's raw RFB stream, both ways; text frames are gtmworks's own,
// one JSON object each. From gtmworks: {control:'agent'|'mine'|'other',by?} whenever who controls the Screen changes,
// {stream:'open'} before the first frame of a stream and {stream:'closed'} when it stops, {refused:'held'|'notAllowed'|
// 'failed',by?} for a take that did not happen, and {given:true} for a give-back done. From the browser: {take:true} and
// {giveBack:true}. While another person holds control nobody else is streamed the Screen, since it may show what they
// type: their stream is closed and opens again once control is given back.
//
// Watching is for any Member who is shown the Agent (company_app_agents lists only those). Taking control is for one who
// is not a Viewer: check_screen_control asks the database before the Engine is asked, and answers the person's name,
// which everyone else watching is shown. Taking control and giving it back are one Company log row each. Control is given
// back on "Done", and whenever the browser's socket closes: the view closed, the page left, or the connection lost, which
// the heartbeat finds when a ping goes unanswered. The Engine keeps a lease when its stream drops, so gtmworks gives it
// back itself; control that no open socket here holds (this server stopped while a person held it) is given back by force
// when the next person opens the Screen.
//
// The person is read once, from the session cookie the browser sent: its access token, which must still have a minute
// to run, is used as it is and never refreshed here, since a refresh would spend the browser's own refresh token.
// A socket refused for an expired token closes with 4401, and the page reads the Screen again (which refreshes it)
// before it opens another.
export const screenStreamPath='/api/display/ws';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const heartbeat=15000;
const textLimit=2000;
const closeCodes={signedOut:4401,notFound:4404,asleep:4001,unreachable:4503};

/** @type {Map<string,{holder:Session|null,sessions:Set<Session>}>} */
const screens=new Map();
/** @typedef {{send:(message:object)=>void,changed:()=>void,name:string}} Session */

/** @param {string} header */
async function accessToken(header) {
 const settings=supabaseSettings();
 const key=settings.cookieOptions?.name??`sb-${new URL(settings.url).hostname.split('.')[0]}-auth-token`;
 const jar=new Map(parseCookieHeader(header??'').map(({name,value})=>[name,value??'']));
 const raw=await combineChunks(key,name=>jar.get(name));
 if(!raw) return null;
 try {
  const session=JSON.parse(raw.startsWith('base64-')?stringFromBase64URL(raw.slice(7)):raw);
  if(typeof session?.access_token!=='string'||!(Number(session.expires_at)*1000>Date.now()+60000)) return null;
  return session.access_token;
 } catch { return null; }
}

// The person and the Agent a socket asks for (its query, as the web server read it), or why it is refused.
/** @param {import('node:http').IncomingMessage} request @param {URLSearchParams} query */
async function admit(request,query) {
 const company=query.get('company')??'', agent=query.get('agent')??'';
 if(!uuid.test(company)||!uuid.test(agent)) return {refused:400};
 // A page on another site may not open it: its Origin names another host than the one asked.
 const headers=new Headers(Object.entries(request.headers).flatMap(([name,value])=>typeof value==='string'?[[name,value]]:[]));
 if(crossSiteWrite(headers)) return {refused:403};
 const token=await accessToken(request.headers.cookie??'');
 if(!token) return {refused:closeCodes.signedOut};
 const settings=supabaseSettings();
 const db=createClient(settings.url,settings.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:{user}={user:null},error}=await db.auth.getUser(token);
 if(error||!user) return {refused:closeCodes.signedOut};
 if(!await permitted(db,'viewer',company,user.id)) return {refused:closeCodes.notFound};
 const {data:seen}=await db.rpc('company_app_agents',{c:company});
 const own=Array.isArray(seen)?seen.find(row=>row?.agent===agent&&typeof row.profile==='string'):null;
 if(!own) return {refused:closeCodes.notFound};
 return {db,company,agent,profile:own.profile};
}

/** @param {any} db @param {string} fn @param {{company:string,agent:string}} at */
async function logged(db,fn,at) {
 const {error}=await db.rpc(fn,{c:at.company,agent:at.agent});
 if(error) console.error(JSON.stringify({event:'screen_control_log_failed',fn,company:at.company,agent:at.agent,code:error.code??null}));
}

/** @param {import('ws').WebSocket} browser @param {{db:any,company:string,agent:string,profile:string}} at @param {{hermes?:any,engine?:typeof engineFor}} options */
async function serve(browser,at,{hermes,engine=engineFor}) {
 const send=message=>{ if(browser.readyState===browser.OPEN) browser.send(JSON.stringify(message)); };
 const connection=await (hermes===undefined?engineOf(at.company):hermes);
 if(!connection) { browser.close(closeCodes.unreachable,'no engine'); return; }
 const opened=await engine({...connection,profile:at.profile}).screenViewer?.();
 if(opened?.state!=='open') { browser.close(opened?.state==='asleep'?closeCodes.asleep:opened?.state==='missing'?closeCodes.notFound:closeCodes.unreachable,opened?.state??'unreachable'); return; }
 if(browser.readyState!==browser.OPEN) { await opened.viewer.close(); return; }
 const viewer=opened.viewer;
 const key=`${at.company}/${at.profile}`;
 const screen=screens.get(key)??{holder:null,sessions:new Set()}; screens.set(key,screen);
 let stream=null; let opening=false; let ended=false; let working=Promise.resolve();
 // One thing at a time: a take, a give-back or a change of holder waits for the one before.
 const serially=task=>{ working=working.then(task).catch(()=>{}); return working; };
 const stopStream=()=>{ const current=stream; stream=null; if(current) { try { current.close(); } catch { /* closed */ } send({stream:'closed'}); } };
 const startStream=async()=>{
  if(stream||opening||ended||(screen.holder&&screen.holder!==session)) return;
  opening=true;
  const socket=await viewer.stream().catch(()=>null);
  opening=false;
  if(!socket) { if(!ended) browser.close(closeCodes.asleep,'no stream'); return; }
  if(ended||(screen.holder&&screen.holder!==session)) { try { socket.close(); } catch { /* closed */ } return; }
  stream=socket;
  send({stream:'open'});
  socket.addEventListener('message',event=>{ if(stream===socket&&browser.readyState===browser.OPEN) browser.send(Buffer.from(event.data),{binary:true}); });
  // The Engine ended the stream (the Screen stopped): the socket ends with it, which gives back what it held.
  socket.addEventListener('close',()=>{ if(stream===socket) { stream=null; send({stream:'closed'}); browser.close(closeCodes.asleep,'screen stopped'); } });
 };
 const tell=()=>send(screen.holder===session?{control:'mine'}:screen.holder?{control:'other',by:screen.holder.name}:{control:'agent'});
 /** @type {Session} */
 const session={send,name:'',changed:()=>{ tell(); if(screen.holder&&screen.holder!==session) stopStream(); else void startStream(); }};
 const everyone=()=>{ for(const other of screen.sessions) other.changed(); };
 screen.sessions.add(session);

 const giveBack=async()=>{
  if(screen.holder!==session) return false;
  const given=await viewer.giveBack();
  if(given.state!=='given') return false;
  screen.holder=null;
  await logged(at.db,'log_screen_given_back',at);
  everyone();
  return true;
 };
 const take=async()=>{
  if(screen.holder===session) return send({control:'mine'});
  if(screen.holder) return send({refused:'held',by:screen.holder.name});
  const allowed=await at.db.rpc('check_screen_control',{c:at.company,agent:at.agent});
  if(allowed.error) return send({refused:allowed.error.code==='42501'?'notAllowed':'failed'});
  session.name=String(allowed.data??'');
  const taken=await viewer.take();
  if(taken.state==='held') return send({refused:'held'});
  if(taken.state!=='taken') return send({refused:'failed'});
  screen.holder=session;
  await logged(at.db,'log_screen_taken',at);
  everyone();
 };

 const end=()=>{
  if(ended) return; ended=true;
  clearInterval(beat);
  void serially(async()=>{
   await giveBack();
   screen.sessions.delete(session);
   if(!screen.sessions.size&&!screen.holder) screens.delete(key);
   stopStream();
   await viewer.close();
  });
 };
 browser.on('close',end);
 browser.on('error',end);
 let answered=true;
 browser.on('pong',()=>{ answered=true; });
 const beat=setInterval(()=>{ if(!answered) { browser.terminate(); return; } answered=false; browser.ping(); },heartbeat);
 browser.on('message',(data,binary)=>{
  if(binary) { if(stream) { try { stream.send(Buffer.isBuffer(data)?data:Buffer.concat(/** @type {Buffer[]} */(data))); } catch { /* closing */ } } return; }
  const text=String(data); if(text.length>textLimit) return;
  let message; try { message=JSON.parse(text); } catch { return; }
  if(message?.take===true) void serially(take);
  else if(message?.giveBack===true) void serially(async()=>{ if(await giveBack()) send({given:true}); });
 });

 // Control a person here left behind with no open socket (this server stopped while they held it) is given back first.
 await serially(async()=>{
  if(!screen.holder&&await viewer.control()==='other') await viewer.giveBack({force:true});
  session.changed();
 });
}

/** @param {{hermes?:any,engine?:typeof engineFor}} [options] */
export function screenStreams(options={}) {
 const sockets=new WebSocketServer({noServer:true,maxPayload:1024*1024});
 /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head @param {URLSearchParams} query */
 return async(request,socket,head,query)=>{
  socket.on('error',()=>{});
  let at;
  try { at=await admit(request,query); } catch { at={refused:closeCodes.unreachable}; }
  if('refused' in at&&at.refused<1000) { socket.end(`HTTP/1.1 ${at.refused} ${at.refused===403?'Forbidden':'Bad Request'}\r\nConnection: close\r\n\r\n`); return; }
  sockets.handleUpgrade(request,socket,head,browser=>{
   if('refused' in at) { browser.close(at.refused,'refused'); return; }
   serve(browser,at,options).catch(()=>browser.close(closeCodes.unreachable,'failed'));
  });
 };
}
