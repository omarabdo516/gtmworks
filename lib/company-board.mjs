import { companyEngine, seenAgents } from './engine/handle.mjs';
import { cardSymbol, columnOfStatus, orderCards } from './board-columns.mjs';

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
/** @typedef {{id:string,title:string,column:CardColumn,symbol:import('./board-columns.mjs').CardSymbol|null,agent:{id:string,name:string}|null,comments:number,createdAt:number|null}} BoardCard */

/**
 * @param {any} db the reader's own session @param {{company:string}} target
 * @returns {Promise<{state:'found',cards:BoardCard[],main:{id:string,name:string}|null}|{state:'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function readCompanyBoard(db,{company}) {
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 const read=await engine.board.read();
 if(read.state!=='found') return {state:read.state};
 const companyProfiles=new Set(engine.profiles);
 /** @type {Map<string,{id:string,name:string}>} */
 const byProfile=new Map();
 for(const row of seen) if(typeof row.profile==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??'')});
 /** @type {BoardCard[]} */
 const cards=[];
 for(const card of read.cards) {
  const column=columnOfStatus(card.status);
  const agent=card.assignee?byProfile.get(card.assignee)??null:null;
  if(!column||card.assignee&&!agent&&companyProfiles.has(card.assignee)) continue;
  cards.push({id:card.id,title:card.title,column,symbol:cardSymbol(card),agent,comments:card.comments,createdAt:card.createdAt});
 }
 // The Company's main Agent, whom an empty board names (design-reference-card: .board-bare).
 const main=seen.find(row=>row.main===true);
 return {state:'found',cards:orderCards(cards),main:main?{id:main.agent,name:String(main.name??'')}:null};
}
