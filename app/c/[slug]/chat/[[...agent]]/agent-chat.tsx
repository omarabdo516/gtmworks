'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, newId, postMessage } from '@/app/conversation-composer';
import { LeadWelcome } from '@/app/lead-welcome';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';

// An Agent's empty chat (design-reference: newAgentEmptyHTML, mainEmptyHTML): its face and name (the main Agent
// carries "Main"), what it is for, and the composer, with the Agent's details beside it. A Viewer reads one quiet line
// where the composer would be.
// In a new workspace that holds only the main Agent (`fresh`), it greets with Lead's first words instead (#9).
export default function AgentChat({slug,company,agent,writer,fresh=false}:{slug:string,company:string,agent:DetailsAgent|null,writer:boolean,fresh?:boolean}) {
 const {t}=useI18n(); const router=useRouter(); const [conversation]=useState(newId); const panel=useDetailsPanel();
 const [draft,setDraft]=useState<{text:string,n:number}|null>(null);
 return <div className="convo">
  <div className="chat">
   <HeadPill panel={panel} agent={agent?.name} face={agent&&<span aria-hidden="true"><CompanyAgentFace agent={agent} size={24}/></span>} title={t('newChat')}/>
   <div className="transcript"><div className="transcript__col">
    {agent&&fresh&&agent.main?<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>:agent?<div className="empty-chat empty-chat--agent">
     <div className="empty-chat__faces" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/></div>
     <h2 className="main-h"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge main-badge">{t('mainAgent')}</span>}</h2>
     {agent.speciality&&<p className="empty-chat__role" dir="auto">{agent.speciality}</p>}
     <p>{t('agentEmptyChat')}</p>
    </div>:<div className="empty-chat"><p role="note">{t('conversationNoAgent')}</p></div>}
   </div></div>
   <div className="composer-area">{agent&&(writer?<MessageBox key={draft?.n||0} draft={draft?.text} placeholder={t('writeTo',agent.name)} send={async(message,sendKey)=>{
    const failure=await postMessage({company,conversation,agent:agent.id,message,sendKey});
    if(!failure) router.push(`/c/${slug}/conversations/${conversation}`);
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{agent.main?t('viewOnlyLead'):t('viewOnly')}</span></p>)}</div>
  </div>
  {agent&&<AgentDetails panel={panel} agent={agent} settingsHref={`/c/${slug}/agents`}/>}
 </div>;
}
