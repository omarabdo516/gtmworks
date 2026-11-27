import { companyEngine, seenAgents } from './engine/handle.mjs';
import { activeMembers, cardRows, readCompanyBoard, shownWithoutAgent } from './company-board.mjs';
import { searchFold } from './arabic-search.mjs';

// Archiving and restoring Cards on the board (spec #831, #842; design-reference-card: cwArchive, cwUndo, cwRestore, the
// board's archive icon). A Card is archived with the Engine's own archived status, never deleted, and gtmworks keeps no
// copy of it or of where it was: the Engine's events say that when it is restored (lib/engine/board.mjs).
//
// - Archiving takes the Cards on the reader's board as they read it now (lib/company-board.mjs): a Card that is gone
//   from it meanwhile, or of an Agent hidden from them, is left and named. An Agent working on a Card, or waiting on a
//   person's answer, is stopped only once the person confirmed (`stop`); until then the answer names each thing that
//   stops, and nothing is archived. The Engine stops the open Run in the archive itself.
// - Restoring puts each archived Card the reader may see back where it was, and asks the dispatcher for nothing, so no
//   Run starts from it (where each Card goes back is lib/engine/board.mjs restoreCard's). The Undo of an archive also
//   gives the work back to an Agent that was working on it when the archive stopped it (`undo`), as the reference's
//   Undo does.
// - The archived list is every archived Card the reader may see, newest made first, fifty at a time, searched by title
//   as the interface reads a search (lib/arabic-search.mjs).
//
// `db` is the signed-in person's own session and `me` that person: the route has checked their Role first (Owner, Manager
// or Contributor to archive or restore, any Member to read the list). A Card with no Agent is theirs to see by the board's
// one rule (lib/company-board.mjs shownWithoutAgent). No answer names a profile, the Engine's address or its key.

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const taskId=/^[A-Za-z0-9_-]{1,64}$/;
const most=200;
const archivedPage=50;

/** The Cards a request names: one to two hundred distinct task ids, or null. @param {unknown} cards */
function cardsOf(cards) {
 if(!Array.isArray(cards)||!cards.length||cards.length>most||!cards.every(id=>typeof id==='string'&&taskId.test(id))) return null;
 return [...new Set(/** @type {string[]} */(cards))];
}

/** @typedef {import('./archive-stops').ArchiveStop} ArchiveStop */
/**
 * Archives the Cards on the reader's board. Without `stop`, a Card an Agent works on or that waits on a person's answer
 * archives nothing and answers what would stop.
 * @param {any} db the reader's own session @param {{company:string,me:string,cards:unknown,stop?:unknown}} request
 * @returns {Promise<{state:'archived',archived:string[],left:string[]}|{state:'stops',stops:ArchiveStop[]}|{state:'invalid'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function archiveCompanyCards(db,{company,me,cards,stop}) {
 const ids=cardsOf(cards);
 if(!uuid.test(company)||!ids) return {state:'invalid'};
 const [board,engine]=await Promise.all([readCompanyBoard(db,{company,me}),companyEngine(company,{reader:db})]);
 if(board.state!=='found') return {state:board.state};
 if(!engine) return {state:'noEngine'};
 const shown=new Map(board.cards.map(card=>[card.id,card]));
 const targets=ids.filter(id=>shown.has(id));
 /** @type {ArchiveStop[]} */
 const stops=targets.map(id=>/** @type {import('./company-board.mjs').BoardCard} */(shown.get(id))).flatMap(card=>{
  const kind=card.column==='progress'?'run':card.symbol?.kind==='question'?'question':null;
  return kind?[{about:card.id,kind,title:card.title,agent:card.agent?.name??null,agent_id:card.agent?.id??null}]:[];
 });
 if(stops.length&&stop!==true) return {state:'stops',stops};
 const archived=[]; const left=ids.filter(id=>!shown.has(id));
 for(const id of targets) {
  const done=await engine.board.archive(id);
  if(done.state==='archived') archived.push(id); else left.push(id);
 }
 return {state:'archived',archived,left};
}

