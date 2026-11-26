import { withCause } from './transport.mjs';
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
