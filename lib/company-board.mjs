import { companyEngine, seenAgents } from './engine/handle.mjs';
import { cardSymbol, columnOfStatus, orderCards, waitsOn, waitsOnReader } from './board-columns.mjs';

// The board a Member reads (spec #831, #834): the Company's Engine's own Kanban board, read through the Engine handle as
// the reader may see it, and made into what the board draws. gtmworks keeps none of it (ADR 0033): every read asks the
// Engine, and the browser keeps the last good read (ADR 0030).
//
// `db` is the signed-in person's own session. The Company's Engine is found for a Member only, with every Engine profile
// of the Company (company_engine_target), and the Agents they see with the profile each runs on (company_app_agents). A
// Card given to a profile of the Company whose Agent is hidden from the reader is not on their board, as an Agent hidden
// from them is missing everywhere (ADR 0031); one given to a profile that is no Agent of the Company's (the Engine's
// own) shows no Agent. No answer names a profile, the Engine's address or its key.

/** @typedef {import('./board-columns.mjs').CardColumn} CardColumn */
// A Card's Project is the Engine's `tenant`, a name, and its publishing date (a day, YYYY-MM-DD) is in gtmworks's row
// beside it (#845): the list sorts and filters by them, and the calendar places a Card on its day.
// Whom a Card waits on (#841): a Member by name (`person`), or every Administrator and Manager (`person` null), and
// whether that is the reader (`mine`); null when it waits on no one. Worked out on each read, never kept.
/** @typedef {{mine:boolean,person:{id:string,name:string}|null}} CardWaits */
/** @typedef {{id:string,title:string,column:CardColumn,symbol:import('./board-columns.mjs').CardSymbol|null,agent:{id:string,name:string}|null,person:{id:string,name:string}|null,waits:CardWaits|null,comments:number,createdAt:number|null,project:string|null,publishOn:string|null}} BoardCard */

/**
 * `me` is the reader, whom the answer says each Card does or does not wait on, and whose Role shows a Card with no
 * Agent (shownWithoutAgent; null: a read for no one, which says no Card waits on the reader and shows no such
 * Card).
 * @param {any} db the reader's own session @param {{company:string,me:string|null}} target
 * @returns {Promise<{state:'found',cards:BoardCard[],main:{id:string,name:string}|null}|{state:'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function readCompanyBoard(db,{company,me}) {
 const [engine,seen,rows,people]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company),cardRows(db,company),activeMembers(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen||!rows||!people) return {state:'failed'};
 const reader={me:me??'',role:me?people.get(me)?.role:null};
 const ids=new Set(people.keys());
 const read=await engine.board.read();
 if(read.state!=='found') return {state:read.state};
 const companyProfiles=new Set(engine.profiles);
 /** @type {Map<string,{id:string,name:string}>} */
 const byProfile=new Map();
 for(const row of seen) if(typeof row.profile==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??'')});
 const loose=await shownWithoutAgent(engine,{cards:read.cards,rows,role:reader.role,seen:new Set(byProfile.keys())});
 /** @type {BoardCard[]} */
 const cards=[];
 for(const card of read.cards) {
  const column=columnOfStatus(card.status);
  const agent=card.assignee?byProfile.get(card.assignee)??null:null;
  if(!column||card.assignee&&!agent&&companyProfiles.has(card.assignee)||!card.assignee&&!loose.has(card.id)) continue;
  // A Card has at most one Assignee: a Card with an Agent on the Engine is the Agent's, whatever its row says (#836).
  const row=rows.get(card.id);
  const person=card.assignee?null:row?.person??null;
  const waits=waitsOn({status:card.status,person:person?.id??null,maker:row?.maker??null},ids);
  const on=waits&&'person' in waits?waits.person:null;
  cards.push({id:card.id,title:card.title,column,symbol:cardSymbol(card),agent,person,
   waits:waits&&{mine:waitsOnReader(waits,reader),person:on?{id:on,name:people.get(on)?.name??''}:null},comments:card.comments,createdAt:card.createdAt,project:card.tenant,publishOn:row?.publishOn??null});
 }
 // The Company's main Agent, whom an empty board names (design-reference-card: .board-bare).
 const main=seen.find(row=>row.main===true);
 return {state:'found',cards:orderCards(cards),main:main?{id:main.agent,name:String(main.name??'')}:null};
}

