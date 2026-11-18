import { ownerNames } from './company-owners.mjs';
import type { supabase } from './supabase';
import type { PermissionChoice, SessionUsage } from './engine.mjs';
import type { AppStates } from './conversations';
import { faceOf, handTurn, latestEnded, messageColumns, noteColumns, queuedColumns, queuedWaiting, questionParts, replyCardColumns, replyCardOf, shown, stepsOfReplies, waiting, withBoardNote, withDecisions, withTeamWork, type AgentRequestView, type Decision, type LeadCard, type PlacedCard, type QueuedTurn, type ReplyCard, type ReplyCardRow, type RunStep, type SavedRule, type RunEnd, type StoredNote } from './conversations';
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
// questions its Agent asked with their answers (#138); while one waits for its answer the record says so (`asking`). Each
// reply carries the tool calls of its Run (#141), read from the Agent's Hermes session as the chat opens (#346), never kept, and the
// Conversation's token use is that session's own (#347), null while it cannot be read. While a request to
// allow an action waits (#163), the record says which choices this person may send (`permit`); the Run is still working. The
// turn a hand card's "Done it" started (#140) is drawn by that card alone, which says when that turn could not start.
// A connect card (#203) shows its app's state in the Agent's profile now (`apps`, read only while one is open); the record
// says whether this person is the Owner who connects it, and else who does (`connect`).
export async function conversationRecord(db:Database,person:string,company:string,found:{id:string,agent_id:string|null,agent_name:string,hermes_session_id?:string|null,hermes_agents:unknown},apps?:(agent:string)=>Promise<AppStates>,session?:(agent:string,session:string)=>Promise<{turns:{at:number,seconds:number,steps:RunStep[]}[],usage:SessionUsage|null}|null>) {
 const conversation=found.id;
 // The session is read beside the database, so the Engine adds no wait of its own to opening the chat.
 const read=session&&found.agent_id&&found.hermes_session_id?session(found.agent_id,found.hermes_session_id).catch(()=>null):Promise.resolve(null);
 // The record's reads go out together, each one round trip, so a busy machine adds one wait and not a chain of them to
 // opening the chat (decision 0042). The messages with how their runs ended and the turns still waiting, and the requests
 // for an Agent with the Agents made for them, are read in one statement (one snapshot): a run closed in one transaction
 // with its reply shows both or neither, and an Owner's yes, which writes the request's state and the made Agent in one
 // transaction, is never seen in half.
 type RequestRow={id:number,run_id:string,call_id:string,agent_name:string,job:string,apps:string[],asked_with:string,state:AgentRequestView['state'],answered_at:string|null,reason:string|null,created_at:string,answerer:{name:string}|null,asker:{name:string}|null};
 type Message={id:number,author:'person'|'agent',author_name:string,body:string,run_id:string,hand_card:number|null,created_at:string};
 type MadeRow={run_id:string,call_id:string,created_at:string,hermes_agents:{id:string,connection_id:string,name:string,speciality:string,apps:string[]|null,is_default:boolean,requested_by:string|null,requester_opened_at:string|null}|null};
 const [{ends,messages,queued,requestRows,madeRows},notes,replyRows,rows,{data:working},{data:me},card]=await Promise.all([
  db.from('conversations').select(`conversation_run_ends(run_id,outcome),conversation_messages(${messageColumns}),conversation_queued_turns(${queuedColumns}),`
   +'lead_agent_requests(id,run_id,call_id,agent_name,job,apps,asked_with,state,answered_at,reason,created_at,answerer:people!answered_by(name),asker:people!asked_by(name)),'
   +'lead_made_agents(run_id,call_id,created_at,hermes_agents(id,connection_id,name,speciality,apps,is_default,requested_by,requester_opened_at))')
   .eq('id',conversation).order('id',{referencedTable:'conversation_messages'}).order('queued_at',{referencedTable:'conversation_queued_turns'})
   .order('id',{referencedTable:'lead_agent_requests'}).order('created_at',{referencedTable:'lead_made_agents'}).maybeSingle()
   .then(({data})=>{ const read=data as unknown as {conversation_run_ends:RunEnd[],conversation_messages:Message[],conversation_queued_turns:QueuedTurn[],lead_agent_requests:RequestRow[],lead_made_agents:MadeRow[]}|null;
    return {ends:read?.conversation_run_ends||[],messages:read?.conversation_messages||[],queued:read?.conversation_queued_turns||[],requestRows:read?.lead_agent_requests||[],madeRows:read?.lead_made_agents||[]}; }),
  db.from('conversation_notes').select(noteColumns).eq('conversation_id',conversation).order('id').then(({data})=>(data||[]) as StoredNote[]),
  db.from('reply_cards').select(replyCardColumns).eq('conversation_id',conversation).order('id').then(({data})=>(data||[]) as ReplyCardRow[]),
  db.from('agent_rules').select('id,run_id,agent_id,removed_at,said_at,body,suggestion,decided_at,decider:people!decided_by(name)').eq('conversation_id',conversation).order('said_at').then(({data})=>(data||[]) as unknown as SavedRow[]),
  db.rpc('conversation_working_for',{conversation}),
  db.from('people').select('name').eq('id',person).maybeSingle(),
  tiedCard(db,company,conversation),
 ]);
 const lead=(found.hermes_agents as {is_default?:boolean}|null)?.is_default===true;
 const asksForApps=replyRows.some(row=>row.kind==='connect');
 const states=apps&&found.agent_id&&replyRows.some(row=>row.kind==='connect'&&row.state==='open')?await apps(found.agent_id):null;
 const {data:isOwner}=asksForApps?await db.rpc('is_company_owner',{c:company}):{data:false};
 const connect=asksForApps?{owner:isOwner===true,owners:isOwner===true?[]:await ownerNames(db,company)}:null;
 const owners=requestRows.some(row=>row.state==='waiting')?await ownerNames(db,company):[];
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
 const cards=[...madeRows.flatMap(({run_id,call_id,created_at,hermes_agents:agent})=>agent&&!requested.has(`${run_id}:${call_id}`)?[{run_id,at:created_at,card:{kind:'made',agent:{id:agent.id,connection_id:agent.connection_id,name:agent.name,job:agent.speciality,apps:agent.apps||[],fresh:isNewFor(agent,person),created_at}}} satisfies {run_id:string,at:string,card:LeadCard}]:[]),
  ...requestRows.map(row=>({run_id:row.run_id,at:row.created_at,card:{kind:'request',request:requestView(row)}} satisfies {run_id:string,at:string,card:LeadCard})),
  ...replyRows.flatMap(row=>{ const card=handPickup(replyCardOf(row,states),queued,messages as {author:string,created_at:string}[]); return card?[{run_id:row.run_id,at:row.created_at,card:{kind:'reply',card},...questionParts(row,card,lead)} satisfies PlacedCard]:[]; })];
 type SavedRow={id:string,run_id:string,agent_id:string|null,removed_at:string|null,said_at:string,body:string,suggestion:'pending'|'approved'|'rejected'|null,decided_at:string|null,decider:{name:string}|null};
 const sentTo=rows.some(row=>row.suggestion)?new Map((((await db.rpc('rule_suggestions_sent_to',{conversation})).data||[]) as {rule:string,sent_to:string[]}[]).map(row=>[row.rule,row.sent_to])):new Map<string,string[]>();
 const saved=rows.map(row=>({run_id:row.run_id,rule:{id:row.id,agent:row.agent_id,removed:row.removed_at!==null,said_at:row.said_at,...(row.suggestion?{sentTo:sentTo.get(row.id)||[]}:{})} satisfies SavedRule}));
 const decisions=[...rows.flatMap(row=>row.decided_at?[{kind:'rule',approved:row.suggestion==='approved',by:row.decider?.name||'',rule:row.body,at:row.decided_at} satisfies Decision]:[]),
  ...requestRows.flatMap(row=>row.state!=='waiting'&&row.answered_at?[{kind:'request',by:row.answerer?.name||'',name:row.agent_name,at:row.answered_at,...(row.state==='made'?{made:true as const}:{made:false as const,reason:row.reason||''})} satisfies Decision]:[])];
 const {data:permit}=replyRows.some(row=>row.kind==='permission'&&row.state==='open')?await db.rpc('permission_choices',{c:company}):{data:null};
 const runner=(working as {person:string,name:string}[]|null)?.[0];
 const {data:manages}=runner&&runner.person!==person?await db.rpc('can_manage_company',{target:company}):{data:false};
 const board=card&&{card:card.card,column:card.column};
 // Only a Card the chat's first Run put on the board says so; a chat started from its Card (#145) found it there.
 const first=messages.find(message=>message.author==='person');
 const firstReply=card&&first&&card.created_at>first.created_at?messages.find(message=>message.author==='agent'&&message.run_id===first.run_id)?.id:undefined;
 return {
  conversation:{id:found.id,agent_id:found.agent_id,agent_name:found.agent_name,face:faceOf(found)},
  messages:withBoardNote(withTeamWork(withDecisions(shown(messages,ends,cards,found.agent_name,saved,stepsOfReplies(messages,(await read)?.turns??null)),decisions,found.agent_name),notes,queued,me?.name||''),firstReply),
  usage:(await read)?.usage??null,
  pending:waiting(messages,ends).length>0||queuedWaiting(queued),
  ...(replyRows.some(row=>row.kind==='question'&&row.state==='open')?{asking:true as const}:{}),
  ...(permit?{permit:permit as PermissionChoice[]}:{}),
  ...(connect?{connect}:{}),
  failed:latestEnded(messages,ends),
  working:runner?.name??null,
  canStop:!!runner&&(runner.person===person||manages===true),
  ...(board?{board}:{}),
 };
}
export type ConversationRecord=Awaited<ReturnType<typeof conversationRecord>>;

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
