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

const statusOrArchived=value=>statuses.has(value)||value==='archived'?value:null;
// The events of a Card a person reads in its Activity, by the Engine's kinds (hermes_cli/kanban_db*.py _append_event):
// what was made, given, started, asked, sent for review, sent back, finished, stopped, failed, archived, edited or
// linked. The dispatcher's own plumbing (a worker spawned or registered, a claim refused or deferred, a heartbeat gone
// stale, a workspace) is no step of the work and is left out.
const shownEvents=new Set(['created','assigned','claimed','completed','blocked','unblocked','commented','review_requested','changes_requested','review_reopened',
 'archived','reclaimed','crashed','timed_out','gave_up','promoted','promoted_manual','edited','reprioritized','linked','unlinked','attached','attachment_removed',
 'scheduled','decomposed','status']);
const author=value=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):'';

/** @typedef {{id:number,author:string,body:string,at:number|null}} EngineComment */
/** @typedef {{id:number,kind:string,at:number|null,run:number|null,assignee?:string|null,author?:string}} EngineEvent */
/** @typedef {{id:number,profile:string|null,status:string,outcome:string|null,summary:string|null,startedAt:number|null,endedAt:number|null}} EngineRun */
/** @typedef {{id:string,title:string,status:string}} EngineLink */
/** @typedef {Omit<EngineCard,'comments'>&{body:string,summary:string|null,createdBy:string|null,comments:EngineComment[],events:EngineEvent[],runs:EngineRun[],waitsFor:EngineLink[],waitedBy:EngineLink[]}} EngineCardDetail */

/** @param {any} list @returns {any[]} */
const listOf=list=>Array.isArray(list)?list.filter(item=>item&&typeof item==='object'):[];

/**
 * One Card whole (GET /tasks/{id}, plugins/kanban/dashboard/plugin_api.py get_task): the task with its full latest
 * summary, its comments, its events a person reads, its Runs, and the Cards it waits for and that wait for it. Only the
 * fields the Card window draws are kept: no workspace, lock, worker, attachment path or event payload beyond the
 * assignee an assignment names and a comment's author. An archived Card is read too (its status `archived`).
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {string} id
 * @returns {Promise<{state:'found',card:EngineCardDetail}|{state:'missing'|'invalid'|'refused'|'unreachable'|'failed',card:null}>}
 */
