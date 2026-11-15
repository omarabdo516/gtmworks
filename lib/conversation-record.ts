import type { supabase } from './supabase';
import { faceOf, latestEnded, messageColumns, noteColumns, queuedColumns, queuedWaiting, shown, totalOf, usageColumns, waiting, withTeamWork, type MadeAgent, type QueuedTurn, type SavedRule, type RunUsage, type StoredNote } from './conversations';
import { isNewFor } from './sidebar.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;

// The record of one conversation as its page and the conversation route show it, read with the person's own session
// (RLS): messages, notes addressed to a person, turns still waiting, the usage of ended runs, who the Agent is working
// for, and whether this person may stop the open run (its own person, or a Manager or Owner of the Company; the
// database checks that again when they stop it), the Agents Lead made in it (an Agent since removed has no card) and
// the rules its Agent saved in it.
export async function conversationRecord(db:Database,person:string,company:string,found:{id:string,agent_name:string,hermes_agents:unknown}) {
 const conversation=found.id;
 // Usage first: a run closed between the two reads then shows its reply too (both are written in one transaction).
 const usage=((await db.from('conversation_usage').select(usageColumns).eq('conversation_id',conversation)).data||[]) as RunUsage[];
 const messages=(await db.from('conversation_messages').select(messageColumns).eq('conversation_id',conversation).order('id')).data||[];
 const notes=((await db.from('conversation_notes').select(noteColumns).eq('conversation_id',conversation).order('id')).data||[]) as StoredNote[];
 const queued=((await db.from('conversation_queued_turns').select(queuedColumns).eq('conversation_id',conversation).order('queued_at')).data||[]) as QueuedTurn[];
 type MadeRow={run_id:string,created_at:string,hermes_agents:{id:string,connection_id:string,name:string,speciality:string,apps:string[]|null,is_default:boolean,requested_by:string|null,requester_opened_at:string|null}|null};
 const made=(((await db.from('lead_made_agents').select('run_id,created_at,hermes_agents(id,connection_id,name,speciality,apps,is_default,requested_by,requester_opened_at)').eq('conversation_id',conversation).order('created_at')).data||[]) as unknown as MadeRow[])
  .flatMap(({run_id,created_at,hermes_agents:agent})=>agent?[{run_id,agent:{id:agent.id,connection_id:agent.connection_id,name:agent.name,job:agent.speciality,apps:agent.apps||[],fresh:isNewFor(agent,person),created_at} satisfies MadeAgent}]:[]);
 type SavedRow={id:string,run_id:string,agent_id:string|null,removed_at:string|null,said_at:string};
 const saved=(((await db.from('agent_rules').select('id,run_id,agent_id,removed_at,said_at').eq('conversation_id',conversation).order('said_at')).data||[]) as SavedRow[])
  .map(row=>({run_id:row.run_id,rule:{id:row.id,agent:row.agent_id,removed:row.removed_at!==null,said_at:row.said_at} satisfies SavedRule}));
 const {data:working}=await db.rpc('conversation_working_for',{conversation});
 const runner=(working as {person:string,name:string}[]|null)?.[0];
 const {data:manages}=runner&&runner.person!==person?await db.rpc('can_manage_company',{target:company}):{data:false};
 const {data:me}=await db.from('people').select('name').eq('id',person).maybeSingle();
 return {
  conversation:{id:found.id,agent_name:found.agent_name,face:faceOf(found)},
  messages:withTeamWork(shown(messages,usage,made,found.agent_name,saved),notes,queued,me?.name||''),
  usage:totalOf(usage),
  pending:waiting(messages,usage).length>0||queuedWaiting(queued),
  failed:latestEnded(messages,usage),
  working:runner?.name??null,
  canStop:!!runner&&(runner.person===person||manages===true),
 };
}
export type ConversationRecord=Awaited<ReturnType<typeof conversationRecord>>;
