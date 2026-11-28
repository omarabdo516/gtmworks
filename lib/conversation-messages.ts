import 'server-only';
import { createHash } from 'node:crypto';
import type { supabase } from './supabase';
import type { ConversationMessage, MessageFile, RunStep } from './conversations';
import type { SessionMessage, SessionUsage } from './engine.mjs';
import { agentEngine, companyEngine, seenAgents, stepsBetween, takeToolCalls } from './engine/handle.mjs';
import { fileTagName, takeFileTags } from './media-tags.mjs';
import { ownWorkFile, readAgentWorkFile } from './reply-files.mjs';
import { pictureType } from './file-preview.mjs';

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
// The words of a stored message as a person reads them, and what it carries (#880). An Agent's: gtmworks's own tool
// blocks taken out as the Run record's reply takes them (lib/engine/runs.mjs takeToolCalls), and each MEDIA: tag (ADR
// 0028) taken out and kept as the path of a file it names, each path once. A person's: the page holds no image (lib/
// engine/sessions.mjs readSessionMessages), only the `[image]` line the Engine writes for each, at the end of the words
// as the Run's input put them after the text; those lines are counted and taken out.
// shortcut: a person who ends their own words with a line that is exactly `[image]` reads one image more, which then
// cannot be opened; upgrade by reading the images' count from the Engine if it ever says it.
const imageLine='[image]';
/** @param {SessionMessage} [message] */
function messageParts(message?:SessionMessage):{body:string,paths:string[],images:number} {
 if(message?.role==='assistant') { const {body,paths}=takeFileTags(takeToolCalls(textOf(message.content)).reply); return {body,paths:[...new Set(paths)],images:0}; }
 const lines=textOf(message?.content).split('\n'); let images=0;
 while(lines.length&&lines.at(-1)===imageLine) { lines.pop(); images++; }
 // The line before each `[image]` is the Engine's own separator, so what is left is the person's words exactly.
 return {body:images?lines.join('\n'):textOf(message?.content),paths:[],images};
}
const replyText=(message?:SessionMessage)=>messageParts(message).body;
// Whether an Agent's message is a reply a person reads: words, or a file it names.
const hasReply=(message?:SessionMessage)=>{ const {body,paths}=messageParts(message); return !!body.trim()||paths.length>0; };
// A Conversation's file (#880) is told by the message it is in and its place there: `i<message>-<n>` a person's n-th
// image, `f<message>-<n>` the n-th file the Agent's reply names. The address names no path; each read finds the message
// again in the Engine's session and reads the file from there.
const fileKey=/^([if])(\d{1,15})-(\d{1,2})$/;
// A file an Agent named is read from its own work folder in the Company's work sandbox (lib/reply-files.mjs
// ownWorkFile): one a tag names anywhere else is told as not attached, by its name, and never read.
/** @param {SessionMessage} message @param {number} id @param {string} profile */
function namedFiles(message:SessionMessage,id:number,profile:string):{files:MessageFile[],missed:string[]} {
 const {paths,images}=messageParts(message);
 const files:MessageFile[]=Array.from({length:images},(_,n)=>({id:n,name:'',image:true,key:`i${id}-${n}`}));
 const missed:string[]=[];
 paths.forEach((path,n)=>{ const name=fileTagName(path);
  if(!ownWorkFile(path,profile)) { missed.push(name); return; }
  files.push({id:n,name,...(pictureType(name)?{image:true as const}:{}),key:`f${id}-${n}`});
 });
 return {files,missed};
}
// The page's messages as the transcript draws them (#875): the person's words as theirs, one reply for each turn — its
// last assistant message with words, the interim narration dropped — with the tool calls that turn made beside it (never
// matched by time), and the Engine's compaction summary as the Engine's. Tool results are read for their step's end and
// drawn under the reply. `prefix` is the page before, when the page starts in the middle of a turn.
/** @param {SessionMessage[]} page @param {SessionMessage[]} prefix @param {SessionMessage[]} suffix @param {string} agentName @param {string} profile */
function pageMessages(page:SessionMessage[],prefix:SessionMessage[],suffix:SessionMessage[],agentName:string,profile:string):PageMessage[] {
 const all=[...prefix,...page,...suffix];
 const shown:PageMessage[]=[];
 // The turn a message belongs to, by its first message's own key, so a page read later names the same turn.
 const turnKey=(at:number)=>String(all[at]?.message_uid??all[at]?.id??idOf(all[at]));
 // The person's words repeated with no reply between are one unanswered message, the first standing for both (#980):
 // Try again starts a Run on the message already in the Conversation, whose input the Engine stores, and the page draws
 // it once (`repeats` below). The turn still starts at the repeated message, so the rerun's reply keeps its own Steps,
 // and the repeated row stays in the read for the page's sent-message matching (app/c/[slug]/conversations/[id]).
 const repeats=new Set<number>();
 let lastPersonAt=-1;
 for(let index=0;index<all.length;index++) {
  const message=all[index];
  if(message?.role==='user'&&startsTurn(message)) {
   const body=textOf(message.content);
   if(summary.test(body)) lastPersonAt=-1;
   else { if(lastPersonAt>=0&&textOf(all[lastPersonAt].content)===body) repeats.add(index); lastPersonAt=index; }
  // A reply the person read ends the unanswered message; a turn's tool calls do not, so a rerun after a lost Run's
  // calls is still the same unanswered words.
  } else if(message?.role==='assistant'&&!toolTurn(message)&&replyText(message).trim()) lastPersonAt=-1;
 }
 // shortcut: a page whose first message is the repeated one has no message before it, so that page draws it; upgrade by
 // reading one message before a page that starts on a person's words.
 // The last message of each turn that has words is its reply: Hermes keeps the interim narration ("Let me check…")
 // beside the call it made, and the old record showed the Run's final output alone.
 const lastText=new Map<number,number>();
 let turn=0;
 for(let index=0;index<all.length;index++) {
  if(startsTurn(all[index])) turn=index;
  if(all[index]?.role==='assistant'&&!toolTurn(all[index])&&hasReply(all[index])) lastText.set(turn,index);
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
   const {files}=namedFiles(message,idOf(message),profile);
   if(body.trim()||files.length) shown.push({id:idOf(message),author:'person',author_name:'',body,created_at:atOf(message),turn:turnKey(turn),...(files.length?{files}:{}),...(repeats.has(index)?{repeated:true as const}:{})});
   continue;
  }
  if(message?.role==='assistant'&&lastText.get(turn)===index&&hasReply(message)) {
   const steps=stepsBetween(all,turn,index);
   const {files,missed}=namedFiles(message,idOf(message),profile);
   shown.push({id:idOf(message),author:'agent',author_name:agentName,body,created_at:atOf(message),turn:turnKey(turn),steps:{list:steps?.list??[],seconds:steps?.seconds??null},
    ...(files.length?{files}:{}),...(missed.length?{missed}:{})});
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
 let messages=pageMessages(read.messages,read.prefix,read.suffix,found.agent_name,target.engine.profile);
 // A file an Agent named is listed whether or not its work sandbox runs; while it is stopped the file says it cannot be
 // read now. The sandbox is asked once, and only for a page that names one.
 if(messages.some(message=>message.author==='agent'&&message.files?.length)&&(await target.engine.files.sandbox().catch(()=>null))?.state!=='running')
  messages=messages.map(message=>message.author==='agent'&&message.files?{...message,files:message.files.map(file=>({...file,state:'notNow' as const}))}:message);
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

// One file of a Conversation (#880), by its key, read from the Engine each time and kept nowhere: a person's image from
// the message in the session that carried it to the Agent, or a file the Agent's reply names from that Agent's own work
// folder in the Company's work sandbox, through the Engine's file routes. Only the Conversation's own person reads it
// (the row is read with their session and named as theirs). `notNow` is an Engine or a work sandbox that cannot be read
// now, never a file that is gone.
export async function readConversationFile(db:Database,{company,person,conversation,file}:{company:string,person:string,conversation:string,file:string}):Promise<{state:'found',name:string,type:string,body:Uint8Array<ArrayBuffer>}|{state:'missing'|'notNow'|'tooLarge'}> {
 const key=fileKey.exec(file);
 if(!key) return {state:'missing'};
 const id=Number(key[2]); const n=Number(key[3]);
 const {data:found,error}=await db.from('conversations').select('agent_id,hermes_session_id').eq('id',conversation).eq('company_id',company).eq('person_id',person).maybeSingle<{agent_id:string|null,hermes_session_id:string|null}>();
 if(error) return {state:'notNow'};
 if(!found?.agent_id||!found.hermes_session_id) return {state:'missing'};
 const target=await agentEngine(db,{company,agent:found.agent_id});
 if(target.state==='missing'||target.state==='noEngine'||target.state==='invalid') return {state:'missing'};
 if(target.state!=='found') return {state:'notNow'};
 const {sessions}=target.engine; const session=found.hermes_session_id;
 if(key[1]==='i') {
  const read=await sessions.image(session,(each:SessionMessage)=>each.role==='user'&&idOf(each)===id&&n<messageParts(each).images,n);
  if(read.state==='found') return {state:'found',name:`image-${n+1}.${read.type.slice('image/'.length).replace('jpeg','jpg')}`,type:read.type,body:new Uint8Array(read.body)};
  return {state:read.state==='missing'||read.state==='tooLarge'?read.state:'notNow'};
 }
 const reply=await sessions.find(session,(each:SessionMessage)=>each.role==='assistant'&&idOf(each)===id);
 if(reply.state!=='found') return {state:reply.state==='missing'?'missing':'notNow'};
 const path=messageParts(reply.message).paths[n];
 return path?readAgentWorkFile(target.engine,path):{state:'missing'};
}
