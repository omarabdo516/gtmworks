'use client';
import { Suspense, createContext, memo, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { useAgentState } from '@/app/sidebar-live';
import { Greeting } from '@/components/face-moments';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent, type DetailsPanel } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import type { DetailsTab } from '@/lib/agent-details.mjs';
import { LeadWelcome } from '@/app/lead-welcome';
import { PrivateLine } from '@/app/private-line';
import { conversationTitle } from '@/lib/conversation-title.mjs';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ConversationSteps } from '@/lib/conversation-steps';
import type { Send } from '@/lib/sending';
import { columnLabel } from '@/lib/board-columns.mjs';
import type { MessageBoxHandle } from '@/app/conversation-composer';
import { ChatPlaceholder, ConversationComposer, ConversationTurns, OpeningSteps, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';
import { FirstRunToast } from '@/app/first-run-toast';
import { ShellIcon } from '@/components/shell-icon';
import { MoreMenu } from '@/app/more-menu';
import { useConversationArchive } from '@/app/conversation-archive';
import { toast } from '@/app/toast';
import { useRouter } from 'next/navigation';

// The record as the loaded transcript keeps it current, and how it asks for the reply after a send.
type Live={record:ConversationRecord,asked:()=>void,sending:Send,engine?:true};
// The record, and the sends made before it arrived, reach the title, the corner and the composer through this store,
// not through this frame's state or its context value: the transcript arrives while the page still streams in, and a
// render of this frame then would make React draw the transcript again in the browser, leaving the streamed copy hidden
// in the page (#172, #253, #297).
type LiveStore={get:()=>Live|undefined,set:(live:Live)=>void,early:()=>number,earlier:()=>void,subscribe:(listener:()=>void)=>()=>void};
function newLive():LiveStore {
 let live:Live|undefined; let early=0; const listeners=new Set<()=>void>();
 const changed=(next:()=>void)=>{ next(); listeners.forEach(listener=>listener()); };
 return {get:()=>live,set:value=>changed(()=>{live=value;}),early:()=>early,earlier:()=>changed(()=>{early+=1;}),
  subscribe:listener=>{ listeners.add(listener); return ()=>{listeners.delete(listener);}; }};
}

// Drawn as the reference's chat (design-reference: renderChat): a floating title pill, the Conversation's messages and
// composer (app/conversation-thread.tsx), its usage, and the Agent's details beside it while the Agent is still
// attached. In a team, a line at the top says the chat is between this person and the Agent only (#25).
// The record arrives after the page (#172): until then the transcript shows the reference's placeholder, under the title
// the sidebar gives the chat. The title and the composer stay outside the part that loads, so the same box takes a
// message from the start, keeping what was typed, its caret and its focus; a message sent before the record arrives
// has its reply asked for once it is there. `children` is the transcript (ConversationLoaded), drawn by the server once
// the record is read. `archived` (#674): the Conversation is archived; its head's menu restores it, and a line
// over the composer says so, and that writing in it brings it back.
export default function ConversationView({slug,agent,details,tab,company,conversation,title,writer,first,invites,archived=false,children}:{slug:string,agent:DetailsAgent|null,details:Promise<AgentDetailsView>|null,tab?:DetailsTab,company:string,conversation:ThreadConversation,title:string,writer:boolean,first?:'alone'|'team',invites?:number,archived?:boolean,children:ReactNode}) {
 const panel=useDetailsPanel();
 const [isArchived,setArchived]=useState(archived);
 // This chat's own archive and restore show at once; the server's answer, read again after one from elsewhere (the
 // sidebar's menu), wins whenever it changes.
 const [served,setServed]=useState(archived);
 if(served!==archived) { setServed(archived); setArchived(archived); }
 const composer=useRef<MessageBoxHandle>(null); const [live]=useState(newLive);
 // The same object for the page's life: a new context value reaching a transcript that still streams in would make React
 // draw it again in the browser and leave the streamed copy hidden in the page (#172, #253).
 const view=useMemo(()=>({slug,agent,company,conversation,writer,suggest:(text:string)=>composer.current?.insert(text),live}),[slug,agent,company,conversation,writer,live]);
 const fill=useCallback((text:string)=>composer.current?.fill(text),[]);
 return <ChatView value={view}>{first&&<FirstRunToast mode={first} agent={conversation.agent_name} invites={invites}/>}<div className="convo"><div className="chat">
  <ChatHead panel={panel} agent={agent} conversation={conversation} title={title}/>
  <ChatMore company={company} conversation={conversation} title={title} archived={isArchived} changed={setArchived}/>
  <Transcript>{children}</Transcript>
  <ChatComposer company={company} conversation={conversation} writer={writer} box={composer} archived={isArchived} restored={()=>setArchived(false)}/>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} tab={tab} slug={slug} suggest={writer?fill:undefined}/>}</div></ChatView>;
}

