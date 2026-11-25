import { ownerNames } from './company-owners.mjs';
import type { supabase } from './supabase';
import type { PermissionChoice, SessionUsage } from './engine.mjs';
import type { AppStates } from './conversations';
import { stepsOfReplies, type RunSteps, type SessionTurn } from './conversations';
import { faceOf, handTurn, handoverEnding, latestEnd, messageColumns, noteColumns, queuedColumns, queuedWaiting, questionParts, replyCardColumns, replyCardOf, saidParts, shown, waiting, withBoardNote, withDecisions, withHandedOn, withHandoverAnswers, withTeamWork, type AgentAccessView, type AgentRequestView, type ChangeProposalView, type Decision, type LeadCard, type PlacedCard, type QueuedTurn, type ReplyCard, type ReplyCardRow, type SavedRule, type RunEnd, type StoredFile, type StoredNote } from './conversations';
import { isNewFor } from './sidebar.mjs';
import { columnOf, type BoardColumn, type CardWait } from './board-columns.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;

// The record of one conversation as its page and the conversation route show it, read with the person's own session
// (RLS): messages, notes addressed to a person, turns still waiting, how ended runs ended, who the Agent is working
// for, and whether this person may stop the open run (its own person, or a Manager or Owner of the Company; the
// database checks that again when they stop it), the Agents Lead made in it (an Agent since removed has no card), the
// Agents its person asked Lead for and the Owner's answer (#17), the cards its Agent showed with its replies (#136), the
// rules its Agent saved in it: a suggestion with who it was sent to, and how it was decided (RLS: only the person who
// told it reads one that is not the team's), the Card it put on the board with that Card's column now (#144), and the
// questions its Agent asked with their answers (#138); while one waits for its answer the record says so (`asking`). The
// record is what the database holds and never waits on the Engine (ADR 0030, #766): each reply's tool calls (#141) and
// the Conversation's token use (#347), which the Agent's Hermes session keeps, are their own read (conversationSteps),
// started once the messages are drawn. While a request to
// allow an action waits (#163), the record says which choices this person may send (`permit`); the Run is still working. The
// turn a hand card's "Done it" started (#140) is drawn by that card alone, which says when that turn could not start.
// A connect card (#203) shows its app's state in the Agent's profile now (`apps`, read only while one is open); the record
// says whether this person is the Owner who connects it, and else who does (`connect`). A job the chat's Agent handed
// another Agent (#317, #475) is a quiet row under that reply, then the other Agent's answer under its own name, read
// through conversation_handovers by this Conversation's person whether or not they see that Agent; while its two Runs
// move, the record says so (`handover`), so the chat keeps asking for the follow-up reply, and once it ended without
// finishing the row says so (`failed`, #375).
export async function conversationRecord(db:Database,person:string,company:string,found:{id:string,agent_id:string|null,kept_agent_id?:string|null,agent_name:string,hermes_session_id?:string|null,good_morning?:number|null,good_morning_day?:string|null,hermes_agents:unknown},apps?:(agent:string)=>Promise<AppStates>) {
 const conversation=found.id;
 // The record's reads go out together, each one round trip, so a busy machine adds one wait and not a chain of them to
 // opening the chat (decision 0042). The messages with how their runs ended and the turns still waiting, and the requests
 // for an Agent with the Agents made for them, are read in one statement (one snapshot): a run closed in one transaction
 // with its reply shows both or neither, and an Owner's yes, which writes the request's state and the made Agent in one
 // transaction, is never seen in half.
 type RequestRow={id:number,run_id:string,call_id:string,agent_name:string,job:string,apps:string[],asked_with:string,state:AgentRequestView['state'],answered_at:string|null,reason:string|null,created_at:string,answerer:{name:string}|null,asker:{name:string}|null};
 type Message={id:number,author:'person'|'agent',author_name:string,agent_id:string|null,body:string,run_id:string,hand_card:number|null,created_at:string};
 type MadeRow={run_id:string,call_id:string,created_at:string,hermes_agents:{id:string,connection_id:string,name:string,speciality:string,apps:string[]|null,is_default:boolean,requested_by:string|null,requester_opened_at:string|null}|null};
 type HandedRow={id:number,run:string,from_agent:string,from_name:string,to_agent:string,to_name:string,goal:string,answer:string|null,state:string,target_outcome:string|null,answers_person:boolean,created_at:string,answered_at:string|null,parent?:number|null,stopped?:boolean};
 type Face={id:string,connection_id:string,name:string};
 type ChangeRow={id:number,run_id:string,change:ChangeProposalView['change'],setting:string|null,value:unknown,approved_value?:unknown,reason:string,state:ChangeProposalView['state']|'applying',answered_at:string|null,answer:string|null,maybe_applied?:boolean,created_at:string,answerer:{name:string}|null,agent:Face|null,by:Face|null};
 type AccessRow={id:number,run_id:string,state:'offered'|'asked'|'dismissed'|'opened'|'declined',named_first:string,named_name:string,named_role:string,pressed_at:string|null,answered_at:string|null,answerer:string,opened:Face|null,available:boolean,created_at:string};
 // The stamp first (#767), awaited before the rows are read: a change made while they are read then gives the next
 // poll a new stamp, never a stamp newer than the rows it came with.
 const stamp=await db.rpc('conversation_stamp',{conversation}).then(({data})=>typeof data==='string'?data:null,()=>null);
 const stamped=Promise.resolve(stamp);
 const [{ends,resets,messages,queued,requestRows,madeRows,changeRows,moving},handedRows,notes,replyRows,rows,files,{data:working},{data:me},card,accessRows]=await Promise.all([
  db.from('conversations').select(`conversation_run_ends(run_id,outcome),conversation_run_resets(run_id,resets_at),conversation_messages(${messageColumns}),conversation_queued_turns(${queuedColumns}),`
   +'lead_agent_requests(id,run_id,call_id,agent_name,job,apps,asked_with,state,answered_at,reason,created_at,answerer:people!answered_by(name),asker:people!asked_by(name)),'
   +'lead_made_agents(run_id,call_id,created_at,hermes_agents(id,connection_id,name,speciality,apps,is_default,requested_by,requester_opened_at)),'
   // Each handover's state in the same snapshot as the messages: a follow-up that closes writes its reply and marks the
   // handover done in one transaction, so the chat keeps asking until both are read together (`handover`).
   +'agent_handovers(id,state),'
   // A change the chat's Agent proposed (#19), read by the Conversation's person while they see both Agents (RLS).
   +'agent_change_proposals(id,run_id,change,setting,value,approved_value,reason,state,answered_at,answer,maybe_applied,created_at,answerer:people!answered_by(name),agent:hermes_agents!agent_id(id,connection_id,name),by:hermes_agents!proposed_by(id,connection_id,name))')
   .eq('id',conversation).order('id',{referencedTable:'conversation_messages'}).order('queued_at',{referencedTable:'conversation_queued_turns'})
   .order('id',{referencedTable:'lead_agent_requests'}).order('created_at',{referencedTable:'lead_made_agents'})
   .order('id',{referencedTable:'agent_change_proposals'}).maybeSingle()
   .then(({data,error})=>{ if(error) throw new ConversationUnread(); const read=data as unknown as {conversation_run_ends:RunEnd[],conversation_run_resets:{run_id:string,resets_at:string}[],conversation_messages:Message[],conversation_queued_turns:QueuedTurn[],lead_agent_requests:RequestRow[],lead_made_agents:MadeRow[],agent_handovers:{id:number,state:string}[],agent_change_proposals:ChangeRow[]}|null;
    return {ends:read?.conversation_run_ends||[],resets:read?.conversation_run_resets||[],messages:read?.conversation_messages||[],queued:read?.conversation_queued_turns||[],requestRows:read?.lead_agent_requests||[],madeRows:read?.lead_made_agents||[],changeRows:read?.agent_change_proposals||[],moving:(read?.agent_handovers||[]).some(row=>row.state!=='done'&&row.state!=='failed')}; }),
  // The handovers of this chat (#317, #475), both Agents named, oldest first, to draw them; whether one is still moving
  // is read with the messages above.
  db.rpc('conversation_handovers',{conversation}).then(({data})=>(data||[]) as HandedRow[]),
  db.from('conversation_notes').select(noteColumns).eq('conversation_id',conversation).order('id').then(({data})=>(data||[]) as StoredNote[]),
  db.from('reply_cards').select(replyCardColumns).eq('conversation_id',conversation).order('id').then(({data})=>(data||[]) as ReplyCardRow[]),
  db.from('agent_rules').select('id,run_id,agent_id,removed_at,said_at,body,suggestion,decided_at,decider:people!decided_by(name)').eq('conversation_id',conversation).order('said_at').then(({data})=>(data||[]) as unknown as SavedRow[]),
  // The files each message was sent with (#155), read beside it: the message they were linked to, or the send key of a
  // turn still waiting. Only this Conversation's own person reads them (RLS, conversation_attachments_read).
  db.from('conversation_attachments').select('id,name,content_type,message_id,send_key,position').eq('conversation_id',conversation).order('position').then(({data})=>(data||[]) as StoredFile[]),
  db.rpc('conversation_working_for',{conversation}),
  db.from('people').select('name').eq('id',person).maybeSingle(),
  tiedCard(db,company,conversation),
  // The cards that asked whether to request an Agent hidden from this person (#167), which never name that Agent until
  // it is opened for them (conversation_agent_access: this person's own Conversation only).
  db.rpc('conversation_agent_access',{conversation}).then(({data})=>(data||[]) as AccessRow[]),
 ]);
 // A Conversation the morning opened (#183) carries the morning's card under the main Agent's greeting, read now.
 // Loaded only here: it reaches the Engine for the foot, which no screen that draws a record (a component test) imports.
 const morning=found.good_morning&&found.good_morning_day?await (await import('./good-morning-card')).morningCard(db,company,person,found.good_morning,found.good_morning_day):null;
 const lead=(found.hermes_agents as {is_default?:boolean}|null)?.is_default===true;
 const asksForApps=replyRows.some(row=>row.kind==='connect');
 const states=apps&&found.agent_id&&replyRows.some(row=>row.kind==='connect'&&row.state==='open')?await apps(found.agent_id):null;
 const {data:isOwner}=asksForApps?await db.rpc('is_company_owner',{c:company}):{data:false};
 const connect=asksForApps?{owner:isOwner===true,owners:isOwner===true?[]:await ownerNames(db,company)}:null;
 // A proposal whose approval is being written still waits on the Owner, who approves it again to finish it.
 const changeWaits=changeRows.some(row=>row.state==='waiting'||row.state==='applying');
 const owners=requestRows.some(row=>row.state==='waiting')||changeWaits?await ownerNames(db,company):[];
 // The Owner answers a proposal from the chat too (design-reference: chgHTML), so the record says whether this person is one.
 const [{data:ownsChanges},{data:mode}]=changeWaits?await Promise.all([db.rpc('is_company_owner',{c:company}),db.from('companies').select('work_mode').eq('id',company).maybeSingle()]):[{data:false},{data:null}];
 const changeView=(row:ChangeRow&{agent:Face,by:Face}):ChangeProposalView=>{
  const base={id:row.id,change:row.change,setting:row.setting,value:row.value,...(row.approved_value!==null&&row.approved_value!==undefined?{approved:row.approved_value}:{}),reason:row.reason,agent:row.agent,by:row.by};
  if(row.state==='waiting'||row.state==='applying') return {...base,state:'waiting',owners};
  if(row.state==='refused') return {...base,state:'refused'};
  const by=row.answerer?.name||''; const at=row.answered_at||row.created_at;
  return row.state==='approved'?{...base,state:'approved',answeredBy:by,at}:{...base,state:'declined',answeredBy:by,at,answer:row.answer,...(row.maybe_applied?{maybeApplied:true}:{})};
 };
 // A card asking for a hidden Agent (#167) says what its person pressed and when, whatever answer came after; the answer
 // is its own line (`decisions`).
 const accessView=(row:AccessRow):AgentAccessView=>{
  const named={first:row.named_first,name:row.named_name,role:row.named_role};
  if(row.available&&(row.state==='offered'||row.state==='asked')) return {id:row.id,named,state:'available'};
  return row.state==='offered'||!row.pressed_at?{id:row.id,named,state:'offered'}:row.state==='dismissed'?{id:row.id,named,state:'dismissed',at:row.pressed_at}:{id:row.id,named,state:'asked',at:row.pressed_at,waits:row.state==='asked'};
 };
 // The Agent made for a request shows in the request's own card, so one card holds the request and its outcome.
 const madeFor=(row:RequestRow)=>madeRows.find(made=>made.run_id===row.run_id&&made.call_id===row.call_id);
 const requestView=(row:RequestRow):AgentRequestView=>{
  const base={id:row.id,name:row.agent_name,job:row.job,apps:row.apps,askedBy:row.asker?.name||'',askedWith:row.asked_with};
  if(row.state==='waiting') return {...base,state:'waiting',owners};
  const by=row.answerer?.name||''; const at=row.answered_at||row.created_at;
  if(row.state==='declined') return {...base,state:'declined',by,at,reason:row.reason||''};
  const agent=madeFor(row)?.hermes_agents;
  return {...base,state:'made',by,at,agent:agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name}:null};
 };
 const requested=new Set(requestRows.map(row=>`${row.run_id}:${row.call_id}`));
 const handedCard=(row:HandedRow)=>({kind:'handed',from:{name:row.from_name,face:row.from_agent},name:row.to_name,face:row.to_agent,goal:row.goal,...handoverEnding(row)}) satisfies LeadCard;
 // A handover the chat's Agent made sits under the reply of its Run; one an asked Agent handed on (#477) is its own row.
 const handed=handedRows.filter(row=>row.parent==null).map(row=>({run_id:row.run,at:row.created_at,card:handedCard(row)}));
 const handedOn=handedRows.filter(row=>row.parent!=null).map(row=>({id:row.id,at:row.created_at,card:handedCard(row)}));
 // The asked Agent's answer, once it came, for the asking Agent to reply with (a job command's answer is the chat's own
 // message instead, and none comes here).
 const answers=handedRows.flatMap(row=>row.answer&&row.answered_at?[{id:row.id,from:row.from_name,name:row.to_name,face:row.to_agent,body:row.answer,at:row.answered_at}]:[]);
 // A job command's handover (#358) is the chat's own Run: the target Agent answers the person, so its reply is drawn
 // with that Agent's face, and the chat never waits on that Run as if the Conversation's Agent worked on it.
 const commandRuns=new Set(handedRows.filter(row=>row.answers_person).map(row=>row.run));
 // Only a job command's answer is a chat message from another Agent; a chain (#477) may ask the chat's own Agent back,
 // whose messages stay its own.
 const faces=new Map(handedRows.filter(row=>row.answers_person).map(row=>[row.to_agent,row.to_agent] as const));
 // What a job command's Agent asks the person (#470) is kept on the command's own Run, and drawn as that Agent's.
 const askers=new Map(handedRows.filter(row=>row.answers_person&&!row.parent).map(row=>[row.run,{id:row.to_agent,name:row.to_name}] as const));
 const cards=[...madeRows.flatMap(({run_id,call_id,created_at,hermes_agents:agent})=>agent&&!requested.has(`${run_id}:${call_id}`)?[{run_id,at:created_at,card:{kind:'made',agent:{id:agent.id,connection_id:agent.connection_id,name:agent.name,job:agent.speciality,apps:agent.apps||[],fresh:isNewFor(agent,person),created_at}}} satisfies {run_id:string,at:string,card:LeadCard}]:[]),
  ...requestRows.map(row=>({run_id:row.run_id,at:row.created_at,card:{kind:'request',request:requestView(row)}} satisfies {run_id:string,at:string,card:LeadCard})),
  ...handed,
  ...accessRows.map(row=>({run_id:row.run_id,at:row.created_at,card:{kind:'access',access:accessView(row)}} satisfies {run_id:string,at:string,card:LeadCard})),
  ...changeRows.flatMap(row=>row.agent&&row.by?[{run_id:row.run_id,at:row.created_at,card:{kind:'change',change:changeView({...row,agent:row.agent,by:row.by})}} satisfies {run_id:string,at:string,card:LeadCard}]:[]),
  ...replyRows.flatMap(row=>{ const card=handPickup(replyCardOf(row,states),queued,messages as {author:string,created_at:string}[]); const asker=askers.get(row.run_id); return card?[{run_id:row.run_id,at:row.created_at,card:{kind:'reply',card},...questionParts(row,card),...saidParts(row),...(asker?{asker}:{})} satisfies PlacedCard]:[]; }),
  ...(morning&&found.good_morning?[{run_id:`good-morning:${found.good_morning}`,at:messages[0]?.created_at??'',card:{kind:'morning',morning}} satisfies PlacedCard]:[])];
 type SavedRow={id:string,run_id:string,agent_id:string|null,removed_at:string|null,said_at:string,body:string,suggestion:'pending'|'approved'|'rejected'|null,decided_at:string|null,decider:{name:string}|null};
 const sentTo=rows.some(row=>row.suggestion)?new Map((((await db.rpc('rule_suggestions_sent_to',{conversation})).data||[]) as {rule:string,sent_to:string[]}[]).map(row=>[row.rule,row.sent_to])):new Map<string,string[]>();
 const saved=rows.map(row=>({run_id:row.run_id,rule:{id:row.id,agent:row.agent_id,removed:row.removed_at!==null,said_at:row.said_at,...(row.suggestion?{sentTo:sentTo.get(row.id)||[]}:{})} satisfies SavedRule}));
 const decisions=[...rows.flatMap(row=>row.decided_at?[{kind:'rule',approved:row.suggestion==='approved',by:row.decider?.name||'',rule:row.body,at:row.decided_at} satisfies Decision]:[]),
  ...accessRows.flatMap(row=>(row.state==='opened'||row.state==='declined')&&row.answered_at?[{kind:'access',by:row.answerer,at:row.answered_at,...(row.state==='opened'?{opened:true as const,agent:row.opened}:{opened:false as const})} satisfies Decision]:[]),
  ...requestRows.flatMap(row=>row.state!=='waiting'&&row.answered_at?[{kind:'request',by:row.answerer?.name||'',name:row.agent_name,at:row.answered_at,...(row.state==='made'?{made:true as const}:{made:false as const,reason:row.reason||''})} satisfies Decision]:[])];
 const {data:permit}=replyRows.some(row=>row.kind==='permission'&&row.state==='open')?await db.rpc('permission_choices',{c:company}):{data:null};
 const runner=(working as {person:string,name:string}[]|null)?.[0];
 const {data:manages}=runner&&runner.person!==person?await db.rpc('can_manage_company',{target:company}):{data:false};
 const board=card&&{card:card.card,column:card.column};
 // A reply that failed for a cause a retry cannot fix (#422, #457) says so: the Owner fixes it, a Member asks the Owner.
 const ended=latestEnd(messages,ends);
 const reason: 'credit'|'key'|'model'|'access'|null=ended==='no_credit'?'credit':ended==='key_refused'?'key':ended==='model_missing'?'model':ended==='no_access'?'access':null;
 const {data:ownsIt}=ended==='no_model'||reason?await db.rpc('is_company_owner',{c:company}):{data:false};
 // A job command's target answers the person (#358), so a refusal of its model call names that Agent, not the chat's (#530).
 const lastRun=messages.filter(message=>message.author==='person').at(-1)?.run_id;
 const commanded=reason?handedRows.find(row=>row.answers_person&&row.run===lastRun&&!row.parent):undefined;
 // A Run whose every account ran out says when its usage resets, when the Engine named it (#642).
 const resetsAt=reason==='access'?resets.find(row=>row.run_id===lastRun)?.resets_at:undefined;
 // Only a Card the chat put on the board says so; a chat started from its Card (#145) found it there. A chat with Lead
 // gets its Card when Lead hands the work over (#147), so its line goes under the handover's answer: the follow-up reply
 // of a Run no message of the person started. A job command's answer (#358) is a message from an Agent the chat handed
 // work to, never the chat's Agent's, so it is never taken for that answer.
 const first=messages.find(message=>message.author==='person');
 const firstReply=card&&first&&card.created_at>first.created_at
  ?(lead
   ?messages.find(message=>message.author==='agent'&&!(message.agent_id&&faces.has(message.agent_id))&&!messages.some(own=>own.author==='person'&&own.run_id===message.run_id))
   :messages.find(message=>message.author==='agent'&&message.run_id===first.run_id))?.id
  :undefined;
 return {
  conversation:{id:found.id,agent_id:found.agent_id,agent_name:found.agent_name,face:faceOf(found)},
  // What the poll sends back to ask whether anything changed since this read (#767); left out when it could not be read.
  ...await stamped.then(stamp=>stamp?{stamp}:{}),
  ...(found.good_morning_day?{morningDay:found.good_morning_day}:{}),
  messages:withBoardNote(withTeamWork(withHandedOn(withHandoverAnswers(withDecisions(shown(messages,ends,cards,found.agent_name,saved,[],files),decisions,found.agent_name),answers),handedOn),notes,queued,me?.name||'',files,waiting(messages,ends,commandRuns).length>0),firstReply)
   .map(message=>message.agent_id&&faces.has(message.agent_id)?{...message,face:faces.get(message.agent_id)}:message),
  usage:null as SessionUsage|null,
  pending:waiting(messages,ends,commandRuns).length>0||queuedWaiting(queued),
  ...(moving?{handover:true as const}:{}),
  ...(lead?{lead:true as const}:{}),
  ...(replyRows.some(row=>row.kind==='question'&&row.state==='open')?{asking:true as const}:{}),
  ...(permit?{permit:permit as PermissionChoice[]}:{}),
  ...(connect?{connect}:{}),
  ...(ownsChanges===true?{changeOwner:true as const,...((mode as {work_mode?:string}|null)?.work_mode==='alone'?{alone:true as const}:{})}:{}),
  failed:ended!==null,
  ...(ended==='no_model'?{noModel:{owner:ownsIt===true}}:{}),
  ...(reason?{modelRefused:{reason,owner:ownsIt===true,...(commanded?{agent:commanded.to_name}:{}),...(resetsAt?{resetsAt}:{})}}:{}),
  working:runner?.name??null,
  // A turn waiting behind another person's Run says whom the Agent works for (#763).
  ...(runner&&runner.person!==person?{workingFor:runner.name}:{}),
  canStop:!!runner&&(runner.person===person||manages===true),
  ...(board?{board}:{}),
 };
}
export type ConversationRecord=Awaited<ReturnType<typeof conversationRecord>>&{unread?:true};
// The Conversation's own rows could not be read (#768): a state of its own, never an empty Conversation.
class ConversationUnread extends Error { constructor() { super('conversationUnread'); this.name='ConversationUnread'; } }

