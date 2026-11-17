// The conversation record as the page shows it: run ids stay on the server. A note is a person's message addressed to
// another Member (`to`, no run); a queued message waits for the Agent to finish the current reply (`queued`), or was
// not sent because the engine would not start it (`failed`). A person's answer to a question (`answer`, #138) is
// `failed` when it never reached the Engine: the Run had ended or stopped waiting before it was delivered.
// What Lead's turn of a run holds besides its words is a card: an Agent Lead made in it (#13), or a Member's request for
// an Agent kept in it (#17), which shows the Owner's answer once there is one. The card is in Lead's reply of that run;
// when Lead wrote nothing but the call, it is Lead's whole turn (`kind` made) after the message that asked. A card any
// Agent shows with its reply (#136) is placed the same way.
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
// A card any Agent's reply carries (#136), one variant per kind, every word on it the Agent's. A row of a kind this app
// version does not know (the database may be newer) is left out.
// A question (#138) is the Engine's own: open until its person answers it, then answered with that answer (a claimed
// answer still on its way to the Engine is drawn answered), or closed once the Engine no longer waits for it.
// A hand card (#139) is open until its person marks the step done, then done at that time; `failed` when the turn that
// told its Agent (#140) could not be started.
type ReviewItem={text:string,fine:boolean,note:string};
type Question={id:number,kind:'question',title:string,question:string,choices:string[],multiple:boolean};
export type ReplyCard={id:number,kind:'draft',title:string,line:string,rows:{label:string,value:string}[]}
 |{id:number,kind:'review',title:string,line:string,items:ReviewItem[],decision:string}
 |(Question&({state:'open'}|{state:'answered',answer:string}|{state:'closed'}))
 |(Hand&({state:'open'}|{state:'done',at:string,failed?:true}));
