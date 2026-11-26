import { WebSocketServer } from 'ws';
import { companyEngine, seenAgents } from './engine/handle.mjs';
import { permitted } from './route-permissions.mjs';
import { socketPerson } from './socket-person.mjs';
import { uuid } from './company-apps.mjs';
import { screenLogged } from './agent-screen.mjs';

// The live stream of an Agent's Screen (#713, ADR 0029): a WebSocket gtmworks carries itself, at /api/display/ws on its
// own address (beside the board's live changes, lib/board-stream.mjs). The browser never reaches the Engine (ADR 0011): gtmworks's web server takes the
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
// Control is the person's, not their socket's (#752): a page whose connection drops opens a new socket within seconds,
// while the heartbeat finds the old one dead only up to half a minute later. A page that held control when its socket
// dropped says so on the next one (`resume=1`), which is handed control another socket of the same person still holds,
// with no log row since nobody else took it; the older socket then watches as anyone else would. A take on any socket of
// the person moves it the same way; a new view, in another tab, takes nothing on arrival.
//
// What the person may do is asked again on each take and every minute while the socket is open: one no longer shown the
// Agent is closed with 4404, and one who may no longer take control (made a Viewer) gives it back and keeps watching.
// The person is read from the session cookie the browser sent (lib/socket-person.mjs): its access token, which must still
// have a minute to run when the socket opens, is used as it is and never refreshed here, since a refresh would spend the
// browser's own refresh token. A socket refused for an expired token, or whose token runs out while it is open, closes with 4401, and the page
// reads the Screen again (which refreshes it) before it opens another.
export const screenStreamPath='/api/display/ws';
const heartbeat=15000;
const recheckEvery=60000;
const textLimit=2000;
const closeCodes={signedOut:4401,notFound:4404,asleep:4001,unreachable:4503};

/** @type {Map<string,{holder:Session|null,sessions:Set<Session>}>} */
const screens=new Map();
/** @typedef {{send:(message:object)=>void,changed:()=>void,name:string,person:string,viewer:{giveBack:()=>Promise<{state:string}>}}} Session */
/** @typedef {{company:string,agent:string,profile:string,person:string}} Seat */
/** @typedef {{level:'control',name:string}|{level:'watch'|'none'|'signedOut'}|null} Access */
/** @typedef {{admit:(request:import('node:http').IncomingMessage,query:URLSearchParams)=>Promise<Seat|{refused:number}>,access:(at:any)=>Promise<Access>,logged:(at:any,row:'taken'|'givenBack')=>Promise<void>}} People */

// The person as the app knows them: the session cookie the browser sent, and their own database session.
/** @type {People} */
const signedInPeople={
 // The person and the Agent a socket asks for (its query, as the web server read it), or why it is refused.
 async admit(request,query) {
  const company=query.get('company')??'', agent=query.get('agent')??'';
  if(!uuid.test(company)||!uuid.test(agent)) return {refused:400};
  const signedIn=await socketPerson(request);
  if('refused' in signedIn) return signedIn;
  const {db,person}=signedIn;
  if(!await permitted(db,'viewer',company,person)) return {refused:closeCodes.notFound};
  const seen=await seenAgents(db,company);
  const own=seen?.find(row=>row.agent===agent&&typeof row.profile==='string')??null;
  if(!own) return {refused:closeCodes.notFound};
  return {db,expiresAt:signedIn.expiresAt,company,agent,profile:own.profile,person};
 },
 // What the person may do now: control (with their name), watch, none (no longer a Member shown the Agent on this
 // profile) or signedOut (their token ran out); null when the database did not answer, which changes nothing.
 async access(at) {
  if(Date.now()>=at.expiresAt) return {level:'signedOut'};
  const seen=await seenAgents(at.db,at.company);
  if(!seen) return null;
  if(!seen.some(row=>row.agent===at.agent&&row.profile===at.profile)) return {level:'none'};
  const allowed=await at.db.rpc('check_screen_control',{c:at.company,agent:at.agent});
  if(allowed.error) return allowed.error.code==='42501'?{level:'watch'}:null;
  return {level:'control',name:String(allowed.data??'')};
 },
 logged:(at,row)=>screenLogged(at.db,row==='taken'?'log_screen_taken':'log_screen_given_back',at.company,at.agent),
};

