import 'server-only';
import { createHash } from 'node:crypto';
import type { supabase } from './supabase';
import type { ConversationMessage, RunStep } from './conversations';
import type { SessionMessage, SessionUsage } from './engine.mjs';
import { agentEngine, companyEngine, seenAgents, stepsBetween, takeToolCalls } from './engine/handle.mjs';
import { takeFileTags } from './media-tags.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Found={id:string,agent_id:string|null,agent_name:string,hermes_session_id?:string|null};
type ConversationMessagesPage={state:'found',messages:ConversationMessage[],nextOffset:number,hasMore:boolean}|{state:'none'|'notSeen'|'missing'|'refused'|'unreachable'};
// A message whose Steps still hold the profile a Card was given to, kept on the server until the reader's Agents are
// known (namedMessages); the profile never leaves here.
type PageStep=import('./engine.mjs').RunStep;
type PageMessage=Omit<ConversationMessage,'steps'>&{steps?:{list:PageStep[],seconds:number|null}};
const summary=/^\s*\[CONTEXT COMPACTION/i;
/** @param {unknown} content */
function textOf(content:unknown) {
 if(typeof content==='string') return content.toWellFormed();
 if(Array.isArray(content)) return content.flatMap(part=>part&&typeof part==='object'&&typeof (part as {text?:unknown}).text==='string'?[(part as {text:string}).text]:[]).join('');
 return '';
}
/** @param {SessionMessage} [message] */
function atOf(message?:SessionMessage) {
 const seconds=Number(message?.timestamp);
 return Number.isFinite(seconds)?new Date(seconds*1000).toISOString():new Date(0).toISOString();
}
/** A message's own key, short enough for the record's numeric id and stable across pages and refreshes: the Engine's own
 * uid or id, else the message itself (the wire fake keeps no id), so the same message is the same row on every read. */
function idOf(message:SessionMessage) {
 const key=message?.message_uid??message?.id??`${message?.role}:${Number(message?.timestamp)||0}:${textOf(message?.content)}:${JSON.stringify(message?.tool_calls??message?.tool_call_id??message?.display_kind??'')}`;
 return Number.parseInt(createHash('sha1').update(String(key)).digest('hex').slice(0,10),16);
}
/** The Engine's summary without its own marker, which names the Engine's rule rather than anything a person wrote. */
function summaryText(content:unknown) {
 return textOf(content).replace(/\[CONTEXT COMPACTION[^\]]*\]/gi,'').trim();
}
const startsTurn=(message?:SessionMessage)=>message?.role==='user'&&(message.display_kind!=='hidden'||summary.test(textOf(message.content)));
// An assistant message that made a call is no reply, even when it carries narrative words: the Engine marks it
// finish_reason tool_calls, and the turn's reply comes after its results.
const toolTurn=(message?:SessionMessage)=>message?.role==='assistant'&&(message.finish_reason==='tool_calls'||(Array.isArray(message.tool_calls)&&message.tool_calls.length>0&&message.finish_reason!=='stop'));
// The words of an Agent's stored message as a person reads them: gtmworks's own tool blocks are taken out as the Run
// record's reply takes them (lib/engine/runs.mjs takeToolCalls), and a MEDIA: tag is taken out with no file named until
// #880 reads the Engine's files. An image part is asked for but not drawn yet either.
/** @param {SessionMessage} [message] */
function replyText(message?:SessionMessage):string {
 const content=message?.role==='assistant'?takeToolCalls(textOf(message.content)).reply:textOf(message?.content);
 return message?.role==='assistant'?takeFileTags(content).body:content;
}
// The page's messages as the transcript draws them (#875): the person's words as theirs, one reply for each turn — its
// last assistant message with words, the interim narration dropped — with the tool calls that turn made beside it (never
// matched by time), and the Engine's compaction summary as the Engine's. Tool results are read for their step's end and
// drawn under the reply. `prefix` is the page before, when the page starts in the middle of a turn.
/** @param {SessionMessage[]} page @param {SessionMessage[]} prefix @param {SessionMessage[]} suffix @param {string} agentName */
function pageMessages(page:SessionMessage[],prefix:SessionMessage[],suffix:SessionMessage[],agentName:string):PageMessage[] {
 const all=[...prefix,...page,...suffix];
 const shown:PageMessage[]=[];
 // The turn a message belongs to, by its first message's own key, so a page read later names the same turn.
 const turnKey=(at:number)=>String(all[at]?.message_uid??all[at]?.id??idOf(all[at]));
 // The last message of each turn that has words is its reply: Hermes keeps the interim narration ("Let me check…")
 // beside the call it made, and the old record showed the Run's final output alone.
 const lastText=new Map<number,number>();
 let turn=0;
 for(let index=0;index<all.length;index++) {
  if(startsTurn(all[index])) turn=index;
  if(all[index]?.role==='assistant'&&!toolTurn(all[index])&&replyText(all[index]).trim()) lastText.set(turn,index);
 }
 turn=0;
 for(let index=0;index<prefix.length;index++) if(startsTurn(all[index])) turn=index;
 for(let index=prefix.length;index<prefix.length+page.length;index++) {
  const message=all[index];
  if(startsTurn(message)) turn=index;
  const body=replyText(message);
  if(message?.role==='user') {
   if(summary.test(body)) { shown.push({id:idOf(message),author:'engine',author_name:'',body:summaryText(textOf(message.content)),created_at:atOf(message),kind:'summary',turn:turnKey(turn)}); continue; }
   if(message.display_kind==='hidden') continue;
   if(body.trim()) shown.push({id:idOf(message),author:'person',author_name:'',body,created_at:atOf(message),turn:turnKey(turn)});
   continue;
  }
  if(message?.role==='assistant'&&lastText.get(turn)===index&&body.trim()) {
   const steps=stepsBetween(all,turn,index);
   shown.push({id:idOf(message),author:'agent',author_name:agentName,body,created_at:atOf(message),turn:turnKey(turn),steps:{list:steps?.list??[],seconds:steps?.seconds??null}});
  }
 }
 return shown;
}
type SeenRow={agent?:unknown,name?:unknown,connection?:unknown,profile?:unknown};
// A Card a Step made (#844) is named by the Agent its profile runs, as the board names it, and one given to an Agent
// hidden from the reader is no row of theirs, as it is on no board of theirs (lib/conversation-steps.ts namedCards). A
// profile that is no Agent of the Company's names no Agent; the profile itself never leaves the server.
/** @param {PageMessage[]} messages @param {SeenRow[]} seen @param {string[]} profiles */
function namedMessages(messages:PageMessage[],seen:SeenRow[],profiles:string[]):ConversationMessage[] {
 const byProfile=new Map<string,{id:string,name:string,face:string}>();
 for(const row of seen) if(typeof row.profile==='string'&&typeof row.agent==='string'&&!byProfile.has(row.profile)) byProfile.set(row.profile,{id:row.agent,name:String(row.name??''),face:String(row.connection??row.agent)});
 return messages.map(message=>{
  if(!message.steps) return message as ConversationMessage;
  const list=message.steps.list.flatMap(step=>{
   const card=step.card;
   if(!card) return [step as RunStep];
   const agent=byProfile.get(card.profile)??null;
   if(!agent&&profiles.includes(card.profile)) { const {card:givenCard,...rest}=step; void givenCard; return [rest as RunStep]; }
   const {card:givenCard,...rest}=step; void givenCard;
   return [{...rest,card:{id:card.id,title:card.title,agent}}];
  });
  return {...message,steps:{...message.steps,list}};
 });
}

