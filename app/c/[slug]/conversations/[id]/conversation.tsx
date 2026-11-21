'use client';
import { Suspense, createContext, memo, use, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { LiveFace } from '@/app/agent-face-dot';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent, type DetailsPanel } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import type { DetailsTab } from '@/lib/agent-details.mjs';
import { LeadWelcome } from '@/app/lead-welcome';
import { PrivateLine } from '@/app/private-line';
import { titleOf } from '@/lib/conversations';
import type { ConversationRecord } from '@/lib/conversation-record';
import { columnLabel } from '@/lib/board-columns.mjs';
import { useNewlyWaiting } from '@/lib/newly-waiting';
import type { MessageBoxHandle } from '@/app/conversation-composer';
import { ChatPlaceholder, ConversationComposer, ConversationTurns, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';
import { FirstRunToast } from '@/app/first-run-toast';

// The record as the loaded transcript keeps it current, and how it asks for the reply after a send.
type Live={record:ConversationRecord,asked:()=>void};
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
// the record is read. `board` is the chat's Card on the board as the page read it, shown in the corner until the record
// says where the Card is now.
export default function ConversationView({slug,agent,details,tab,company,conversation,title,writer,board,first,invites,children}:{slug:string,agent:DetailsAgent|null,details:Promise<AgentDetailsView>|null,tab?:DetailsTab,company:string,conversation:ThreadConversation,title:string,writer:boolean,board?:ConversationRecord['board'],first?:'alone'|'team',invites?:number,children:ReactNode}) {
 const panel=useDetailsPanel();
 const composer=useRef<MessageBoxHandle>(null); const [live]=useState(newLive);
 // The same object for the page's life: a new context value reaching a transcript that still streams in would make React
 // draw it again in the browser and leave the streamed copy hidden in the page (#172, #253).
 const view=useMemo(()=>({slug,agent,company,conversation,writer,suggest:(text:string)=>composer.current?.insert(text),live}),[slug,agent,company,conversation,writer,live]);
 return <ChatView value={view}>{first&&<FirstRunToast mode={first} agent={conversation.agent_name} invites={invites}/>}<div className="convo"><div className="chat">
  <ChatHead panel={panel} slug={slug} agent={agent} conversation={conversation} title={title} writer={writer} board={board}/>
  <Transcript>{children}</Transcript>
  <ChatComposer company={company} conversation={conversation} writer={writer} box={composer}/>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} tab={tab} slug={slug}/>}</div></ChatView>;
}

// The chat's floating title and its corner, as the loaded transcript keeps them (#297): they subscribe to the frame's
// store, so the record arriving redraws these and never the page around the transcript.
function ChatHead({panel,slug,agent,conversation,title,writer,board}:{panel:DetailsPanel,slug:string,agent:DetailsAgent|null,conversation:ThreadConversation,title:string,writer:boolean,board?:ConversationRecord['board']}) {
 const {c}=useConversationText(); const {live:store}=useView();
 const live=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 const record=live?.record; const corner=record?record.board:board;
 // The pill shakes once when its Card starts waiting while the chat is open (design-reference: syncWaitMarks).
 const fresh=useNewlyWaiting(corner?.column==='waiting'?[corner.card]:[]);
 return <HeadPill panel={panel} agent={agent?.name} face={<span aria-hidden="true"><LiveFace agentId={conversation.agent_id??undefined} agent={{connection_id:conversation.face,name:conversation.agent_name}} size={24}/></span>} title={record?titleOf(record.messages,conversation.agent_name):title} titleDir="auto" corner={corner&&<CornerPill slug={slug} board={corner} writer={writer} fresh={fresh.has(corner.card)} c={c}/>}/>;
}

// The composer, told the record when it is there and given the send made before it as the transcript asks for its reply
// once loaded (#297).
function ChatComposer({company,conversation,writer,box}:{company:string,conversation:ThreadConversation,writer:boolean,box:Ref<MessageBoxHandle>}) {
 const {live:store}=useView();
 const live=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 return <div className="composer-area"><ConversationComposer company={company} conversation={conversation} record={live?.record??null} writer={writer} asked={live?.asked??store.earlier} box={box} usage/></div>;
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
export function ConversationLoaded({initial,team}:{initial:ConversationRecord,team:boolean}) {
 const {slug,agent,company,conversation,writer,suggest,live:store}=useView();
 const {record,asked,reread}=useConversationRecord({company,initial});
 const {messages}=record;
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 // `asked` only sets this transcript's own state, so the one it was first given stays good.
 useLayoutEffect(()=>{ store.set({record,asked}); },[record]); // eslint-disable-line react-hooks/exhaustive-deps
 const early=useSyncExternalStore(store.subscribe,store.early,()=>0);
 // Opened from "Waiting on you" at a handed step (#140, `#hand-<card>`) or a permission request (#165,
 // `#permission-<card>`): that card in view and focused, not the newest
 // message. It runs before the effect below, on the first draw only. The address is then the Conversation's again, so a
// reload opens on the newest message, and the first message after the landing (the Agent's reply to "Done it") is
// followed again.
 const landed=useRef<number|null>(null);
 useLayoutEffect(()=>{
  const card=/^#(hand|permission)-\d+$/.test(location.hash)?box.current?.querySelector<HTMLElement>(location.hash):null;
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
  <ConversationTurns slug={slug} company={company} record={record} writer={writer} asked={asked} reread={reread}/>
 </div></div>;
}

// The chat's Card on the board (#144; design-reference: renderChat's corner pill): its column now, and the way to it on
// the board. A phone shows the column alone.
function CornerPill({slug,board,writer,fresh,c}:{slug:string,board:NonNullable<ConversationRecord['board']>,writer:boolean,fresh:boolean,c:(key:string,...values:unknown[])=>string}) {
 const {t}=useI18n(); const waiting=board.column==='waiting'; const column=t(columnLabel(board.column,writer));
 return <div className="chat__corner"><Link className={`corner-pill${waiting?' is-waiting':''}${waiting&&fresh?' is-new':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('onTheBoard')} ${column}`}>
  <span className={`dot dot--${waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('onTheBoard')}</span><span className="corner-pill__col">{column}</span>
 </Link></div>;
}
