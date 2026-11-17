'use client';
// The strings only a Conversation shows live in conversation.en.json and conversation.ar.json, in the chunk of the
// routes that draw one (its own page, and a Card's sheet on the board), not in the catalogue every company route loads
// (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, postMessage, type MessageBoxHandle } from '@/app/conversation-composer';
import type { Decision, SavedRule } from '@/lib/conversations';
import { MadeCard, RequestCard } from '@/app/agent-card';
import { ReplyCard } from '@/app/reply-card';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import type { ConversationRecord } from '@/lib/conversation-record';
import { localeFor } from '@/lib/i18n.mjs';
import { useReportRun } from '@/lib/live-runs';

export type ThreadConversation=ConversationRecord['conversation'];
type Text=(key:string,...values:unknown[])=>string;
type BidiText=(key:string,...values:ReactNode[])=>ReactNode[];
const requestWaits=(messages:ConversationRecord['messages'])=>messages.some(message=>message.cards?.some(card=>card.kind==='request'&&card.request.state==='waiting'));
const replyCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='reply'?[card.card.id]:[])??[]);
const madeCount=(rows:ConversationRecord['messages'])=>rows.reduce((sum,message)=>sum+(message.cards?.filter(card=>card.kind==='made').length||0),0);

export function useConversationText() {
 const {language}=useI18n(); const own:Record<string,string>=language==='ar'?conversationAr:conversationEn;
 const c:Text=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 // The same, each value isolated in its own direction (a name or a rule in the other script).
 const cb:BidiText=(key,...values)=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 return {c,cb};
}

// The record of a Conversation kept current while it is open, on its page or in a Card's sheet. The reply is collected
// by the server from Hermes; the record is asked for again until the reply is in it. Each send restarts the asking, so
// an answer about an earlier run cannot stop it before the new reply arrives. An Owner answers a request for an Agent
// from their own page, so while one waits it is also asked for again, less often (#17).
export function useConversationRecord({company,initial}:{company:string,initial:ConversationRecord}) {
 const id=initial.conversation.id;
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0);
 const {messages,pending}=record;
 // The open Run moves its Agent's tile in the sidebar, from the page and from a Card's sheet alike (#184). A Run waiting
 // on its person's answer (#138) is not working, as the reference's Run has ended when its question card is drawn.
 useReportRun(record.conversation.agent_id??undefined,pending&&!record.asking);
 // The sidebar's Agents and the board come from the server render: an Agent Lead makes while the record is asked for
 // again, or a Card's new column, is only on the page once the server parts are drawn again, so they show without a
 // reload.
 const router=useRouter();
 const made=useRef(madeCount(initial.messages));
 // A queued turn keeps `pending` true from one run to the next; each run's start and reply add a message.
 const runKey=`${pending}:${messages.length}`; const drawnRun=useRef(runKey);
 useEffect(()=>{ if(drawnRun.current===runKey) return; drawnRun.current=runKey; router.refresh(); },[runKey,router]);
 const asking=pending||requestWaits(messages);
 useEffect(()=>{
  if(!asking) return;
  let stopped=false; let every=1500;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${id}`,{cache:'no-store'});
    if(response.ok&&!stopped) {
     const result=await response.json() as ConversationRecord; setRecord(result);
     const now=madeCount(result.messages); if(now>made.current) router.refresh(); made.current=now;
     if(!result.pending&&!requestWaits(result.messages)) return;
     every=result.pending?1500:5000;
    }
   } catch { /* Hermes or the network is down: ask again. */ }
   if(!stopped) timer=setTimeout(poll,every);
  };
  let timer=setTimeout(poll,500);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[asking,sent,company,id,router]);
 // The Card may move on the board in another window: coming back to this one reads its column again.
 const tied=!!record.board;
 useEffect(()=>{
  if(!tied) return;
  const again=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${id}`,{cache:'no-store'});
    // The column alone: an answer that was on its way while a message was sent is older than the chat now shown.
    if(response.ok) { const {board}=await response.json() as ConversationRecord; setRecord(current=>({...current,board})); }
   } catch { /* The column shown stays until the next read. */ }
  };
  window.addEventListener('focus',again);
  return ()=>window.removeEventListener('focus',again);
 },[tied,company,id]);
 const asked=()=>{ setRecord(current=>({...current,pending:true})); setSent(value=>value+1); };
 return {record,asked};
}

