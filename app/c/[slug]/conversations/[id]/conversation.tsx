'use client';
import { Suspense, createContext, use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import { LeadWelcome } from '@/app/lead-welcome';
import { PrivateLine } from '@/app/private-line';
import { titleOf } from '@/lib/conversations';
import type { ConversationRecord } from '@/lib/conversation-record';
import { columnLabel } from '@/lib/board-columns.mjs';
import { ChatPlaceholder, ConversationComposer, ConversationTurns, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';

type Draft={text:string,n:number}|null;
// The record as the loaded transcript keeps it current, and how it asks for the reply after a send.
type Live={record:ConversationRecord,asked:()=>void};

// Drawn as the reference's chat (design-reference: renderChat): a floating title pill, the Conversation's messages and
// composer (app/conversation-thread.tsx), its usage, and the Agent's details beside it while the Agent is still
// attached. In a team, a line at the top says the chat is between this person and the Agent only (#25).
// The record arrives after the page (#172): until then the transcript shows the reference's placeholder, under the title
// the sidebar gives the chat. The title and the composer stay outside the part that loads, so the same box takes a
// message from the start, keeping what was typed, its caret and its focus; a message sent before the record arrives
// has its reply asked for once it is there. `children` is the transcript (ConversationLoaded), drawn by the server once
// the record is read.
export default function ConversationView({slug,agent,details,company,conversation,title,writer,children}:{slug:string,agent:DetailsAgent|null,details:AgentDetailsView|null,company:string,conversation:ThreadConversation,title:string,writer:boolean,children:ReactNode}) {
 const {c}=useConversationText(); const panel=useDetailsPanel();
 const [draft,setDraft]=useState<Draft>(null); const [early,setEarly]=useState(0); const [live,setLive]=useState<Live|null>(null);
 const record=live?.record;
 return <ChatView value={{slug,agent,company,conversation,writer,setDraft,early,setLive}}><div className="convo"><div className="chat">
  <HeadPill panel={panel} agent={agent?.name} face={<span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={24}/></span>} title={record?titleOf(record.messages,conversation.agent_name):title} titleDir="auto" corner={record?.board&&<CornerPill slug={slug} board={record.board} writer={writer} c={c}/>}/>
  <Suspense fallback={<div className="transcript"><ChatPlaceholder/></div>}>{children}</Suspense>
  <div className="composer-area"><ConversationComposer company={company} conversation={conversation} record={record??null} writer={writer} asked={live?.asked??(()=>setEarly(count=>count+1))} draft={draft} usage/></div>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} settingsHref={`/c/${slug}/agents`}/>}</div></ChatView>;
}

type View={slug:string,agent:DetailsAgent|null,company:string,conversation:ThreadConversation,writer:boolean,setDraft:(next:(current:Draft)=>Draft)=>void,early:number,setLive:(live:Live)=>void};
// The chat around the transcript: what the transcript tells the title and the composer.
const ChatView=createContext<View|null>(null);
const useView=()=>use(ChatView)!;

// The transcript once its record is read, in place of the placeholder.
export function ConversationLoaded({initial,team}:{initial:ConversationRecord,team:boolean}) {
 const {slug,agent,company,conversation,writer,setDraft,early,setLive}=useView();
 const {record,asked}=useConversationRecord({company,initial});
 const {messages}=record;
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 // `asked` only sets this transcript's own state, so the one it was first given stays good.
 useLayoutEffect(()=>{ setLive({record,asked}); },[record]); // eslint-disable-line react-hooks/exhaustive-deps
 // Kept on the newest message while the reader is there (design-reference: renderTranscript).
 useLayoutEffect(()=>{ if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight; },[messages.length,record.pending]);
 const answered=useRef(0);
 useEffect(()=>{ if(early>answered.current) { answered.current=early; asked(); } });
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const welcome=!messages.length&&agent?.main;
 return <div className="transcript" ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}><div className="transcript__col">
  {team&&<PrivateLine agent={conversation.agent_name}/>}
  {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>}
  <ConversationTurns slug={slug} record={record}/>
 </div></div>;
}

// The chat's Card on the board (#144; design-reference: renderChat's corner pill): its column now, and the way to it on
// the board. A phone shows the column alone.
function CornerPill({slug,board,writer,c}:{slug:string,board:NonNullable<ConversationRecord['board']>,writer:boolean,c:(key:string,...values:unknown[])=>string}) {
 const {t}=useI18n(); const waiting=board.column==='waiting'; const column=t(columnLabel(board.column,writer));
 return <div className="chat__corner"><Link className={`corner-pill${waiting?' is-waiting':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('onTheBoard')} ${column}`}>
  <span className={`dot dot--${waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('onTheBoard')}</span><span className="corner-pill__col">{column}</span>
 </Link></div>;
}
