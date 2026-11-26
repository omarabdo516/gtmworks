import { engineSocket, bodyLimit } from './transport.mjs';
import { reachable } from './wire.mjs';

// An Agent's Screen (#712): the pinned Engine's Bot Desktop of the profile, asked over the management listener's
// JSON-RPC socket (/api/ws, tui_gateway/ws.py), which takes the session token as `?token=` (web_server_chat.py) and
// ignores an Authorization header on the upgrade. Each call is one socket: the Engine's `gateway.ready` event first, then
// one request naming the profile and its one answer, and the socket is closed. No browser Origin is sent, and nothing of
// the socket, its address or its token ever leaves this file. A profile the Engine does not have is refused before the
// method runs (4064, ProfileUnavailableError); a display failure is 5300 with the Engine's English reason, which
// gtmworks never shows. A socket that cannot open (a refused token reads the same: the upgrade answers 401) is
// unreachable.
const screenSocket=connection=>engineSocket(connection,{path:'/api/ws',search:{token:connection.key}});
const screenRead=5000; const screenStartTime=40000;
const profileGone=4064;
/** @param {any} connection @param {string} method @param {number} timeout @returns {Promise<{result:any}|{error:{code:number,message:string}}|null>} */
function screenCall(connection,method,timeout) {
 if(!reachable(connection)) return Promise.resolve(null);
 return new Promise(resolve=>{
  let socket; let done=false;
  const finish=answer=>{ if(done) return; done=true; clearTimeout(timer); try { socket?.close(); } catch { /* already closed */ } resolve(answer); };
  const timer=setTimeout(()=>finish(null),timeout);
  try { socket=screenSocket(connection); } catch { finish(null); return; }
  let ready=false;
  socket.addEventListener('error',()=>finish(null));
  socket.addEventListener('close',()=>finish(null));
  socket.addEventListener('message',event=>{
   if(typeof event.data!=='string'||event.data.length>bodyLimit) return finish(null);
   let frame; try { frame=JSON.parse(event.data); } catch { return finish(null); }
   if(!ready) {
    if(frame?.method!=='event'||frame.params?.type!=='gateway.ready') return;
    ready=true;
    socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method,params:{profile:connection.profile}}));
    return;
   }
   if(frame?.id!==1) return;
   if(frame.error&&typeof frame.error==='object') return finish({error:{code:Number(frame.error.code),message:String(frame.error.message??'')}});
   finish(frame.result&&typeof frame.result==='object'?{result:frame.result}:null);
  });
 });
}
// A Screen's state from the Engine's DisplayStatus (tui_gateway/contracts/display.py): none where the Engine offers no
// Screen for the profile, awake while its desktop runs, asleep otherwise. The pinned Engine has no waking: a start in
// flight is gtmworks's own. Who controls it is the lease's holder: the Agent, or a person. A start would be refused
// (`missing`) while the sandbox lacks a program the desktop needs (`blocker` names them for a sandbox Screen).
/** @param {any} status */
function screenOf(status) {
 const control=status?.lease?.holder==='human'?'person':'agent';
 if(status?.supported===false) return {state:'none',control,refusal:null};
 const missing=status?.installed===false||Array.isArray(status?.missing)&&status.missing.length>0||typeof status?.blocker==='string'&&status.blocker!=='';
 if(status?.running===true) return {state:'awake',control,refusal:null};
 return {state:'asleep',control,refusal:missing?'missing':null};
}
/** @param {any} connection */
export async function readScreen(connection) {
 const answer=await screenCall(connection,'display.status',screenRead);
 if(!answer) return {state:'unreachable'};
 if('error' in answer) return {state:answer.error.code===profileGone?'missing':'unreachable'};
 return {state:'found',screen:screenOf(answer.result)};
}
// A start wakes the Screen and answers its state, awake; one the Engine refuses is notStarted with why: the sandbox
// lacks a program the desktop needs (missing), or it did not come up, which is what the pinned Engine answers while
// another profile's Screen holds the sandbox's one display (failed). The Engine's own words never leave this file.
/** @param {any} connection */
export async function wakeScreen(connection) {
 const answer=await screenCall(connection,'display.start',screenStartTime);
 if(!answer) return {state:'unreachable'};
 if('error' in answer) {
  if(answer.error.code===profileGone) return {state:'missing'};
  return {state:'notStarted',reason:/\bmissing\b|\bneeds\b|not installed/i.test(answer.error.message)?'missing':'failed'};
 }
 const screen=screenOf(answer.result);
 return screen.state==='awake'?{state:'awake',screen}:{state:'notStarted',reason:screen.refusal??'failed'};
}
// One picture of the Screen: the Engine's own grab (a JPEG or PNG data URL, at most 960 by 600), none while the Screen
// is asleep, and withheld while a person controls it, since it may show what they type (methods_display.py). Anything
// else the Engine sends is no picture (failed).
const pictureUrl=/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;
const pictureLimit=4*1024*1024;
/** @param {any} connection */
export async function readScreenPicture(connection) {
 const answer=await screenCall(connection,'display.thumbnail',screenRead);
 if(!answer) return {state:'unreachable'};
 if('error' in answer) return {state:answer.error.code===profileGone?'missing':'unreachable'};
 if(answer.result.suppressed) return {state:'withheld'};
 if(answer.result.data_url===null||answer.result.data_url===undefined) return {state:'asleep'};
 const picture=typeof answer.result.data_url==='string'&&answer.result.data_url.length<=pictureLimit?pictureUrl.exec(answer.result.data_url):null;
 if(!picture) return {state:'failed'};
 return {state:'found',type:picture[1],body:new Uint8Array(Buffer.from(picture[2],'base64'))};
}