type Hand={id:number,kind:'hand',title:string,line:string,app:string,rows:{label:string,value:string}[],url:string|null,note:string|null};
export const replyCardColumns='id,run_id,kind,title,content,state,answered_at,done_at,created_at';
export type ReplyCardRow={id:number,run_id:string,kind:string,title:string,content:unknown,state:string,answered_at:string|null,done_at:string|null,created_at:string};
// The database keeps only rows each kind's reader can read (reply_card_valid); a kind with no reader fails the build.
const replyReaders:{[K in ReplyCard['kind']]:(row:ReplyCardRow)=>Extract<ReplyCard,{kind:K}>}={
 draft:({id,title,content})=>{ const {line,rows}=content as {line:string,rows:{label:string,value:string}[]}; return {id,kind:'draft',title,line,rows}; },
 review:({id,title,content})=>{ const {line,items,decision}=content as {line:string,items:ReviewItem[],decision:string}; return {id,kind:'review',title,line,items,decision}; },
 question:({id,title,content,state})=>{
  const {question,choices,multiple,answer}=content as {question:string,choices:string[],multiple:boolean,answer?:string};
  const asked:Question={id,kind:'question',title,question,choices,multiple};
  return state==='open'?{...asked,state:'open'}:state==='closed'||answer===undefined?{...asked,state:'closed'}:{...asked,state:'answered',answer};
 },
 hand:({id,title,content,state,done_at})=>{
  const {line,app,rows,url,note}=content as {line:string,app:string,rows:{label:string,value:string}[],url?:string,note?:string};
  const handed:Hand={id,kind:'hand',title,line,app,rows,url:url??null,note:note??null};
  return state==='done'&&done_at?{...handed,state:'done',at:done_at}:{...handed,state:'open'};
 },
};
export const replyCardOf=(row:ReplyCardRow):ReplyCard|null=>Object.hasOwn(replyReaders,row.kind)?replyReaders[row.kind as ReplyCard['kind']](row):null;
export type LeadCard={kind:'made',agent:MadeAgent}|{kind:'request',request:AgentRequestView}|{kind:'reply',card:ReplyCard};
export type SavedRule={id:string,agent:string|null,removed:boolean,said_at:string,sentTo?:string[]};
type RuleDecision={approved:boolean,by:string,rule:string,at:string};
export type Decision=({kind:'rule'}&RuleDecision)|({kind:'request',by:string,name:string,at:string}&({made:true}|{made:false,reason:string}));
// The tool calls the Engine reported for the Run of an Agent's reply (#141), in the Engine's order, and the Run's length
// in seconds (null when the Engine's record gave none). A call that never reported its end is `started`.
export type RunStep={tool:string,preview:string|null,state:'started'|'done'|'failed'};
export type RunSteps={list:RunStep[],seconds:number|null};
export type RunStepsRow={run_id:string,steps:(RunStep&{call:string})[],seconds:number|null};
export const runStepsColumns='run_id,steps,seconds';
export type ConversationMessage={id:number,author:'person'|'agent',author_name:string,body:string,lost?:boolean,created_at:string,kind?:'note'|'queued'|'made'|'saved'|'decided'|'boarded'|'asked'|'answer',to?:string,failed?:boolean,cards?:LeadCard[],saved?:SavedRule[],decided?:Decision,steps?:RunSteps};
type StoredMessage=ConversationMessage&{run_id:string,hand_card?:number|null};
export const messageColumns='id,author,author_name,body,run_id,hand_card,created_at';
export const conversationColumns='id,agent_id,agent_name,hermes_agents(connection_id,is_default)';
// A card of a run as the record places it. A question (#138) also carries the answer its person gave, drawn as their
// own message though none is stored, and the main Agent's question carries the plain words it is drawn as (`words`)
// until #143 draws its own card.
export type PlacedCard={run_id:string,card:LeadCard,at:string,answer?:{body:string,at:string,delivered:boolean},words?:string};
// What a question adds to its place in the record (#138): the answer its person gave, at the time they gave it, and
// whether it reached the Engine (one claimed after the Engine stopped waiting, or as its Run ended, did not: its card
// closed), and for the main Agent the plain words it is drawn as (the question, then each choice on its own line).
export function questionParts(row:ReplyCardRow,card:ReplyCard,lead:boolean):Pick<PlacedCard,'answer'|'words'> {
 if(card.kind!=='question') return {};
 const {answer}=row.content as {answer?:string};
 return {...(answer!==undefined&&row.answered_at?{answer:{body:answer,at:row.answered_at,delivered:card.state!=='closed'}}:{}),...(lead?{words:[card.question,...card.choices.map(choice=>`- ${choice}`)].join('\n')}:{})};
}
const isQuestion=(row:PlacedCard)=>row.card.kind==='reply'&&row.card.card.kind==='question';
// A person's message whose run Hermes no longer knew is marked lost (#243), from the run's usage record. A run's
// questions follow its person's message, each with its answer, before the run's reply (#138). The reply carries its
// Run's steps when the Engine reported any (#141). The message of a turn "Done it" started (#140, `handTurn`) was
// never written by the person: it draws no bubble, and what its run showed stays.
export const shown=(messages:StoredMessage[],usage:{run_id:string,outcome:string}[]=[],leadCards:PlacedCard[]=[],agentName='',saved:{run_id:string,rule:SavedRule}[]=[],runSteps:RunStepsRow[]=[]):ConversationMessage[]=>messages.flatMap(message=>{
 const plain={id:message.id,author:message.author,author_name:message.author_name,body:message.body,lost:message.author==='person'&&usage.some(run=>run.run_id===message.run_id&&run.outcome==='lost'),created_at:message.created_at};
 const replied=message.author==='agent'||messages.some(other=>other.author==='agent'&&other.run_id===message.run_id);
 const ofRun=leadCards.filter(row=>row.run_id===message.run_id&&!isQuestion(row)); const cards=ofRun.map(row=>row.card);
 const rules=saved.filter(row=>row.run_id===message.run_id).map(row=>row.rule);
 const asked=message.author==='person'?leadCards.filter(row=>row.run_id===message.run_id&&isQuestion(row)).flatMap((row):ConversationMessage[]=>{
  const id=row.card.kind==='reply'?row.card.card.id:0;
  return [{id,author:'agent',author_name:agentName,body:row.words??'',created_at:row.at,kind:'asked',...(row.words===undefined?{cards:[row.card]}:{})},
   ...(row.answer?[{id,author:'person' as const,author_name:message.author_name,body:row.answer.body,created_at:row.answer.at,kind:'answer' as const,...(row.answer.delivered?{}:{failed:true})}]:[])];
 }):[];
  const own=handTurn(message)?[]:[plain];
 const steps=message.author==='agent'?runSteps.find(row=>row.run_id===message.run_id):undefined;
 const reply={...plain,...(cards.length?{cards}:{}),...(steps?{steps:{list:steps.steps.map(({tool,preview,state})=>({tool,preview,state})),seconds:steps.seconds}}:{})};
 const turn:ConversationMessage[]=message.author==='agent'?[reply]
  :replied||!cards.length?[...own,...asked]:[...own,...asked,{id:message.id,author:'agent',author_name:agentName,body:'',created_at:ofRun[0].at,kind:'made',cards}];
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
// A turn "Done it" queued (#140) names its hand card and is drawn by that card, never as a message.
export type QueuedTurn={send_key:string,message:string,queued_at:string,started_at:string|null,failed_at:string|null,hand_card?:number|null};
export const noteColumns='id,author_name,addressed_name,body,created_at';
export const queuedColumns='send_key,message,queued_at,started_at,failed_at,hand_card';
// A turn "Done it" queued, and the person's message it became, name their hand card (#140): the one test every reader
// of the record uses, waiting or started.
export const handTurn=(row:{hand_card?:number|null})=>row.hand_card!=null;
export const withTeamWork=(record:ConversationMessage[],notes:StoredNote[]=[],queued:QueuedTurn[]=[],sender=''):ConversationMessage[]=>{
 // The record keeps its own order (by id); each note goes before the first message written after it.
 const merged:ConversationMessage[]=[]; const left=[...notes].sort((a,b)=>a.id-b.id);
 for(const message of record) { while(left.length&&left[0].created_at<=message.created_at) merged.push(noteOf(left.shift()!)); merged.push(message); }
 return [...merged,...left.map(noteOf),
  ...queued.filter(turn=>!turn.started_at&&!handTurn(turn)).map((turn,index)=>({id:index,author:'person' as const,author_name:sender,body:turn.message,created_at:turn.queued_at,kind:'queued' as const,...(turn.failed_at?{failed:true}:{})}))];
};
const noteOf=(note:StoredNote):ConversationMessage=>({id:note.id,author:'person',author_name:note.author_name,body:note.body,created_at:note.created_at,kind:'note',to:note.addressed_name});
// Waiting turns keep the page asking until they have started and been answered.
export const queuedWaiting=(queued:QueuedTurn[])=>queued.some(turn=>!turn.started_at&&!turn.failed_at);