/**
 * The archived Cards the reader `me` may see, as the Engine holds them: none of an Agent hidden from them, and one with no
 * Agent only by the board's rule (shownWithoutAgent).
 * @param {any} db @param {string} company @param {string} me
 */
async function seenArchived(db,company,me) {
 const [engine,seen,rows,people]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company),cardRows(db,company),activeMembers(db,company)]);
 if(!engine) return /** @type {const} */({state:'noEngine'});
 if(!seen||!rows||!people) return /** @type {const} */({state:'failed'});
 const role=people.get(me)?.role;
 const read=await engine.board.archived();
 if(read.state!=='found') return {state:read.state};
 const companyProfiles=new Set(engine.profiles);
 /** @type {Map<string,{id:string,name:string}>} */
 const byProfile=new Map();
 for(const row of seen) if(typeof row.profile==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??'')});
 const cards=read.cards.filter(card=>card.assignee?!(!byProfile.has(card.assignee)&&companyProfiles.has(card.assignee)):shownWithoutAgent(rows.has(card.id),role))
  .map(card=>({...card,agent:card.assignee?byProfile.get(card.assignee)??null:null}));
 return /** @type {const} */({state:'found',engine,cards,rows});
}

/**
 * Restores the archived Cards the reader may see (lib/engine/board.mjs restoreCard). An `undo` puts a Card that was
 * being worked on back to ready and asks the dispatcher for a tick, so its Agent goes on as before the archive.
 * @param {any} db the reader's own session @param {{company:string,me:string,cards:unknown,undo?:unknown}} request
 * @returns {Promise<{state:'restored',restored:string[],left:string[]}|{state:'invalid'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function restoreCompanyCards(db,{company,me,cards,undo}) {
 const ids=cardsOf(cards);
 if(!uuid.test(company)||!ids) return {state:'invalid'};
 const found=await seenArchived(db,company,me);
 if(found.state!=='found') return {state:found.state};
 const archived=new Set(found.cards.map(card=>card.id));
 const restored=[]; const left=ids.filter(id=>!archived.has(id)); let working=false;
 for(const id of ids.filter(id=>archived.has(id))) {
  const done=await found.engine.board.restore(id,{resume:undo===true});
  if(done.state==='restored') { restored.push(id); working||=done.was==='running'; } else left.push(id);
 }
 if(undo===true&&working) await found.engine.board.dispatch();
 return {state:'restored',restored,left};
}

/** @typedef {{id:string,title:string,agent:{id:string,name:string}|null,person:{id:string,name:string}|null,project:string|null,createdAt:number|null}} ArchivedCard */
/**
 * One page of the archived list: fifty from `from`, newest made first, those whose title holds `query` when it is given.
 * `total` is every archived Card the reader may see, `next` where the next page starts, or null.
 * @param {any} db the reader's own session @param {{company:string,me:string,query?:unknown,from?:unknown}} request
 * @returns {Promise<{state:'found',cards:ArchivedCard[],total:number,next:number|null}|{state:'invalid'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function readArchivedCards(db,{company,me,query='',from=0}) {
 const start=Number(from);
 if(!uuid.test(company)||typeof query!=='string'||query.length>200||!Number.isSafeInteger(start)||start<0) return {state:'invalid'};
 const found=await seenArchived(db,company,me);
 if(found.state!=='found') return {state:found.state};
 const rows=found.rows;
 const wanted=searchFold(query);
 const all=[...found.cards].sort((a,b)=>(b.createdAt??0)-(a.createdAt??0)||(a.id<b.id?1:-1));
 const matched=wanted?all.filter(card=>searchFold(card.title).includes(wanted)):all;
 const cards=matched.slice(start,start+archivedPage).map(card=>({id:card.id,title:card.title,agent:card.agent,person:card.agent?null:rows.get(card.id)?.person??null,
  project:card.tenant,createdAt:card.createdAt}));
 return {state:'found',cards,total:all.length,next:start+archivedPage<matched.length?start+archivedPage:null};
}
