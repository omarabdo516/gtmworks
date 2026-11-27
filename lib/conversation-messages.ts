import 'server-only';
import { createHash } from 'node:crypto';
import type { supabase } from './supabase';
import type { ConversationMessage } from './conversations';
import type { SessionMessage, SessionUsage } from './engine.mjs';
import { agentEngine, stepsBetween, takeToolCalls } from './engine/handle.mjs';
import { takeFileTags } from './media-tags.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Found={id:string,agent_id:string|null,agent_name:string,hermes_session_id?:string|null};
type ConversationMessagesPage={state:'found',messages:ConversationMessage[],nextOffset:number,hasMore:boolean}|{state:'none'|'notSeen'|'missing'|'refused'|'unreachable'};
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
/** A message's own key, short enough for the record's numeric id and stable across pages and refreshes. */
function idOf(message:SessionMessage,index:number,offset:number) {
 const key=message?.message_uid??message?.id??`${offset}:${index}`;
 return Number.parseInt(createHash('sha1').update(String(key)).digest('hex').slice(0,10),16);
}
/** The Engine's summary without its own marker, which names the Engine's rule rather than anything a person wrote. */
function summaryText(content:unknown) {
 return textOf(content).replace(/\[CONTEXT COMPACTION[^\]]*\]/gi,'').trim();
}
const startsTurn=(message?:SessionMessage)=>message?.role==='user'&&(message.display_kind!=='hidden'||summary.test(textOf(message.content)));
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
/** @param {SessionMessage[]} page @param {SessionMessage[]} prefix @param {string} agentName @param {number} offset */
function pageMessages(page:SessionMessage[],prefix:SessionMessage[],agentName:string,offset=0):ConversationMessage[] {
 const all=[...prefix,...page];
 const shown:ConversationMessage[]=[];
 // The last message of each turn that has words is its reply: Hermes keeps the interim narration ("Let me check…")
 // beside the call it made, and the old record showed the Run's final output alone.
 const lastText=new Map<number,number>();
 let turn=0;
 for(let index=0;index<all.length;index++) {
  if(startsTurn(all[index])) turn=index;
  if(all[index]?.role==='assistant'&&replyText(all[index]).trim()) lastText.set(turn,index);
 }
 turn=0;
 for(let index=0;index<prefix.length;index++) if(startsTurn(all[index])) turn=index;
 for(let index=prefix.length;index<all.length;index++) {
  const message=all[index];
  if(startsTurn(message)) turn=index;
  const body=replyText(message);
  if(message?.role==='user') {
   if(summary.test(body)) { shown.push({id:idOf(message,index,offset),author:'engine',author_name:'',body:summaryText(textOf(message.content)),created_at:atOf(message),kind:'summary'}); continue; }
   if(message.display_kind==='hidden') continue;
   if(body.trim()) shown.push({id:idOf(message,index,offset),author:'person',author_name:'',body,created_at:atOf(message)});
   continue;
  }
  if(message?.role==='assistant'&&lastText.get(turn)===index&&body.trim()) {
   const steps=stepsBetween(all,turn,index);
   // The profile a Card step was given to never leaves the server; a Card here names no Agent but its title (#844).
   const list=steps?.list.map(({card,...step})=>card?{...step,card:{id:card.id,title:card.title,agent:null}}:step)??[];
   shown.push({id:idOf(message,index,offset),author:'agent',author_name:agentName,body,created_at:atOf(message),steps:{list,seconds:steps?.seconds??null}});
  }
 }
 return shown;
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
 return {state:'found',messages:pageMessages(read.messages,read.prefix,found.agent_name,offset),nextOffset:offset+read.messages.length,hasMore:read.more&&read.messages.length>0};
}

// The Conversation's token use (#347), its session detail's, on a request of its own after the messages (ADR 0030): null
// when the Conversation has no session, the Engine does not know it, or the reader may not see its Agent.
/** @param {Database} db @param {string} company @param {Found} found */
export async function conversationUsage(db:Database,company:string,found:Found):Promise<SessionUsage|null> {
 if(!found.agent_id||!found.hermes_session_id) return null;
 const target=await agentEngine(db,{company,agent:found.agent_id});
 return target.state==='found'?target.engine.sessions.tokenUse(found.hermes_session_id):null;
}
