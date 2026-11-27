import { companyEngine, seenAgents } from './engine/handle.mjs';
import { columnOfStatus, statusOfColumn } from './board-columns.mjs';
import { tickTodo } from './card-description.mjs';

// A Card changed after it is made (spec #831, #837): its title, its description or one to-do of it, its column, the
// Cards it waits for, on the Company's Engine's own board; and its publishing date, which is about people and lives in
// gtmworks's row beside the Card (public.kanban_cards, ADR 0033).
//
// - Each change sends the Engine only its own field, so a rename never writes the description and the reverse. A title
//   or a description is changed only from what the person read (`was`): one another person or the Agent changed since
//   is not written over (stale), and a to-do is ticked on the Engine's description as it is now, its other lines as
//   they are.
// - A column asks the Engine for the status it means (lib/board-columns.mjs): Ideas `triage`, Planned `ready` (`todo`
//   while a Card it waits for is open, where the Engine keeps a waiting Card), Done `done`. In progress and Waiting on
//   you are the work's own: the Engine refuses `running` (400), and takes `blocked` or `review` only from a Card that is
//   ready or running, which would leave a Card waiting on no question and no work. gtmworks offers neither and says so.
//   A move the Engine refuses (a Card waiting for an open one is not done) leaves the Card where it was, with why.
// - After a change that can make a Card startable (into Planned with an Agent, into Done which frees the Cards waiting
//   for it, a Card it waited for taken away), the Engine's dispatcher is asked for a tick, so its Agent starts at once.
//
// `db` is the signed-in person's own session: the route has checked their Role (Owner, Manager or Contributor) before
// anything here reaches the Engine, and the row's policies check it again (ADR 0004). A Card of an Agent hidden from the
// reader is not theirs to change (missing), nor to wait for. No answer names a profile, the Engine's address or its key.

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const taskId=/^[A-Za-z0-9_-]{1,64}$/;
const titleLimit=500;
const descriptionLimit=20000;

/** @typedef {{title:unknown,was:unknown}|{description:unknown,was:unknown}|{tick:unknown}|{column:unknown}|{waitFor:unknown}|{stopWaitingFor:unknown}|{publishOn:unknown}} CardChange */
/** @typedef {{state:'changed'}|{state:'refused',why:'progress'|'waiting'|'waits'|'link'|'engine'}|{state:'invalid'|'stale'|'missing'|'noEngine'|'unreachable'|'failed'|'notKept'}} ChangeAnswer */

/** A publishing date as a day (YYYY-MM-DD) that is on the calendar, null for none; undefined for anything else. @param {unknown} value */
function publishDateOf(value) {
 if(value===''||value===null) return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
 const day=new Date(`${value}T00:00:00Z`);
 return Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==value?undefined:value;
}

/**
 * One change to one Card on the board.
 * @param {any} db the reader's own session @param {{company:string,person:string,card:unknown,change:CardChange}} target
 * @returns {Promise<ChangeAnswer>}
 */
