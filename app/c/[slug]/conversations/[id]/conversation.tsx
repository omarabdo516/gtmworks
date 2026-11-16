'use client';
import { useState } from 'react';
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
import { ConversationComposer, ConversationTurns, useConversationRecord, useConversationText, type ThreadConversation } from '@/app/conversation-thread';

// Drawn as the reference's chat (design-reference: renderChat): a floating title pill, the Conversation's messages and
// composer (app/conversation-thread.tsx), its usage, and the Agent's details beside it while the Agent is still
// attached. In a team, a line at the top says the chat is between this person and the Agent only (#25).
export default function ConversationView({slug,agent,details,company,conversation,initial,writer,team}:{slug:string,agent:DetailsAgent|null,details:AgentDetailsView|null,company:string,conversation:ThreadConversation,initial:ConversationRecord,writer:boolean,team:boolean}) {
 const {c}=useConversationText(); const panel=useDetailsPanel();
 const {record,asked}=useConversationRecord({company,initial});
 const {messages}=record;
 const face=(size:number)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const [draft,setDraft]=useState<{text:string,n:number}|null>(null);
 const welcome=!messages.length&&agent?.main;
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} agent={agent?.name} face={face(24)} title={titleOf(messages,conversation.agent_name)} titleDir="auto" corner={record.board&&<CornerPill slug={slug} board={record.board} writer={writer} c={c}/>}/>
  <div className="transcript"><div className="transcript__col">
   {team&&<PrivateLine agent={conversation.agent_name}/>}
   {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>}
   <ConversationTurns slug={slug} record={record}/>
  </div></div>
  <div className="composer-area"><ConversationComposer company={company} record={record} writer={writer} asked={asked} draft={draft} usage/></div>
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} settingsHref={`/c/${slug}/agents`}/>}</div>;
}

// The chat's Card on the board (#144; design-reference: renderChat's corner pill): its column now, and the way to it on
// the board. A phone shows the column alone.
function CornerPill({slug,board,writer,c}:{slug:string,board:NonNullable<ConversationRecord['board']>,writer:boolean,c:(key:string,...values:unknown[])=>string}) {
 const {t}=useI18n(); const waiting=board.column==='waiting'; const column=t(columnLabel(board.column,writer));
 return <div className="chat__corner"><Link className={`corner-pill${waiting?' is-waiting':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('onTheBoard')} ${column}`}>
  <span className={`dot dot--${waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('onTheBoard')}</span><span className="corner-pill__col">{column}</span>
 </Link></div>;
}
