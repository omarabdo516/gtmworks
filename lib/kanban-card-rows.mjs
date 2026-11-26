import { companyEngine } from './engine/handle.mjs';
import { workerUpkeep } from './upkeep-schedule.mjs';

// The rows gtmworks keeps beside the Cards of a Company's Engine (spec #831, #836: public.kanban_cards): the Member who
// is a Card's Assignee, its publishing date, who made it. A Card is the Engine's task, and gtmworks keeps no copy of it,
// so a row whose task the Engine no longer holds is forgotten, by this slow check for drift (ADR 0031 item 4): one pass
// every five minutes, never on a page read. An archived Card is still the Engine's task and keeps its row. A Company whose
// Engine does not answer, or answers with something other than its board, forgets nothing, and is left alone a while
// (lib/upkeep-schedule.mjs). Kept in the worker's memory only; a restart checks at once.
const cardsMemory={drift:0};
const driftEvery=300000;

/** @param {any} db the worker's database @param {{memory?:{drift:number},health?:ReturnType<typeof import('./upkeep-schedule.mjs').upkeepSchedule>,now?:()=>number}} [options] */
export async function keepKanbanCards(db,{memory=cardsMemory,health=workerUpkeep,now=Date.now}={}) {
 const done={forgotten:0};
 if(memory.drift&&now()-memory.drift<driftEvery) return done;
 memory.drift=now();
 const {data:rows,error}=await db.rpc('kanban_card_tasks');
 if(error) throw new Error(error.message);
 for(const {company_id:company,tasks} of rows||[]) {
  const engine=await companyEngine(company);
  if(!engine||!health.ready(engine.address)) continue;
  const read=await engine.board.taskIds();
  if(read.state!=='found') { if(read.state==='unreachable') health.failed(engine.address); continue; }
  health.answered(engine.address);
  const gone=(tasks||[]).filter((/** @type {string} */ task)=>!read.ids.has(task));
  if(!gone.length) continue;
  const {data:forgotten,error:failed}=await db.rpc('forget_kanban_cards',{c:company,tasks:gone});
  if(failed) { console.error('Card rows not forgotten:',company,failed.message); continue; }
  done.forgotten+=Number(forgotten)||0;
 }
 return done;
}