// The chat's floating title, as the loaded transcript keeps it (#297): it subscribes to the frame's store, so the record
// arriving redraws it and never the page around the transcript. The reference's corner pill named the chat's Card on the
// old board, which is switched off (#846); a Card an Agent makes from a chat is its own row in the transcript (#844).
function ChatHead({panel,agent,conversation,title}:{panel:DetailsPanel,agent:DetailsAgent|null,conversation:ThreadConversation,title:string}) {
 const {live:store}=useView(); const {t,language}=useI18n();
 const live=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 const record=live?.record;
 // The head's face shows the Agent's state as the sidebar's tile does (app/sidebar-live), with what this chat knows.
 const state=useAgentState(conversation.agent_id??'');
 // The Engine's messages are a page of the end, not the Conversation's first words: its title stays the database's.
 const named=record&&!live?.engine;
 return <><Greeting agent={conversation.agent_id}/><HeadPill panel={panel} agent={agent?.name} face={<span aria-hidden="true" data-greet><AgentFace agent={conversation.face} name={conversation.agent_name} size={32} state={state} live/></span>} title={named?conversationTitle({morningDay:record.morningDay,body:record.messages[0]?.body,file:record.messages[0]?.files?.[0]?.name,agent:conversation.agent_name},t,language):title} titleDir="auto"/></>;
}

// The chat head's own menu (#674; design-reference-card: #chat-more, popHTML 'chat'): archive the Conversation, or
// restore it while it is archived. Its person tidies their own, whatever their Role.
function ChatMore({company,conversation,title,archived,changed}:{company:string,conversation:ThreadConversation,title:string,archived:boolean,changed:(archived:boolean)=>void}) {
 const {t}=useI18n();
 const chat={id:conversation.id,title};
 const {archive,restore,confirm}=useConversationArchive(company,(_ids,nowArchived)=>changed(nowArchived));
 return <div className="chat__start"><MoreMenu label={t('conversationMore')} items={[archived
  ?{key:'restore',icon:'restore',label:t('conversationRestore'),run:()=>void restore([chat])}
  :{key:'archive',icon:'archive',label:t('conversationArchive'),run:()=>void archive([chat])}]}/>{confirm}</div>;
}

// The composer, told the record when it is there and given the send made before it as the transcript asks for its reply
// once loaded (#297). Over it, while the Conversation is archived, the line that says so (design-reference-card:
// renderChat's arc-line); a message sent then has brought it back (restore_written_conversation), which a toast says.
function ChatComposer({company,conversation,writer,box,archived,restored}:{company:string,conversation:ThreadConversation,writer:boolean,box:Ref<MessageBoxHandle>,archived:boolean,restored:()=>void}) {
 const {live:store}=useView(); const {t}=useI18n(); const router=useRouter();
 const live=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 const sent=()=>{ if(!archived) return; restored(); router.refresh(); toast(t('conversationBack'),{icon:'restore'}); };
 return <div className="composer-area">{archived&&<p className="arc-line"><ShellIcon name="archive"/><span>{t(writer?'conversationArchivedLine':'conversationArchivedLineRead')}</span></p>}
  <ConversationComposer company={company} conversation={conversation} record={live?.record??null} writer={writer} asked={live?.asked??store.earlier} sending={live?.sending} box={box} usage sent={sent}/></div>;
}

