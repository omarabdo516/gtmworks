'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { titleOf, type ConversationMessage as Message, type UsageTotal } from '@/lib/conversations';
import { localeFor } from '@/lib/i18n.mjs';
type Conversation={id:string,agent_name:string,face:string};

// The reply is collected by the server from Hermes; the page asks again until it is in the record. Each send restarts
// the asking, so an answer about an earlier run cannot stop it before the new reply arrives.
export default function ConversationView({company,companyName,conversation,initial,usage:initialUsage,failed:initialFailed,pending:initialPending,agency}:{company:string,companyName:string,conversation:Conversation,initial:Message[],usage:UsageTotal,failed:boolean,pending:boolean,agency:boolean}) {
 const {t,language}=useI18n(); const [messages,setMessages]=useState(initial); const [usage,setUsage]=useState(initialUsage); const [pending,setPending]=useState(initialPending); const [sent,setSent]=useState(0); const [failed,setFailed]=useState(initialFailed);
 useEffect(()=>{
  if(!pending) return;
  let stopped=false;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${conversation.id}`,{cache:'no-store'});
    if(response.ok&&!stopped) { const result=await response.json(); setMessages(result.messages); setUsage(result.usage); setFailed(result.failed); setPending(result.pending); if(!result.pending) return; }
   } catch { /* Hermes or the network is down: ask again. */ }
   if(!stopped) timer=setTimeout(poll,1500);
  };
  let timer=setTimeout(poll,500);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[pending,sent,company,conversation.id]);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 return <div className="convo-layout">
  <div className="convo-scroll"><div className="convo">
   <div className="convo-head"><AgentFace id={conversation.face} role="account_manager" name={conversation.agent_name} size={40}/><div className="grow"><h1 dir="auto">{titleOf(messages,conversation.agent_name)}</h1><p className="sub">{t('conversationWith',conversation.agent_name,companyName)}</p><p className="sub" data-usage>{t('conversationUsage',count(usage.input+usage.output),count(usage.input),count(usage.output))}{usage.unknown>0&&<> · {t('usageUnknownRuns',count(usage.unknown))}</>}</p></div></div>
   <ol className="convo-messages" aria-label={t('conversationMessages')}>{messages.map(message=><li key={message.id} className={`msg ${message.author==='person'?'me':''}`} data-author={message.author}>
    <div className="byline">{message.author==='agent'&&<AgentFace id={conversation.face} role="account_manager" name={message.author_name}/>}<bdi>{message.author_name}</bdi><time className="when" dateTime={message.created_at}>{time(message.created_at)}</time></div>
    <div className={message.author==='person'?'bubble':'text'} dir="auto">{message.body}</div>
    {message.lost&&<p className="convo-status" data-outcome="lost">{t('conversationRunLost')}</p>}
   </li>)}</ol>
   {pending&&<p className="convo-status" role="status">{t('conversationWorking',conversation.agent_name)}</p>}
   {failed&&<p className="convo-status" role="alert">{t('conversationReplyFailed')}</p>}
  </div></div>
  {agency&&<div className="dock"><MessageBox rows={2} placeholder={t('conversationReplyPlaceholder',conversation.agent_name)} send={async(message,sendKey)=>{
   const failure=await postMessage({company,conversation:conversation.id,message,sendKey});
   if(!failure) { setPending(true); setSent(count=>count+1); }
   return failure;
  }}/></div>}
 </div>;
}