export async function readTask(connection,id) {
 if(typeof id!=='string'||!taskId.test(id)) return {state:'invalid',card:null};
 if(!reachable(connection)) return {state:'unreachable',card:null};
 try {
  const {response,result}=await manage(connection,`/api/plugins/kanban/tasks/${encodeURIComponent(id)}`);
  if(response.status===404) return {state:'missing',card:null};
  if(!response.ok) return {state:refusal(response),card:null};
  const task=result?.task;
  const card=task?.status==='archived'?cardOf({...task,status:'todo'}):cardOf(task);
  if(!card||card.id!==id) return {state:'failed',card:null};
  if(task.status==='archived') card.status='archived';
  const links=listOf(result.link_tasks).filter(other=>typeof other.id==='string'&&taskId.test(other.id))
   .map(other=>({id:other.id,title:text(other.title),status:statusOrArchived(other.status)??'todo'}));
  const linked=(/** @type {unknown} */ ids)=>Array.isArray(ids)?ids.filter(other=>typeof other==='string'&&taskId.test(other)).map(other=>links.find(found=>found.id===other)??{id:other,title:'',status:'todo'}):[];
  const comments=listOf(result.comments).map(comment=>({id:count(comment.id),author:author(comment.author),body:text(comment.body),at:epoch(comment.created_at)}));
  const events=listOf(result.events).filter(event=>shownEvents.has(event.kind)).map(event=>({id:count(event.id),kind:event.kind,at:epoch(event.created_at),
   run:Number.isSafeInteger(event.run_id)?event.run_id:null,
   ...event.kind==='assigned'?{assignee:typeof event.payload?.assignee==='string'&&profileName.test(event.payload.assignee)?event.payload.assignee:null}:{},
   ...event.kind==='commented'?{author:author(event.payload?.author)}:{}}));
  const runs=listOf(result.runs).filter(run=>Number.isSafeInteger(run.id)).map(run=>({id:run.id,
   profile:typeof run.profile==='string'&&profileName.test(run.profile)?run.profile:null,status:text(run.status),
   outcome:typeof run.outcome==='string'?run.outcome:null,summary:typeof run.summary==='string'&&run.summary.trim()?run.summary:null,
   startedAt:epoch(run.started_at),endedAt:epoch(run.ended_at)}));
  const parents=linked(result.links?.parents);
  return {state:'found',card:{...card,parents:parents.length,body:text(task.body),summary:typeof task.latest_summary==='string'&&task.latest_summary.trim()?task.latest_summary:null,
   createdBy:typeof task.created_by==='string'&&profileName.test(task.created_by)?task.created_by:null,
   comments,events,runs,waitsFor:parents,waitedBy:linked(result.links?.children)}};
 } catch(error) { return withCause({state:'unreachable',card:null},error); }
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

// A Card made, its Agent changed, and the dispatcher asked for a tick (#836; docs/engine-probes/kanban-board.md). A Card
// with an Agent is `ready`, and the dispatcher's own tick comes only every minute, so after a write that makes a Card
// startable gtmworks asks for one tick now. The Engine's delete is never called: a Card is archived, not deleted.

/**
 * Makes a Card on the Engine's default board, given to the profile `assignee` or to none. `key` makes a retried request
 * one Card: the Engine answers the Card it already made with that key (create_task's idempotency_key).
 * @param {{address:string,key:string,managementAddress?:string}} connection
 * @param {{title:string,body:string,assignee:string|null,key:string}} card
 * @returns {Promise<{state:'made',card:EngineCard}|{state:'invalid'|'refused'|'unreachable'|'failed',card:null}>}
 */
export async function makeCard(connection,{title,body,assignee,key}) {
 if(!reachable(connection)) return {state:'unreachable',card:null};
 try {
  const {response,result}=await manage(connection,'/api/plugins/kanban/tasks',{method:'POST',body:{title,body,...(assignee?{assignee}:{}),idempotency_key:key}});
  if(response.status===400||response.status===422) return {state:'invalid',card:null};
  if(!response.ok) return {state:refusal(response),card:null};
  const card=cardOf(result?.task);
  return card?{state:'made',card}:{state:'failed',card:null};
 } catch(error) { return withCause({state:'unreachable',card:null},error); }
}

/**
 * Gives the Card to the profile `assignee`, or to no Agent (null). A Card an Agent is working now does not change hands
 * (busy); one the Engine does not hold is missing.
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {{id:string,assignee:string|null}} change
 * @returns {Promise<{state:'assigned'|'busy'|'missing'|'refused'|'unreachable'}>}
 */
export async function assignCard(connection,{id,assignee}) {
 if(!reachable(connection)) return {state:'unreachable'};
 if(!taskId.test(id)) return {state:'missing'};
 try {
  const {response}=await manage(connection,`/api/plugins/kanban/tasks/${encodeURIComponent(id)}`,{method:'PATCH',body:{assignee:assignee??''},timeout:15000});
  if(response.status===404) return {state:'missing'};
  if(response.status===409) return {state:'busy'};
  return {state:response.ok?'assigned':refusal(response)};
 } catch(error) { return withCause({state:'unreachable'},error); }
}

/** Asks the Engine's dispatcher for one tick now (POST /dispatch), so a Card given to an Agent starts at once.
 * @param {{address:string,key:string,managementAddress?:string}} connection @returns {Promise<{state:'asked'|'refused'|'unreachable'}>} */
export async function dispatchNow(connection) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const {response}=await manage(connection,'/api/plugins/kanban/dispatch',{method:'POST'});
  return {state:response.ok?'asked':refusal(response)};
 } catch(error) { return withCause({state:'unreachable'},error); }
}

