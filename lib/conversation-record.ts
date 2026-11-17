import type { supabase } from './supabase';
import { faceOf, latestEnded, messageColumns, noteColumns, queuedColumns, queuedWaiting, questionParts, replyCardColumns, replyCardOf, shown, totalOf, usageColumns, waiting, withBoardNote, withDecisions, withTeamWork, type AgentRequestView, type Decision, type LeadCard, type PlacedCard, type QueuedTurn, type ReplyCardRow, type SavedRule, type RunUsage, type StoredNote } from './conversations';
import { isNewFor } from './sidebar.mjs';
import type { BoardColumn } from './board-columns.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;

// The record of one conversation as its page and the conversation route show it, read with the person's own session
// (RLS): messages, notes addressed to a person, turns still waiting, the usage of ended runs, who the Agent is working
// for, and whether this person may stop the open run (its own person, or a Manager or Owner of the Company; the
// database checks that again when they stop it), the Agents Lead made in it (an Agent since removed has no card), the
// Agents its person asked Lead for and the Owner's answer (#17), the cards its Agent showed with its replies (#136), the
// rules its Agent saved in it: a suggestion with who it was sent to, and how it was decided (RLS: only the person who
// told it reads one that is not the team's), the Card it put on the board with that Card's column now (#144), and the
// questions its Agent asked with their answers (#138); while one waits for its answer the record says so (`asking`).
export async function conversationRecord(db:Database,person:string,company:string,found:{id:string,agent_id:string|null,agent_name:string,hermes_agents:unknown}) {
 const conversation=found.id;
 // Usage first: a run closed between the two reads then shows its reply too (both are written in one transaction).
 const usage=((await db.from('conversation_usage').select(usageColumns).eq('conversation_id',conversation)).data||[]) as RunUsage[];
 const messages=(await db.from('conversation_messages').select(messageColumns).eq('conversation_id',conversation).order('id')).data||[];
 const notes=((await db.from('conversation_notes').select(noteColumns).eq('conversation_id',conversation).order('id')).data||[]) as StoredNote[];
 const queued=((await db.from('conversation_queued_turns').select(queuedColumns).eq('conversation_id',conversation).order('queued_at')).data||[]) as QueuedTurn[];
 // Requests first: an Owner's yes writes the request's state and the made Agent in one transaction, so a made request
 // read here always finds its Agent in the read after it.
 type RequestRow={id:number,run_id:string,call_id:string,agent_name:string,job:string,apps:string[],asked_with:string,state:AgentRequestView['state'],answered_at:string|null,reason:string|null,created_at:string,answerer:{name:string}|null,asker:{name:string}|null};
 const requestRows=((await db.from('lead_agent_requests').select('id,run_id,call_id,agent_name,job,apps,asked_with,state,answered_at,reason,created_at,answerer:people!answered_by(name),asker:people!asked_by(name)').eq('conversation_id',conversation).order('id')).data||[]) as unknown as RequestRow[];
 type MadeRow={run_id:string,call_id:string,created_at:string,hermes_agents:{id:string,connection_id:string,name:string,speciality:string,apps:string[]|null,is_default:boolean,requested_by:string|null,requester_opened_at:string|null}|null};
 const madeRows=((await db.from('lead_made_agents').select('run_id,call_id,created_at,hermes_agents(id,connection_id,name,speciality,apps,is_default,requested_by,requester_opened_at)').eq('conversation_id',conversation).order('created_at')).data||[]) as unknown as MadeRow[];
 const replyRows=((await db.from('reply_cards').select(replyCardColumns).eq('conversation_id',conversation).order('id')).data||[]) as ReplyCardRow[];
 const lead=(found.hermes_agents as {is_default?:boolean}|null)?.is_default===true;
 const owners=requestRows.some(row=>row.state==='waiting')?((((await db.from('members').select('people(name)').eq('company_id',company).eq('role','owner').is('removed_at',null)).data||[]) as unknown as {people:{name:string}|null}[])
  .flatMap(row=>row.people?[row.people.name]:[]).sort()):[];
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
  ...replyRows.flatMap(row=>{ const card=replyCardOf(row); return card?[{run_id:row.run_id,at:row.created_at,card:{kind:'reply',card},...questionParts(row,card,lead)} satisfies PlacedCard]:[]; })];
 type SavedRow={id:string,run_id:string,agent_id:string|null,removed_at:string|null,said_at:string,body:string,suggestion:'pending'|'approved'|'rejected'|null,decided_at:string|null,decider:{name:string}|null};
 const rows=((await db.from('agent_rules').select('id,run_id,agent_id,removed_at,said_at,body,suggestion,decided_at,decider:people!decided_by(name)').eq('conversation_id',conversation).order('said_at')).data||[]) as unknown as SavedRow[];
 const sentTo=rows.some(row=>row.suggestion)?new Map((((await db.rpc('rule_suggestions_sent_to',{conversation})).data||[]) as {rule:string,sent_to:string[]}[]).map(row=>[row.rule,row.sent_to])):new Map<string,string[]>();
 const saved=rows.map(row=>({run_id:row.run_id,rule:{id:row.id,agent:row.agent_id,removed:row.removed_at!==null,said_at:row.said_at,...(row.suggestion?{sentTo:sentTo.get(row.id)||[]}:{})} satisfies SavedRule}));
 const decisions=[...rows.flatMap(row=>row.decided_at?[{kind:'rule',approved:row.suggestion==='approved',by:row.decider?.name||'',rule:row.body,at:row.decided_at} satisfies Decision]:[]),
  ...requestRows.flatMap(row=>row.state!=='waiting'&&row.answered_at?[{kind:'request',by:row.answerer?.name||'',name:row.agent_name,at:row.answered_at,...(row.state==='made'?{made:true as const}:{made:false as const,reason:row.reason||''})} satisfies Decision]:[])];
 const {data:working}=await db.rpc('conversation_working_for',{conversation});
 const runner=(working as {person:string,name:string}[]|null)?.[0];
 const {data:manages}=runner&&runner.person!==person?await db.rpc('can_manage_company',{target:company}):{data:false};
 const {data:me}=await db.from('people').select('name').eq('id',person).maybeSingle();
 const card=await tiedCard(db,company,conversation);
 const board=card&&{card:card.card,column:card.column};
 // Only a Card the chat's first Run put on the board says so; a chat started from its Card (#145) found it there.
 const first=messages.find(message=>message.author==='person');
 const firstReply=card&&first&&card.created_at>first.created_at?messages.find(message=>message.author==='agent'&&message.run_id===first.run_id)?.id:undefined;
 return {
  conversation:{id:found.id,agent_id:found.agent_id,agent_name:found.agent_name,face:faceOf(found)},
  messages:withBoardNote(withTeamWork(withDecisions(shown(messages,usage,cards,found.agent_name,saved),decisions,found.agent_name),notes,queued,me?.name||''),firstReply),
  usage:totalOf(usage),
  pending:waiting(messages,usage).length>0||queuedWaiting(queued),
  ...(replyRows.some(row=>row.kind==='question'&&row.state==='open')?{asking:true as const}:{}),
  failed:latestEnded(messages,usage),
  working:runner?.name??null,
  canStop:!!runner&&(runner.person===person||manages===true),
  ...(board?{board}:{}),
 };
}
export type ConversationRecord=Awaited<ReturnType<typeof conversationRecord>>;

// The chat's Card on the board (#144), the one it put there or was started from (#145), with its column now.
export async function tiedCard(db:Database,company:string,conversation:string) {
 const {data}=await db.from('work_cards').select('id,created_at,work_stages(board_column)').eq('company_id',company).eq('conversation_id',conversation).maybeSingle();
 const card=data as {id:number,created_at:string,work_stages:{board_column:BoardColumn}|null}|null;
 return card?.work_stages?{card:card.id,column:card.work_stages.board_column,created_at:card.created_at}:undefined;
}
