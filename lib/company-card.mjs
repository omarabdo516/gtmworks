import { companyEngine, seenAgents } from './engine/handle.mjs';
import { cardSymbol, columnOfStatus } from './board-columns.mjs';

// A Card a Member opens (spec #831, #835): one task of the Company's Engine's own Kanban board, read whole through the
// Engine handle (GET /tasks/{id}) as the reader may see it, and made into what the Card window draws. gtmworks keeps
// none of it (ADR 0033): every read asks the Engine, and the browser keeps the last good read (ADR 0030).
//
// `db` is the signed-in person's own session, as for the board (lib/company-board.mjs): a Card given to an Agent hidden
// from the reader is missing for them, as it is not on their board; an Agent hidden from them that commented on a Card
// they see, ran it or made it is named as no one; a Card it waits for that they may not see has no id and no title. No
// answer names a profile, the Engine's address or its key.
//
// What is about people is gtmworks's row beside the Card (kanban_cards, #836): the Member who is its Assignee (a Card
// with an Agent on the Engine is the Agent's, whatever the row says), its publishing date and the person who made it.

/** @typedef {{id:string,name:string}} Agent */
/** @typedef {{id:string|null,title:string|null,column:string|null,done:boolean}} CardLink */
/** @typedef {'running'|'done'|'question'|'review'|'sentBack'|'failed'|'stopped'|'moved'} RunState */
/** @typedef {{id:string,name:string}} Person */
/** @typedef {{id:string,title:string,column:string|null,archived:boolean,symbol:import('./board-columns.mjs').CardSymbol|null,agent:Agent|null,person:Person|null,
 *  question:string|null,project:string|null,madeBy:{agent:Agent}|{person:Person}|null,publishOn:string|null,createdAt:number|null,completedAt:number|null,description:string,summary:string|null,
 *  waitsFor:CardLink[],waitedBy:CardLink[],
 *  comments:{id:number,author:{agent:Agent|null}|{person:string},body:string,at:number|null}[],
 *  activity:{id:number,kind:string,at:number|null,agent:Agent|null,to?:{agent:Agent|null}|null,by?:string|null}[],
 *  runs:{id:number,n:number,agent:Agent|null,state:RunState,summary:string|null,startedAt:number|null,endedAt:number|null}[]}} CompanyCard */

const failedOutcomes=new Set(['crashed','timed_out','spawn_failed','gave_up']);
const stoppedOutcomes=new Set(['reclaimed','stale']);
/** A Run's state in the words of the approved Card (design-reference-card: RUN_TXT), from the Engine's status and outcome. @param {{status:string,outcome:string|null}} run @returns {RunState} */
function runState({status,outcome}) {
 if(outcome==='completed') return 'done';
 if(outcome==='blocked') return 'question';
 if(outcome==='review_requested') return 'review';
 if(outcome==='changes_requested') return 'sentBack';
 if(outcome==='scheduled') return 'moved';
 if(outcome&&failedOutcomes.has(outcome)||['failed','crashed','timed_out'].includes(status)) return 'failed';
 if(outcome&&stoppedOutcomes.has(outcome)||status==='released') return 'stopped';
 return status==='running'?'running':'done';
}

