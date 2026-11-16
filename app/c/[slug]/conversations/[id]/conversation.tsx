'use client';
import { Suspense, use, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent, type DetailsPanel } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import { LeadWelcome } from '@/app/lead-welcome';
import { PrivateLine } from '@/app/private-line';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { titleOf } from '@/lib/conversations';
import type { ConversationRecord } from '@/lib/conversation-record';
import { columnLabel } from '@/lib/board-columns.mjs';
import { ChatPlaceholder, ConversationComposer, ConversationTurns, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';

type Draft={text:string,n:number}|null;
// Where the focus and the caret were in the loading chat when it gave way to the loaded one.
type Left={start:number,end:number,focus:'box'|'head'|Element|null};

// Drawn as the reference's chat (design-reference: renderChat): a floating title pill, the Conversation's messages and
// composer (app/conversation-thread.tsx), its usage, and the Agent's details beside it while the Agent is still
// attached. In a team, a line at the top says the chat is between this person and the Agent only (#25).
// The record arrives after the page (#172): until then the transcript shows the reference's placeholder under the title
// the sidebar gives the chat, and the composer already takes a message. What was typed there, the caret and the focus
// carry into the loaded chat, and a message sent from it has its reply asked for once the chat is loaded.
export default function ConversationView({slug,agent,details,company,conversation,record,title,writer,team}:{slug:string,agent:DetailsAgent|null,details:AgentDetailsView|null,company:string,conversation:ThreadConversation,record:Promise<ConversationRecord>,title:string,writer:boolean,team:boolean}) {
 const panel=useDetailsPanel();
 const [draft,setDraft]=useState<Draft>(null); const [typed,setTyped]=useState(''); const [early,setEarly]=useState(0);
 const leftRef=useRef<Left|null>(null);
 const view={slug,agent,company,conversation,writer,panel,leftRef};
 return <div className="convo"><div className="chat">
  <Suspense fallback={<Loading {...view} title={title} setTyped={setTyped} setDraft={setDraft} sent={()=>setEarly(count=>count+1)}/>}>
   <Loaded {...view} record={record} team={team} draft={draft??(typed?{text:typed,n:0}:null)} setDraft={setDraft} early={early}/>
  </Suspense>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} settingsHref={`/c/${slug}/agents`}/>}</div>;
}

type View={slug:string,agent:DetailsAgent|null,company:string,conversation:ThreadConversation,writer:boolean,panel:DetailsPanel,leftRef:RefObject<Left|null>};
const Face=({conversation,size}:{conversation:ThreadConversation,size:number})=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;

function Loading({agent,company,conversation,writer,panel,leftRef,title,setTyped,setDraft,sent}:View&{title:string,setTyped:(text:string)=>void,setDraft:(next:(current:Draft)=>Draft)=>void,sent:()=>void}) {
 const {t}=useI18n(); const area=useRef<HTMLDivElement>(null); const shown=useRef(true);
 useLayoutEffect(()=>{
  const box=area.current?.querySelector('textarea');
  return ()=>{
   shown.current=false;
   const now=document.activeElement;
   leftRef.current={start:box?.selectionStart??0,end:box?.selectionEnd??0,focus:box&&now===box?'box':now?.id==='btn-details'?'head':now};
  };
 },[leftRef]);
 return <>
  <HeadPill panel={panel} agent={agent?.name} face={<Face conversation={conversation} size={24}/>} title={title} titleDir="auto"/>
  <div className="transcript"><ChatPlaceholder/></div>
  <div className="composer-area" ref={area} onInput={event=>setTyped((event.target as HTMLTextAreaElement).value)}>
   {writer?<MessageBox placeholder={t('writeTo',conversation.agent_name)} send={async(message,sendKey)=>{
    setTyped('');
    const failure=await postMessage({company,conversation:conversation.id,message,sendKey});
    if(!failure) sent();
    else if(shown.current) setTyped(message);
    else setDraft(current=>({text:message,n:(current?.n||0)+1}));
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
   {/* The usage line's place, so the composer does not move when it arrives. */}
   <p className="chat-usage" aria-hidden="true">{'\u00a0'}</p>
  </div>
 </>;
}

function Loaded({slug,agent,company,conversation,writer,panel,leftRef,record:arriving,team,draft,setDraft,early}:View&{record:Promise<ConversationRecord>,team:boolean,draft:Draft,setDraft:(next:(current:Draft)=>Draft)=>void,early:number}) {
 const {c}=useConversationText();
 const {record,asked}=useConversationRecord({company,initial:use(arriving)});
 const {messages}=record;
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true); const area=useRef<HTMLDivElement>(null);
 // Kept on the newest message while the reader is there (design-reference: renderTranscript).
 useLayoutEffect(()=>{ if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight; },[messages.length,record.pending]);
 useLayoutEffect(()=>{
  const was=leftRef.current; if(!was) return; leftRef.current=null;
  const field=area.current?.querySelector('textarea');
  const target=was.focus==='box'?field:was.focus==='head'?document.getElementById('btn-details'):was.focus;
  if(target instanceof HTMLElement) target.focus();
  if(was.focus==='box') field?.setSelectionRange(was.start,was.end);
 },[leftRef]);
 const answered=useRef(0);
 useEffect(()=>{ if(early>answered.current) { answered.current=early; asked(); } });
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const welcome=!messages.length&&agent?.main;
 return <>
  <HeadPill panel={panel} agent={agent?.name} face={<Face conversation={conversation} size={24}/>} title={titleOf(messages,conversation.agent_name)} titleDir="auto" corner={record.board&&<CornerPill slug={slug} board={record.board} writer={writer} c={c}/>}/>
  <div className="transcript" ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}><div className="transcript__col">
   {team&&<PrivateLine agent={conversation.agent_name}/>}
   {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>}
   <ConversationTurns slug={slug} record={record}/>
  </div></div>
  <div className="composer-area" ref={area}><ConversationComposer company={company} record={record} writer={writer} asked={asked} draft={draft} usage/></div>
 </>;
}

// The chat's Card on the board (#144; design-reference: renderChat's corner pill): its column now, and the way to it on
// the board. A phone shows the column alone.
function CornerPill({slug,board,writer,c}:{slug:string,board:NonNullable<ConversationRecord['board']>,writer:boolean,c:(key:string,...values:unknown[])=>string}) {
 const {t}=useI18n(); const waiting=board.column==='waiting'; const column=t(columnLabel(board.column,writer));
 return <div className="chat__corner"><Link className={`corner-pill${waiting?' is-waiting':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('onTheBoard')} ${column}`}>
  <span className={`dot dot--${waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('onTheBoard')}</span><span className="corner-pill__col">{column}</span>
 </Link></div>;
}
