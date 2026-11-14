// The conversation record as the page shows it: run ids stay on the server. A note is a person's message addressed to
// another Member (`to`, no run); a queued message waits for the Agent to finish the current reply (`queued`), or was
// not sent because the engine would not start it (`failed`).
export type ConversationMessage={id:number,author:'person'|'agent',author_name:string,body:string,lost?:boolean,created_at:string,kind?:'note'|'queued',to?:string,failed?:boolean};
type StoredMessage=ConversationMessage&{run_id:string};
export const messageColumns='id,author,author_name,body,run_id,created_at';
export const conversationColumns='id,agent_id,agent_name,hermes_agents(connection_id)';
// A person's message whose run Hermes no longer knew is marked lost (#243), from the run's usage record.
export const shown=(messages:StoredMessage[],usage:{run_id:string,outcome:string}[]=[])=>messages.map(message=>({id:message.id,author:message.author,author_name:message.author_name,body:message.body,lost:message.author==='person'&&usage.some(run=>run.run_id===message.run_id&&run.outcome==='lost'),created_at:message.created_at}));
// What each ended run used, as Hermes reported it; null tokens are unknown, never zero.
export type RunUsage={run_id:string,outcome:'completed'|'stopped'|'lost'|'failed',input_tokens:number|null,output_tokens:number|null};
export const usageColumns='run_id,outcome,input_tokens,output_tokens';
export type UsageTotal={input:number,output:number,unknown:number};
export const totalOf=(usage:RunUsage[]):UsageTotal=>usage.reduce((total,run)=>run.input_tokens===null||run.output_tokens===null?{...total,unknown:total.unknown+1}:{...total,input:total.input+Number(run.input_tokens),output:total.output+Number(run.output_tokens)},{input:0,output:0,unknown:0});
// A person's message whose run has no stored reply yet and has not been recorded as ended.
export const waiting=(messages:StoredMessage[],usage:RunUsage[]=[])=>messages.filter(message=>message.author==='person'&&!messages.some(other=>other.author==='agent'&&other.run_id===message.run_id)&&!usage.some(run=>run.run_id===message.run_id));
// Whether the latest message's run was recorded as ended without a reply (stopped, lost or failed).
export const latestEnded=(messages:StoredMessage[],usage:RunUsage[])=>{ const latest=messages.filter(message=>message.author==='person').at(-1); return !!latest&&usage.some(run=>run.run_id===latest.run_id&&run.outcome!=='completed'); };
export const titleOf=(messages:ConversationMessage[],agentName:string)=>messages[0]?.body.split('\n')[0]||agentName;
// The agent's face is drawn from its Connection, as on the Agents page; a detached agent keeps a stable face from the conversation.
export const faceOf=(conversation:{id:string,hermes_agents:unknown})=>(conversation.hermes_agents as {connection_id:string}|null)?.connection_id||conversation.id;
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Notes to a person and turns still waiting join the record: notes in the order they were written, waiting turns after
// everything already sent (they start in that order). A started turn is an ordinary message and is not repeated.
export type StoredNote={id:number,author_name:string,addressed_name:string,body:string,created_at:string};
export type QueuedTurn={send_key:string,message:string,queued_at:string,started_at:string|null,failed_at:string|null};
export const noteColumns='id,author_name,addressed_name,body,created_at';
export const queuedColumns='send_key,message,queued_at,started_at,failed_at';
export const withTeamWork=(record:ConversationMessage[],notes:StoredNote[]=[],queued:QueuedTurn[]=[],sender=''):ConversationMessage[]=>{
 // The record keeps its own order (by id); each note goes before the first message written after it.
 const merged:ConversationMessage[]=[]; const left=[...notes].sort((a,b)=>a.id-b.id);
 for(const message of record) { while(left.length&&left[0].created_at<=message.created_at) merged.push(noteOf(left.shift()!)); merged.push(message); }
 return [...merged,...left.map(noteOf),
  ...queued.filter(turn=>!turn.started_at).map((turn,index)=>({id:index,author:'person' as const,author_name:sender,body:turn.message,created_at:turn.queued_at,kind:'queued' as const,...(turn.failed_at?{failed:true}:{})}))];
};
const noteOf=(note:StoredNote):ConversationMessage=>({id:note.id,author:'person',author_name:note.author_name,body:note.body,created_at:note.created_at,kind:'note',to:note.addressed_name});
// Waiting turns keep the page asking until they have started and been answered.
export const queuedWaiting=(queued:QueuedTurn[])=>queued.some(turn=>!turn.started_at&&!turn.failed_at);