/** @param {import('ws').WebSocket} browser @param {any} at @param {{people:People,recheck:number,resuming:boolean}} options */
async function serve(browser,at,{people,recheck,resuming}) {
 const send=message=>{ if(browser.readyState===browser.OPEN) browser.send(JSON.stringify(message)); };
 const engine=(await companyEngine(at.company))?.on(at.profile);
 if(!engine) { browser.close(closeCodes.unreachable,'no engine'); return; }
 const opened=await engine.screen.viewer();
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
 const session={send,name:'',person:at.person,viewer,changed:()=>{ tell(); if(screen.holder&&screen.holder!==session) stopStream(); else void startStream(); }};
 const everyone=()=>{ for(const other of screen.sessions) other.changed(); };
 screen.sessions.add(session);

 // Control this person holds goes back. "Done" (`always` false) keeps it when the Engine fails the release, so they can
 // ask again; a socket that is going, or a person who may no longer hold it, gives it back here whatever the Engine said:
 // a lease the Engine kept is then held by no socket here, and the next open or take gives it back by force.
 const giveBack=async(always=false)=>{
  if(screen.holder!==session) return false;
  const given=await viewer.giveBack().catch(()=>({state:'failed'}));
  // Moved meanwhile to another socket of this person, which holds it now.
  if(screen.holder!==session) return given.state==='given';
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
 // A take, or control this person holds on another socket moved to this one (`from`, which keeps no lease once asked).
 // On arrival (`arriving`) the move is not the person's own ask: a move that does not happen says nothing.
 const take=async(arriving=false)=>{
  const refuse=answer=>{ if(!arriving) send(answer); };
  if(screen.holder===session) return refuse({control:'mine'});
  const from=screen.holder;
  if(from&&from.person!==session.person) return refuse({refused:'held',by:from.name});
  const may=await asked();
  if(may==='closed') return;
  if(may?.level!=='control') return refuse({refused:may?.level==='watch'?'notAllowed':'failed'});
  if(screen.holder!==from) return screen.holder?refuse({refused:'held',by:screen.holder.name}):arriving?undefined:take();
  session.name=may.name;
  if(from) { screen.holder=session; await from.viewer.giveBack().catch(()=>null); }
  let taken=await viewer.take();
  // The Engine says another viewer holds it, but no other socket here does: a lease left behind, or the one this person's
  // other socket held, is given back by force.
  if(taken.state==='held'&&screen.holder===(from?session:null)&&(await viewer.giveBack({force:true})).state==='given') taken=await viewer.take();
  if(taken.state!=='taken') {
   if(from&&screen.holder===session) { screen.holder=null; await people.logged(at,'givenBack'); everyone(); }
   return refuse({refused:taken.state==='held'?'held':'failed'});
  }
  // Another of this person's sockets moved control to itself meanwhile: this lease is not the holder's, so it goes back.
  if(screen.holder&&screen.holder!==session) { await viewer.giveBack().catch(()=>null); return refuse({refused:'held',by:screen.holder.name}); }
  screen.holder=session;
  if(!from) await people.logged(at,'taken');
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
  if(message?.take===true) void serially(()=>take());
  else if(message?.giveBack===true) void serially(async()=>{ if(await giveBack()) send({given:true}); });
 });

 // Control no open socket here holds (this server stopped while a person held it) is given back first; control this
 // person holds on another socket comes to this one when its page held it as its last socket dropped.
 await serially(async()=>{
  if(!screen.holder&&await viewer.control()==='other') await viewer.giveBack({force:true});
  if(resuming&&screen.holder&&screen.holder.person===session.person) await take(true);
  if(screen.holder!==session) session.changed();
 });
}

/** @param {{people?:People,recheck?:number}} [options] */
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
   serve(browser,at,{...options,people,recheck,resuming:query.get('resume')==='1'}).catch(()=>browser.close(closeCodes.unreachable,'failed'));
  });
 };
}