// Each reply's steps and the Conversation's token use, read from its Agent's Hermes session (#346, #347) on their own
// request, after the messages are drawn (ADR 0030, #766): by the id of the reply they go under. Null when the session
// cannot be read, which changes nothing on the page. `session` reads it; nothing of it is kept (ADR 0017).
export type ConversationSteps={steps:Record<number,RunSteps>,usage:SessionUsage|null};
export async function conversationSteps(db:Database,found:{id:string,agent_id:string|null,hermes_session_id?:string|null},session:(agent:string,session:string)=>Promise<{turns:SessionTurn[],usage:SessionUsage|null}|null>):Promise<ConversationSteps|null> {
 if(!found.agent_id||!found.hermes_session_id) return {steps:{},usage:null};
 const [{data},read]=await Promise.all([
  db.from('conversation_messages').select('id,author,run_id,created_at').eq('conversation_id',found.id).order('id'),
  session(found.agent_id,found.hermes_session_id).catch(()=>null),
 ]);
 if(!read) return null;
 const messages=(data||[]) as {id:number,author:string,run_id:string,created_at:string}[];
 const byRun=new Map(messages.filter(message=>message.author==='agent').map(message=>[message.run_id,message.id]));
 const steps:Record<number,RunSteps>={};
 for(const row of stepsOfReplies(messages,read.turns)) { const id=byRun.get(row.run_id); if(id!==undefined) steps[id]={list:row.steps,seconds:row.seconds}; }
 return {steps,usage:read.usage};
}

