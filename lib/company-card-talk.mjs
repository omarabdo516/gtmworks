import { companyEngine, seenAgents } from './engine/handle.mjs';
import { cardSymbol } from './board-columns.mjs';

// A person talks to the work on a Card (spec #831, #838): a comment, an answer to its Agent's question, Stop and Continue,
// each a write to the Card's task on the Company's Engine's own Kanban board (docs/engine-probes/kanban-board.md).
//
// - A comment is the Engine's own, under the writer's name: gtmworks writes the person's name as its author, because the
//   Engine records no identity of its own. A comment starts nothing.
// - Answering a Card stopped on a question is that comment, then a move to ready and a dispatcher tick, so the person
//   presses one button and the Agent's next Run reads the answer at once.
// - Stop is the Engine's own stop for the Card's open Run (reclaim), which ends the worker and its Run and puts the Card
//   back to ready, where the dispatcher would start it again within its minute. So the Card is then parked (`scheduled`,
//   which the dispatcher never starts) until a person lets it go on: wrong work ends and does not begin again by itself.
// - Continue lets a Card stopped after two failures, or stopped by a person, go on: a move to ready, which starts the
//   Engine's count of failures again, and a dispatcher tick, so the Engine tries again now.
//
// `db` is the signed-in person's own session: the route has checked their Role (Owner, Manager or Contributor) before
// anything here reaches the Engine. A Card given to an Agent hidden from them is missing, as it is not on their board,
// and nothing is written to it. No answer names a profile, the Engine's address or its key.

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const taskId=/^[A-Za-z0-9_-]{1,64}$/;
export const commentLimit=20000;

/** @typedef {'invalid'|'missing'|'noEngine'|'unreachable'|'failed'} Refused */

/**
 * The Card as the reader may reach it: the Engine and its task, or why not.
 * @param {any} db @param {string} company @param {unknown} id
 * @returns {Promise<{engine:NonNullable<Awaited<ReturnType<typeof companyEngine>>>,task:import('./engine/board.mjs').EngineCardDetail}|{state:Refused}>}
 */
export async function reach(db,company,id) {
 if(typeof company!=='string'||!uuid.test(company)||typeof id!=='string'||!taskId.test(id)) return {state:'invalid'};
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 const read=await engine.board.task(id);
 if(read.state==='missing'||read.state==='invalid') return {state:'missing'};
 if(read.state!=='found') return {state:read.state==='failed'?'failed':'unreachable'};
 const seenProfiles=new Set(seen.map(row=>row.profile));
 const assignee=read.card.assignee;
 if(assignee&&engine.profiles.includes(assignee)&&!seenProfiles.has(assignee)||read.card.status==='archived') return {state:'missing'};
 return {engine,task:read.card};
}

/** The signed-in person's name, which the Engine keeps as a comment's author; null when the database does not answer.
 * @param {any} db @param {string} person */
export async function nameOf(db,person) {
 const {data,error}=await Promise.resolve().then(()=>db.from('people').select('name').eq('id',person).maybeSingle()).catch(failure=>({data:null,error:failure}));
 const name=typeof data?.name==='string'?data.name.trim().slice(0,200):'';
 return error||!name?null:name;
}

export const wrote=(/** @type {string} */ state)=>/** @type {{state:Refused}} */({state:state==='missing'?'missing':state==='invalid'?'invalid':'unreachable'});

/**
 * Comments on a Card under the writer's name; with `answer`, the comment answers the Agent's question and the Card goes
 * on at once. An answer to a Card that is not stopped on a question writes nothing (notAsking).
 * @param {any} db the writer's own session
 * @param {{company:string,person:string,card:unknown,body:unknown,answer?:unknown}} comment
 * @returns {Promise<{state:'commented'|'answered'|'notAsking'|Refused}>}
 */
export async function commentOnCard(db,{company,person,card,body,answer=false}) {
 const text=typeof body==='string'?body.trim():'';
 if(!text||text.length>commentLimit) return {state:'invalid'};
 const found=await reach(db,company,card);
 if('state' in found) return found;
 const {engine,task}=found;
 if(answer===true&&cardSymbol(task)?.kind!=='question') return {state:'notAsking'};
 const author=await nameOf(db,person);
 if(!author) return {state:'failed'};
 const commented=await engine.board.comment({id:task.id,author,body:text});
 if(commented.state!=='commented') return wrote(commented.state);
 if(answer!==true) return {state:'commented'};
 const moved=await engine.board.move({id:task.id,status:'ready'});
 // The comment stays, as any comment does, when the Card moved meanwhile.
 if(moved.state==='conflict') return {state:'commented'};
 if(moved.state!=='moved') return wrote(moved.state);
 await engine.board.dispatch();
 return {state:'answered'};
}

/**
 * Stops the Agent working a Card: the Engine ends its open Run, and the Card is held until a person lets it go on.
 * @param {any} db the person's own session @param {{company:string,person:string,card:unknown}} stop
 * @returns {Promise<{state:'stopped'|'idle'|Refused}>}
 */
export async function stopCard(db,{company,person,card}) {
 const found=await reach(db,company,card);
 if('state' in found) return found;
 const {engine,task}=found;
 if(task.status!=='running') return {state:'idle'};
 const name=await nameOf(db,person);
 const stopped=await engine.board.stop({id:task.id,reason:name?`Stopped by ${name}`:'Stopped by a person'});
 if(stopped.state==='idle') return {state:'idle'};
 if(stopped.state!=='stopped') return wrote(stopped.state);
 // Held where the dispatcher never starts it. A reviewer's Run goes back to review, which a person decides: the move is
 // refused there and the Card stays in review.
 const held=await engine.board.move({id:task.id,status:'scheduled'});
 if(held.state!=='moved'&&held.state!=='conflict') return wrote(held.state);
 return {state:'stopped'};
}

/**
 * Lets a Card stopped after two failures, or stopped by a person, go on: the Engine tries it again now.
 * @param {any} db the person's own session @param {{company:string,card:unknown}} target
 * @returns {Promise<{state:'continued'|'notStopped'|Refused}>}
 */
export async function continueCard(db,{company,card}) {
 const found=await reach(db,company,card);
 if('state' in found) return found;
 const {engine,task}=found;
 const kind=cardSymbol(task)?.kind;
 if(kind!=='failed'&&kind!=='stopped') return {state:'notStopped'};
 const moved=await engine.board.move({id:task.id,status:'ready'});
 if(moved.state==='conflict') return {state:'notStopped'};
 if(moved.state!=='moved') return wrote(moved.state);
 await engine.board.dispatch();
 return {state:'continued'};
}