// A viewer of an Agent's Screen (#713): one connection to the management listener's /api/ws, kept open while a person
// has the Screen's large view open, because the pinned Engine names a viewer per connection: display.observe mints its
// viewer id there (methods_display.py _mint_viewer_id), and display.lease.acquire and release take only an id that same
// connection minted. Each live stream spends one display.observe ticket (single-use, 30 s) on /api/display/ws
// (hermes_cli/web_routers/display.py), whose frames are raw RFB; the Engine lets keyboard and pointer messages through
// only from the viewer holding the lease. The Engine's lease is last writer wins, so a take is refused here while another
// viewer holds it. The lease shows its holder only as a hash of the viewer id, which this viewer matches against its own.
// The Engine keeps a lease when a stream merely drops: closing a viewer gives back what it holds, and control nobody
// holds any more (a viewer whose server went away) is given back by force. Nothing of the socket, the ticket or the id
// leaves this file.
const screenControlTime=10000; const ticketFresh=20000;
/** @param {any} connection @returns {Promise<{call:(method:string,params?:object)=>Promise<{result:any}|{error:{code:number,message:string}}|null>,close:()=>void,closed:()=>boolean}|null>} */
function screenSession(connection) {
 if(!reachable(connection)) return Promise.resolve(null);
 return new Promise(resolve=>{
  let socket; let open=false; let next=1; let ended=false;
  const pending=new Map();
  const end=()=>{ if(ended) return; ended=true; clearTimeout(timer); for(const settle of pending.values()) settle(null); pending.clear(); try { socket?.close(); } catch { /* already closed */ } if(!open) resolve(null); };
  const timer=setTimeout(end,screenRead);
  try { socket=screenSocket(connection); } catch { end(); return; }
  socket.addEventListener('error',end);
  socket.addEventListener('close',end);
  socket.addEventListener('message',event=>{
   if(typeof event.data!=='string'||event.data.length>bodyLimit) return;
   let frame; try { frame=JSON.parse(event.data); } catch { return; }
   if(!open) {
    if(frame?.method!=='event'||frame.params?.type!=='gateway.ready') return;
    open=true; clearTimeout(timer);
    resolve({
     call:(method,params={})=>new Promise(settle=>{
      if(ended) return settle(null);
      const id=next++;
      const wait=setTimeout(()=>{ pending.delete(id); settle(null); },screenControlTime);
      pending.set(id,answer=>{ clearTimeout(wait); settle(answer); });
      socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params:{profile:connection.profile,...params}}));
     }),
     close:end,closed:()=>ended,
    });
    return;
   }
   const settle=pending.get(frame?.id); if(!settle) return;
   pending.delete(frame.id);
   if(frame.error&&typeof frame.error==='object') return settle({error:{code:Number(frame.error.code),message:String(frame.error.message??'')}});
   settle(frame.result&&typeof frame.result==='object'?{result:frame.result}:null);
  });
 });
}
/** @param {string} viewer */
const viewerHashOf=async viewer=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(viewer))).toString('hex').slice(0,12);
/** @param {any} connection */
export async function openScreenViewer(connection) {
 const session=await screenSession(connection);
 if(!session) return {state:'unreachable'};
 const observed=await session.call('display.observe');
 if(!observed||'error' in observed) {
  session.close();
  if(observed?.error.code===profileGone) return {state:'missing'};
  if(observed&&'error' in observed) return {state:'asleep'};
  return {state:'unreachable'};
 }
 const viewer=String(observed.result.viewer_id??'');
 if(!viewer) { session.close(); return {state:'unreachable'}; }
 const hash=await viewerHashOf(viewer);
 // The first ticket comes with the viewer; it is spent only while it is fresh (the Engine's last 30 seconds).
 let ticket=typeof observed.result.ticket==='string'?{value:observed.result.ticket,at:Date.now()}:null;
 const streams=new Set();
 /** @param {any} lease */
 const holderOf=lease=>lease?.holder!=='human'?'agent':lease.viewer_hash===hash?'mine':'other';
 const control=async()=>{
  const status=await session.call('display.status');
  return status&&'result' in status?holderOf(status.result.lease):'gone';
 };
 const giveBack=async({force=false}={})=>{
  const answer=await session.call('display.lease.release',force?{force:true}:{viewer_id:viewer});
  return {state:answer&&'result' in answer&&(force||holderOf(answer.result.lease)!=='mine')?'given':'failed'};
 };
 return {state:'open',viewer:{
  control,
  take:async()=>{
   const now=await control();
   if(now==='other') return {state:'held'};
   if(now==='gone') return {state:'failed'};
   const answer=await session.call('display.lease.acquire',{viewer_id:viewer});
   return {state:answer&&'result' in answer&&holderOf(answer.result.lease)==='mine'?'taken':'failed'};
  },
  giveBack,
  // The live stream: an open WebSocket of raw RFB frames, or null when the Engine opens none.
  stream:async()=>{
   let spend=ticket&&Date.now()-ticket.at<ticketFresh?ticket.value:null; ticket=null;
   if(!spend) {
    const again=await session.call('display.observe',{viewer_id:viewer});
    spend=again&&'result' in again&&typeof again.result.ticket==='string'?again.result.ticket:null;
   }
   if(!spend) return null;
   return await new Promise(resolve=>{
    let socket; try { socket=engineSocket(connection,{path:'/api/display/ws',search:{display_ticket:spend},binary:true}); } catch { resolve(null); return; }
    const timer=setTimeout(()=>{ try { socket.close(); } catch { /* closed */ } resolve(null); },screenRead);
    socket.addEventListener('open',()=>{ clearTimeout(timer); streams.add(socket); socket.addEventListener('close',()=>streams.delete(socket)); resolve(socket); },{once:true});
    socket.addEventListener('error',()=>{ clearTimeout(timer); resolve(null); },{once:true});
   });
  },
  // Closing the viewer gives back the control it holds, then ends its streams and its connection.
  close:async()=>{
   if(session.closed()) return;
   if(await control()==='mine') await giveBack();
   for(const socket of streams) { try { socket.close(); } catch { /* closed */ } }
   session.close();
  },
 }};
}
