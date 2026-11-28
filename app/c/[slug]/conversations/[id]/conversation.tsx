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
import { takeSent, type Send } from '@/lib/sending';
import type { LiveRun } from '@/app/run-activity';
import type { LiveDelta, LiveLine } from '@/lib/live-steps.mjs';
import { columnLabel } from '@/lib/board-columns.mjs';
import { postMessageAnswer, type MessageBoxHandle } from '@/app/conversation-composer';
import { ChatPlaceholder, ConversationComposer, ConversationTurns, OpeningSteps, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';
import { FirstRunToast } from '@/app/first-run-toast';
import { ShellIcon } from '@/components/shell-icon';
import { MoreMenu } from '@/app/more-menu';
import { useConversationArchive } from '@/app/conversation-archive';
import { useConversationRename } from '@/app/conversation-rename';
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
export default function ConversationView({slug,agent,details,tab,company,conversation,title,titled=false,writer,first,invites,archived=false,children}:{slug:string,agent:DetailsAgent|null,details:Promise<AgentDetailsView>|null,tab?:DetailsTab,company:string,conversation:ThreadConversation,title:string,titled?:boolean,writer:boolean,first?:'alone'|'team',invites?:number,archived?:boolean,children:ReactNode}) {
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
  <ChatHead panel={panel} agent={agent} conversation={conversation} title={title} titled={titled}/>
  <ChatMore company={company} conversation={conversation} title={title} archived={isArchived} changed={setArchived}/>
  <Transcript>{children}</Transcript>
  <ChatComposer company={company} conversation={conversation} writer={writer} box={composer} archived={isArchived} restored={()=>setArchived(false)}/>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} tab={tab} slug={slug} suggest={writer?fill:undefined}/>}</div></ChatView>;
}

// The chat's floating title, as the loaded transcript keeps it (#297): it subscribes to the frame's store, so the record
// arriving redraws it and never the page around the transcript. The reference's corner pill named the chat's Card on the
// old board, which is switched off (#846); a Card an Agent makes from a chat is its own row in the transcript (#844).
// `titled`: the title is the session's own (#881, renamed or titled by the Engine), which the record's first words never replace.
function ChatHead({panel,agent,conversation,title,titled}:{panel:DetailsPanel,agent:DetailsAgent|null,conversation:ThreadConversation,title:string,titled:boolean}) {
 const {live:store}=useView(); const {t,language}=useI18n();
 const live=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 const record=live?.record;
 // The head's face shows the Agent's state as the sidebar's tile does (app/sidebar-live), with what this chat knows.
 const state=useAgentState(conversation.agent_id??'');
 // The Engine's messages are a page of the end, not the Conversation's first words: its title stays the database's.
 const named=record&&!live?.engine&&!titled;
 return <><Greeting agent={conversation.agent_id}/><HeadPill panel={panel} agent={agent?.name} face={<span aria-hidden="true" data-greet><AgentFace agent={conversation.face} name={conversation.agent_name} size={32} state={state} live/></span>} title={named?conversationTitle({morningDay:record.morningDay,body:record.messages[0]?.body,file:record.messages[0]?.files?.[0]?.name,agent:conversation.agent_name},t,language):title} titleDir="auto"/></>;
}

