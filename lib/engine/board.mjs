import { withCause, engineSocket, bodyLimit } from './transport.mjs';
import { manage, reachable, refusal } from './wire.mjs';

// The Engine's own Kanban board (spec #831, ADR 0033 item 2): one board for each Company, the Engine's default board,
// read on its management listener under /api/plugins/kanban (docs/engine-probes/kanban-board.md). gtmworks keeps no copy
// of a Card: each read is the Engine's answer, made into the few fields the screens draw.
//
// GET /board (plugins/kanban/dashboard/plugin_api.py get_board) answers every Card that is not archived, grouped by its
// status in the workflow's order, each column already in the Engine's own order.

const statuses=new Set(['triage','todo','scheduled','ready','running','blocked','review','done']);
const taskId=/^[A-Za-z0-9_-]{1,64}$/;
const profileName=/^[A-Za-z0-9_-]{1,64}$/;
const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
const epoch=value=>Number.isFinite(value)?value:null;
const text=value=>typeof value==='string'?value:'';

/** @typedef {{id:string,title:string,status:string,assignee:string|null,tenant:string|null,createdAt:number|null,completedAt:number|null,failures:number,parents:number,comments:number}} EngineCard */

/** One task of the board's answer, or null for one that is not a Card gtmworks can draw. @param {any} task @returns {EngineCard|null} */
function cardOf(task) {
 if(!task||typeof task!=='object'||typeof task.id!=='string'||!taskId.test(task.id)||!statuses.has(task.status)) return null;
 return {id:task.id,title:text(task.title),status:task.status,
  assignee:typeof task.assignee==='string'&&profileName.test(task.assignee)?task.assignee:null,
  tenant:typeof task.tenant==='string'&&task.tenant.trim()?task.tenant:null,
  createdAt:epoch(task.created_at),completedAt:epoch(task.completed_at),failures:count(task.consecutive_failures),
  parents:count(task.link_counts?.parents),comments:count(task.comment_count)};
}

/**
 * The Company's board: its Cards in the Engine's order, or why it could not be read.
 * @param {{address:string,key:string,managementAddress?:string}} connection the Engine's record: the board is the
 *  Engine's, not one profile's
 * @returns {Promise<{state:'found',cards:EngineCard[]}|{state:'refused'|'unreachable'|'failed',cards:null}>}
 */
export async function readBoard(connection) {
 if(!reachable(connection)) return {state:'unreachable',cards:null};
 try {
  const {response,result}=await manage(connection,'/api/plugins/kanban/board');
  if(!response.ok) return {state:refusal(response),cards:null};
  if(!result||typeof result!=='object'||!Array.isArray(result.columns)) return {state:'failed',cards:null};
  const cards=result.columns.flatMap(column=>Array.isArray(column?.tasks)?column.tasks:[]).map(cardOf).filter(card=>card!==null);
  return {state:'found',cards:[...new Map(cards.map(card=>[card.id,card])).values()]};
 } catch(error) { return withCause({state:'unreachable',cards:null},error); }
}

// The board's event stream (#840; plugin_api.py stream_events): a WebSocket on the management listener at
// /api/plugins/kanban/events, opened with a one-use ticket of 30 seconds (POST /api/auth/ws-ticket, minted with the
// Engine's key), so the key is never in the socket's address. With no `since` it starts at the board's tail, and every
// 300 ms sends the board's new task_events rows, at most 200, as {events, cursor}. Each event names its task; what
// leaves this file is only the ids of the Cards that changed, never a payload, the ticket or the address.
const followOpen=5000;
/**
 * Follows the board: `changed` is called with the ids of the Cards each frame of the stream names, and `ended` once,
 * when the stream ends after it opened. Answers the open stream (close it with `close`), or null when it does not open.
 * @param {{address:string,key:string,managementAddress?:string}} connection
 * @param {{changed:(cards:string[])=>void,ended:()=>void}} listener
 * @returns {Promise<{close:()=>void}|null>}
 */
export async function followBoard(connection,{changed,ended}) {
 if(!reachable(connection)) return null;
 let ticket;
 try {
  const {response,result}=await manage(connection,'/api/auth/ws-ticket',{method:'POST',timeout:followOpen});
  ticket=response.ok&&typeof result?.ticket==='string'&&result.ticket?result.ticket:null;
 } catch { ticket=null; }
 if(!ticket) return null;
 return new Promise(resolve=>{
  let socket; let open=false; let over=false;
  const end=()=>{ if(over) return; over=true; clearTimeout(timer); try { socket?.close(); } catch { /* closed */ } if(open) ended(); else resolve(null); };
  const timer=setTimeout(end,followOpen);
  try { socket=engineSocket(connection,{path:'/api/plugins/kanban/events',search:{ticket}}); } catch { end(); return; }
  socket.addEventListener('open',()=>{ if(over) return; open=true; clearTimeout(timer); resolve({close:()=>{ if(over) return; over=true; try { socket.close(); } catch { /* closed */ } }}); },{once:true});
  socket.addEventListener('error',end);
  socket.addEventListener('close',end);
  socket.addEventListener('message',event=>{
   if(over||typeof event.data!=='string'||event.data.length>bodyLimit) return;
   let frame; try { frame=JSON.parse(event.data); } catch { return; }
   const cards=Array.isArray(frame?.events)?[...new Set(frame.events.map(row=>row?.task_id).filter(id=>typeof id==='string'&&taskId.test(id)))]:[];
   if(cards.length) changed(cards);
  });
 });
}
