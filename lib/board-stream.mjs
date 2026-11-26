import { WebSocketServer } from 'ws';
import { companyEngine } from './engine/handle.mjs';
import { permission } from './route-permissions.mjs';
import { socketPerson, signedOut } from './socket-person.mjs';
import { uuid } from './company-apps.mjs';

// The board's live changes (#840, spec #831): an open board follows its Company's Engine's Kanban event stream, which
// gtmworks's own web server relays at /api/board/events as it carries the Screen's stream (ADR 0029). The browser never
// reaches the Engine (ADR 0011): the web server takes the upgrade (scripts/web-server.mjs, lib/web-upgrades.mjs), checks
// the person as the board's own read does (any Member, a Viewer included), and follows the Engine's stream through the
// Engine handle (lib/engine/board.mjs followBoard), one stream for every open board of the Company, kept while one is open.
//
// Every frame to the browser is gtmworks's own small JSON: {stream:'open'} once the Engine's stream is followed (and when
// it is followed again after a break), {stream:'down'} while it is not, and {changed:[card ids]} for each change the
// Engine reports. The browser reads the board, or its open Card, again through its own routes, which decide what the
// person sees of it; no frame holds an event's payload, a profile, the Engine's address, its ticket or its key.
//
// A stream of the Engine's that ends, or does not open, is followed again after a pause, longer each time, while a board
// of the Company is open; the boards meanwhile read again on their slow timer. A frame of the browser's is ignored.
//
// Whether the person is still a Member is asked again before a change is sent to them, at most once in `fresh`
// milliseconds, and every `recheck` milliseconds while no change comes: one whose membership ended is closed with 4404
// before the change reaches them, and one whose session ran out with 4401, after which the page reads the board again
// (which refreshes it) and opens another socket.
export const boardStreamPath='/api/board/events';
const closeCodes={signedOut,notFound:4404,unreachable:4503};
const heartbeat=15000;
const recheckEvery=60000;
const freshFor=2000;
const againAfter=[1000,2000,5000,10000,30000];

/** @typedef {{company:string,person:string,[field:string]:unknown}} Seat */
/** @typedef {'member'|'none'|'signedOut'|null} Standing */
/** @typedef {{admit:(request:import('node:http').IncomingMessage,query:URLSearchParams)=>Promise<Seat|{refused:number}>,access:(at:any)=>Promise<Standing>}} People */

/** @type {People} */
const signedInPeople={
 async admit(request,query) {
  const company=query.get('company')??'';
  if(!uuid.test(company)) return {refused:400};
  const signedIn=await socketPerson(request);
  if('refused' in signedIn) return signedIn;
  const may=await permission(signedIn.db,'viewer',company,signedIn.person);
  if(may!=='allowed') return {refused:may==='failed'?closeCodes.unreachable:closeCodes.notFound};
  return {...signedIn,company};
 },
 // Still a Member now (member), no longer (none), their token ran out (signedOut), or null when the database did not
 // answer, which changes nothing until the next check.
 async access(at) {
  if(Date.now()>=at.expiresAt) return 'signedOut';
  const may=await permission(at.db,'viewer',at.company,at.person);
  return may==='allowed'?'member':may==='refused'?'none':null;
 },
};

/** @typedef {{send:(message:object)=>void,changed:(cards:string[])=>void}} Board */

