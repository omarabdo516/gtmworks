import { companyEngine, seenAgents } from './engine/handle.mjs';
import { cardSymbol, columnOfStatus } from './board-columns.mjs';
import { fileTagName, takeFileTags } from './media-tags.mjs';
import { ownWorkFile } from './reply-files.mjs';
import { pictureType } from './file-preview.mjs';
import { reviewsOf, withoutPassLine } from './company-card-review.mjs';

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
/** @typedef {'running'|'done'|'question'|'review'|'sentBack'|'passed'|'failed'|'stopped'|'moved'} RunState */
/** @typedef {{agent:Agent|null}|{person:string}} Someone */
/** @typedef {{id:string,name:string}} Person */
/** @typedef {'ready'|'notNow'|'unservable'} CardFileState */
/** @typedef {{key:string,name:string,image:boolean,size:number|null,by:{agent:Agent|null}|{person:string}|null,at:number|null,from:'person'|'summary'|'comment',comment?:number,state:CardFileState}} CardFile */
/** @typedef {{id:string,title:string,column:string|null,archived:boolean,symbol:import('./board-columns.mjs').CardSymbol|null,agent:Agent|null,person:Person|null,
 *  question:string|null,project:string|null,madeBy:{agent:Agent}|{person:Person}|null,publishOn:string|null,createdAt:number|null,completedAt:number|null,description:string,summary:string|null,
 *  waitsFor:CardLink[],waitedBy:CardLink[],
 *  comments:{id:number,author:{agent:Agent|null}|{person:string},body:string,at:number|null}[],
 *  review:{state:'requested'|'passed'|'sentBack',by:Someone|null,text:string|null,at:number|null}|null,
 *  activity:{id:number,kind:string,at:number|null,agent:Agent|null,to?:{agent:Agent|null}|null,by?:string|null}[],
 *  runs:{id:number,n:number,agent:Agent|null,by?:{person:string},state:RunState,summary:string|null,startedAt:number|null,endedAt:number|null}[],
 *  files:CardFile[]}} CompanyCard */

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

// A Card's files (#843), both ways. A person's is a Kanban attachment on the Engine, by its id (`a<id>`). An Agent's is
// named by a `MEDIA:` line (ADR 0028) in the Card's summary or in one of its own comments, and stays in that Agent's own
// work folder in the Company's work sandbox: gtmworks keeps no copy, and reads it through the Engine's file routes when
// a person downloads it. Its key is where it was named (`s<n>`, the summary's n-th; `c<comment>-<n>`), so the address a
// browser holds names no path, and the path is found again from the Engine's own text each time. A tag is resolved inside
// the Agent's own folder only (ownWorkFile): one that names anything else is listed by its name and cannot be served.
/** @typedef {{key:string,path:string,profile:string|null,from:'summary'|'comment',comment?:number,at:number|null}} AgentFileTag */
/** @param {import('./engine/board.mjs').EngineCardDetail} task @param {(name:string)=>boolean} isProfile @returns {AgentFileTag[]} */
function agentFileTags(task,isProfile) {
 const tags=/** @type {AgentFileTag[]} */([]);
 // The summary's Agent is the one whose Run wrote it, else the one the Card is given to.
 const {paths}=takeFileTags(task.summary??'');
 paths.forEach((path,n)=>{
  const run=[...task.runs].reverse().find(found=>found.profile&&found.summary?.includes(path));
  tags.push({key:`s${n}`,path,profile:run?.profile??task.assignee,from:'summary',at:task.completedAt});
 });
 for(const comment of task.comments) {
  if(!isProfile(comment.author)) continue;
  takeFileTags(comment.body).paths.forEach((path,n)=>tags.push({key:`c${comment.id}-${n}`,path,profile:comment.author,from:'comment',comment:comment.id,at:comment.at}));
 }
 return tags;
}
/** Where an Agent's tag is read from: its folder and name in the Agent's own work folder, or null. @param {AgentFileTag} tag */
export const agentFileAt=tag=>tag.profile&&/^[A-Za-z0-9_-]{1,64}$/.test(tag.profile)?ownWorkFile(tag.path,tag.profile):null;
// A text an Agent wrote, as a person reads it: its tags out, each file listed on its own.
/** @param {string} text */
const untagged=text=>takeFileTags(text).body;

