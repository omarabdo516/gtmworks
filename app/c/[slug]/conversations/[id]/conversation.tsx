'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { titleOf } from '@/lib/conversations';
import type { ConversationRecord } from '@/lib/conversation-record';
import { localeFor } from '@/lib/i18n.mjs';
type Conversation={id:string,agent_name:string,face:string};

// The reply is collected by the server from Hermes; the page asks again until it is in the record. Each send restarts
// the asking, so an answer about an earlier run cannot stop it before the new reply arrives.
// Drawn as the reference's chat (design-reference: renderChat, msgHTML): a floating title pill, the Agent's turns on
// the start side, the person's on the end side, the composer below, and the Agent's details beside it while the
// Agent is still attached. While the Agent works, everyone reading sees who it is working for; a message sent
// meanwhile waits as its sender's next turn (marked as the reference marks a queued message), and the person who
// started the run, or a Manager or Owner, may stop it from the composer's stop square.
export default function ConversationView({slug,agent,company,conversation,initial,writer}:{slug:string,agent:DetailsAgent|null,company:string,conversation:Conversation,initial:ConversationRecord,writer:boolean}) {
 const {t,language}=useI18n(); const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel();
 const {messages,usage,pending,failed,working,canStop}=record;
 useEffect(()=>{
  if(!pending) return;
  let stopped=false;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${conversation.id}`,{cache:'no-store'});
    if(response.ok&&!stopped) { const result=await response.json() as ConversationRecord; setRecord(result); if(!result.pending) return; }
   } catch { /* Hermes or the network is down: ask again. */ }
   if(!stopped) timer=setTimeout(poll,1500);
  };
  let timer=setTimeout(poll,500);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[pending,sent,company,conversation.id]);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const face=(size:number)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;
 const asked=()=>{ setRecord(current=>({...current,pending:true})); setSent(value=>value+1); };
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} agent={agent?.name} face={face(24)} title={titleOf(messages,conversation.agent_name)} titleDir="auto"/>
  <div className="transcript"><div className="transcript__col">
   <ol className="turns" aria-label={t('conversationMessages')}>{messages.map(message=>message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${message.kind==='queued'&&!message.failed?' is-queued':''}`} data-author="person" data-kind={message.kind}>
    <div className="bubble-row"><time className="bubble__time" dateTime={message.created_at}>{time(message.created_at)}</time><div className="bubble bubble--user" dir="auto">{message.body}</div></div>
    {message.kind==='queued'&&!message.failed&&<span className="queued"><ShellIcon name="clock"/>{t('conversationQueued')}</span>}
    {message.kind==='queued'&&message.failed&&<p className="note" role="alert">{t('conversationQueuedFailed')}</p>}
    {message.kind==='note'&&<span className="queued" data-addressed>{t('conversationAddressed',message.to||'')}</span>}
    {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
   </li>:<li key={`m${message.id}`} className="turn turn--agent msg" data-author="agent">
    <div className="sender">{face(20)}<bdi>{message.author_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>
    <div className="bubble bubble--agent" dir="auto">{message.body}</div>
   </li>)}</ol>
   {pending&&<p className="thinking convo-status" role="status">{working?t('conversationWorkingFor',conversation.agent_name,working):t('conversationWorking',conversation.agent_name)}</p>}
   {failed&&<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>}
  </div></div>
  <div className="composer-area">
   {writer?<MessageBox placeholder={t('writeTo',conversation.agent_name)} stop={working&&canStop?{label:t('conversationStop',conversation.agent_name),run:async()=>{
    const failure=await postMessage({company,conversation:conversation.id,intent:'stop'});
    if(!failure) asked();
    return failure;
   }}:undefined} send={async(message,sendKey)=>{
    const failure=await postMessage({company,conversation:conversation.id,message,sendKey});
    if(!failure) asked();
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
   <p className="chat-usage" data-usage>{t('conversationUsage',count(usage.input+usage.output),count(usage.input),count(usage.output))}{usage.unknown>0&&<> · {t('usageUnknownRuns',count(usage.unknown))}</>}</p>
  </div>
 </div>{agent&&<AgentDetails panel={panel} agent={agent} settingsHref={`/c/${slug}/agents`}/>}</div>;
}