// The chat head's own menu (#674; design-reference-card: #chat-more, popHTML 'chat'): rename the Conversation (#881),
// and archive it, or restore it while it is archived. Its person tidies their own, whatever their Role.
function ChatMore({company,conversation,title,archived,changed}:{company:string,conversation:ThreadConversation,title:string,archived:boolean,changed:(archived:boolean)=>void}) {
 const {t}=useI18n();
 const chat={id:conversation.id,title};
 const {archive,restore,confirm}=useConversationArchive(company,(_ids,nowArchived)=>changed(nowArchived));
 const {rename,dialog}=useConversationRename(company);
 return <div className="chat__start"><MoreMenu label={t('conversationMore')} items={[{key:'rename',icon:'pencil',label:t('conversationRename'),run:()=>rename(chat)},archived
  ?{key:'restore',icon:'restore',label:t('conversationRestore'),run:()=>void restore([chat])}
  :{key:'archive',icon:'archive',label:t('conversationArchive'),run:()=>void archive([chat])}]}/>{confirm}{dialog}</div>;
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
type Refreshed='read'|'again'|'stop';
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
 const [moreFailed,setMoreFailed]=useState(false);
 const [usage,setUsage]=useState<ConversationRecord['usage']>(null);
 const pageRef=useRef<EnginePage|null>(null); const modeRef=useRef(mode); const olderRef=useRef(false); const oldRef=useRef(hasOldMessages); const lastAsk=useRef(0);
 useEffect(()=>{ pageRef.current=page; },[page]);
 useEffect(()=>{ modeRef.current=mode; },[mode]);
 useEffect(()=>{ oldRef.current=hasOldMessages; },[hasOldMessages]);
 const read=async(offset:number):Promise<EngineRead>=>{
  try {
   const response=await fetch(`/api/conversations?company=${encodeURIComponent(company)}&conversation=${encodeURIComponent(conversation)}&intent=read&offset=${offset}&limit=50`,{cache:'no-store'});
   if(!response.ok) { await response.arrayBuffer().catch(()=>{}); return {state:response.status===404?'notSeen':response.status===401||response.status===403?'refused':'unread'}; }
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
 // Answers how the Engine's read went: `read`, so a Run's end lets go of its live words only once the session holds them;
 // `again` for a read that may answer later (the Engine slow or not reached); `stop` for one that never will (signed out,
 // no longer allowed, the Conversation or its session gone).
 const refresh=async():Promise<Refreshed>=>{
  const held=rememberedPage(storage);
  if(held&&!pageRef.current) { pageRef.current=held; setPage(held); setMode('engine'); }
  void readUsage();
  const readNow=await read(0);
  if(readNow.state==='found') {
   // A page of only tool calls draws nothing, and a page with messages after it is not the end: an empty page is the
   // first page all the same, so the read goes on to the page before it (#875).
   if(readNow.messages.length||readNow.hasMore) {
    // A refresh keeps the pages the person scrolled back through: the newest page is merged into what is drawn, its
    // duplicates by id dropped, and the older cursor and its history kept (#875).
    const current=pageRef.current;
    const fresh=new Set(readNow.messages.map(message=>message.id));
    // A reply that is in the fresh page supersedes the interim reply the same turn drew before (its words are not a
    // second answer); the turn's own person message stays.
    const freshTurns=new Set(readNow.messages.flatMap(message=>message.turn?[message.turn]:[]));
    // More than a page can arrive while the tab is away: with nothing in common the newest page replaces what was drawn,
    // so the history stays contiguous instead of leaving a gap behind. A page that draws nothing keeps what is there.
    const overlaps=!!current&&(!readNow.messages.length||current.messages.some(message=>fresh.has(message.id)));
    const kept=overlaps?current!.messages.filter(message=>!fresh.has(message.id)&&!(message.author==='agent'&&message.turn&&freshTurns.has(message.turn))):[];
    const older=overlaps&&current!.nextOffset>readNow.nextOffset;
    const next=overlaps?{messages:[...kept,...readNow.messages],nextOffset:Math.max(readNow.nextOffset,current!.nextOffset),hasMore:older?current!.hasMore:readNow.hasMore}:{messages:readNow.messages,nextOffset:readNow.nextOffset,hasMore:readNow.hasMore};
    pageRef.current=next; setPage(next); setMode('engine'); setFailed(false); setMoreFailed(false);
    if(readNow.messages.length) rememberPage(storage,{messages:readNow.messages,nextOffset:readNow.nextOffset,hasMore:readNow.hasMore});
   } else if(modeRef.current==='engine'&&pageRef.current) setFailed(false);
   else if(oldRef.current()>0) setMode('fallback');
   else { const empty={messages:[],nextOffset:0,hasMore:false}; pageRef.current=empty; setPage(empty); setMode('engine'); }
   return 'read';
  }
  if(pageRef.current||modeRef.current==='engine') setFailed(true);
  else setMode('fallback');
  return readNow.state==='unread'||readNow.state==='unreachable'?'again':'stop';
 };
 const refreshRef=useRef<()=>Promise<Refreshed>>(async()=>'again');
 useEffect(()=>{ refreshRef.current=refresh; });
 // The last good read this browser kept shows at once, then a read asks the Engine again (and a tab that comes back
 // asks once more). A first read that fails or finds no messages leaves the old record in charge.
 useEffect(()=>{
  lastAsk.current=Date.now();
  void refreshRef.current();
  // A tab that comes back asks once, whichever of the two events arrives first (they fire together).
  const shown=()=>{
   if(document.visibilityState!=='visible') return;
   const now=Date.now(); if(now-lastAsk.current<1000) return;
   lastAsk.current=now; void refreshRef.current();
  };
  window.addEventListener('focus',shown);
  document.addEventListener('visibilitychange',shown);
  return ()=>{ window.removeEventListener('focus',shown); document.removeEventListener('visibilitychange',shown); };
 },[company,conversation]);
 const more=async()=>{
  let current=pageRef.current;
  if(!current?.hasMore||olderRef.current) return false;
  olderRef.current=true; setOlder(true);
  try {
   // A page can hold only tool calls, tool results or hidden messages: read on until a page has something to draw, or
   // the history ends, so the messages before it are never lost. Twenty pages at a time; a later scroll goes on.
   for(let step=0;step<20;step++) {
    const readNow=await read(current.nextOffset);
    if(readNow.state!=='found'||!pageRef.current) { setMoreFailed(true); return false; }
    setMoreFailed(false);
    const seen=new Set(pageRef.current.messages.map(message=>message.id));
    // New messages can shift the newest-relative offset while the tab is open: only messages older than the oldest
    // drawn, and of a turn not already drawn, are prepended; a newer one waits for the refresh that shows it.
    const oldest=pageRef.current.messages[0]?.created_at;
    const turns=new Set(pageRef.current.messages.flatMap(message=>message.turn?[message.turn]:[]));
    const carried=readNow.messages.filter(message=>!seen.has(message.id)&&(!oldest||message.created_at<=oldest)&&!(message.author==='agent'&&message.turn&&turns.has(message.turn)));
    if(carried.length) {
     current={messages:[...carried,...pageRef.current.messages],nextOffset:readNow.nextOffset,hasMore:readNow.hasMore};
     pageRef.current=current; setPage(current); return true;
    }
    current={...pageRef.current,nextOffset:readNow.nextOffset,hasMore:readNow.hasMore};
    pageRef.current=current; setPage(current);
    if(!readNow.hasMore) return false;
   }
   return false;
  } finally { olderRef.current=false; setOlder(false); }
 };
 return {page,mode,failed,older,moreFailed,more,usage,refresh:()=>refreshRef.current(),hasMore:page?.hasMore??false};
}

// The open Run of a Conversation whose messages are the Engine's, as it happens (#876): read from gtmworks's own live
// route (app/api/conversation-live), never from the Engine. Its view is the Run's steps so far and the call it makes
// now, its reply the words written so far. `follow` starts reading it, at once on a page that opened while a Run works
// and after each send; once the Run's end is seen, `ended` reads the session again, which then holds the reply and its
// steps, and only once that read came back are the live view and the sent message let go, so nothing is drawn twice or
// goes missing. A read that is cut short, or a session read that fails, is asked again, more slowly each time.
function useEngineRun(company:string,conversation:string,open:boolean,ended:()=>Promise<Refreshed>) {
 const [view,setView]=useState<LiveRun|null>(null);
 const [reply,setReply]=useState('');
 const [working,setWorking]=useState(open);
 // The Runs whose live read has begun (#877): a message the Engine queued waits until its own Run is one of them.
 const [begun,setBegun]=useState<ReadonlySet<string>>(()=>new Set());
 // Whether a live read is on, the one looking for the next Run included: none on, the row holds no Run that works.
 const [following,setFollowing]=useState(open);
 const reading=useRef<AbortController|null>(null);
 const endedRef=useRef(ended); useEffect(()=>{ endedRef.current=ended; });
 // A message sent while a Run is followed starts its own Run, which the row holds after it: once a Run ends the next one
 // the row holds is followed, in the order they were started, until the row holds none.
 const again=useRef(false);
 // `next`: the read that looks for the next Run once one ended, which shows the Agent working only once it finds one.
 const follow=useCallback((next=false)=>{
  if(reading.current) { again.current=true; return; }
  const stopped=new AbortController(); reading.current=stopped;
  setFollowing(true);
  if(!next||again.current) setWorking(true);
  const read=async(failures:number):Promise<void>=>{
   let end:string|null=null; let said='';
   try {
    const response=await fetch(`/api/conversation-live?company=${encodeURIComponent(company)}&conversation=${encodeURIComponent(conversation)}`,{cache:'no-store',signal:stopped.signal});
    // Signed out, no longer allowed, or the Conversation or its Agent gone: no later read can answer, so the read ends.
    if(response.status===401||response.status===403||response.status===404) { await response.arrayBuffer().catch(()=>{}); end='none'; }
    else {
     if(!response.ok||!response.body) throw new Error('unread');
     const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
     let buffer='';
     for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      buffer+=value;
      for(let at=buffer.indexOf('\n');at>=0;at=buffer.indexOf('\n')) {
       const line=JSON.parse(buffer.slice(0,at)) as LiveLine|LiveDelta; buffer=buffer.slice(at+1);
       if('end' in line) end=line.end;
       else if('delta' in line) { said+=line.delta; setReply(said); setWorking(true); }
       else { setView(line); setWorking(true); setBegun(current=>current.has(line.run)?current:new Set([...current,line.run])); }
      }
     }
    }
   } catch { if(stopped.signal.aborted) return; end='unreachable'; }
   if(stopped.signal.aborted) return;
   if(end==='ended'||end==='gone'||end==='none') {
    // The live words stay until a read of the session holds the reply: a read that may answer later is asked again, one
    // that never will lets them go.
    let outcome=await endedRef.current();
    for(let tries=0;outcome==='again';tries++) {
     await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**tries,15000)));
     if(stopped.signal.aborted) return;
     outcome=await endedRef.current();
    }
    if(stopped.signal.aborted) return;
    reading.current=null; setView(null); setReply('');
    // The next Run the row holds, if any: after one that ended, or after a send made meanwhile.
    if(outcome==='read'&&(end!=='none'||again.current)) { const sent=again.current; again.current=false; if(!sent) setWorking(false); follow(!sent); } else { again.current=false; setWorking(false); setFollowing(false); }
    return;
   }
   // A read cut short replays the Run's events from its start, so the words are drawn again from the first.
   await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,15000)));
   if(!stopped.signal.aborted) await read(end==='unreachable'?failures+1:0);
  };
  void read(0);
 },[company,conversation]);
 useEffect(()=>{ if(open) follow(); return ()=>{ reading.current?.abort(); reading.current=null; }; },[open,follow]);
 return {view,reply,working,follow,begun,following};
}