// The transcript's boundary renders only when the transcript itself changes. This frame renders again while it
// hydrates on a phone, where the details panel's media query answers differently; reaching the boundary while its
// content still streams in, that render would make React draw the transcript in the browser beside its hidden streamed
// copy (#172), as a new context value would.
const loadingTranscript=<ChatPlaceholder/>;
const Transcript=memo(function Transcript({children}:{children:ReactNode}) {
 return <Suspense fallback={loadingTranscript}>{children}</Suspense>;
});

type View={slug:string,agent:DetailsAgent|null,company:string,conversation:ThreadConversation,writer:boolean,suggest:(text:string)=>void,live:LiveStore};
// The chat around the transcript: what the transcript tells the title and the composer.
const ChatView=createContext<View|null>(null);
const useView=()=>use(ChatView)!;

// The transcript once its record is read, in place of the placeholder.
// A first open whose record could not be read (#768): one line with "Try again", which draws the page again, in place of
// an empty Conversation.
export function ConversationNotRead() {
 const {c}=useConversationText(); const router=useRouter();
 return <div className="transcript"><div className="transcript__col"><p className="note convo-status" role="alert" data-outcome="unread">{c('conversationUnread')} <button type="button" className="link-btn" onClick={()=>router.refresh()}>{c('conversationTryAgain')}</button></p></div></div>;
}

