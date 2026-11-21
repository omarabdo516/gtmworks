'use client';
// The strings only a Conversation shows live in conversation.en.json and conversation.ar.json, in the chunk of the
// routes that draw one (its own page, and a Card's sheet on the board), not in the catalogue every company route loads
// (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, Suspense, lazy, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { HandedRow } from '@/app/handed-row';
import { MessageBox, postMessage, postMessageWithFiles, type MessageBoxHandle } from '@/app/conversation-composer';
import type { Decision, SavedRule } from '@/lib/conversations';
import { StepsList } from '@/app/run-steps';
import { showRoutines } from '@/app/details-routines';
import { formOf, scheduleLabel } from '@/lib/routine-schedule.mjs';
import { MadeCard, RequestCard } from '@/app/agent-card';
import { ChangeCard } from '@/app/change-card';
import { AccessCard, type PressAccess } from '@/app/access-card';
// The Owner's answer posts through a server action: loaded only when a waiting proposal is drawn for an Owner, so the
// chat's own bundle and its tests never load the server module.
const ChangeAnswer=lazy(()=>import('@/app/c/[slug]/[[...section]]/agent-change-card').then(module=>({default:module.ChangeAnswer})));
import { AgentMadeToast } from '@/app/agent-made';
import { ReplyCard } from '@/app/reply-card';
import type { DecidePermission, PermissionOutcome } from '@/app/permission-card';
import type { ConnectApps } from '@/app/connect-card';
import { signInToApp } from '@/app/app-sign-in';
import { useAppsSheet } from '@/app/apps-sheet-open';
import { appsChanged } from '@/app/company-apps-read';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import type { ConversationRecord } from '@/lib/conversation-record';
import { localeFor } from '@/lib/i18n.mjs';
import { useReportRun } from '@/lib/live-runs';
import { useArrivals, useSentIntoNewChat, type Arrival } from '@/lib/arrivals';

