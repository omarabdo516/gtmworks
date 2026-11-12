'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, newId, postMessage } from '@/app/conversation-composer';

type Agent={id:string,face:string,name:string,speciality:string,main:boolean};

// An Agent's empty chat: its face and name (Lead carries "Main"), what it is for, and the composer. A Viewer reads
// one quiet line where the composer would be.
export default function AgentChat({slug,company,agent,writer}:{slug:string,company:string,agent:Agent|null,writer:boolean}) {
 const {t}=useI18n(); const router=useRouter(); const [conversation]=useState(newId);
 return <div className="chat">
  <div className="chat__top"><h1 className="head-pill">{agent&&<span aria-hidden="true"><AgentFace id={agent.face} role="account_manager" name={agent.name} size={24}/></span>}<span className="head-pill__title">{t('newChat')}</span></h1></div>
  <div className="transcript"><div className="transcript__col">
   {agent?<div className="empty-chat">
    <div className="empty-chat__faces" aria-hidden="true"><AgentFace id={agent.face} role="account_manager" name={agent.name} size={64}/></div>
    <h2 className="main-h"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge">{t('mainAgent')}</span>}</h2>
    {agent.speciality&&<p className="empty-chat__role" dir="auto">{agent.speciality}</p>}
    <p>{t('agentEmptyChat')}</p>
   </div>:<div className="empty-chat"><p role="note">{t('conversationNoAgent')}</p></div>}
  </div></div>
  <div className="composer-area">{agent&&(writer?<MessageBox placeholder={t('writeTo',agent.name)} send={async(message,sendKey)=>{
   const failure=await postMessage({company,conversation,agent:agent.id,message,sendKey});
   if(!failure) router.push(`/c/${slug}/conversations/${conversation}`);
   return failure;
  }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{agent.main?t('viewOnlyLead'):t('viewOnly')}</span></p>)}</div>
 </div>;
}