// A done hand card says its turn could not start until its person writes to the Agent after that.
const handPickup=(card:ReplyCard|null,queued:QueuedTurn[],messages:{author:string,created_at:string}[]):ReplyCard|null=>{
 if(card?.kind!=='hand'||card.state!=='done') return card;
 const failed=queued.find(turn=>handTurn(turn)&&turn.hand_card===card.id&&turn.failed_at)?.failed_at;
 const written=!!failed&&(messages.some(message=>message.author==='person'&&message.created_at>failed)||queued.some(turn=>!handTurn(turn)&&turn.queued_at>failed));
 return failed&&!written?{...card,failed:true}:card;
};

// The chat's Card on the board (#144), the one it put there or was started from (#145), with its column now: "Waiting
// on you" while the chat waits on its person (#146).
export async function tiedCard(db:Database,company:string,conversation:string) {
 const {data}=await db.from('work_cards').select('id,created_at,stage_id,wait:card_wait,work_stages(id,board_column)').eq('company_id',company).eq('conversation_id',conversation).maybeSingle();
 const card=data as {id:number,created_at:string,stage_id:number,wait:CardWait|null,work_stages:{id:number,board_column:BoardColumn}|null}|null;
 return card?.work_stages?{card:card.id,column:columnOf(card,[card.work_stages]) as BoardColumn,created_at:card.created_at}:undefined;
}