// One page of a Conversation's messages from its Agent's Engine session (#875), read through the Engine handle on the
// profile the reader sees the Agent on. None when the Conversation has no session yet or its Company no Engine; notSeen
// when the Agent is hidden from the reader. gtmworks keeps none of it.
/** @param {Database} db @param {string} company @param {Found} found @param {{offset:number,limit:number}} page */
export async function conversationMessagesPage(db:Database,company:string,found:Found,{offset,limit}:{offset:number,limit:number}):Promise<ConversationMessagesPage> {
 if(!found.agent_id||!found.hermes_session_id) return {state:'none'};
 const target=await agentEngine(db,{company,agent:found.agent_id});
 if(target.state==='missing') return {state:'notSeen'};
 if(target.state==='noEngine'||target.state==='invalid') return {state:'none'};
 if(target.state!=='found') return {state:'unreachable'};
 const read=await target.engine.sessions.messages(found.hermes_session_id,{offset,limit});
 if(read.state!=='found') return {state:read.state};
 const messages=pageMessages(read.messages,read.prefix,read.suffix,found.agent_name);
 const made=messages.some(message=>message.steps?.list.some(step=>step.card));
 let named=messages as ConversationMessage[];
 if(made) {
  const [seen,engine]=await Promise.all([seenAgents(db,company),companyEngine(company,{reader:db})]);
  named=namedMessages(messages,seen??[],engine?.profiles??[]);
 }
 return {state:'found',messages:named,nextOffset:offset+read.messages.length,hasMore:read.more&&read.messages.length>0};
}

// The Conversation's token use (#347), its session detail's, on a request of its own after the messages (ADR 0030): null
// when the Conversation has no session, the Engine does not know it, or the reader may not see its Agent.
/** @param {Database} db @param {string} company @param {Found} found */
export async function conversationUsage(db:Database,company:string,found:Found):Promise<SessionUsage|null> {
 if(!found.agent_id||!found.hermes_session_id) return null;
 const target=await agentEngine(db,{company,agent:found.agent_id});
 return target.state==='found'?target.engine.sessions.tokenUse(found.hermes_session_id):null;
}