/**
 * @param {any} db the reader's own session @param {{company:string,card:unknown}} target
 * @returns {Promise<{state:'found',card:CompanyCard}|{state:'invalid'|'missing'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function readCompanyCard(db,{company,card:id}) {
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return {state:'invalid'};
 const [engine,seen]=await Promise.all([companyEngine(company,{reader:db}),seenAgents(db,company)]);
 if(!engine) return {state:'noEngine'};
 if(!seen) return {state:'failed'};
 // The board says which linked Cards the reader sees, as it holds each one's Agent; a Card it cannot vouch for is hidden.
 const [read,board,row]=await Promise.all([engine.board.task(id),engine.board.read(),rowOf(db,company,id)]);
 if(read.state!=='found') return {state:read.state==='invalid'?'invalid':read.state};
 if(row===false) return {state:'failed'};
 const task=read.card;
 const companyProfiles=new Set(engine.profiles);
 /** @type {Map<string,Agent>} */
 const byProfile=new Map();
 for(const row of seen) if(typeof row.profile==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??'')});
 const hidden=(/** @type {string|null} */ profile)=>!!profile&&!byProfile.has(profile)&&companyProfiles.has(profile);
 if(hidden(task.assignee)) return {state:'missing'};
 const agentOf=(/** @type {string|null|undefined} */ profile)=>profile?byProfile.get(profile)??null:null;
 // A profile's name is never shown: an author that is one (the Company's, or any Agent's or Company's by its shape) is
 // its Agent, or no one; any other author is the person's name gtmworks wrote on the comment.
 const isProfile=(/** @type {string} */ name)=>companyProfiles.has(name)||byProfile.has(name)||/^(ag|co)-[0-9a-f]{32}$/.test(name);
 const seenOnBoard=new Map((board.cards??[]).filter(other=>!hidden(other.assignee)).map(other=>[other.id,other]));
 const link=(/** @type {{id:string,title:string,status:string}} */ other)=>{
  const done=other.status==='done'||other.status==='archived';
  const shown=seenOnBoard.get(other.id);
  return shown?{id:other.id,title:other.title||shown.title,column:columnOfStatus(other.status),done}:{id:null,title:null,column:null,done};
 };
 const runAgent=new Map(task.runs.map(run=>[run.id,agentOf(run.profile)]));
 const status=task.status;
 const symbol=status==='archived'?null:cardSymbol(task);
 return {state:'found',card:{id:task.id,title:task.title,column:columnOfStatus(status),archived:status==='archived',
  symbol,
  // What a Card stopped on a question asks (#838): the reason its Agent stopped with, its latest stopped Run's summary.
  question:symbol?.kind==='question'?task.runs.filter(run=>run.outcome==='blocked').at(-1)?.summary??null:null,
  agent:agentOf(task.assignee),person:!task.assignee&&row?.assignee?{id:String(row.assignee),name:String(row.member?.name??'')}:null,
  project:task.tenant,publishOn:typeof row?.publish_on==='string'?row.publish_on:null,
  madeBy:row?.made_by?{person:{id:String(row.made_by),name:String(row.maker?.name??'')}}:agentOf(task.createdBy)?{agent:/** @type {Agent} */(agentOf(task.createdBy))}:null,
  createdAt:task.createdAt,completedAt:task.completedAt,description:task.body,summary:status==='done'?task.summary:null,
  waitsFor:task.waitsFor.map(link),waitedBy:task.waitedBy.map(link),
  comments:task.comments.map(comment=>({id:comment.id,author:isProfile(comment.author)?{agent:agentOf(comment.author)}:{person:comment.author},body:comment.body,at:comment.at})),
  activity:task.events.map(event=>{
   const agent=event.run!=null?runAgent.get(event.run)??null:null;
   if(event.kind==='assigned') return {id:event.id,kind:event.kind,at:event.at,agent,to:event.assignee?{agent:agentOf(event.assignee)}:null};
   if(event.kind==='commented') { const by=event.author??''; return isProfile(by)?{id:event.id,kind:event.kind,at:event.at,agent:agentOf(by),by:null}:{id:event.id,kind:event.kind,at:event.at,agent,by:by||null}; }
   return {id:event.id,kind:event.kind,at:event.at,agent};
  }),
  runs:task.runs.map((run,index)=>({id:run.id,n:index+1,agent:agentOf(run.profile),state:runState(run),summary:run.summary,startedAt:run.startedAt,endedAt:run.endedAt}))}};
}

/** gtmworks's row beside one Card, null when it has none, false when the database does not answer.
 * @param {any} db @param {string} company @param {string} id */
async function rowOf(db,company,id) {
 const {data,error}=await Promise.resolve().then(()=>db.from('kanban_cards').select('assignee,made_by,publish_on,member:people!kanban_cards_assignee_fkey(name),maker:people!kanban_cards_made_by_fkey(name)')
  .eq('company_id',company).eq('task_id',id).maybeSingle()).catch(failure=>({data:null,error:failure}));
 return error?false:data??null;
}