// A Conversation whose messages are the Engine's (#875): the page draws its frame, Agent and composer from the database
// and this reads the last 50 messages from the Agent's session on a request of its own (ADR 0030). Scroll to the top
// reads the 50 before. The last good read stays in this browser while a new read runs, and a read that fails after one
// says it could not refresh. A Conversation with no Engine session, or one whose session the Engine does not answer,
// falls back to the old record once, as until its first send gives it a session.
type EnginePage={messages:ConversationRecord['messages'],nextOffset:number,hasMore:boolean};
type EngineRead=(EnginePage&{state:'found'})|{state:'none'|'notSeen'|'missing'|'refused'|'unreachable'|'unread'};
const engineReads=new Map<string,EnginePage>();
const engineKey=(company:string,conversation:string)=>`gw-conversation:${company}:${conversation}`;
function rememberedPage(storage:string):EnginePage|null {
 const held=engineReads.get(storage);
 if(held) return held;
 try {
  const raw=sessionStorage.getItem(storage); if(!raw) return null;
  const page=JSON.parse(raw) as EnginePage;
  return Array.isArray(page?.messages)&&Number.isSafeInteger(page.nextOffset)?page:null;
 } catch { return null; }
}
function rememberPage(storage:string,page:EnginePage) {
 // The last reads of the conversations this tab opened, ten of them: enough to go back to one, never a growing copy.
 if(engineReads.size>=10) { const oldest=engineReads.keys().next().value; if(oldest) { engineReads.delete(oldest); try { sessionStorage.removeItem(oldest); } catch { /* Nothing kept. */ } } }
 engineReads.set(storage,page);
 try { sessionStorage.setItem(storage,JSON.stringify(page)); } catch { /* The last read stays in memory. */ }
}
// The messages' own read, kept beside the frame: `page` is what is drawn, `mode` whether it is the Engine's or the old
// record's, `failed` a read that failed after a good one, and `more` the 50 before the oldest drawn.
function useEnginePage(company:string,conversation:string,hasOldMessages:()=>number) {
 const storage=engineKey(company,conversation);
 const [page,setPage]=useState<EnginePage|null>(null);
 const [mode,setMode]=useState<'reading'|'engine'|'fallback'>('reading');
 const [failed,setFailed]=useState(false);
 const [older,setOlder]=useState(false);
 const [usage,setUsage]=useState<ConversationRecord['usage']>(null);
 const pageRef=useRef<EnginePage|null>(null); const modeRef=useRef(mode); const olderRef=useRef(false); const oldRef=useRef(hasOldMessages);
 useEffect(()=>{ pageRef.current=page; },[page]);
 useEffect(()=>{ modeRef.current=mode; },[mode]);
 useEffect(()=>{ oldRef.current=hasOldMessages; },[hasOldMessages]);
 const read=async(offset:number):Promise<EngineRead>=>{
  try {
   const response=await fetch(`/api/conversations?company=${encodeURIComponent(company)}&conversation=${encodeURIComponent(conversation)}&intent=read&offset=${offset}&limit=50`,{cache:'no-store'});
   if(!response.ok) { await response.arrayBuffer().catch(()=>{}); return {state:response.status===404?'notSeen':'unread'}; }
   return await response.json() as EngineRead;
  } catch { return {state:'unread'}; }
 };
 // The token use is the session detail's, on a request of its own, so a slow detail never holds the messages (ADR 0030).
 const readUsage=async()=>{
  try {
   const response=await fetch(`/api/conversations?company=${encodeURIComponent(company)}&conversation=${encodeURIComponent(conversation)}&intent=usage`,{cache:'no-store'});
   if(!response.ok) { await response.arrayBuffer().catch(()=>{}); return; }
   const body=await response.json() as {usage?:ConversationRecord['usage']};
   if(body.usage) setUsage(body.usage);
  } catch { /* The last usage read stays. */ }
 };
 const refresh=async()=>{
  const held=rememberedPage(storage);
  if(held&&!pageRef.current) { pageRef.current=held; setPage(held); setMode('engine'); }
  void readUsage();
  const readNow=await read(0);
  if(readNow.state==='found') {
   if(readNow.messages.length) {
    const next={messages:readNow.messages,nextOffset:readNow.nextOffset,hasMore:readNow.hasMore};
    pageRef.current=next; setPage(next); setMode('engine'); rememberPage(storage,next); setFailed(false);
   } else if(modeRef.current==='engine'&&pageRef.current) setFailed(false);
   else if(oldRef.current()>0) setMode('fallback');
   else { const empty={messages:[],nextOffset:0,hasMore:false}; pageRef.current=empty; setPage(empty); setMode('engine'); }
   return;
  }
  if(pageRef.current||modeRef.current==='engine') setFailed(true);
  else setMode('fallback');
 };
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{ refreshRef.current=refresh; });
 // The last good read this browser kept shows at once, then a read asks the Engine again (and a tab that comes back
 // asks once more). A first read that fails or finds no messages leaves the old record in charge.
 useEffect(()=>{
  void refreshRef.current();
  const shown=()=>{ if(document.visibilityState==='visible') void refreshRef.current(); };
  window.addEventListener('focus',shown);
  document.addEventListener('visibilitychange',shown);
  return ()=>{ window.removeEventListener('focus',shown); document.removeEventListener('visibilitychange',shown); };
 },[company,conversation]);
 const more=async()=>{
  const current=pageRef.current;
  if(!current?.hasMore||olderRef.current) return false;
  olderRef.current=true; setOlder(true);
  try {
   const readNow=await read(current.nextOffset);
   if(readNow.state!=='found'||!pageRef.current) return false;
   const seen=new Set(pageRef.current.messages.map(message=>message.id));
   const carried=readNow.messages.filter(message=>!seen.has(message.id));
   if(!carried.length) { const done={...pageRef.current,hasMore:false}; pageRef.current=done; setPage(done); return false; }
   const next={messages:[...carried,...pageRef.current.messages],nextOffset:readNow.nextOffset,hasMore:readNow.hasMore};
   pageRef.current=next; setPage(next); return true;
  } finally { olderRef.current=false; setOlder(false); }
 };
 return {page,mode,failed,older,more,usage,refresh:()=>void refreshRef.current(),hasMore:page?.hasMore??false};
}