/**
 * The id of every task on the Engine's default board, archived ones included: the slow drift check keeps a row for each.
 * @param {{address:string,key:string,managementAddress?:string}} connection
 * @returns {Promise<{state:'found',ids:Set<string>}|{state:'refused'|'unreachable'|'failed',ids:null}>}
 */
export async function readTaskIds(connection) {
 if(!reachable(connection)) return {state:'unreachable',ids:null};
 try {
  const {response,result}=await manage(connection,'/api/plugins/kanban/board?include_archived=true',{timeout:15000});
  if(!response.ok) return {state:refusal(response),ids:null};
  if(!result||typeof result!=='object'||!Array.isArray(result.columns)) return {state:'failed',ids:null};
  const ids=result.columns.flatMap(column=>Array.isArray(column?.tasks)?column.tasks:[]).map(task=>task?.id).filter(id=>typeof id==='string');
  return {state:'found',ids:new Set(ids)};
 } catch(error) { return withCause({state:'unreachable',ids:null},error); }
}

// Talking to the work on a Card (#838; docs/engine-probes/kanban-board.md): a comment under the person's name, which
// gtmworks writes as its author because the Engine records no identity of its own; the Engine's own stop for the Card's
// open Run (reclaim, which ends the worker and its Run and puts the Card back where that Run started it); and a move of
// the Card to another status, which the Engine checks against where the Card is now.

/**
 * Adds a comment to the Card under `author` (POST /tasks/{id}/comments). An empty comment is invalid.
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {{id:string,author:string,body:string}} comment
 * @returns {Promise<{state:'commented'|'invalid'|'missing'|'refused'|'unreachable'}>}
 */
export async function commentTask(connection,{id,author,body}) {
 if(!reachable(connection)) return {state:'unreachable'};
 if(!taskId.test(id)) return {state:'missing'};
 try {
  const {response}=await manage(connection,`/api/plugins/kanban/tasks/${encodeURIComponent(id)}/comments`,{method:'POST',body:{body,author}});
  if(response.status===404) return {state:'missing'};
  if(response.status===400||response.status===422) return {state:'invalid'};
  return {state:response.ok?'commented':refusal(response)};
 } catch(error) { return withCause({state:'unreachable'},error); }
}

/**
 * Stops the Card's open Run (POST /tasks/{id}/reclaim): the Engine ends the worker and the Run, and puts the Card back to
 * `ready` (`review` for a reviewer's Run). A Card with no open Run is idle (409).
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {{id:string,reason:string}} stop
 * @returns {Promise<{state:'stopped'|'idle'|'missing'|'refused'|'unreachable'}>}
 */
export async function reclaimTask(connection,{id,reason}) {
 if(!reachable(connection)) return {state:'unreachable'};
 if(!taskId.test(id)) return {state:'missing'};
 try {
  const {response}=await manage(connection,`/api/plugins/kanban/tasks/${encodeURIComponent(id)}/reclaim`,{method:'POST',body:{reason},timeout:15000});
  if(response.status===404) return {state:'missing'};
  if(response.status===409) return {state:'idle'};
  return {state:response.ok?'stopped':refusal(response)};
 } catch(error) { return withCause({state:'unreachable'},error); }
}

/**
 * Moves the Card to `status` (PATCH /tasks/{id}): `ready` from `blocked` or `scheduled` lets it go on, `scheduled` parks it
 * where the dispatcher does not start it. A move the Card's state does not allow is a conflict (409).
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {{id:string,status:'ready'|'scheduled'}} move
 * @returns {Promise<{state:'moved'|'conflict'|'missing'|'refused'|'unreachable'}>}
 */
export async function moveTask(connection,{id,status}) {
 if(!reachable(connection)) return {state:'unreachable'};
 if(!taskId.test(id)) return {state:'missing'};
 try {
  const {response}=await manage(connection,`/api/plugins/kanban/tasks/${encodeURIComponent(id)}`,{method:'PATCH',body:{status},timeout:15000});
  if(response.status===404) return {state:'missing'};
  if(response.status===409||response.status===400) return {state:'conflict'};
  return {state:response.ok?'moved':refusal(response)};
 } catch(error) { return withCause({state:'unreachable'},error); }
}
