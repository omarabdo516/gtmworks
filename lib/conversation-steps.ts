import 'server-only';
import type { supabase } from './supabase';
import type { SessionUsage } from './engine.mjs';
import { readAgentSession } from './company-apps.mjs';
import { companyEngine, seenAgents } from './engine/handle.mjs';
import { stepsOfReplies, type RunStep, type RunSteps, type SessionTurn } from './conversations';

type Database=Awaited<ReturnType<typeof supabase>>;

// Each reply's steps and the Conversation's token use, read from its Agent's Hermes session (#346, #347) on their own
// request, after the messages are drawn (ADR 0030, #766): by the id of the reply they go under. Null when the session
// cannot be read, which changes nothing on the page. The server's alone: it reads through the Engine handle. notSeen when the Engine handle does not give this reader the
// Agent (hidden from them, #782): nothing is asked of the Engine. Nothing of it is kept (ADR 0017).
export type ConversationSteps={steps:Record<number,RunSteps>,usage:SessionUsage|null};
type EngineStep=Omit<RunStep,'card'>&{card?:{id:string,title:string,profile:string}};
// A Card the Agent made in a turn (#844) is named by the Agent its profile runs, as the board names it
// (lib/company-board.mjs): one given to an Agent hidden from the reader is no row of theirs, as it is on no board of
// theirs, and one given to a profile that is no Agent of the Company's names no Agent. The profile never leaves here.
type Seen={agent:string,name?:unknown,connection?:unknown,profile?:unknown}[];
function namedCards(turns:{at:number,seconds:number,steps:EngineStep[]}[],seen:Seen,profiles:string[]):SessionTurn[] {
 const byProfile=new Map<string,{id:string,name:string,face:string}>();
 for(const row of seen) if(typeof row.profile==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??''),face:String(row.connection??row.agent)});
 return turns.map(turn=>({...turn,steps:turn.steps.map(({card,...step})=>{
  if(!card) return step;
  const agent=byProfile.get(card.profile)??null;
  return agent||!profiles.includes(card.profile)?{...step,card:{id:card.id,title:card.title,agent}}:step;
 })}));
}
export async function conversationSteps(db:Database,company:string,found:{id:string,agent_id:string|null,hermes_session_id?:string|null}):Promise<ConversationSteps|'notSeen'|null> {
 if(!found.agent_id||!found.hermes_session_id) return {steps:{},usage:null};
 const [{data},read]=await Promise.all([
  db.from('conversation_messages').select('id,author,run_id,created_at').eq('conversation_id',found.id).order('id'),
  readAgentSession(db,{company,agent:found.agent_id,session:found.hermes_session_id}),
 ]);
 if(read==='notSeen') return read;
 if(!read) return null;
 const made=read.turns.some(turn=>turn.steps.some(step=>step.card));
 const [seen,engine]=made?await Promise.all([seenAgents(db,company),companyEngine(company,{reader:db})]):[[],null];
 const messages=(data||[]) as {id:number,author:string,run_id:string,created_at:string}[];
 const byRun=new Map(messages.filter(message=>message.author==='agent').map(message=>[message.run_id,message.id]));
 const steps:Record<number,RunSteps>={};
 for(const row of stepsOfReplies(messages,namedCards(read.turns,seen??[],engine?.profiles??[]))) { const id=byRun.get(row.run_id); if(id!==undefined) steps[id]={list:row.steps,seconds:row.seconds}; }
 return {steps,usage:read.usage};
}
