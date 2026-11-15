'use client';
// The strings only this page shows live in conversation.en.json and conversation.ar.json, in this route's own chunk, not in
// the catalogue every company route loads (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { LeadWelcome } from '@/app/lead-welcome';
import { titleOf, type MadeAgent, type SavedRule } from '@/lib/conversations';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { madeDay, useZone } from '@/app/agent-made';
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
export default function ConversationView({slug,agent,details,company,conversation,initial,writer}:{slug:string,agent:DetailsAgent|null,details:AgentDetailsView|null,company:string,conversation:Conversation,initial:ConversationRecord,writer:boolean}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?conversationAr:conversationEn;
 const c=(key:string,...values:unknown[])=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel();
 const {messages,usage,pending,failed,working,canStop}=record;
 // The sidebar's Agents come from the server render: an Agent Lead makes while this page asks again is only on the
 // page once the server parts are drawn again, so its tile and its "new" mark show without a reload.
 const router=useRouter(); const madeCount=(rows:ConversationRecord['messages'])=>rows.reduce((sum,message)=>sum+(message.made?.length||0),0);
 const made=useRef(madeCount(initial.messages));
 // A queued turn keeps `pending` true from one run to the next; each run's start and reply add a message.
 const runKey=`${pending}:${messages.length}`; const drawnRun=useRef(runKey);
 useEffect(()=>{ if(drawnRun.current===runKey) return; drawnRun.current=runKey; router.refresh(); },[runKey,router]);
 useEffect(()=>{
  if(!pending) return;
  let stopped=false;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${conversation.id}`,{cache:'no-store'});
    if(response.ok&&!stopped) {
     const result=await response.json() as ConversationRecord; setRecord(result);
     const now=madeCount(result.messages); if(now>made.current) router.refresh(); made.current=now;
     if(!result.pending) return;
    }
   } catch { /* Hermes or the network is down: ask again. */ }
   if(!stopped) timer=setTimeout(poll,1500);
  };
  let timer=setTimeout(poll,500);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[pending,sent,company,conversation.id,router]);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const face=(size:number)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const [draft,setDraft]=useState<{text:string,n:number}|null>(null);
 const welcome=!messages.length&&agent?.main;
 const asked=()=>{ setRecord(current=>({...current,pending:true})); setSent(value=>value+1); };
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} agent={agent?.name} face={face(24)} title={titleOf(messages,conversation.agent_name)} titleDir="auto"/>
  <div className="transcript"><div className="transcript__col">
   {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>}
   <ol className="turns" aria-label={t('conversationMessages')}>{messages.map(message=>message.kind==='saved'?<Fragment key={`saved${message.id}`}>{message.saved?.map(rule=><SavedLine key={rule.id} slug={slug} agent={conversation.agent_name} rule={rule} c={c}/>)}</Fragment>:message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${message.kind==='queued'&&!message.failed?' is-queued':''}`} data-author="person" data-kind={message.kind}>
    <div className="bubble-row"><time className="bubble__time" dateTime={message.created_at}>{time(message.created_at)}</time><div className="bubble bubble--user" dir="auto">{message.body}</div></div>
    {message.kind==='queued'&&!message.failed&&<span className="queued"><ShellIcon name="clock"/>{c('conversationQueued')}</span>}
    {message.kind==='queued'&&message.failed&&<p className="note" role="alert">{c('conversationQueuedFailed')}</p>}
    {message.kind==='note'&&<span className="queued" data-addressed>{c('conversationAddressed',message.to||'')}</span>}
    {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
   </li>:<li key={`${message.kind||'m'}${message.id}`} className="turn turn--agent msg" data-author="agent" data-kind={message.kind}>
    <div className="sender">{face(20)}<bdi>{message.author_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>
    {message.body&&<div className="bubble bubble--agent" dir="auto">{message.body}</div>}
    {message.made?.map(made=><MadeCard key={made.id} slug={slug} agent={made} c={c}/>)}
   </li>)}</ol>
   {pending&&<p className="thinking convo-status" role="status">{working?c('conversationWorkingFor',conversation.agent_name,working):t('conversationWorking',conversation.agent_name)}</p>}
   {failed&&<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>}
  </div></div>
  <div className="composer-area">
   {writer?<MessageBox key={draft?.n||0} draft={draft?.text} placeholder={t('writeTo',conversation.agent_name)} stop={working&&canStop?{label:c('conversationStop',conversation.agent_name),run:async()=>{
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
 </div>{agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} settingsHref={`/c/${slug}/agents`}/>}</div>;
}

// The line under the Agent's reply when it saved a lasting rule it was told (#18; design-reference: ruleTurn, the
// note--saved message): "Saved", whose rule it is, that it is in the log, and the way to the Agent's page while the rule
// is still there.
function SavedLine({slug,agent,rule,c}:{slug:string,agent:string,rule:SavedRule,c:(key:string,...values:unknown[])=>string}) {
 return <li className="note note--saved" data-kind="saved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{c('ruleSavedFor',agent)}</span>
  {rule.agent&&!rule.removed&&<Link className="note__link" href={overlayHref(slug,'agents',{agent:rule.agent})}>{c('ruleSeeIt')}</Link>}</li>;
}

// The card for an Agent Lead made (design-reference: agentCardHTML): "Made", with "New" until the person who asked opens
// it and its day after that; its name, job and apps; the three things no Agent does without a person (ADR 0006, 0008);
// and the way into its own chat.
const never=['madeAgentPublish','madeAgentSpend','madeAgentMessage'];
function MadeCard({slug,agent,c}:{slug:string,agent:MadeAgent,c:(key:string,...values:unknown[])=>string}) {
 const {t,language}=useI18n(); const zone=useZone();
 return <div className="ac-card" role="group" aria-label={c('madeAgentLabel',agent.name)}>
  <div className="hcard__top"><span className="badge badge--made" data-utc={agent.fresh?undefined:zone}><ShellIcon name="check"/>{c('madeAgentMade')} · {agent.fresh?t('agentNew'):madeDay(agent.created_at,language,zone)}</span></div>
  <div className="card__head"><span aria-hidden="true"><CompanyAgentFace agent={agent} size={44}/></span><div className="card__titles"><span className="card__title"><bdi>{agent.name}</bdi></span></div></div>
  <dl className="kv ac-kv">
   <div className="kv__row"><dt>{c('madeAgentJob')}</dt><dd dir="auto">{agent.job}</dd></div>
   <div className="kv__row"><dt>{c('madeAgentApps')}</dt><dd>{agent.apps.length?agent.apps.map((app,index)=><Fragment key={index}>{index>0&&c('madeAgentAppsJoin')}<bdi>{app}</bdi></Fragment>):c('madeAgentNoApps')}</dd></div>
   <div className="kv__row"><dt>{c('madeAgentNever')}</dt><dd><ul className="ac-never">{never.map(key=><li key={key}><ShellIcon name="hand"/><span>{c(key)}</span></li>)}</ul></dd></div>
  </dl>
  <div className="ac-actions"><Link className="btn btn--primary" href={`/c/${slug}/chat/${agent.id}`}>{c('madeAgentOpen',agent.name)}</Link></div>
  <p className="ac-tip"><ShellIcon name="chat"/><span>{c('madeAgentTip')}</span></p>
 </div>;
}