/** @param {{people?:People,fresh?:number,recheck?:number,again?:number[]}} [options] */
export function boardStreams({people=signedInPeople,fresh=freshFor,recheck=recheckEvery,again=againAfter}={}) {
 const sockets=new WebSocketServer({noServer:true,maxPayload:4096});
 /** @type {Map<string,{boards:Set<Board>,state:'opening'|'open'|'down',stream:{close:()=>void}|null,timer?:ReturnType<typeof setTimeout>,tries:number}>} */
 const relays=new Map();

 // The Company's one follow of its Engine's stream, opened by its first open board and ended with its last.
 /** @param {string} company @param {Board} board */
 const join=(company,board)=>{
  let relay=relays.get(company);
  if(relay) {
   relay.boards.add(board);
   if(relay.state!=='opening') board.send({stream:relay.state});
   return;
  }
  const own={boards:new Set([board]),state:/** @type {'opening'|'open'|'down'} */('opening'),stream:/** @type {{close:()=>void}|null} */(null),timer:undefined,tries:0};
  relays.set(company,own);
  const gone=()=>relays.get(company)!==own;
  const tell=(/** @type {'open'|'down'} */ state)=>{ if(own.state===state) return; own.state=state; for(const one of own.boards) one.send({stream:state}); };
  const later=()=>{ if(gone()) return; own.timer=setTimeout(follow,again[Math.min(own.tries++,again.length-1)]); };
  async function follow() {
   if(gone()) return;
   const engine=await companyEngine(company).catch(()=>null);
   const followed=engine?await engine.board.follow({
    changed:cards=>{ for(const one of own.boards) one.changed(cards); },
    ended:()=>{ if(own.stream!==followed) return; own.stream=null; tell('down'); later(); },
   }).catch(()=>null):null;
   if(gone()) { followed?.close(); return; }
   if(!followed) { tell('down'); later(); return; }
   own.stream=followed; own.tries=0; tell('open');
  }
  void follow();
 };
 /** @param {string} company @param {Board} board */
 const leave=(company,board)=>{
  const relay=relays.get(company); if(!relay) return;
  relay.boards.delete(board);
  if(relay.boards.size) return;
  relays.delete(company); clearTimeout(relay.timer); relay.stream?.close();
 };

 /** @param {import('ws').WebSocket} browser @param {Seat} at */
 const serve=(browser,at)=>{
  const send=(/** @type {object} */ message)=>{ if(browser.readyState===browser.OPEN) browser.send(JSON.stringify(message)); };
  let ended=false; let checkedAt=Date.now(); let working=Promise.resolve();
  // One thing at a time, in order: a change waits for the check before it.
  const serially=(/** @type {()=>Promise<void>} */ task)=>{ working=working.then(task).catch(()=>{}); };
  const check=async()=>{
   const standing=await people.access(at).catch(()=>null);
   if(standing==='none') browser.close(closeCodes.notFound,'not a member');
   else if(standing==='signedOut') browser.close(closeCodes.signedOut,'signed out');
   else if(standing==='member') checkedAt=Date.now();
   if(standing==='none'||standing==='signedOut') end();
  };
  /** @type {Board} */
  const board={send,changed:cards=>serially(async()=>{
   if(ended) return;
   if(Date.now()-checkedAt>=fresh) await check();
   if(!ended) send({changed:cards});
  })};
  const end=()=>{ if(ended) return; ended=true; clearInterval(beat); clearInterval(rechecking); leave(at.company,board); };
  browser.on('close',end);
  browser.on('error',end);
  let answered=true;
  browser.on('pong',()=>{ answered=true; });
  const beat=setInterval(()=>{ if(!answered) { browser.terminate(); return; } answered=false; browser.ping(); },heartbeat);
  const rechecking=setInterval(()=>serially(async()=>{ if(!ended&&Date.now()-checkedAt>=recheck) await check(); }),Math.min(recheck,heartbeat));
  join(at.company,board);
 };

 /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head @param {URLSearchParams} query */
 return async(request,socket,head,query)=>{
  socket.on('error',()=>{});
  /** @type {Seat|{refused:number}} */
  let at;
  try { at=await people.admit(request,query); } catch { at={refused:closeCodes.unreachable}; }
  if('refused' in at&&at.refused<1000) { socket.end(`HTTP/1.1 ${at.refused} ${at.refused===403?'Forbidden':'Bad Request'}\r\nConnection: close\r\n\r\n`); return; }
  sockets.handleUpgrade(request,socket,head,browser=>{
   if('refused' in at) { browser.close(at.refused,'refused'); return; }
   serve(browser,at);
  });
 };
}
