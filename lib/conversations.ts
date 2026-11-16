// The conversation record as the page shows it: run ids stay on the server. A note is a person's message addressed to
// another Member (`to`, no run); a queued message waits for the Agent to finish the current reply (`queued`), or was
// not sent because the engine would not start it (`failed`).
// What Lead's turn of a run holds besides its words is a card: an Agent Lead made in it (#13), or a Member's request for
// an Agent kept in it (#17), which shows the Owner's answer once there is one. The card is in Lead's reply of that run;
// when Lead wrote nothing but the call, it is Lead's whole turn (`kind` made) after the message that asked.
// A lasting rule the Agent saved in a run (#18) shows as a saved line (`kind` saved) after the Agent's reply of that run,
// or after the message that told it when the reply was nothing but the call. A rule since removed keeps its line, since
// the Conversation is the record as people saw it; only its way to the Agent's page goes, with the Agent's.
// A Contributor's rule is a suggestion (#25): its line names who it was sent to (`sentTo`), and the Owner's or a
// Manager's decision shows as its own line (`kind` decided) at the time it was made, as an Owner's answer to a request
// does.
export type MadeAgent={id:string,connection_id:string,name:string,job:string,apps:string[],fresh:boolean,created_at:string};
// `owners` names whom a waiting request waits on ("When Omar says yes"); a made request's `agent` is null once removed.
type RequestBase={id:number,name:string,job:string,apps:string[],askedBy:string,askedWith:string};
export type AgentRequestView=RequestBase&({state:'waiting',owners:string[]}|{state:'made',by:string,at:string,agent:Pick<MadeAgent,'id'|'connection_id'|'name'>|null}|{state:'declined',by:string,at:string,reason:string});
export type LeadCard={kind:'made',agent:MadeAgent}|{kind:'request',request:AgentRequestView};
export type SavedRule={id:string,agent:string|null,removed:boolean,said_at:string,sentTo?:string[]};
type RuleDecision={approved:boolean,by:string,rule:string,at:string};
export type Decision=({kind:'rule'}&RuleDecision)|({kind:'request',by:string,name:string,at:string}&({made:true}|{made:false,reason:string}));
export type ConversationMessage={id:number,author:'person'|'agent',author_name:string,body:string,lost?:boolean,created_at:string,kind?:'note'|'queued'|'made'|'saved'|'decided'|'boarded',to?:string,failed?:boolean,cards?:LeadCard[],saved?:SavedRule[],decided?:Decision};
type StoredMessage=ConversationMessage&{run_id:string};
export const messageColumns='id,author,author_name,body,run_id,created_at';
export const conversationColumns='id,agent_id,agent_name,hermes_agents(connection_id)';
// A person's message whose run Hermes no longer knew is marked lost (#243), from the run's usage record.
export const shown=(messages:StoredMessage[],usage:{run_id:string,outcome:string}[]=[],leadCards:{run_id:string,card:LeadCard,at:string}[]=[],agentName='',saved:{run_id:string,rule:SavedRule}[]=[]):ConversationMessage[]=>messages.flatMap(message=>{
 const plain={id:message.id,author:message.author,author_name:message.author_name,body:message.body,lost:message.author==='person'&&usage.some(run=>run.run_id===message.run_id&&run.outcome==='lost'),created_at:message.created_at};
 const replied=message.author==='agent'||messages.some(other=>other.author==='agent'&&other.run_id===message.run_id);
 const ofRun=leadCards.filter(row=>row.run_id===message.run_id); const cards=ofRun.map(row=>row.card);
 const rules=saved.filter(row=>row.run_id===message.run_id).map(row=>row.rule);
 const turn:ConversationMessage[]=message.author==='agent'?[cards.length?{...plain,cards}:plain]
  :replied||!cards.length?[plain]:[plain,{id:message.id,author:'agent',author_name:agentName,body:'',created_at:ofRun[0].at,kind:'made',cards}];
 const last=message.author==='agent'||!replied;
 return last&&rules.length?[...turn,{id:message.id,author:'agent',author_name:agentName,body:'',created_at:rules[0].said_at,kind:'saved',saved:rules}]:turn;
});
// A Conversation that put its Card on the board (#144) says so once, under the Agent's reply to its first Run
// (`kind` boarded; design-reference: send's note after the first reply).
export const withBoardNote=(record:ConversationMessage[],reply:number|undefined):ConversationMessage[]=>record.flatMap(message=>
 message.author==='agent'&&!message.kind&&message.id===reply?[message,{id:message.id,author:'agent',author_name:message.author_name,body:'',created_at:message.created_at,kind:'boarded'}]:[message]);
// Each decision goes before the first item shown after it.
export const withDecisions=(record:ConversationMessage[],decisions:Decision[],agentName=''):ConversationMessage[]=>{
 const left=[...decisions].sort((a,b)=>a.at.localeCompare(b.at)).map((decided,index):ConversationMessage=>({id:index,author:'agent',author_name:agentName,body:'',created_at:decided.at,kind:'decided',decided}));
 const merged:ConversationMessage[]=[];
 for(const message of record) { while(left.length&&left[0].created_at<=message.created_at) merged.push(left.shift()!); merged.push(message); }
 return [...merged,...left];
};
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