// The transcript while the Conversation is still loading (#172; design-reference: skeletonHTML): the person's message,
// a reply with its face, and a reply with a card.
export function ChatPlaceholder() {
 const {c}=useConversationText();
 const line=(width:number)=><div className="sk sk-line" style={{width:`${width}%`}}/>;
 return <div className="transcript sk-hold" aria-busy="true"><span className="sr-only">{c('chatLoading')}</span><div className="transcript__col" aria-hidden="true">
  <div className="sk-msg" style={{alignSelf:'flex-end',width:'55%'}}>{line(100)}{line(70)}</div>
  <div className="sk-msg" style={{width:'80%'}}><div className="sk" style={{width:20,height:20,borderRadius:'50%'}}/>{line(90)}{line(95)}{line(60)}</div>
  <div className="sk-msg" style={{width:'90%'}}>{line(100)}{line(80)}<div className="sk" style={{height:180,borderRadius:'var(--gw-r-card)',width:'100%'}}/></div>
 </div></div>;
}

// The messages as the reference draws them (design-reference: msgHTML): the Agent's turns on the start side, the
// person's on the end side, with every card and line the Conversation has; then whether the Agent is working, and for
// whom, or that the reply failed. While the Agent works, a message sent meanwhile waits as its sender's next turn
// (marked as the reference marks a queued message).
// A question the Agent waits on (#138) is answered from its card: a pick goes to the waiting Run, and the record is asked
// for again at once. While it waits, the Agent is not shown working.
export function ConversationTurns({slug,company,record,asked}:{slug:string,company:string,record:ConversationRecord,asked:()=>void}) {
 const {t,language}=useI18n(); const {c,cb}=useConversationText();
 const {conversation,messages,pending,failed,working}=record;
 const answer=async(card:number,choice:number,answerKey:string)=>{
  const failure=await postMessage({company,conversation:conversation.id,intent:'answer',card,choice,answerKey});
  asked();
  return failure;
 };
 // A card an Agent shows while the chat is open rises in once (design-reference: card-in); those already there do not.
 const [drawnCards]=useState(()=>new Set(replyCardIds(messages)));
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const face=(size:number)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;
 return <>
  <ol className="turns" aria-label={t('conversationMessages')}>{messages.map(message=>message.kind==='boarded'?<li key={`boarded${message.id}`} className="note" data-kind="boarded"><span>{c('cardAddedToBoard')}</span></li>:message.kind==='saved'?<Fragment key={`saved${message.id}`}>{message.saved?.map(rule=>rule.sentTo?<SuggestedLine key={rule.id} to={rule.sentTo} cb={cb}/>:<SavedLine key={rule.id} slug={slug} agent={conversation.agent_name} rule={rule} c={c}/>)}</Fragment>
   :message.kind==='decided'&&message.decided?<DecidedLine key={`decided${message.id}`} decided={message.decided} c={c} cb={cb} lead={<div className="sender">{face(20)}<bdi>{conversation.agent_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>}/>:message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${message.kind==='queued'&&!message.failed?' is-queued':''}`} data-author="person" data-kind={message.kind}>
   <div className="bubble-row"><time className="bubble__time" dateTime={message.created_at}>{time(message.created_at)}</time><div className="bubble bubble--user" dir="auto">{message.body}</div></div>
   {message.kind==='queued'&&!message.failed&&<span className="queued"><ShellIcon name="clock"/>{c('conversationQueued')}</span>}
   {message.kind==='queued'&&message.failed&&<p className="note" role="alert">{c('conversationQueuedFailed')}</p>}
   {message.kind==='note'&&<span className="queued" data-addressed>{c('conversationAddressed',message.to||'')}</span>}
   {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
  </li>:<li key={`${message.kind||'m'}${message.id}`} className="turn turn--agent msg" data-author="agent" data-kind={message.kind}>
   <div className="sender">{face(20)}<bdi>{message.author_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>
   {message.body&&<div className="bubble bubble--agent" dir="auto">{message.body}</div>}
   {message.cards?.map(card=>card.kind==='made'?<MadeCard key={card.agent.id} slug={slug} agent={card.agent}/>:card.kind==='request'?<RequestCard key={`request${card.request.id}`} slug={slug} request={card.request}/>
    :<ReplyCard key={`reply${card.card.id}`} card={card.card} fresh={!drawnCards.has(card.card.id)} answer={answer}/>)}
  </li>)}</ol>
  {pending&&!record.asking&&<p className="thinking convo-status" role="status">{working?c('conversationWorkingFor',conversation.agent_name,working):t('conversationWorking',conversation.agent_name)}</p>}
  {failed&&<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>}
 </>;
}

// What goes under the messages (design-reference: composerHTML): the composer for a person who may write, whose stop
// square stops the open run for the person who started it, or a Manager or Owner; the view-only line for a Viewer. The
// Conversation's own page adds its usage line; a Card's sheet draws none. While the record is still on its way (#172) it
// already takes a message, with no stop square, and keeps the usage line's place.
export function ConversationComposer({company,conversation,record,writer,asked,box,usage}:{company:string,conversation:ThreadConversation,record:ConversationRecord|null,writer:boolean,asked:()=>void,box?:Ref<MessageBoxHandle>,usage:boolean}) {
 const {t,language}=useI18n(); const {c}=useConversationText();
 // A Run waiting on its person's answer is not working (#138): the box keeps its send arrow, as the reference's does.
 const working=record?.asking?null:record?.working; const canStop=record?.canStop;
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 return <>
  {writer?<MessageBox ref={box} placeholder={t('writeTo',conversation.agent_name)} stop={working&&canStop?{label:c('conversationStop',conversation.agent_name),run:async()=>{
   const failure=await postMessage({company,conversation:conversation.id,intent:'stop'});
   if(!failure) asked();
   return failure;
  }}:undefined} send={async(message,sendKey)=>{
   const failure=await postMessage({company,conversation:conversation.id,message,sendKey});
   if(!failure) asked();
   return failure;
  }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
  {usage&&(record?<p className="chat-usage" data-usage>{t('conversationUsage',count(record.usage.input+record.usage.output),count(record.usage.input),count(record.usage.output))}{record.usage.unknown>0&&<> · {t('usageUnknownRuns',count(record.usage.unknown))}</>}</p>
   :<p className="chat-usage" aria-hidden="true">{'\u00a0'}</p>)}
 </>;
}

// The line under the Agent's reply when it saved a lasting rule it was told (#18; design-reference: ruleTurn, the
// note--saved message): "Saved", whose rule it is, that it is in the log, and the way to the Agent's page while the rule
// is still there.
function SavedLine({slug,agent,rule,c}:{slug:string,agent:string,rule:SavedRule,c:Text}) {
 return <li className="note note--saved" data-kind="saved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{c('ruleSavedFor',agent)}</span>
  {rule.agent&&!rule.removed&&<Link className="note__link" href={overlayHref(slug,'agents',{agent:rule.agent})}>{c('ruleSeeIt')}</Link>}</li>;
}

// A Contributor's rule became a suggestion for the team (#25; design-reference: suggestTurn's note): who it was sent to,
// and where they decide it.
function SuggestedLine({to,cb}:{to:string[],cb:BidiText}) {
 const {language}=useI18n();
 const names=new Intl.ListFormat(localeFor(language),{type:'conjunction'}).formatToParts(to).map((part,index)=>part.type==='element'?<bdi key={index}>{part.value}</bdi>:part.value);
 return <li className="note note--icon" data-kind="suggested"><ShellIcon name="clock" className="note__icon"/><span>{cb('ruleSuggested',names)}</span></li>;
}

// An Owner's or a Manager's decision on it, where it happened among the messages (design-reference: lnApprove's notes):
// approved, it is saved for the whole team; refused, it stays in this person's own work. An Owner's answer to this
// person's request for an Agent (#17; design-reference: approveRequest and refuseRequest's messages) is drawn as Lead's
// message, as the reference posts it, though it is read from the request rather than written.
function DecidedLine({decided,c,cb,lead}:{decided:Decision,c:Text,cb:BidiText,lead:ReactNode}) {
 if(decided.kind==='request') return <li className="turn turn--agent msg" data-author="agent" data-kind="decided" data-decision={decided.made?'made':'declined'}>
  {lead}<div className="bubble bubble--agent" dir="auto">{decided.made?cb('requestAnsweredMade',decided.by,decided.name):cb('requestAnsweredDeclined',decided.by,decided.name,decided.reason)}</div></li>;
 return decided.approved
  ?<li className="note note--saved" data-kind="decided" data-decision="approved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{cb('ruleApproved',decided.by,decided.rule)}</span></li>
  :<li className="note note--icon" data-kind="decided" data-decision="declined"><ShellIcon name="x" className="note__icon"/><span>{cb('ruleDeclined',decided.by)}</span></li>;
}
