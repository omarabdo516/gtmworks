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
