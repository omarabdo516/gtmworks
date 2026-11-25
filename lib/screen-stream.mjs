import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { combineChunks, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { supabaseSettings } from './supabase-settings.mjs';
import { engineOf } from './company-engine.mjs';
import { engineFor } from './engine.mjs';
import { permitted } from './route-permissions.mjs';
import { crossSiteWrite } from './app-origin.mjs';
import { uuid } from './company-apps.mjs';
import { screenLogged } from './agent-screen.mjs';

// The live stream of an Agent's Screen (#713, ADR 0029): the one WebSocket gtmworks carries itself, at
// /api/display/ws on its own address. The browser never reaches the Engine (ADR 0011): gtmworks's web server takes the
// upgrade (scripts/web-server.mjs), checks the person as the page would, and opens a viewer on the Engine contract for
// the Agent's own profile, which it keeps for as long as the browser's socket is open.
//
// One socket carries both: binary frames are the Screen's raw RFB stream, both ways; text frames are gtmworks's own,
// one JSON object each. From gtmworks: {control:'agent'|'mine'|'other',by?} whenever who controls the Screen changes,
// {stream:'open'} before the first frame of a stream and {stream:'closed'} when it stops, {refused:'held'|'notAllowed'|
// 'failed',by?} for a take that did not happen (or control taken away from a person made a Viewer), and {given:true}
// for a give-back done. From the browser: {take:true} and {giveBack:true}. While another person holds control nobody
// else is streamed the Screen, since it may show what they type: their stream is closed and opens again once control is
// given back.
//
// Watching is for any Member who is shown the Agent (company_app_agents lists only those). Taking control is for one who
// is not a Viewer: check_screen_control asks the database before the Engine is asked, and answers the person's name,
// which everyone else watching is shown. Taking control and giving it back are one Company log row each. Control is given
// back on "Done", and whenever the browser's socket closes: the view closed, the page left, or the connection lost, which
// the heartbeat finds when a ping goes unanswered. The Engine keeps a lease when its stream drops, so gtmworks gives it
// back itself; control that no open socket here holds (this server stopped while a person held it, or the Engine failed
// the give-back of a socket that closed) is given back by force when the next person opens the Screen or takes control.
//
// What the person may do is asked again on each take and every minute while the socket is open: one no longer shown the
// Agent is closed with 4404, and one who may no longer take control (made a Viewer) gives it back and keeps watching.
// The person is read from the session cookie the browser sent: its access token, which must still have a minute to run
// when the socket opens, is used as it is and never refreshed here, since a refresh would spend the browser's own refresh
// token. A socket refused for an expired token, or whose token runs out while it is open, closes with 4401, and the page
// reads the Screen again (which refreshes it) before it opens another.
export const screenStreamPath='/api/display/ws';
const heartbeat=15000;
const recheckEvery=60000;
const textLimit=2000;
const closeCodes={signedOut:4401,notFound:4404,asleep:4001,unreachable:4503};

/** @type {Map<string,{holder:Session|null,sessions:Set<Session>}>} */
const screens=new Map();
/** @typedef {{send:(message:object)=>void,changed:()=>void,name:string}} Session */
/** @typedef {{company:string,agent:string,profile:string}} Seat */
/** @typedef {{level:'control',name:string}|{level:'watch'|'none'|'signedOut'}|null} Access */
/** @typedef {{admit:(request:import('node:http').IncomingMessage,query:URLSearchParams)=>Promise<Seat|{refused:number}>,access:(at:any)=>Promise<Access>,logged:(at:any,row:'taken'|'givenBack')=>Promise<void>}} People */

/** @param {string} header */
async function sessionOf(header) {
 const settings=supabaseSettings();
 const key=settings.cookieOptions?.name??`sb-${new URL(settings.url).hostname.split('.')[0]}-auth-token`;
 const jar=new Map(parseCookieHeader(header??'').map(({name,value})=>[name,value??'']));
 const raw=await combineChunks(key,name=>jar.get(name));
 if(!raw) return null;
 try {
  const found=JSON.parse(raw.startsWith('base64-')?stringFromBase64URL(raw.slice(7)):raw);
  const expiresAt=Number(found?.expires_at)*1000;
  if(typeof found?.access_token!=='string'||!(expiresAt>Date.now()+60000)) return null;
  return {token:found.access_token,expiresAt};
 } catch { return null; }
}

// The person as the app knows them: the session cookie the browser sent, and their own database session.
/** @type {People} */
const signedInPeople={
 // The person and the Agent a socket asks for (its query, as the web server read it), or why it is refused.
 async admit(request,query) {
  const company=query.get('company')??'', agent=query.get('agent')??'';
  if(!uuid.test(company)||!uuid.test(agent)) return {refused:400};
  // A page on another site may not open it: its Origin names another host than the one asked.
  const headers=new Headers(Object.entries(request.headers).flatMap(([name,value])=>typeof value==='string'?[[name,value]]:[]));
  if(crossSiteWrite(headers)) return {refused:403};
  const signedIn=await sessionOf(request.headers.cookie??'');
  if(!signedIn) return {refused:closeCodes.signedOut};
  const settings=supabaseSettings();
  const db=createClient(settings.url,settings.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${signedIn.token}`}}});
  const {data:{user}={user:null},error}=await db.auth.getUser(signedIn.token);
  if(error||!user) return {refused:closeCodes.signedOut};
  if(!await permitted(db,'viewer',company,user.id)) return {refused:closeCodes.notFound};
  const {data:seen}=await db.rpc('company_app_agents',{c:company});
  const own=Array.isArray(seen)?seen.find(row=>row?.agent===agent&&typeof row.profile==='string'):null;
  if(!own) return {refused:closeCodes.notFound};
  return {db,expiresAt:signedIn.expiresAt,company,agent,profile:own.profile};
 },
 // What the person may do now: control (with their name), watch, none (no longer a Member shown the Agent on this
 // profile) or signedOut (their token ran out); null when the database did not answer, which changes nothing.
 async access(at) {
  if(Date.now()>=at.expiresAt) return {level:'signedOut'};
  const seen=await at.db.rpc('company_app_agents',{c:at.company});
  if(seen.error||!Array.isArray(seen.data)) return null;
  if(!seen.data.some(row=>row?.agent===at.agent&&row.profile===at.profile)) return {level:'none'};
  const allowed=await at.db.rpc('check_screen_control',{c:at.company,agent:at.agent});
  if(allowed.error) return allowed.error.code==='42501'?{level:'watch'}:null;
  return {level:'control',name:String(allowed.data??'')};
 },
 logged:(at,row)=>screenLogged(at.db,row==='taken'?'log_screen_taken':'log_screen_given_back',at.company,at.agent),
};

/** @param {import('ws').WebSocket} browser @param {any} at @param {{hermes?:any,engine?:typeof engineFor,people:People,recheck:number}} options */
async function serve(browser,at,{hermes,engine=engineFor,people,recheck}) {
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

 // Control this person holds goes back. "Done" (`always` false) keeps it when the Engine fails the release, so they can
 // ask again; a socket that is going, or a person who may no longer hold it, gives it back here whatever the Engine said:
 // a lease the Engine kept is then held by no socket here, and the next open or take gives it back by force.
 const giveBack=async(always=false)=>{
  if(screen.holder!==session) return false;
  const given=await viewer.giveBack().catch(()=>({state:'failed'}));
  if(given.state!=='given'&&!always) return false;
  screen.holder=null;
  await people.logged(at,'givenBack');
  everyone();
  return given.state==='given';
 };
 // What the person may do now; one who may no longer watch is closed, and the close gives back what they held.
 const asked=async()=>{
  const may=await people.access(at).catch(()=>null);
  if(may?.level==='none') browser.close(closeCodes.notFound,'not shown');
  else if(may?.level==='signedOut') browser.close(closeCodes.signedOut,'signed out');
  else return may;
  return 'closed';
 };
 const take=async()=>{
  if(screen.holder===session) return send({control:'mine'});
  if(screen.holder) return send({refused:'held',by:screen.holder.name});
  const may=await asked();
  if(may==='closed') return;
  if(may?.level!=='control') return send({refused:may?.level==='watch'?'notAllowed':'failed'});
  session.name=may.name;
  let taken=await viewer.take();
  // The Engine says another viewer holds it, but no socket here does: control left behind is given back by force.
  if(taken.state==='held'&&!screen.holder&&(await viewer.giveBack({force:true})).state==='given') taken=await viewer.take();
  if(taken.state==='held') return send({refused:'held'});
  if(taken.state!=='taken') return send({refused:'failed'});
  screen.holder=session;
  await people.logged(at,'taken');
  everyone();
 };
 // Every minute: one no longer shown the Agent is closed, and one who may no longer take control gives it back.
 const check=async()=>{
  if(ended) return;
  const may=await asked();
  if(may&&may!=='closed'&&may.level!=='control'&&screen.holder===session) { await giveBack(true); send({refused:'notAllowed'}); }
 };

 const end=()=>{
  if(ended) return; ended=true;
  clearInterval(beat); clearInterval(rechecking);
  void serially(async()=>{
   await giveBack(true);
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
 const rechecking=setInterval(()=>void serially(check),recheck);
 browser.on('message',(data,binary)=>{
  if(binary) { if(stream) { try { stream.send(Buffer.isBuffer(data)?data:Buffer.concat(/** @type {Buffer[]} */(data))); } catch { /* closing */ } } return; }
  const text=String(data); if(text.length>textLimit) return;
  let message; try { message=JSON.parse(text); } catch { return; }
  if(message?.take===true) void serially(take);
  else if(message?.giveBack===true) void serially(async()=>{ if(await giveBack()) send({given:true}); });
 });

 // Control no open socket here holds (this server stopped while a person held it) is given back first.
 await serially(async()=>{
  if(!screen.holder&&await viewer.control()==='other') await viewer.giveBack({force:true});
  session.changed();
 });
}

/** @param {{hermes?:any,engine?:typeof engineFor,people?:People,recheck?:number}} [options] */
export function screenStreams({people=signedInPeople,recheck=recheckEvery,...options}={}) {
 const sockets=new WebSocketServer({noServer:true,maxPayload:1024*1024});
 /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head @param {URLSearchParams} query */
 return async(request,socket,head,query)=>{
  socket.on('error',()=>{});
  /** @type {any} */
  let at;
  try { at=await people.admit(request,query); } catch { at={refused:closeCodes.unreachable}; }
  if('refused' in at&&at.refused<1000) { socket.end(`HTTP/1.1 ${at.refused} ${at.refused===403?'Forbidden':'Bad Request'}\r\nConnection: close\r\n\r\n`); return; }
  sockets.handleUpgrade(request,socket,head,browser=>{
   if('refused' in at) { browser.close(at.refused,'refused'); return; }
   serve(browser,at,{...options,people,recheck}).catch(()=>browser.close(closeCodes.unreachable,'failed'));
  });
 };
}

// The web server's upgrades: the Screen's stream is taken here. In development every other upgrade (the hot reload) is
// Next's, which attaches its own handler; in production nothing else upgrades, so any other is ended.
/** @param {{dev:boolean,screen:(request:import('node:http').IncomingMessage,socket:import('node:stream').Duplex,head:Buffer,query:URLSearchParams)=>unknown}} options */
export function screenUpgrades({dev,screen}) {
 /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head */
 return (request,socket,head)=>{
  const asked=new URL(request.url??'/','http://gtmworks');
  if(asked.pathname===screenStreamPath) void screen(request,socket,head,asked.searchParams);
  else if(!dev) socket.destroy();
 };
}
