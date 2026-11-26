import { companyEngine, seenAgents } from './engine/handle.mjs';

// A Card made from the board and given to an Agent, a Member or nobody (spec #831, #836). The Card is a task on the
// Company's Engine's own Kanban board; gtmworks keeps only what is about people, in its row beside the Card
// (public.kanban_cards, ADR 0033): the Member who is its Assignee, its publishing date and the person who made it.
//
// - Given to an Agent, the Card is made on the Engine with that Agent's profile, so it is `ready`, and the Engine's
//   dispatcher is asked for a tick at once (the Agent starts within seconds, not at the dispatcher's next minute).
// - Given to a Member, the Card has no Agent on the Engine, so the dispatcher never starts it; the Member is in the row.
// - Given to nobody, it waits, worked by nobody.
// A Card has at most one Assignee: an Agent given it clears the Member, and a Member given it clears the Agent first, so
// it stops being offered to the dispatcher before the Member holds it.
//
// `db` is the signed-in person's own session: the route has checked their Role (Owner, Manager or Contributor) before
// anything here reaches the Engine, and the row's policies check it again (ADR 0004). An Agent is one the reader sees
// (company_app_agents), a Member an active Member of the Company. No answer names a profile, the Engine's address or key.

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const taskId=/^[A-Za-z0-9_-]{1,64}$/;
const titleLimit=500;
const descriptionLimit=20000;

/** @typedef {{kind:'agent',id:string}|{kind:'member',id:string}|null} Assignee */
/**
 * An Assignee as the browser names it: `agent:<id>`, `member:<id>`, or '' for nobody; undefined for anything else.
 * @param {unknown} value @returns {Assignee|undefined}
 */
function assigneeOf(value) {
 if(value===''||value===null) return null;
 const found=typeof value==='string'?/^(agent|member):(.+)$/.exec(value):null;
 if(!found||!uuid.test(found[2])) return undefined;
 return found[1]==='agent'?{kind:'agent',id:found[2]}:{kind:'member',id:found[2]};
}
/** A publishing date as a day (YYYY-MM-DD) that is on the calendar, null for none; undefined for anything else. @param {unknown} value */
function publishDateOf(value) {
 if(value===''||value===null||value===undefined) return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
 const day=new Date(`${value}T00:00:00Z`);
 return Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==value?undefined:value;
}

/** The profile an Agent the reader sees runs on, or the Member's id when they are an active Member; null when neither.
 * @param {any} db @param {string} company @param {NonNullable<Assignee>} assignee @param {Awaited<ReturnType<typeof seenAgents>>} seen */
async function assigneeFound(db,company,assignee,seen) {
 if(assignee.kind==='agent') return seen?.find(row=>row.agent===assignee.id&&typeof row.profile==='string')?.profile??null;
 const {data,error}=await db.from('members').select('person_id').eq('company_id',company).eq('person_id',assignee.id).is('removed_at',null).maybeSingle();
 if(error) throw new Error(error.message);
 return data?assignee.id:null;
}

/** The row's Member for a Card: updated when it has a row, else made with it. @param {any} db @param {{company:string,task:string,member:string|null}} change */
async function keepMember(db,{company,task,member}) {
 const {data,error}=await db.from('kanban_cards').update({assignee:member}).eq('company_id',company).eq('task_id',task).select('task_id');
 if(error) return false;
 if(data?.length||!member) return true;
 const made=await db.from('kanban_cards').insert({company_id:company,task_id:task,assignee:member});
 return !made.error||made.error.code==='23505'&&await keepMember(db,{company,task,member});
}

/**
 * Makes a Card from the board. `key` is the request's own id: a retry with it is the same Card on the Engine and the
 * same row.
 * @param {any} db the maker's own session
 * @param {{company:string,person:string,key:unknown,title:unknown,description:unknown,assignee:unknown,publishOn:unknown}} card
 * @returns {Promise<{state:'made',id:string}|{state:'invalid'|'assigneeInvalid'|'noEngine'|'unreachable'|'failed'|'notKept'}>}
 */
