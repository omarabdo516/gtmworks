'use client';
import { MorningCard } from './morning-card';
// The strings only a Conversation shows live in conversation.en.json and conversation.ar.json, in the chunk of the
// routes that draw one (its own page, and a Card's sheet on the board), not in the catalogue every company route loads
// (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, Suspense, createContext, lazy, use, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { ReplyFiles } from '@/app/reply-files';
import { HandedRow } from '@/app/handed-row';
import { MessageBox, postMessage, postMessageWithFiles, type MessageBoxHandle } from '@/app/conversation-composer';
import type { Decision, LeadCard, RunStepCard, SavedRule } from '@/lib/conversations';
import { StepsList, type StepsBidiText, type StepsText } from '@/app/run-steps';
import { LiveTurn, WorkingLine, useLanding, useLiveSteps, type LiveRun } from '@/app/run-activity';
import { showRoutines } from '@/app/details-routines';
import { handDoneHere, onHandDone, showScreen } from '@/app/screen-hands';
import { formOf, scheduleLabel } from '@/lib/routine-schedule.mjs';
import { MadeCard, RequestCard } from '@/app/agent-card';
import { ChangeCard } from '@/app/change-card';
import { AccessCard, type PressAccess } from '@/app/access-card';
// The Owner's answer posts through a server action: loaded only when a waiting proposal is drawn for an Owner, so the
// chat's own bundle and its tests never load the server module.
const ChangeAnswer=lazy(()=>import('@/app/c/[slug]/[[...section]]/agent-change-card').then(module=>({default:module.ChangeAnswer})));
import { AgentMadeToast, ReaderTime } from '@/app/agent-made';
import { ReplyCard } from '@/app/reply-card';
import type { DecidePermission, PermissionOutcome } from '@/app/permission-card';
import type { ConnectApps } from '@/app/connect-card';
import { signInToApp } from '@/app/app-sign-in';
import { useAppsReader, useAppsSheet } from '@/app/apps-sheet-open';
import { appsChanged } from '@/app/company-apps-read';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { ModelLine } from '@/app/model-line';
import { modelOutcome } from '@/lib/model-causes';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ConversationSteps } from '@/lib/conversation-steps';
import { localeFor } from '@/lib/i18n.mjs';
import { useReportRun } from '@/lib/live-runs';
import { useArrivals, useSentIntoNewChat, type Arrival } from '@/lib/arrivals';
import { useSending, type Send, type Sending } from '@/lib/sending';
import { reportWait } from '@/lib/waits';