export type ThreadConversation=ConversationRecord['conversation'];
type Text=(key:string,...values:unknown[])=>string;
type BidiText=(key:string,...values:ReactNode[])=>ReactNode[];
// A request for an Agent waiting on the Owner (#17), or one sent to open an Agent hidden from its person (#167), keeps the
// chat reading its record, less often, until the answer is in.
const requestWaits=(messages:ConversationRecord['messages'])=>messages.some(message=>message.cards?.some(card=>(card.kind==='request'&&card.request.state==='waiting')||(card.kind==='access'&&card.access.state==='asked'&&card.access.waits)));
const replyCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='reply'?[card.card.id]:[])??[]);
const accessCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='access'?[card.access.id]:[])??[]);
// What each drawn message is known by for its rise (lib/arrivals), and the element it is drawn as (its key in the list).
// A turn still waiting (`queued`) is drawn again as the sent message once its Run starts, under a new id, so the
// person's words are known by their text and how many times it was said before: the started turn is the same message,
// drawn as another element, and does not rise again. A made Agent's card is known by its Agent.
const arrivals=(messages:ConversationRecord['messages']):Arrival[]=>{
 const said=new Map<string,number>();
 return messages.map(message=>{
  const element=`${message.kind||'m'}${message.id}`;
  if(message.author!=='person'||(message.kind&&message.kind!=='queued')) return {key:element,element};
  const times=said.get(message.body)??0; said.set(message.body,times+1);
  return {key:`said:${times}:${message.body}`,element};
 });
};
// A card can be drawn first in a turn of its own and moved into the Agent's reply once it is in, which draws it again
// as a new element: the element names its turn, so the moved card stays still.
const madeArrival=(message:ConversationRecord['messages'][number],agent:string):Arrival=>({key:`made:${agent}`,element:`${message.kind||'m'}${message.id}/made:${agent}`});
// A saved or suggested rule's line moves the same way, from under the person's message to under the Agent's reply: it
// is known by its rule, and its element names its turn.
const ruleArrival=(message:ConversationRecord['messages'][number],rule:string):Arrival=>({key:`rule:${rule}`,element:`${message.kind||'m'}${message.id}/rule:${rule}`});
const ruleArrivals=(messages:ConversationRecord['messages']):Arrival[]=>messages.flatMap(message=>message.kind==='saved'?message.saved?.map(rule=>ruleArrival(message,rule.id))??[]:[]);
const madeArrivals=(messages:ConversationRecord['messages']):Arrival[]=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='made'?[madeArrival(message,card.agent.id)]:[])??[]);
// An Agent made, or one opened for this person (#167), changes the sidebar: either is counted, so it is drawn again.
const madeCount=(rows:ConversationRecord['messages'])=>rows.reduce((sum,message)=>sum+(message.cards?.filter(card=>card.kind==='made').length||0)+(message.decided?.kind==='access'&&message.decided.opened?1:0),0);
// The words and the recorded outcome for a model error a retry cannot fix (#457).
const refusalLine={credit:'modelNoCredit',key:'modelKeyRefused',model:'modelMissing'};
const refusalOutcome={credit:'no-credit',key:'key-refused',model:'model-missing'};

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
// from their own page, so while one waits it is also asked for again, less often (#17). A job handed to another Agent
// (#317) keeps it asking until Lead's follow-up reply is in the record (`handover`).
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
 const asking=pending||requestWaits(messages)||record.handover===true;
 useEffect(()=>{
  if(!asking) return;
  let stopped=false; let every=1500;
  const poll=async()=>{
   try {
    const response=await fetch(`/api/conversations?company=${company}&conversation=${id}`,{cache:'no-store'});
    if(response.ok&&!stopped) {
     const result=await response.json() as ConversationRecord; setRecord(result);
     const now=madeCount(result.messages); if(now>made.current) router.refresh(); made.current=now;
     if(!result.pending&&!requestWaits(result.messages)&&!result.handover) return;
     every=result.pending||result.handover?1500:5000;
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
 // A press that changed nothing the Agent does (#167) reads the record once, which keeps it read while its answer waits.
 const reread=async()=>{
  try { const response=await fetch(`/api/conversations?company=${company}&conversation=${id}`,{cache:'no-store'}); if(response.ok) setRecord(await response.json() as ConversationRecord); }
  catch { /* The next send or read brings it. */ }
 };
 return {record,asked,reread};
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
// whom, or that the reply failed, and why when the Company has no model to reply with (#422) or its model call cannot
// succeed on a retry (#457). While the Agent works, a message sent meanwhile waits as its sender's next turn (marked as
// the reference marks a queued message).
// A question the Agent waits on (#138) is answered from its card: a pick goes to the waiting Run, and the record is asked
// for again at once. While it waits, the Agent is not shown working. The main Agent's question draws as the reference's
// chip card, any other Agent's as the lettered card (#143).
// A person who may not write (a Viewer) sees a handed step's "Done it" but cannot press it.
// A request the Agent's Run waits on to allow an action (#163) is decided from its card with the choices this person may
// send, and the record is asked for again at once; while it waits, the Agent is still working. A Viewer sees the wait
// line.
// `details`: the Agent's details are beside this chat, so a Routine the Agent made is a way into them (#205).
export function ConversationTurns({slug,company,record,writer,asked,reread,details=false}:{slug:string,company:string,record:ConversationRecord,writer:boolean,asked:()=>void,reread?:()=>Promise<void>,details?:boolean}) {
 const openSheet=useAppsSheet();
 // An Owner's answer to a proposal from the chat comes back to this chat (#19).
 const here=usePathname();
 const {t,language}=useI18n(); const {c,cb}=useConversationText();
 const {conversation,messages,pending,failed,working}=record;
 const answer=async(card:number,choice:number,answerKey:string)=>{
  const failure=await postMessage({company,conversation:conversation.id,intent:'answer',card,choice,answerKey});
  asked();
  return failure;
 };
 // "Done it" on a step the Agent handed over (#139): the card shows the time the database kept, and the press starts the
 // Agent's turn (#140), so the record is read again, as after an answer, until its reply is in. A press another tab made
// first started nothing here, so the record is not read again: a read could replace a newer one (a message sent
// meanwhile).
 const done=async(card:number)=>{
  try {
   const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,conversation:conversation.id,intent:'done',card})});
   const body=await response.json() as {at?:string,first?:boolean,error?:string};
   if(!response.ok||!body.at) return {error:body.error||'conversationFailed'};
   if(body.first===true) asked();
   return {at:body.at,first:body.first===true};
  } catch { return {error:'conversationFailed'}; }
 };
 // A press on the card asking for a hidden Agent (#167): kept once by the database for this person, who alone answers
 // it; another tab's press answers what the card already says.
 const pressAccess:PressAccess=async(request,ask)=>{
  try {
   const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,conversation:conversation.id,intent:'access',card:request,ask})});
   const body=await response.json() as {state?:string,at?:string,error?:string};
   if(!response.ok) return {error:body.error||'conversationFailed'};
   // A press another tab made first may have been answered since: the card still says it was sent.
   void reread?.();
   if(body.state==='available') return {state:'available'};
   if(body.at&&(body.state==='dismissed'||body.state==='asked'||body.state==='opened'||body.state==='declined')) return {state:body.state==='dismissed'?'dismissed':'asked',at:body.at};
   return {error:'conversationFailed'};
  } catch { return {error:'conversationFailed'}; }
 };
 const permit:DecidePermission=async(card,choice)=>{
  try {
   const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,conversation:conversation.id,intent:'permit',card,choice})});
   const body=await response.json() as {state?:PermissionOutcome['state'],choice?:typeof choice,at?:string,first?:boolean,error?:string};
   if(!response.ok||!body.state) return {error:body.error||'conversationFailed'};
   asked();
   return body.state==='decided'&&body.choice&&body.at?{state:'decided',choice:body.choice,at:body.at,first:body.first===true}:{state:'closed',first:body.first===true};
  } catch { return {error:'conversationFailed'}; }
 };
 // An app the Agent asked for (#203): the Owner signs in to it for this Conversation's Agent, as Settings, Apps does,
 // and the sidebar's count is read again once it is connected; Later is kept by the database.
 const agent=conversation.agent_id;
 const connect:ConnectApps|undefined=record.connect&&{...record.connect,
  start:async(app,signal)=>{
   if(!agent) return {error:'connectFailed'};
   const result=await signInToApp({company,agent,app,signal,openApp:key=>openSheet?.(null,key,agent)});
   if('state' in result) void appsChanged(company,language);
   return result;
  },
  later:async card=>{
   try {
    const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,conversation:conversation.id,intent:'later',card})});
    const body=await response.json() as {state?:string,error?:string};
    return response.ok&&body.state==='postponed'?{state:'postponed'}:{error:body.error||'conversationFailed'};
   } catch { return {error:'conversationFailed'}; }
  }};
 // A card an Agent shows while the chat is open rises in once (design-reference: card-in); those already there do not.
 const [drawnCards]=useState(()=>new Set(replyCardIds(messages)));
 const [drawnAccess]=useState(()=>new Set(accessCardIds(messages)));
 // So does a message, a line or the card of an Agent Lead made (design-reference: msg-in, agentCardHTML's card-in):
 // what the Conversation held when it opened stays still, unless it was opened by the first message just sent into it.
 const drawn=arrivals(messages);
 const {rises}=useArrivals([...drawn,...madeArrivals(messages),...ruleArrivals(messages)],{fresh:useSentIntoNewChat(conversation.id)});
 const rise=(index:number)=>rises(drawn[index])?' msg-in':'';
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 // The sender's face: the Conversation's Agent's, or the one the message itself names — a job command's answer is the
 // target Agent's, drawn with its own face (#358).
 const face=(size:number,connection?:string,name=conversation.agent_name)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:connection||conversation.face,name}} size={size}/></span>;
 return <>
  <ol className="turns" aria-label={t('conversationMessages')}>{messages.map((message,index)=>message.kind==='boarded'?<li key={`boarded${message.id}`} className={`note${rise(index)}`} data-kind="boarded"><span>{c('cardAddedToBoard')}</span></li>:message.kind==='saved'?<Fragment key={`saved${message.id}`}>{message.saved?.map(rule=>rule.sentTo?<SuggestedLine key={rule.id} to={rule.sentTo} cb={cb} rise={rises(ruleArrival(message,rule.id))?' msg-in':''}/>:<SavedLine key={rule.id} slug={slug} agent={conversation.agent_name} rule={rule} c={c} rise={rises(ruleArrival(message,rule.id))?' msg-in':''}/>)}</Fragment>
   :message.kind==='decided'&&message.decided?<DecidedLine key={`decided${message.id}`} decided={message.decided} c={c} cb={cb} rise={rise(index)} lead={<div className="sender">{face(20)}<bdi>{conversation.agent_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>}/>:message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${message.kind==='queued'&&!message.failed?' is-queued':''}${rise(index)}`} data-author="person" data-kind={message.kind}>
   {!!message.body.trim()&&<div className="bubble-row"><time className="bubble__time" dateTime={message.created_at}>{time(message.created_at)}</time><div className="bubble bubble--user" dir="auto">{message.body}</div></div>}
   {!!message.files?.length&&<div className="msg-files">{message.files.map(file=><a key={file.id} className="file-chip" href={`/c/${slug}/files/conversation/${file.id}`} target="_blank" rel="noreferrer"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}
   {message.kind==='queued'&&!message.failed&&<span className="queued"><ShellIcon name="clock"/>{c('conversationQueued')}</span>}
   {message.kind==='queued'&&message.failed&&<p className="note" role="alert">{c('conversationQueuedFailed')}</p>}
   {message.kind==='answer'&&message.failed&&<p className="note" role="status">{c('conversationAnswerNotDelivered')}</p>}
   {message.kind==='note'&&<span className="queued" data-addressed>{c('conversationAddressed',message.to||'')}</span>}
   {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
  </li>:<Fragment key={`${message.kind||'m'}${message.id}`}><li className={`turn turn--agent msg${rise(index)}`} data-author="agent" data-kind={message.kind}>
   <div className="sender">{face(20,message.face,message.author_name)}<bdi>{message.author_name}</bdi><time className="sender__time" dateTime={message.created_at}>{time(message.created_at)}</time></div>
   {!!message.steps?.list.length&&<StepsList steps={message.steps} c={c} cb={cb}/>}
   {message.body&&<div className="bubble bubble--agent" dir="auto">{message.body}</div>}
   {/* A tool the Engine could not run because the Company's work sandbox is down (#398): one plain line under the reply,
       which the Conversation still gave. */}
   {message.steps?.list.some(step=>step.sandbox)&&<p className="note" role="alert" data-outcome="sandbox">{t('workSandboxNotRunning')}</p>}
   {message.cards?.map(card=>card.kind==='made'?<Fragment key={card.agent.id}><MadeCard slug={slug} agent={card.agent} fresh={rises(madeArrival(message,card.agent.id))}/>{card.agent.fresh&&<AgentMadeToast company={company} slug={slug} agent={card.agent}/>}</Fragment>:card.kind==='request'?<RequestCard key={`request${card.request.id}`} slug={slug} request={card.request}/>
    :card.kind==='change'?<ChangeCard key={`change${card.change.id}`} change={card.change} company={company} owner={record.changeOwner===true}
     answer={card.change.state==='waiting'&&record.changeOwner?<Suspense fallback={null}><ChangeAnswer slug={slug} company={company} change={card.change} alone={record.alone===true} back={here}/></Suspense>:undefined}/>
    :card.kind==='access'?<AccessCard key={`access${card.access.id}`} card={card.access} fresh={!drawnAccess.has(card.access.id)} press={writer?pressAccess:undefined} c={c} cb={cb}/>
    :card.kind==='handed'?<HandedRow key={`handed${message.id}`} as="p" from={{connection_id:conversation.face,name:conversation.agent_name}} to={{connection_id:card.face,name:card.name}}
     title={cb('handedTo',card.name)} goal={card.goal} failed={card.failed?c('handedFailed'):null}/>
    :<ReplyCard key={`reply${card.card.id}`} card={card.card} fresh={!drawnCards.has(card.card.id)} chips={record.lead===true} answer={answer} done={writer?done:undefined} decide={writer?permit:undefined} may={record.permit} connect={connect}/>)}
  </li>{message.steps?.list.flatMap((step,at)=>step.routine?[<RoutineLine key={at} routine={step.routine} details={details} rise={rise(index)}/>]:[])}</Fragment>)}</ol>
  {pending&&!record.asking&&<p className="thinking convo-status" role="status"><span className="shimmer">{working?c('conversationWorkingFor',conversation.agent_name,working):t('conversationWorking',conversation.agent_name)}</span></p>}
  {failed&&(record.noModel
   // The Company has no model at all (#422): sending again cannot work, so the line says where one is connected.
   ?<p className="note convo-status" role="alert" data-outcome="no-model">{t('noModelLine')} {record.noModel.owner?<Link className="note__link" href={overlayHref(slug,'models')}>{t('noModelConnect')}</Link>:t('noModelAskOwner')}</p>
   // A model error a retry cannot fix (#457) says its cause, and where the Owner fixes it: the Agent's model.
   :record.modelRefused?<p className="note convo-status" role="alert" data-outcome={refusalOutcome[record.modelRefused.reason]}>{t(refusalLine[record.modelRefused.reason],conversation.agent_name)} {record.modelRefused.owner?<Link className="note__link" href={overlayHref(slug,'models')}>{t('modelRefusedFix')}</Link>:t('modelRefusedAskOwner')}</p>
   :<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>)}
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
 // A waiting message the Engine refused for the Conversation's model (#158) is told as a sent one is, while it is the latest.
 const last=record?.messages.at(-1); const refused=last?.kind==='queued'&&last.failed&&last.model_refused?{key:`${last.created_at}:${last.body}`,text:last.body}:undefined;
 return <>
  {writer?<MessageBox ref={box} placeholder={t('writeTo',conversation.agent_name)} model={{company,conversation:conversation.id,agent:conversation.agent_name}} voice={conversation.agent_id?{company,agent:conversation.agent_id}:undefined} refused={refused} stop={working&&canStop?{label:c('conversationStop',conversation.agent_name),run:async()=>{
   const failure=await postMessage({company,conversation:conversation.id,intent:'stop'});
   if(!failure) asked();
   return failure;
  }}:undefined} send={async(message,sendKey,files)=>{
   const failure=files.length?await postMessageWithFiles({company,conversation:conversation.id,message,sendKey},files):await postMessage({company,conversation:conversation.id,message,sendKey});
   if(!failure) asked();
   return failure;
  }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
  {usage&&(record?.usage?<p className="chat-usage" data-usage>{t('conversationUsage',count(record.usage.input+record.usage.output),count(record.usage.input),count(record.usage.output))}</p>
   :<p className="chat-usage" aria-hidden="true">{'\u00a0'}</p>)}
 </>;
}

// Under a reply in which the Agent made a Routine (#205; design-reference: routineFromChat's note): its name and when it
// runs, and the way to it in the details beside the chat (design-reference: showRoutines).
// The schedule is in words as the Routine's row has it (lib/routine-schedule.mjs), in the interface's language.
function RoutineLine({routine,details,rise}:{routine:{name:string,schedule:string},details:boolean,rise:string}) {
 const {t}=useI18n();
 const schedule=scheduleLabel(t,{expr:formOf(routine.schedule)?routine.schedule:null,display:routine.schedule});
 return <li className={`note note--icon${rise}`} data-kind="routine"><ShellIcon name="repeat" className="note__icon"/><span><bdi>{t('chatRoutineMade',routine.name,schedule)}</bdi></span>
  {details&&<button type="button" className="link-btn note__link" onClick={showRoutines}>{t('chatRoutineSee')}</button>}</li>;
}

// The tool calls the Engine reported for the reply's Run (#141; design-reference: stepsHTML, toggle-steps) are drawn by
// StepsList (app/run-steps.tsx), as a channel's are (#148).


// The line under the Agent's reply when it saved a lasting rule it was told (#18; design-reference: ruleTurn, the
// note--saved message): "Saved", whose rule it is, that it is in the log, and the way to the Agent's page while the rule
// is still there.
function SavedLine({slug,agent,rule,c,rise}:{slug:string,agent:string,rule:SavedRule,c:Text,rise:string}) {
 return <li className={`note note--saved${rise}`} data-kind="saved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{c('ruleSavedFor',agent)}</span>
  {rule.agent&&!rule.removed&&<Link className="note__link" href={overlayHref(slug,'agents',{agent:rule.agent})}>{c('ruleSeeIt')}</Link>}</li>;
}

// A Contributor's rule became a suggestion for the team (#25; design-reference: suggestTurn's note): who it was sent to,
// and where they decide it.
function SuggestedLine({to,cb,rise}:{to:string[],cb:BidiText,rise:string}) {
 const {language}=useI18n();
 const names=new Intl.ListFormat(localeFor(language),{type:'conjunction'}).formatToParts(to).map((part,index)=>part.type==='element'?<bdi key={index}>{part.value}</bdi>:part.value);
 return <li className={`note note--icon${rise}`} data-kind="suggested"><ShellIcon name="clock" className="note__icon"/><span>{cb('ruleSuggested',names)}</span></li>;
}

// An Owner's or a Manager's decision on it, where it happened among the messages (design-reference: lnApprove's notes):
// approved, it is saved for the whole team; refused, it stays in this person's own work. An Owner's answer to this
// person's request for an Agent (#17; design-reference: approveRequest and refuseRequest's messages) is drawn as Lead's
// message, as the reference posts it, though it is read from the request rather than written.
function DecidedLine({decided,c,cb,rise,lead}:{decided:Decision,c:Text,cb:BidiText,rise:string,lead:ReactNode}) {
 // An Owner's or a Manager's answer to this person's request for a hidden Agent (#167), drawn as Lead's message as #17's
 // answer is: opened, it names the Agent they now see; a no names nothing of it.
 if(decided.kind==='access') return <li className={`turn turn--agent msg${rise}`} data-author="agent" data-kind="decided" data-decision={decided.opened?'opened':'kept'}>
  {lead}<div className="bubble bubble--agent" dir="auto">{decided.opened?(decided.agent?cb('accessAnsweredOpened',decided.by,decided.agent.name):cb('accessAnsweredOpenedGone',decided.by)):cb('accessAnsweredDeclined',decided.by)}</div></li>;
 if(decided.kind==='request') return <li className={`turn turn--agent msg${rise}`} data-author="agent" data-kind="decided" data-decision={decided.made?'made':'declined'}>
  {lead}<div className="bubble bubble--agent" dir="auto">{decided.made?cb('requestAnsweredMade',decided.by,decided.name):cb('requestAnsweredDeclined',decided.by,decided.name,decided.reason)}</div></li>;
 return decided.approved
  ?<li className={`note note--saved${rise}`} data-kind="decided" data-decision="approved"><ShellIcon name="check" className="note__icon"/><b className="note__saved">{c('ruleSaved')}</b><span>{cb('ruleApproved',decided.by,decided.rule)}</span></li>
  :<li className={`note note--icon${rise}`} data-kind="decided" data-decision="declined"><ShellIcon name="x" className="note__icon"/><span>{cb('ruleDeclined',decided.by)}</span></li>;
}