export async function makeCompanyCard(db,{company,person,key,title,description,assignee,publishOn}) {
 const who=assigneeOf(assignee); const day=publishDateOf(publishOn);
 const name=typeof title==='string'?title.trim():''; const body=typeof description==='string'?description:'';
 if(!uuid.test(company)||typeof key!=='string'||!uuid.test(key)||!name||name.length>titleLimit||body.length>descriptionLimit||who===undefined||day===undefined) return {state:'invalid'};
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 const found=who?await assigneeFound(db,company,who,seen):null;
 if(who&&!found) return {state:'assigneeInvalid'};
 const profile=who?.kind==='agent'?found:null; const member=who?.kind==='member'?found:null;
 const made=await engine.board.make({title:name,body,assignee:profile,key});
 if(made.state==='invalid') return {state:'invalid'};
 if(made.state!=='made') return {state:made.state==='failed'?'failed':'unreachable'};
 // The row, when the Card has a Member or a publishing date, and always who made it. A retry finds the row made.
 const kept=await db.from('kanban_cards').insert({company_id:company,task_id:made.card.id,assignee:member,publish_on:day,made_by:person});
 if(kept.error&&kept.error.code!=='23505') return {state:'notKept'};
 if(profile) await engine.board.dispatch();
 return {state:'made',id:made.card.id};
}

/**
 * Gives a Card on the board to an Agent, a Member or nobody. A Card of an Agent hidden from the reader is not theirs to
 * reach (missing), and one an Agent is working now keeps its Agent (busy).
 * @param {any} db the reader's own session @param {{company:string,card:unknown,assignee:unknown}} change
 * @returns {Promise<{state:'assigned'}|{state:'invalid'|'assigneeInvalid'|'missing'|'busy'|'noEngine'|'unreachable'|'failed'|'notKept'}>}
 */
export async function assignCompanyCard(db,{company,card,assignee}) {
 const who=assigneeOf(assignee);
 if(!uuid.test(company)||typeof card!=='string'||!taskId.test(card)||who===undefined) return {state:'invalid'};
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 const read=await engine.board.read();
 if(read.state!=='found') return {state:read.state==='failed'?'failed':'unreachable'};
 const now=read.cards.find(found=>found.id===card);
 const seenProfiles=new Set(seen.map(row=>row.profile));
 if(!now||now.assignee&&engine.profiles.includes(now.assignee)&&!seenProfiles.has(now.assignee)) return {state:'missing'};
 const found=who?await assigneeFound(db,company,who,seen):null;
 if(who&&!found) return {state:'assigneeInvalid'};
 const profile=who?.kind==='agent'?found:null; const member=who?.kind==='member'?found:null;
 const assigned=await engine.board.assign({id:card,assignee:profile});
 if(assigned.state!=='assigned') return {state:assigned.state==='refused'?'unreachable':assigned.state};
 if(!await keepMember(db,{company,task:card,member})) return {state:'notKept'};
 if(profile) await engine.board.dispatch();
 return {state:'assigned'};
}

/**
 * Whom a Card on the board may be given to, as the reader sees them: the Agents they see and the active Members, with
 * the reader's own id for "Assign to me". Null when the database does not answer.
 * @param {any} db the reader's own session @param {{company:string,person:string}} target
 * @returns {Promise<{me:string,agents:{id:string,name:string}[],people:{id:string,name:string}[]}|null>}
 */
export async function cardChoices(db,{company,person}) {
 if(!uuid.test(company)) return null;
 const [seen,{data:members,error}]=await Promise.all([seenAgents(db,company),
  db.from('members').select('person_id,people(name)').eq('company_id',company).is('removed_at',null)]);
 if(!seen||error) return null;
 const agents=[...new Map(seen.map(row=>[row.agent,{id:row.agent,name:String(row.name??''),main:row.main===true}])).values()]
  .sort((a,b)=>Number(b.main)-Number(a.main)||a.name.localeCompare(b.name)).map(({id,name})=>({id,name}));
 const people=(members||[]).map((/** @type {any} */ row)=>({id:String(row.person_id),name:String(row.people?.name??'')}))
  .sort((/** @type {{name:string}} */ a,/** @type {{name:string}} */ b)=>a.name.localeCompare(b.name));
 return {me:person,agents,people};
}