export type ThreadConversation=ConversationRecord['conversation'];
type Text=(key:string,...values:unknown[])=>string;
type BidiText=(key:string,...values:ReactNode[])=>ReactNode[];
// A request for an Agent waiting on the Owner (#17), or one sent to open an Agent hidden from its person (#167), keeps the
// chat reading its record, less often, until the answer is in.
const requestWaits=(messages:ConversationRecord['messages'])=>messages.some(message=>message.cards?.some(card=>(card.kind==='request'&&card.request.state==='waiting')||(card.kind==='access'&&card.access.state==='asked'&&card.access.waits)));
const replyCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='reply'?[card.card.id]:[])??[]);
const accessCardIds=(messages:ConversationRecord['messages'])=>messages.flatMap(message=>message.cards?.flatMap(card=>card.kind==='access'?[card.access.id]:[])??[]);
// What each drawn message is known by for its rise (lib/arrivals), and the element it is drawn as (its key in the list).
// A message drawn as it was sent (`sending`, #756), and a turn still waiting (`queued`), are drawn again as the stored
// message once the record holds it or its Run starts, under a new id, so the person's words are known by their text and
// how many times it was said before: the stored message is the same one, drawn as another element, and does not rise
// again. A typed answer to a question is the person's words the same way. A made Agent's card is known by its Agent.
const saidKinds=new Set([undefined,'queued','sending','answer']);
const arrivals=(messages:ConversationRecord['messages']):Arrival[]=>{
 const said=new Map<string,number>();
 return messages.map(message=>{
  const element=`${message.kind||'m'}${message.id}`;
  if(message.author!=='person'||!saidKinds.has(message.kind)) return {key:element,element};
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
// The cause of a model error a retry cannot fix (#457), as the record names it.
const refusalCause={credit:'noCredit',key:'keyRefused',model:'modelMissing',access:'noAccess'} as const;

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
// A message its person sends is drawn at once, before the send is answered (#756, `sending`), and the Agent is shown
// working from then: the first read begun after the send was answered holds the stored message, which takes its place.
export function useConversationRecord({company,initial,steps:firstSteps}:{company:string,initial:ConversationRecord,steps?:Promise<ConversationSteps|null>}) {
 const id=initial.conversation.id;
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0);
 const {list:sendingList,start:sending,reading,release}=useSending({company,conversation:id});
 const {messages,pending}=record;
 // What lives outside the Conversation comes from the server render: an Agent made in it (the sidebar's Agents) is
 // drawn again when it changes, and nothing else is (#767): sending, storing and a reply landing never redraw the page.
 const router=useRouter();
 const made=useRef(madeCount(initial.messages));
 const asking=pending||requestWaits(messages)||record.handover===true;
 // The poll asks only whether the Conversation changed since its last read (a stamp from the database, #767), and its
 // answer is the record only when it did. A hidden tab asks nothing until it is shown again, then asks at once; a read
 // that fails asks again more slowly, up to thirty seconds apart, and a signed-out reader stops asking. After a Run's
 // events end (`hurry`) it asks every 300 ms for a few seconds, so the reply is drawn within a second of its Run's end.
 const stamp=useRef(initial.stamp??null); const latest=useRef(record);
 useEffect(()=>{ latest.current=record; },[record]);
 // Three reads in a row that failed say so under the transcript (#768); what is drawn stays, and the next read that
 // lands takes the line away.
 const [unread,setUnread]=useState(false);
 const hurry=useRef(0);
 const read=async(since:string|null)=>{
  const landed=reading();
  const response=await fetch(`/api/conversations?company=${company}&conversation=${id}${since?`&since=${since}`:''}`,{cache:'no-store'});
  if(!response.ok) { await response.arrayBuffer().catch(()=>{}); return {status:response.status}; }
  const result=await response.json() as ConversationRecord|{unchanged:true,stamp:string};
  // Nothing changed since the record shown was read, so it already holds every message answered before this read began.
  if('unchanged' in result) { landed(); return {status:200,record:latest.current}; }
  stamp.current=result.stamp??null; setRecord(result); landed();
  const now=madeCount(result.messages); if(now>made.current) router.refresh(); made.current=now;
  return {status:200,record:result};
 };
 useEffect(()=>{
  if(!asking) return;
  let stopped=false; let failures=0; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(stopped||document.visibilityState==='hidden') return;
   let every=1500;
   try {
    const answer=await read(stamp.current);
    if(stopped) return;
    if(answer.status===401) { stopped=true; return; }
    if(!answer.record) throw new Error(String(answer.status));
    failures=0; setUnread(false);
    const now=answer.record;
    if(!now.pending&&!requestWaits(now.messages)&&!now.handover) return;
    every=now.pending||now.handover?1500:5000;
   } catch { failures++; every=Math.min(1500*2**failures,30000); if(failures>=3) setUnread(true); }
   if(hurry.current>0&&failures===0) { hurry.current--; every=300; }
   if(!stopped) timer=setTimeout(poll,every);
  };
  const shown=()=>{ if(document.visibilityState==='visible'&&!stopped) { clearTimeout(timer); void poll(); } };
  document.addEventListener('visibilitychange',shown);
  timer=setTimeout(poll,500);
  return ()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',shown);};
 },[asking,sent,company,id]); // eslint-disable-line react-hooks/exhaustive-deps
 const asked=()=>{ setRecord(current=>({...current,pending:true})); setSent(value=>value+1); };
 // A press that changed nothing the Agent does (#167), or a Run's events that ended (#763), read the record once now; the
 // poll then asks quickly for a moment, until the reply is in.
 const reread=async()=>{
  hurry.current=10;
  try { const answer=await read(null); if(answer.record) setUnread(false); } catch { /* The next send or read brings it. */ }
 };
 // Each reply's steps and the token use are their own read (ADR 0030, #766), never part of the messages: the page's
 // own read, streamed after them, for the replies it opened with, and a read of their own when a new reply lands. A
 // read that fails leaves the replies as they are, with no line about it.
 const [steps,setSteps]=useState<ConversationSteps|null>(null);
 const replies=messages.filter(message=>message.author==='agent'&&!message.kind).map(message=>message.id).join(',');
 const [opened]=useState(()=>firstSteps?replies:null);
 useEffect(()=>{
  let gone=false;
  firstSteps?.then(read=>{ if(read&&!gone) setSteps(current=>current??read); },()=>{});
  return ()=>{ gone=true; };
 },[firstSteps]);
 useEffect(()=>{
  if(!replies||replies===opened) return;
  const stopped=new AbortController();
  void fetch(`/api/conversations?company=${company}&conversation=${id}&intent=steps`,{cache:'no-store',signal:stopped.signal})
   .then(async response=>{ if(response.ok) setSteps(await response.json() as ConversationSteps); else await response.arrayBuffer(); }).catch(()=>{});
  return ()=>stopped.abort();
 },[replies,opened,company,id]);
 const drawn=useMemo(()=>{ const shown=withSteps(withSending(record,sendingList),steps); return unread?{...shown,unread:true as const}:shown; },[record,sendingList,steps,unread]);
 return {record:drawn,asked,reread,sending,reading,release};
}
// The page's own read of each reply's steps (#766), streamed after the messages: drawn by the server once it answers, so
// a reply shows its steps before the page's script has run, and replaced by the record's own once the hook has it.
const OpeningStepsContext=createContext<Promise<ConversationSteps|null>|null>(null);
export const OpeningSteps=OpeningStepsContext.Provider;
function FirstSteps({reply,c,cb}:{reply:number,c:StepsText,cb:StepsBidiText}) {
 const read=useContext(OpeningStepsContext);
 return read?<Suspense fallback={null}><StreamedSteps read={read} reply={reply} c={c} cb={cb}/></Suspense>:null;
}
function StreamedSteps({read,reply,c,cb}:{read:Promise<ConversationSteps|null>,reply:number,c:StepsText,cb:StepsBidiText}) {
 const steps=use(read)?.steps[reply];
 return steps?.list.length?<StepsList steps={steps} c={c} cb={cb}/>:null;
}
// The record with each reply's steps under it and the Conversation's token use, once read; a reply the read does not
// name stays as it is.
const withSteps=(record:ConversationRecord,read:ConversationSteps|null):ConversationRecord=>!read?.steps?record:{...record,usage:record.usage??read.usage??null,
 messages:record.messages.map(message=>message.author==='agent'&&!message.kind&&!message.steps&&read.steps[message.id]?{...message,steps:read.steps[message.id]}:message)};
// The record as drawn: the messages just sent after it, and the Agent working on them.
const withSending=(record:ConversationRecord,list:Sending[]):ConversationRecord=>!list.length?record:{...record,pending:true,
 messages:[...record.messages,...list.map(sending=>({id:sending.id,author:'person' as const,author_name:'',body:sending.body,created_at:sending.at,kind:'sending' as const,
  ...(sending.posting?{posting:true as const}:{}),...(sending.files.length?{files:sending.files.map((name,at)=>({id:at,name}))}:{})}))]};

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
// `live` (#876): a Conversation whose messages are the Engine's draws its open Run from its own live read, the reply as
// it is written and its steps, in place of the old record's steps read (app/api/run-steps).
export type EngineLive={view:LiveRun|null,reply:string,working:boolean};
export function ConversationTurns({slug,company,record,writer,asked,reread,details=false,live:engineLive}:{slug:string,company:string,record:ConversationRecord,writer:boolean,asked:()=>void,reread?:()=>Promise<void>,details?:boolean,live?:EngineLive}) {
 const openSheet=useAppsSheet(); const appsReader=useAppsReader(company);
 // An Owner's answer to a proposal from the chat comes back to this chat (#19).
 const here=usePathname();
 const {t}=useI18n(); const {c,cb}=useConversationText();
 const {conversation,messages,pending,failed}=record;
 // "Try again" on a message that was not sent (#764): the same turn waits again, and the record is read until its reply.
 const retry=async(sendKey:string)=>{
  const failure=await postMessage({company,conversation:conversation.id,intent:'retry',sendKey});
  if(!failure) asked();
 };
 // A Run's events ended: the record is read now, so its reply is drawn without waiting for the next tick (#763).
 // The Run's end is kept, so the time until its reply is drawn is reported once that reply is (#762).
 const endedAt=useRef<number|null>(null);
 const ended=()=>{ endedAt.current=Date.now(); void reread?.(); };
 const modelCause=record.noModel?'noModel' as const:record.modelRefused?refusalCause[record.modelRefused.reason]:null;
 const answer=async(card:number,choice:number|number[],answerKey:string)=>{
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
   // The Screen's view drops the step at once (#714).
   handDoneHere(card,'chat');
   return {at:body.at,first:body.first===true};
  } catch { return {error:'conversationFailed'}; }
 };
 // "Open the screen" on a step on the Agent's Screen (#714): with the Agent's details beside this chat they open on it;
 // with none (a board Card's chat) the page goes to the Conversation, where the details beside it take the ask.
 const router=useRouter();
 const openScreen=(card:number)=>{ showScreen(card); if(!details) router.push(`/c/${slug}/conversations/${conversation.id}?tab=activity`); };
 // "Done it" pressed in the Screen's view (#714) is the same record: this chat reads it again, so the card reads done and
 // the Agent's turn it started shows.
 useEffect(()=>onHandDone((card,from)=>{ if(from==='view'&&messages.some(message=>message.cards?.some(shown=>shown.kind==='reply'&&shown.card.id===card))) asked(); }),[messages,asked]);
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
   if('state' in result) void appsChanged(appsReader);
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
 // While the Agent works, the line under the transcript and the turn's steps follow its Run live (#646). The reply that
 // lands after live steps were drawn takes their place without rising in again, its list open if the live one was.
 // A message just sent sets the Agent working at once (#756), a typed answer to the question it waits on too.
 const working=(pending&&!record.asking)||messages.some(message=>message.kind==='sending')||!!engineLive?.working;
 // An Agent's reply, not a decision drawn as its message.
 const newestReply=messages.findLast(message=>message.author==='agent'&&message.kind!=='decided');
 const newest=newestReply?.id??null;
 const drawnReply=useRef(newest);
 useEffect(()=>{
  if(drawnReply.current===newest) return;
  drawnReply.current=newest;
  if(!newestReply||newestReply.author!=='agent') return;
  const end=endedAt.current; endedAt.current=null;
  const stored=Date.parse(newestReply.created_at);
  const ms=end!==null?Date.now()-end:Date.now()-stored;
  if(Number.isFinite(ms)) requestAnimationFrame(()=>reportWait({event:'reply_drawn',company,conversation:conversation.id,ms,from:end!==null?'stream':'stored'}));
 },[newest,newestReply,company,conversation.id]);
 const {view:recordSteps}=useLiveSteps({company,conversation:conversation.id},working&&!engineLive,ended);
 const steps=engineLive?engineLive.view:recordSteps;
 const landing=useLanding({working,live:steps,newest});
 // The open Run's face, on the page and in a Card's sheet alike (#184, #700): thinking until its first step, working
 // after it, done once it ended well in front of the reader. A Run waiting on its person's answer (#138) has ended for
 // the face, as the reference's has when its question card is drawn, and waits on them; one that failed or was stopped
 // shows the state the sidebar reads for it.
 useReportRun(conversation.agent_id,working?(steps&&(steps.steps.length||steps.now)?'working':'thinking'):failed||record.asking?'ended':'well');
 const live=landing.view;
 const rise=(index:number)=>rises(drawn[index])&&!(messages[index].author==='agent'&&landing.landed(messages[index].id))?' msg-in':'';
 // The sender's face: the Conversation's Agent's, or the one the message itself names — a job command's answer is the
 // target Agent's, drawn with its own face (#358).
 const face=(size:number,agent?:string,name=conversation.agent_name)=><span aria-hidden="true"><AgentFace agent={agent||conversation.face} name={name} size={size}/></span>;
 // A job one Agent handed another (#317, #475): inside the asking Agent's turn (`p`), or, for one an asked Agent handed on
 // (#477), its own row between the turns (`li`), as a channel draws every handover.
 const handed=(card:Extract<LeadCard,{kind:'handed'}>,key:string,as:'li'|'p',className?:string)=><HandedRow key={key} as={as} className={className} from={{id:card.from.face,name:card.from.name}} to={{id:card.face,name:card.name}}
  title={cb('handoverAsked',card.from.name,card.name)} goal={card.goal} ending={card} said={{stopped:c('handedStopped'),failed:c('handedFailed')}}/>;
 return <>
  <ol className="turns" aria-label={t('conversationMessages')}>{messages.map((message,index)=>message.kind==='saved'?<Fragment key={`saved${message.id}`}>{message.saved?.map(rule=>rule.sentTo?<SuggestedLine key={rule.id} to={rule.sentTo} cb={cb} rise={rises(ruleArrival(message,rule.id))?' msg-in':''}/>:<SavedLine key={rule.id} slug={slug} agent={conversation.agent_name} rule={rule} c={c} rise={rises(ruleArrival(message,rule.id))?' msg-in':''}/>)}</Fragment>
   // The Engine's own compaction summary (#875) is the Engine's, never a person's message: a quiet line between the
   // turns, marked as the Engine's, with the words it kept of the turns it compacted.
   :message.author==='engine'?<li key={`summary${message.id}`} className={`note note--icon${rise(index)}`} data-author="engine" data-kind="summary"><ShellIcon name="spark" className="note__icon"/><span><b>{c('conversationEngineSummary')}</b>{!!message.body&&<> <bdi dir="auto">{message.body}</bdi></>}</span></li>
   // #477: a job an asked Agent handed on is its own quiet row between the turns, as a channel draws every handover.
   :message.kind==='handedOn'&&message.cards?.[0]?.kind==='handed'?handed(message.cards[0],`handedOn${message.id}`,'li',rise(index).trim()||undefined)
   :message.kind==='decided'&&message.decided?<DecidedLine key={`decided${message.id}`} decided={message.decided} c={c} cb={cb} rise={rise(index)} lead={<div className="sender">{face(20)}<bdi>{conversation.agent_name}</bdi><ReaderTime at={message.created_at} className="sender__time"/></div>}/>:message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${message.kind==='queued'&&message.behind?' is-queued':''}${message.posting?' is-sending':''}${rise(index)}`} data-author="person" data-kind={message.kind} aria-busy={message.posting?true:undefined}>
   {!!message.body.trim()&&<div className="bubble-row"><ReaderTime at={message.created_at} className="bubble__time"/><div className="bubble bubble--user" dir="auto">{message.body}</div></div>}
   {/* A message being sent has no stored files to open yet: their names alone (#756). */}
   {!!message.files?.length&&message.kind==='sending'&&<div className="msg-files">{message.files.map(file=><span key={file.id} className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></span>)}</div>}
   {!!message.files?.length&&message.kind!=='sending'&&<div className="msg-files">{message.files.map(file=><a key={file.id} className="file-chip" href={`/c/${slug}/files/conversation/${file.id}`} target="_blank" rel="noreferrer"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}
   {message.kind==='queued'&&message.behind&&<span className="queued"><ShellIcon name="clock"/>{c('conversationQueued')}</span>}
   {/* Not sent (#764): the Engine refused its Run or was not reached; the message stays, and "Try again" starts the same
       turn. One refused for the Conversation's model goes back to the box instead (#158). */}
   {message.kind==='queued'&&message.failed&&<p className="note" role="alert" data-outcome="not-sent">{c('conversationNotSent')}
    {writer&&message.key&&!message.model_refused&&<> <button type="button" className="link-btn" onClick={()=>void retry(message.key!)}>{c('conversationTryAgain')}</button></>}</p>}
   {message.kind==='answer'&&message.failed&&<p className="note" role="status">{c('conversationAnswerNotDelivered')}</p>}
   {message.kind==='note'&&<span className="queued" data-addressed>{c('conversationAddressed',message.to||'')}</span>}
   {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
  </li>:<Fragment key={`${message.kind||'m'}${message.id}`}><li className={`turn turn--agent msg${rise(index)}`} data-author="agent" data-kind={message.kind}>
   <div className="sender">{face(20,message.face,message.author_name)}<bdi>{message.author_name}</bdi>{message.kind==='handed'&&message.to&&<span className="sender__to">{cb('handoverTo',message.to)}</span>}<ReaderTime at={message.created_at} className="sender__time"/></div>
   {message.steps?!!message.steps.list.length&&<StepsList steps={message.steps} c={c} cb={cb} opened={landing.opened(message.id)}/>:<FirstSteps reply={message.id} c={c} cb={cb}/>}
   {message.body&&<div className="bubble bubble--agent" dir="auto">{message.body}</div>}
   <ReplyFiles files={message.files} missed={message.missed} href={id=>`/c/${slug}/files/conversation/${id}`}/>
   {/* A tool the Engine could not run because the Company's work sandbox is down (#398): one plain line under the reply,
       which the Conversation still gave. */}
   {message.steps?.list.some(step=>step.sandbox)&&<p className="note" role="alert" data-outcome="sandbox">{t('workSandboxNotRunning')}</p>}
   {message.cards?.map(card=>card.kind==='made'?<Fragment key={card.agent.id}><MadeCard slug={slug} agent={card.agent} fresh={rises(madeArrival(message,card.agent.id))}/>{card.agent.fresh&&<AgentMadeToast company={company} slug={slug} agent={card.agent}/>}</Fragment>:card.kind==='request'?<RequestCard key={`request${card.request.id}`} slug={slug} request={card.request}/>
    :card.kind==='change'?<ChangeCard key={`change${card.change.id}`} change={card.change} company={company} owner={record.changeOwner===true}
     answer={card.change.state==='waiting'&&record.changeOwner?<Suspense fallback={null}><ChangeAnswer slug={slug} company={company} change={card.change} alone={record.alone===true} back={here}/></Suspense>:undefined}/>
    :card.kind==='access'?<AccessCard key={`access${card.access.id}`} card={card.access} fresh={!drawnAccess.has(card.access.id)} press={writer?pressAccess:undefined} c={c} cb={cb}/>
    :card.kind==='handed'?handed(card,`handed${message.id}:${card.name}:${card.goal}`,'p')
    :card.kind==='morning'?<MorningCard key="morning" slug={slug} card={card.morning}/>
    :<ReplyCard key={`reply${card.card.id}`} card={card.card} fresh={!drawnCards.has(card.card.id)} chips={record.lead===true} answer={answer} done={writer?done:undefined} decide={writer?permit:undefined} may={record.permit} connect={connect} openScreen={writer?openScreen:undefined}/>)}
  </li>{message.steps?.list.flatMap((step,at)=>step.routine?[<RoutineLine key={at} routine={step.routine} details={details} rise={rise(index)}/>]:step.card?[<CardLine key={at} slug={slug} card={step.card} rise={rise(index)}/>]:[])}</Fragment>)}
   {working&&<LiveTurn key={`live${live?.run??''}`} view={live} agent={conversation.agent_name} face={conversation.face} c={c} cb={cb} open={landing.open} toggled={landing.toggled} reply={engineLive?.reply}/>}</ol>
  {working&&<WorkingLine view={live} working={record.workingFor?cb('conversationWorkingForPerson',record.workingFor):undefined} agent={conversation.agent_name} face={conversation.face} c={c} cb={cb}/>}
  {/* The record could not be read three times in a row (#768): what was drawn stays above, and Try again reads it now. */}
  {record.unread&&<p className="note convo-status" role="alert" data-outcome="unread">{c('conversationUnread')}{reread&&<> <button type="button" className="link-btn" onClick={()=>void reread()}>{c('conversationTryAgain')}</button></>}</p>}
  {failed&&(modelCause
   // The Company has no model at all (#422), or a model error a retry cannot fix (#457): sending again cannot work, so
   // the line says its cause and where the Owner fixes it.
   ?<p className="note convo-status" role="alert" data-outcome={modelOutcome(modelCause)}><ModelLine cause={modelCause} agent={record.modelRefused?.agent??conversation.agent_name} slug={slug} owner={(record.noModel??record.modelRefused)?.owner===true} resets={record.modelRefused?.resetsAt} ranOut={record.modelRefused?.ranOut}/></p>
   :<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>)}
 </>;
}

// What goes under the messages (design-reference: composerHTML): the composer for a person who may write, whose stop
// square stops the open run for the person who started it, or a Manager or Owner; the view-only line for a Viewer. The
// Conversation's own page adds its usage line; a Card's sheet draws none. While the record is still on its way (#172) it
// already takes a message, with no stop square, and keeps the usage line's place.
// A message sent is drawn in the transcript at once (`sending`, #756), so the box lets it go as it is sent and takes it
// back if the send is refused.
export function ConversationComposer({company,conversation,record,writer,asked,sending,box,usage,sent}:{company:string,conversation:ThreadConversation,record:ConversationRecord|null,writer:boolean,asked:()=>void,sending?:Send,box?:Ref<MessageBoxHandle>,usage:boolean,sent?:()=>void}) {
 const {t,language}=useI18n(); const {c}=useConversationText();
 // A Run waiting on its person's answer is not working (#138): the box keeps its send arrow, as the reference's does.
 const working=record?.asking?null:record?.working; const canStop=record?.canStop;
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 // A waiting message the Engine refused for the Conversation's model (#158) is told as a sent one is, while it is the latest.
 const last=record?.messages.at(-1); const refused=last?.kind==='queued'&&last.failed&&last.model_refused?{key:`${last.created_at}:${last.body}`,text:last.body}:undefined;
 return <>
  {writer?<MessageBox ref={box} placeholder={t('writeTo',conversation.agent_name)} model={{company,conversation:conversation.id,agent:conversation.agent_name}} voice={conversation.agent_id?{company,agent:conversation.agent_id}:undefined} to={conversation.agent_id} refused={refused} stop={working&&canStop?{label:c('conversationStop',conversation.agent_name),run:async()=>{
   const failure=await postMessage({company,conversation:conversation.id,intent:'stop'});
   if(!failure) asked();
   return failure;
  }}:undefined} drawn={!!sending} send={async(message,sendKey,files)=>{
   const settled=sending?.(sendKey,message,files);
   const failure=files.length?await postMessageWithFiles({company,conversation:conversation.id,message,sendKey},files):await postMessage({company,conversation:conversation.id,message,sendKey});
   settled?.(failure);
   if(!failure) { asked(); sent?.(); }
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

// Under a reply in which the Agent made a Card with the Engine's own Kanban tool (spec #831, #844; design-reference:
// the chat's note with the board icon): the Card's Agent and title, and the way to the Card over the board. It is drawn
// from the step the Engine reported for the call, so gtmworks keeps nothing for it, and no Handover row is made.
function CardLine({slug,card,rise}:{slug:string,card:RunStepCard,rise:string}) {
 const {cb,c}=useConversationText();
 return <li className={`note note--icon${rise}`} data-kind="card"><ShellIcon name="board" className="note__icon"/>
  <span><bdi>{card.agent?cb('chatCardMade',card.agent.name):c('chatCardMadeAlone')}</bdi> · <bdi dir="auto">{card.title}</bdi></span>
  <Link className="link-btn note__link" href={`/c/${slug}/work/board?card=${encodeURIComponent(card.id)}`}>{c('chatCardOpen')}</Link></li>;
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