export async function changeCompanyCard(db,{company,person,card,change}) {
 if(!uuid.test(company)||typeof card!=='string'||!taskId.test(card)||!change||typeof change!=='object') return {state:'invalid'};
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 const seenProfiles=new Set(seen.map(row=>row.profile));
 // A Card as the reader may reach it: on the Engine, and not given to an Agent of the Company hidden from them.
 const reach=async(/** @type {string} */ id)=>{
  const read=await engine.board.task(id);
  if(read.state!=='found') return read.state==='missing'||read.state==='invalid'?'missing':'unreachable';
  const task=read.card;
  return task.status==='archived'||task.assignee&&engine.profiles.includes(task.assignee)&&!seenProfiles.has(task.assignee)?'missing':task;
 };
 const task=await reach(card);
 if(typeof task==='string') return {state:task};
 /** @param {Awaited<ReturnType<typeof engine.board.edit>>} edited @returns {ChangeAnswer} */
 const answer=edited=>edited.state==='edited'?{state:'changed'}:edited.state==='refused'?{state:'stale'}:edited.state==='invalid'?{state:'invalid'}:{state:edited.state};

 if('title' in change) {
  const title=typeof change.title==='string'?change.title.trim():'';
  if(!title||title.length>titleLimit||typeof change.was!=='string') return {state:'invalid'};
  if(task.title!==change.was.trim()) return {state:task.title===title?'changed':'stale'};
  return answer(await engine.board.edit({id:card,title}));
 }
 if('description' in change) {
  if(typeof change.description!=='string'||change.description.length>descriptionLimit||typeof change.was!=='string') return {state:'invalid'};
  if(task.body!==change.was) return {state:task.body===change.description?'changed':'stale'};
  return answer(await engine.board.edit({id:card,body:change.description}));
 }
 if('tick' in change) {
  const tick=/** @type {any} */(change.tick);
  if(!tick||!Number.isSafeInteger(tick.index)||tick.index<0||typeof tick.text!=='string'||typeof tick.done!=='boolean') return {state:'invalid'};
  const body=tickTodo(task.body,tick.index,tick.text,tick.done);
  if(body===null) return {state:'stale'};
  if(body===task.body) return {state:'changed'};
  return answer(await engine.board.edit({id:card,body}));
 }
 if('column' in change) {
  const to=change.column;
  if(to==='progress'||to==='waiting') return {state:'refused',why:to};
  if(to!=='ideas'&&to!=='planned'&&to!=='done') return {state:'invalid'};
  if(columnOfStatus(task.status)===to) return {state:'changed'};
  const waits=task.waitsFor.some(other=>other.status!=='done'&&other.status!=='archived');
  if(to==='done'&&waits) return {state:'refused',why:'waits'};
  const status=/** @type {string} */(statusOfColumn(to,waits));
  /** @param {Awaited<ReturnType<typeof engine.board.edit>>} moved @returns {ChangeAnswer|null} */
  const refusedBy=moved=>moved.state==='edited'?null:moved.state==='refused'?{state:'refused',why:/parent/i.test(moved.detail)?'waits':'engine'}
   :{state:moved.state==='invalid'?'invalid':moved.state};
  // The Engine completes only a ready, running, blocked or review Card, and one not in review only with a line of
  // evidence (complete_task): an Idea or a waiting Card is made ready first, and the line names the person who moved it.
  if(to==='done'&&(task.status==='triage'||task.status==='todo'||task.status==='scheduled')) {
   const readied=refusedBy(await engine.board.edit({id:card,status:'ready'}));
   if(readied) return readied;
  }
  const name=to==='done'?await nameOf(db,person):null;
  const refused=refusedBy(await engine.board.edit({id:card,status,...to==='done'?{summary:name?`Moved to Done by ${name}`:'Moved to Done on the board'}:{}}));
  if(refused) return refused;
  if(to==='done'||status==='ready'&&task.assignee) await engine.board.dispatch();
  return {state:'changed'};
 }
 if('waitFor' in change||'stopWaitingFor' in change) {
  const adding='waitFor' in change; const other=adding?change.waitFor:/** @type {any} */(change).stopWaitingFor;
  if(typeof other!=='string'||!taskId.test(other)||other===card) return {state:'invalid'};
  if(adding) {
   const parent=await reach(other);
   if(typeof parent==='string') return {state:parent};
   const linked=await engine.board.link({parent:other,child:card});
   return linked.state==='linked'?{state:'changed'}:linked.state==='refused'?{state:'refused',why:'link'}:{state:linked.state};
  }
  const unlinked=await engine.board.unlink({parent:other,child:card});
  if(unlinked.state!=='unlinked') return {state:unlinked.state};
  if(task.assignee) await engine.board.dispatch();
  return {state:'changed'};
 }
 if('publishOn' in change) {
  const day=publishDateOf(change.publishOn);
  if(day===undefined) return {state:'invalid'};
  return await keepDate(db,{company,task:card,day})?{state:'changed'}:{state:'notKept'};
 }
 return {state:'invalid'};
}

/** The signed-in person's name, which the line a Card done by hand carries; null when the database does not answer.
 * @param {any} db @param {string} person */
async function nameOf(db,person) {
 const {data,error}=await Promise.resolve().then(()=>db.from('people').select('name').eq('id',person).maybeSingle()).catch(failure=>({data:null,error:failure}));
 const name=typeof data?.name==='string'?data.name.trim().slice(0,200):'';
 return error||!name?null:name;
}

/** The row's publishing date for a Card: updated when it has a row, else made with it. @param {any} db @param {{company:string,task:string,day:string|null}} change @returns {Promise<boolean>} */
async function keepDate(db,{company,task,day}) {
 const {data,error}=await db.from('kanban_cards').update({publish_on:day}).eq('company_id',company).eq('task_id',task).select('task_id');
 if(error) return false;
 if(data?.length||!day) return true;
 const made=await db.from('kanban_cards').insert({company_id:company,task_id:task,publish_on:day});
 return !made.error||made.error.code==='23505'&&await keepDate(db,{company,task,day});
}