// A Card with no Agent fails closed (#842, Omar 2026-11-27): gtmworks cannot tell an Agent hidden from the reader by the
// Card's assignee, as there is none, for instance while a restore holds it with no Agent so nothing starts it
// (lib/engine/board.mjs restoreCard), or after a restore the Engine refused part way. An Administrator sees every such
// Card. Anyone else sees one only when gtmworks's own row is beside it (a Card the board made, or one given to a Member
// or a date), and, when the reader does not see every Agent of the Company, the Card was never one of an Agent hidden
// from them: it is not given to a Member, and the Engine's own record of it (whom it was given to when made and on each
// change, and the profile of each Run) names no such Agent. A row alone is no leave: the board makes one for a Card it
// gives an Agent too. A Card the Engine does not answer for is not shown. The board and the archived list read this one
// rule.
/**
 * The ids of the Cards among `cards` that have no Agent and that the reader may see.
 * @param {{profiles:string[],board:{task:(id:string)=>Promise<{state:string,card:any}>}}} engine
 * @param {{cards:{id:string,assignee:string|null}[],rows:Map<string,{person:unknown}>,role:string|null|undefined,seen:Set<string>}} reader
 * @returns {Promise<Set<string>>}
 */
export async function shownWithoutAgent(engine,{cards,rows,role,seen}) {
 const loose=cards.filter(card=>!card.assignee);
 if(role==='owner') return new Set(loose.map(card=>card.id));
 const hidden=new Set(engine.profiles.filter(profile=>!seen.has(profile)));
 const shown=new Set(); const asked=[];
 for(const card of loose) {
  const row=rows.get(card.id);
  if(!row) continue;
  if(!hidden.size||row.person) shown.add(card.id); else asked.push(card.id);
 }
 // A few at a time, so a long board does not open a request for each of its Cards at once.
 for(let at=0;at<asked.length;at+=8) await Promise.all(asked.slice(at,at+8).map(async id=>{
  const read=await engine.board.task(id);
  if(read.state!=='found') return;
  const had=[...read.card.events.map((/** @type {{assignee?:string|null}} */ event)=>event.assignee),...read.card.runs.map((/** @type {{profile:string|null}} */ run)=>run.profile)];
  if(!had.some(profile=>typeof profile==='string'&&hidden.has(profile))) shown.add(id);
 }));
 return shown;
}

/** The Company's active Members by id, with their Role and name (#841): whom a Card may wait on, the reader among them;
 * null when the database does not answer. @param {any} db @param {string} company
 * @returns {Promise<Map<string,{role:string,name:string}>|null>} */
export async function activeMembers(db,company) {
 const {data,error}=await Promise.resolve().then(()=>db.from('members').select('person_id,role,people(name)').eq('company_id',company).is('removed_at',null))
  .catch(failure=>({data:null,error:failure}));
 if(error||!Array.isArray(data)) return null;
 return new Map(data.map((/** @type {any} */ row)=>[String(row.person_id),{role:String(row.role),name:String(row.people?.name??'')}]));
}

/** What gtmworks keeps beside each Card of the Company, by its task id (#836, #845): the Member it is given to, its
 * publishing date and the person who made it; null when the database does not answer. A former Member keeps their name.
 * @param {any} db @param {string} company
 * @returns {Promise<Map<string,{person:{id:string,name:string}|null,publishOn:string|null,maker:string|null}>|null>} */
export async function cardRows(db,company) {
 const {data,error}=await Promise.resolve().then(()=>db.from('kanban_cards').select('task_id,assignee,publish_on,made_by,people!kanban_cards_assignee_fkey(name)').eq('company_id',company))
  .catch(failure=>({data:null,error:failure}));
 if(error||!Array.isArray(data)) return null;
 return new Map(data.map((/** @type {any} */ row)=>[row.task_id,{person:row.assignee?{id:String(row.assignee),name:String(row.people?.name??'')}:null,maker:row.made_by?String(row.made_by):null,
  publishOn:typeof row.publish_on==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.publish_on)?row.publish_on:null}]));
}
