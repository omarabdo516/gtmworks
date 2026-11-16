'use client';
// The strings only this page shows live in conversation.en.json and conversation.ar.json, in this route's own chunk, not in
// the catalogue every company route loads (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import type { AgentDetailsView } from '@/app/agent-details-server';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { LeadWelcome } from '@/app/lead-welcome';
import { PrivateLine } from '@/app/private-line';
import { titleOf, type Decision, type SavedRule } from '@/lib/conversations';
import { MadeCard, RequestCard } from '@/app/agent-card';
import { ReplyCard } from '@/app/reply-card';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import type { ConversationRecord } from '@/lib/conversation-record';
import { localeFor } from '@/lib/i18n.mjs';
import { columnLabel } from '@/lib/board-columns.mjs';
type Conversation={id:string,agent_name:string,face:string};
const requestWaits=(messages:ConversationRecord['messages'])=>messages.some(message=>message.cards?.some(card=>card.kind==='request'&&card.request.state==='waiting'));
const replyCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='reply'?[card.card.id]:[])??[]);

// The reply is collected by the server from Hermes; the page asks again until it is in the record. Each send restarts
// the asking, so an answer about an earlier run cannot stop it before the new reply arrives. An Owner answers a request
// for an Agent from their own page, so while one waits the page also asks again, less often (#17).
// Drawn as the reference's chat (design-reference: renderChat, msgHTML): a floating title pill, the Agent's turns on
// the start side, the person's on the end side, the composer below, and the Agent's details beside it while the
// Agent is still attached. While the Agent works, everyone reading sees who it is working for; a message sent
// meanwhile waits as its sender's next turn (marked as the reference marks a queued message), and the person who
// started the run, or a Manager or Owner, may stop it from the composer's stop square. In a team, a line at the top says
// the chat is between this person and the Agent only (#25).
export default function ConversationView({slug,agent,details,company,conversation,initial,writer,team}:{slug:string,agent:DetailsAgent|null,details:AgentDetailsView|null,company:string,conversation:Conversation,initial:ConversationRecord,writer:boolean,team:boolean}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?conversationAr:conversationEn;
 const c=(key:string,...values:unknown[])=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 // The same, each value isolated in its own direction (a name or a rule in the other script).
 const cb=(key:string,...values:ReactNode[])=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel();
 const {messages,usage,pending,failed,working,canStop}=record;
 // The sidebar's Agents come from the server render: an Agent Lead makes while this page asks again is only on the
 // page once the server parts are drawn again, so its tile and its "new" mark show without a reload.
 const router=useRouter(); const madeCount=(rows:ConversationRecord['messages'])=>rows.reduce((sum,message)=>sum+(message.cards?.filter(card=>card.kind==='made').length||0),0);
 const made=useRef(madeCount(initial.messages));
 // A card an Agent shows while the page is open rises in once (design-reference: card-in); those already there do not.
 const [drawnCards]=useState(()=>new Set(replyCardIds(initial.messages)));
 // A queued turn keeps `pending` true from one run to the next; each run's start and reply add a message.
 const runKey=`${pending}:${messages.length}`; const drawnRun=useRef(runKey);
 useEffect(()=>{ if(drawnRun.current===runKey) return; drawnRun.current=runKey; router.refresh(); },[runKey,router]);
 const asking=pending||requestWaits(messages);
 useEffect(()=>{
  if(!asking) return;
  let stopped=false; let every=1500;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${conversation.id}`,{cache:'no-store'});
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
 },[asking,sent,company,conversation.id,router]);
 // The Card may move on the board in another window: coming back to this one reads its column again.
 const tied=!!record.board;
 useEffect(()=>{
  if(!tied) return;
  const again=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${conversation.id}`,{cache:'no-store'});
    // The column alone: an answer that was on its way while a message was sent is older than the chat now shown.
    if(response.ok) { const {board}=await response.json() as ConversationRecord; setRecord(current=>({...current,board})); }
   } catch { /* The column shown stays until the next read. */ }
  };
  window.addEventListener('focus',again);
  return ()=>window.removeEventListener('focus',again);
 },[tied,company,conversation.id]);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const face=(size:number)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:conversation.face,name:conversation.agent_name}} size={size}/></span>;
 // A new workspace opens on the Owner's Conversation with Lead before anything is said in it (#9): Lead's first words.
 const [draft,setDraft]=useState<{text:string,n:number}|null>(null);
 const welcome=!messages.length&&agent?.main;
 const asked=()=>{ setRecord(current=>({...current,pending:true})); setSent(value=>value+1); };
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} agent={agent?.name} face={face(24)} title={titleOf(messages,conversation.agent_name)} titleDir="auto" corner={record.board&&<CornerPill slug={slug} board={record.board} writer={writer} c={c}/>}/>
  <div className="transcript"><div className="transcript__col">
   {team&&<PrivateLine agent={conversation.agent_name}/>}
   {welcome&&agent&&<LeadWelcome agent={agent} suggest={writer?text=>setDraft(current=>({text,n:(current?.n||0)+1})):undefined}/>}
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
     :<ReplyCard key={`reply${card.card.id}`} card={card.card} fresh={!drawnCards.has(card.card.id)}/>)}
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