export function EngineLoaded({initial,steps,team}:{initial:ConversationRecord,steps?:Promise<ConversationSteps|null>,team:boolean}) {
 const {slug,agent,company,conversation,writer,suggest,live:store}=useView();
 const {record,asked,reread,sending}=useConversationRecord({company,initial,steps});
 const {c}=useConversationText();
 const engine=useEnginePage(company,conversation.id,()=>record.messages.length);
 // What the transcript draws: the Engine's messages when they were read, else the old record, which a first read that
 // fails leaves in charge (and which the composer and the title read either way). The old record's live states — the
 // working line, Stop, a question or a request to act — wait for #876 to #879, which bring them on this read.
 const shown=useMemo(()=>{
  const base=engine.page?{...record,messages:engine.page.messages,pending:false,asking:undefined,failed:false,working:null,canStop:false,handover:undefined,unread:undefined}:record;
  const usage=engine.usage??base.usage;
  return usage===base.usage?base:{...base,usage};
 },[record,engine.page,engine.usage]);
 useLayoutEffect(()=>{ store.set({record:shown,asked,sending,engine:true}); },[shown]); // eslint-disable-line react-hooks/exhaustive-deps
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true); const preserve=useRef<{height:number,top:number}|null>(null);
 // The newest page opens on its last message; a page read above the oldest keeps the reader where they were.
 useLayoutEffect(()=>{
  const view=box.current; if(!view) return;
  const held=preserve.current;
  if(held) { view.scrollTop=view.scrollHeight-held.height+held.top; preserve.current=null; }
  else if(stick.current) view.scrollTop=view.scrollHeight;
 },[shown.messages.length]);
 const welcome=!shown.messages.length&&agent?.main;
 return <div className="transcript" ref={box} onScroll={event=>{
  const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80;
  if(view.scrollTop<80&&view.scrollHeight>view.clientHeight+80&&engine.hasMore&&!engine.older) {
   preserve.current={height:view.scrollHeight,top:view.scrollTop};
   void engine.more().then(added=>{ if(!added) preserve.current=null; });
  }
 }}><div className="transcript__col">
  {team&&<PrivateLine agent={conversation.agent_name}/>}
  {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?suggest:undefined}/>}
  {!engine.page&&engine.mode==='reading'?<ChatPlaceholder/>:<ConversationTurns slug={slug} company={company} record={shown} writer={writer} asked={asked} reread={reread} details={!!agent}/>}
  {engine.failed&&engine.page&&<p className="note convo-status" role="alert" data-outcome="refresh" data-refresh>{c('conversationNoRefresh')} <button type="button" className="link-btn" onClick={engine.refresh}>{c('conversationTryAgain')}</button></p>}
 </div></div>;
}

export function ConversationLoaded({initial,steps,team}:{initial:ConversationRecord,steps?:Promise<ConversationSteps|null>,team:boolean}) {
 const {slug,agent,company,conversation,writer,suggest,live:store}=useView();
 const {record,asked,reread,sending}=useConversationRecord({company,initial,steps});
 const {messages}=record;
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 // `asked` only sets this transcript's own state, so the one it was first given stays good.
 useLayoutEffect(()=>{ store.set({record,asked,sending}); },[record]); // eslint-disable-line react-hooks/exhaustive-deps
 const early=useSyncExternalStore(store.subscribe,store.early,()=>0);
 // Opened from "Waiting on you" at a handed step (#140, `#hand-<card>`) or a permission request (#165,
 // `#permission-<card>`), or from Settings at a proposed change to an Agent's settings (#178, `#change-<proposal>`): that
// card in view and focused, not the newest message. It runs before the effect below, on the first draw only. The address is then the Conversation's again, so a
// reload opens on the newest message, and the first message after the landing (the Agent's reply to "Done it") is
// followed again.
 const landed=useRef<number|null>(null);
 useLayoutEffect(()=>{
  const card=/^#(hand|permission|change)-\d+$/.test(location.hash)?box.current?.querySelector<HTMLElement>(location.hash):null;
  if(!card) return;
  stick.current=false; landed.current=messages.length;
  card.scrollIntoView({block:'center'}); card.focus({preventScroll:true});
  history.replaceState(history.state,'',location.pathname+location.search);
 },[]); // eslint-disable-line react-hooks/exhaustive-deps
 // Kept on the newest message while the reader is there (design-reference: renderTranscript).
 useLayoutEffect(()=>{
  if(landed.current!==null&&messages.length>landed.current) { landed.current=null; stick.current=true; }
  if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight;
 },[messages.length,record.pending]);
 const answered=useRef(0);
 useEffect(()=>{ if(early>answered.current) { answered.current=early; asked(); } });
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const welcome=!messages.length&&agent?.main;
 return <div className="transcript" ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}><div className="transcript__col">
  {team&&<PrivateLine agent={conversation.agent_name}/>}
  {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?suggest:undefined}/>}
  <OpeningSteps value={steps??null}><ConversationTurns slug={slug} company={company} record={record} writer={writer} asked={asked} reread={reread} details={!!agent}/></OpeningSteps>
 </div></div>;
}

