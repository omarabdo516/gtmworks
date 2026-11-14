import type { supabase } from './supabase';
import { faceOf, latestEnded, messageColumns, noteColumns, queuedColumns, queuedWaiting, shown, totalOf, usageColumns, waiting, withTeamWork, type QueuedTurn, type RunUsage, type StoredNote } from './conversations';

type Database=Awaited<ReturnType<typeof supabase>>;

// The record of one conversation as its page and the conversation route show it, read with the person's own session
// (RLS): messages, notes addressed to a person, turns still waiting, the usage of ended runs, who the Agent is working
// for, and whether this person may stop the open run (its own person, or a Manager or Owner of the Company; the
// database checks that again when they stop it).
export async function conversationRecord(db:Database,person:string,company:string,found:{id:string,agent_name:string,hermes_agents:unknown}) {
 const conversation=found.id;
 // Usage first: a run closed between the two reads then shows its reply too (both are written in one transaction).
 const usage=((await db.from('conversation_usage').select(usageColumns).eq('conversation_id',conversation)).data||[]) as RunUsage[];
 const messages=(await db.from('conversation_messages').select(messageColumns).eq('conversation_id',conversation).order('id')).data||[];
 const notes=((await db.from('conversation_notes').select(noteColumns).eq('conversation_id',conversation).order('id')).data||[]) as StoredNote[];
 const queued=((await db.from('conversation_queued_turns').select(queuedColumns).eq('conversation_id',conversation).order('queued_at')).data||[]) as QueuedTurn[];
 const {data:working}=await db.rpc('conversation_working_for',{conversation});
 const runner=(working as {person:string,name:string}[]|null)?.[0];
 const {data:manages}=runner&&runner.person!==person?await db.rpc('can_manage_company',{target:company}):{data:false};
 const {data:me}=await db.from('people').select('name').eq('id',person).maybeSingle();
 return {
  conversation:{id:found.id,agent_name:found.agent_name,face:faceOf(found)},
  messages:withTeamWork(shown(messages,usage),notes,queued,me?.name||''),
  usage:totalOf(usage),
  pending:waiting(messages,usage).length>0||queuedWaiting(queued),
  failed:latestEnded(messages,usage),
  working:runner?.name??null,
  canStop:!!runner&&(runner.person===person||manages===true),
 };
}
export type ConversationRecord=Awaited<ReturnType<typeof conversationRecord>>;