// The chat's Card on the board (#144; design-reference: renderChat's corner pill): its column now, and the way to it on
// the board. A phone shows the column alone.
function CornerPill({slug,board,writer,c}:{slug:string,board:NonNullable<ConversationRecord['board']>,writer:boolean,c:(key:string,...values:unknown[])=>string}) {
 const {t}=useI18n(); const waiting=board.column==='waiting'; const column=t(columnLabel(board.column,writer));
 return <div className="chat__corner"><Link className={`corner-pill${waiting?' is-waiting':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('onTheBoard')} ${column}`}>
  <span className={`dot dot--${waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('onTheBoard')}</span><span className="corner-pill__col">{column}</span>
 </Link></div>;
}

// The line under the Agent's reply when it saved a lasting rule it was told (#18; design-reference: ruleTurn, the
// note--saved message): "Saved", whose rule it is, that it is in the log, and the way to the Agent's page while the rule
// is still there.
function SavedLine({slug,agent,rule,c}:{slug:string,agent:string,rule:SavedRule,c:(key:string,...values:unknown[])=>string}) {
 return <li className="note note--saved" data-kind="saved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{c('ruleSavedFor',agent)}</span>
  {rule.agent&&!rule.removed&&<Link className="note__link" href={overlayHref(slug,'agents',{agent:rule.agent})}>{c('ruleSeeIt')}</Link>}</li>;
}

// A Contributor's rule became a suggestion for the team (#25; design-reference: suggestTurn's note): who it was sent to,
// and where they decide it.
function SuggestedLine({to,cb}:{to:string[],cb:(key:string,...values:ReactNode[])=>ReactNode[]}) {
 const {language}=useI18n();
 const names=new Intl.ListFormat(localeFor(language),{type:'conjunction'}).formatToParts(to).map((part,index)=>part.type==='element'?<bdi key={index}>{part.value}</bdi>:part.value);
 return <li className="note note--icon" data-kind="suggested"><ShellIcon name="clock" className="note__icon"/><span>{cb('ruleSuggested',names)}</span></li>;
}

// An Owner's or a Manager's decision on it, where it happened among the messages (design-reference: lnApprove's notes):
// approved, it is saved for the whole team; refused, it stays in this person's own work. An Owner's answer to this
// person's request for an Agent (#17; design-reference: approveRequest and refuseRequest's messages) is drawn as Lead's
// message, as the reference posts it, though it is read from the request rather than written.
function DecidedLine({decided,c,cb,lead}:{decided:Decision,c:(key:string,...values:unknown[])=>string,cb:(key:string,...values:ReactNode[])=>ReactNode[],lead:ReactNode}) {
 if(decided.kind==='request') return <li className="turn turn--agent msg" data-author="agent" data-kind="decided" data-decision={decided.made?'made':'declined'}>
  {lead}<div className="bubble bubble--agent" dir="auto">{decided.made?cb('requestAnsweredMade',decided.by,decided.name):cb('requestAnsweredDeclined',decided.by,decided.name,decided.reason)}</div></li>;
 return decided.approved
  ?<li className="note note--saved" data-kind="decided" data-decision="approved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{cb('ruleApproved',decided.by,decided.rule)}</span></li>
  :<li className="note note--icon" data-kind="decided" data-decision="declined"><ShellIcon name="x" className="note__icon"/><span>{cb('ruleDeclined',decided.by)}</span></li>;
}