/**
 * The Card, the Engine's task it is drawn from and the Company's Engine, as the reader may see it: the one read both the
 * Card window and a file's address go through, so a file is only ever served from a Card its reader sees.
 * @param {any} db the reader's own session @param {{company:string,card:unknown}} target @param {{sandbox?:boolean}} [options]
 * @returns {Promise<{state:'found',card:CompanyCard,task:import('./engine/board.mjs').EngineCardDetail,engine:NonNullable<Awaited<ReturnType<typeof companyEngine>>>,tags:AgentFileTag[]}|{state:'invalid'|'missing'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function openCompanyCard(db,{company,card:id},{sandbox=false}={}) {
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
 // The Card's latest review (#839): who passed it or sent it back, an Agent or a person by name. A Card sent back shows
 // so until it starts again, and one passed shows the tick once it is done.
 const {review,passes,returns}=reviewsOf(task,isProfile);
 const column=columnOfStatus(status);
 const symbol=status==='archived'?null:cardSymbol(task)??(review?.state==='sentBack'&&column==='planned'?{kind:/** @type {const} */('sentBack')}:review?.state==='passed'&&status==='done'?{kind:/** @type {const} */('passed')}:null);
 const passedBy=review?.state==='passed'?review.person:null;
 const tags=agentFileTags(task,isProfile);
 // Whether the work sandbox answers, asked once and only for a Card that names an Agent's file: with it stopped, the
 // file is listed and says it cannot be read now.
 const firstAt=tags.map(agentFileAt).findIndex(Boolean);
 const running=sandbox&&firstAt>=0?(await engine.on(tags[firstAt].profile)?.files.sandbox())?.state==='running':true;
 /** @type {CardFile[]} */
 const files=[
  ...task.attachments.map(file=>({key:`a${file.id}`,name:file.name,image:!!pictureType(file.name),size:file.size,
   by:!file.by||file.by==='dashboard'?null:file.by==='agent'||isProfile(file.by)?{agent:agentOf(file.by)}:{person:file.by},at:file.at,from:/** @type {const} */('person'),state:/** @type {const} */('ready')})),
  ...tags.map(tag=>{ const name=fileTagName(tag.path);
   return {key:tag.key,name,image:!!pictureType(name),size:null,by:{agent:agentOf(tag.profile)},at:tag.at,from:tag.from,...tag.comment!=null?{comment:tag.comment}:{},
    state:/** @type {CardFileState} */(!agentFileAt(tag)?'unservable':running?'ready':'notNow')}; }),
 ];
 return {state:'found',task,engine,tags,card:{id:task.id,title:task.title,column,archived:status==='archived',
  symbol,
  // What a Card stopped on a question asks (#838): the reason its Agent stopped with, its latest stopped Run's summary.
  question:symbol?.kind==='question'?task.runs.filter(run=>run.outcome==='blocked').at(-1)?.summary??null:null,
  agent:agentOf(task.assignee),person:!task.assignee&&row?.assignee?{id:String(row.assignee),name:String(row.member?.name??'')}:null,
  project:task.tenant,publishOn:typeof row?.publish_on==='string'?row.publish_on:null,
  madeBy:row?.made_by?{person:{id:String(row.made_by),name:String(row.maker?.name??'')}}:agentOf(task.createdBy)?{agent:/** @type {Agent} */(agentOf(task.createdBy))}:null,
  createdAt:task.createdAt,completedAt:task.completedAt,description:task.body,summary:status==='done'&&task.summary?untagged(passedBy?withoutPassLine(task.summary):task.summary)||null:null,
  waitsFor:task.waitsFor.map(link),waitedBy:task.waitedBy.map(link),
  comments:task.comments.map(comment=>({id:comment.id,author:isProfile(comment.author)?{agent:agentOf(comment.author)}:{person:comment.author},body:isProfile(comment.author)?untagged(comment.body):comment.body,at:comment.at})),
  review:review&&{state:review.state,by:review.person?{person:review.person}:review.profile||review.state!=='sentBack'?{agent:agentOf(review.profile)}:null,
   text:review.text?untagged(review.text)||null:null,at:review.at},
  activity:task.events.map(event=>{
   const agent=event.run!=null?runAgent.get(event.run)??null:null;
   // A pass names the reviewing Agent, whose Run it was, or the person; a person's return names them.
   if(event.kind==='completed'&&event.run!=null&&passes.has(event.run)) { const by=passes.get(event.run); return by?{id:event.id,kind:'passed',at:event.at,agent:null,by}:{id:event.id,kind:'passed',at:event.at,agent}; }
   if(event.kind==='review_reopened'&&returns.has(event.id)) return {id:event.id,kind:event.kind,at:event.at,agent:null,by:returns.get(event.id)};
   if(event.kind==='assigned') return {id:event.id,kind:event.kind,at:event.at,agent,to:event.assignee?{agent:agentOf(event.assignee)}:null};
   if(event.kind==='commented') { const by=event.author??''; return isProfile(by)?{id:event.id,kind:event.kind,at:event.at,agent:agentOf(by),by:null}:{id:event.id,kind:event.kind,at:event.at,agent,by:by||null}; }
   return {id:event.id,kind:event.kind,at:event.at,agent};
  }),
  runs:task.runs.map((run,index)=>{ const by=passes.get(run.id); const summary=run.summary?untagged(by?withoutPassLine(run.summary):run.summary)||null:null;
   return by?{id:run.id,n:index+1,agent:null,by:{person:by},state:/** @type {RunState} */('passed'),summary,startedAt:run.startedAt,endedAt:run.endedAt}
    :{id:run.id,n:index+1,agent:agentOf(run.profile),state:passes.has(run.id)?'passed':runState(run),summary,startedAt:run.startedAt,endedAt:run.endedAt}; }),
  files}};
}

/**
 * The Card window's read: the Card as the reader may see it, with its files and whether an Agent's can be read now.
 * @param {any} db the reader's own session @param {{company:string,card:unknown}} target
 * @returns {Promise<{state:'found',card:CompanyCard}|{state:'invalid'|'missing'|'noEngine'|'refused'|'unreachable'|'failed'}>}
 */
export async function readCompanyCard(db,target) {
 const read=await openCompanyCard(db,target,{sandbox:true});
 return read.state==='found'?{state:'found',card:read.card}:read;
}

/** gtmworks's row beside one Card, null when it has none, false when the database does not answer.
 * @param {any} db @param {string} company @param {string} id */
async function rowOf(db,company,id) {
 const {data,error}=await Promise.resolve().then(()=>db.from('kanban_cards').select('assignee,made_by,publish_on,member:people!kanban_cards_assignee_fkey(name),maker:people!kanban_cards_made_by_fkey(name)')
  .eq('company_id',company).eq('task_id',id).maybeSingle()).catch(failure=>({data:null,error:failure}));
 return error?false:data??null;
}