export function EngineLoaded({initial,steps,team,open=false}:{initial:ConversationRecord,steps?:Promise<ConversationSteps|null>,team:boolean,open?:boolean}) {
 const {slug,agent,company,conversation,writer,suggest,live:store}=useView();
 const {record,reread,sending,release}=useConversationRecord({company,initial,steps});
 const {c}=useConversationText(); const {t}=useI18n();
 const engine=useEnginePage(company,conversation.id,()=>record.messages.length);
 // A Run's end reads the session again; the messages sent before it then leave the drawn list, as the session holds them.
 // A Run's end reads the session again; a sent message leaves the drawn list only once a read holds it (below).
 const run=useEngineRun(company,conversation.id,open,engine.refresh);
 // The first message of a new Conversation, sent from the Agent's empty chat, is drawn here at once (#876).
 useEffect(()=>{ const handed=takeSent(conversation.id); if(handed) sending(handed.key,handed.body,[])(null); },[conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps
 // What the transcript draws: the Engine's messages when they were read, else the old record, which a first read that
 // fails leaves in charge (and which the composer and the title read either way). The old record's live states — the
 // working line, Stop, a question or a request to act — wait for #876 to #879, which bring them on this read.
 // The person's messages the page held when each sent message was first drawn: only a message the session holds beyond
 // those can be that send, so the same words said before (a second "Yes") never stand in for it. Kept as state, set while
 // drawing the first time a sent message is seen.
 const [before,setBefore]=useState<ReadonlyMap<number,ReadonlySet<number>>>(new Map());
 const [spent,setSpent]=useState<ReadonlyMap<number,number>>(new Map());
 const people=(engine.page?.messages??[]).filter(message=>message.author==='person');
 const drawnSent=record.messages.filter(message=>message.kind==='sending');
 if(drawnSent.some(message=>!before.has(message.id))) {
  const next=new Map(before);
  for(const message of drawnSent) if(!next.has(message.id)) next.set(message.id,new Set(people.map(drawn=>drawn.id)));
  setBefore(next);
 }
 const sent=useMemo(()=>{
  // A message sent is drawn after the Engine's messages until a read of the session holds it (#876): one of the person's
  // messages with the same words, not on the page when it was sent, stands for it, and each stands for one send.
  const used=new Set<number>(); const held:{id:number,by:number}[]=[];
  const waiting=drawnSent.filter(message=>{
   const seen=before.get(message.id)??new Set(people.map(drawn=>drawn.id));
   const found=people.find(drawn=>drawn.body===message.body&&!seen.has(drawn.id)&&!used.has(drawn.id)&&(spent.get(drawn.id)??message.id)===message.id);
   if(!found) return true;
   used.add(found.id); held.push({id:message.id,by:found.id}); return false;
  // One the Engine queued waits its turn (#877) until the live read begins its own Run.
  }).map(message=>message.behind&&message.run&&run.begun.has(message.run)?{...message,behind:undefined}:message);
  return {waiting,held};
 },[record.messages,engine.page,before,spent,run.begun]); // eslint-disable-line react-hooks/exhaustive-deps
 const shown=useMemo(()=>{
  const base=engine.page?{...record,messages:[...engine.page.messages,...sent.waiting],pending:false,asking:undefined,failed:false,working:null,canStop:false,handover:undefined,unread:undefined}:record;
  const usage=engine.usage??base.usage;
  return usage===base.usage?base:{...base,usage};
 },[record,engine.page,engine.usage,sent.waiting]);
 useLayoutEffect(()=>{ store.set({record:shown,asked:()=>run.follow(),sending,engine:true}); },[shown]); // eslint-disable-line react-hooks/exhaustive-deps
 // A message sent from the composer before this transcript was drawn has its Run followed once it is (#876), as the old
 // record's transcript asks for its reply.
 const early=useSyncExternalStore(store.subscribe,store.early,()=>0);
 const answeredEarly=useRef(0);
 useEffect(()=>{ if(early>answeredEarly.current) { answeredEarly.current=early; run.follow(); } },[early,run.follow]); // eslint-disable-line react-hooks/exhaustive-deps
 // The messages sent that a read of the session now holds are drawn from it alone: one still queued behind a working Run,
 // which the session does not hold yet, stays drawn as sent.
 // A message that stood for one send is spent on it, kept as state set while drawing: it never stands for another send
 // of the same words, also once the first is let go.
 if(sent.held.some(each=>!spent.has(each.by))) setSpent(new Map([...spent,...sent.held.map(each=>[each.by,each.id] as const)]));
 useEffect(()=>{ release(sent.held.map(each=>each.id)); },[sent.held.map(each=>each.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true); const preserve=useRef<{height:number,top:number}|null>(null);
 // The newest page opens on its last message; a page read above the oldest keeps the reader where they were.
 useLayoutEffect(()=>{
  const view=box.current; if(!view) return;
  const held=preserve.current;
  if(held) { view.scrollTop=view.scrollHeight-held.height+held.top; preserve.current=null; }
  else if(stick.current) view.scrollTop=view.scrollHeight;
 },[shown.messages.length,run.reply,run.view?.steps.length]);
 // A newest page of only tool calls and results can be shorter than the viewport: read the older pages until the
 // transcript scrolls or the history ends, so there is no history a person cannot reach (#875).
 useLayoutEffect(()=>{
  const view=box.current;
  // A failed older read is not retried by this effect: the person can scroll again, and a good refresh clears it.
  if(!view||!engine.page||engine.older||engine.moreFailed||!engine.hasMore) return;
  if(!engine.page.messages.length||view.scrollHeight<=view.clientHeight+80) void engine.more();
 },[engine.page?.nextOffset,engine.hasMore,engine.older,engine.moreFailed]); // eslint-disable-line react-hooks/exhaustive-deps
 const welcome=!shown.messages.length&&agent?.main;
 // A read of the session that already holds the reply the live read is writing draws it once: the stored one (#876).
 const last=shown.messages.at(-1);
 const stored=!!run.reply&&last?.author==='agent'&&last.body.trim()===run.reply.trim();
 // The session's last message is the person's and no Run of the row works (#877): the Agent gave no reply (its Run was
 // lost, or failed with the Engine). Try again asks it again with those words, as a new Run of their own.
 const said=engine.page?.messages.at(-1);
 const noReply=writer&&engine.mode==='engine'&&said?.author==='person'&&!run.following&&!run.working&&!sent.waiting.length;
 const [asking,setAsking]=useState(false);
 // One send key per message left with no reply: a second press after an answer that was lost replays that Run.
 const againKeys=useRef(new Map<number,string>());
 const askAgain=async()=>{
  if(!said||asking) return;
  setAsking(true);
  const key=againKeys.current.get(said.id)??crypto.randomUUID(); againKeys.current.set(said.id,key);
  const settle=sending(key,said.body,[]);
  const {failure,answer}=await postMessageAnswer({company,conversation:conversation.id,message:said.body,sendKey:key});
  settle(failure,answer); setAsking(false);
  if(failure) toast(t(failure),{icon:'alert'}); else run.follow();
 };
 return <div className="transcript" ref={box} onScroll={event=>{
  const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80;
  if(view.scrollTop<80&&view.scrollHeight>view.clientHeight+80&&engine.hasMore&&!engine.older) {
   preserve.current={height:view.scrollHeight,top:view.scrollTop};
   void engine.more().then(added=>{ if(!added) preserve.current=null; });
  }
 }}><div className="transcript__col">
  {team&&<PrivateLine agent={conversation.agent_name}/>}
  {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?suggest:undefined}/>}
  {!engine.page&&engine.mode==='reading'?<ChatPlaceholder/>:<ConversationTurns slug={slug} company={company} record={shown} writer={writer} asked={()=>run.follow()} reread={reread} details={!!agent} live={stored?{view:null,reply:'',working:false}:{view:run.view,reply:run.reply,working:run.working}}/>}
  {noReply&&<p className="note convo-status" role="alert" data-outcome="no-reply">{c('conversationNoReply')} <button type="button" className="link-btn" disabled={asking} onClick={()=>void askAgain()}>{c('conversationTryAgain')}</button></p>}
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

