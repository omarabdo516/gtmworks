import type { supabase } from './supabase';
import { readAgentSession } from './company-apps.mjs';
import { stepsOfReplies, type RunSteps } from './conversations';
import type { ConversationSteps } from './conversation-record';

type Database=Awaited<ReturnType<typeof supabase>>;

// A module of the server alone: it reads through the Engine handle, which a screen's code never imports.
// Each reply's steps and the Conversation's token use, read from its Agent's Hermes session (#346, #347) on their own
// request, after the messages are drawn (ADR 0030, #766): by the id of the reply they go under. Null when the session
// cannot be read, which changes nothing on the page. notSeen when the Engine handle does not give this reader the
// Agent (hidden from them, #782): nothing is asked of the Engine. Nothing of it is kept (ADR 0017).
export async function conversationSteps(db:Database,company:string,found:{id:string,agent_id:string|null,hermes_session_id?:string|null}):Promise<ConversationSteps|'notSeen'|null> {
 if(!found.agent_id||!found.hermes_session_id) return {steps:{},usage:null};
 const [{data},read]=await Promise.all([
  db.from('conversation_messages').select('id,author,run_id,created_at').eq('conversation_id',found.id).order('id'),
  readAgentSession(db,{company,agent:found.agent_id,session:found.hermes_session_id}).catch(()=>null),
 ]);
 if(read==='notSeen') return read;
 if(!read) return null;
 const messages=(data||[]) as {id:number,author:string,run_id:string,created_at:string}[];
 const byRun=new Map(messages.filter(message=>message.author==='agent').map(message=>[message.run_id,message.id]));
 const steps:Record<number,RunSteps>={};
 for(const row of stepsOfReplies(messages,read.turns)) { const id=byRun.get(row.run_id); if(id!==undefined) steps[id]={list:row.steps,seconds:row.seconds}; }
 return {steps,usage:read.usage};
}
