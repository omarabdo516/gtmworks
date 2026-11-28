'use client';
import { MorningCard } from './morning-card';
// The strings only a Conversation shows live in conversation.en.json and conversation.ar.json, in the chunk of the
// routes that draw one (its own page, and a Card's sheet on the board), not in the catalogue every company route loads
// (page weight, #55).
import conversationEn from '@/lib/messages/conversation.en.json';
import conversationAr from '@/lib/messages/conversation.ar.json';
import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { ReplyFiles } from '@/app/reply-files';
import { HandedRow } from '@/app/handed-row';
import { MessageBox, postMessage, postMessageAnswer, postMessageWithFilesAnswer, type MessageBoxHandle } from '@/app/conversation-composer';
import type { Decision, LeadCard, RunStepCard, SavedRule } from '@/lib/conversations';
import { StepsList } from '@/app/run-steps';
import { LiveTurn, WorkingLine, useLanding, type LiveRun } from '@/app/run-activity';
import { showRoutines } from '@/app/details-routines';
import { onHandDone, showScreen } from '@/app/screen-hands';
import { formOf, scheduleLabel } from '@/lib/routine-schedule.mjs';
import { MadeCard, RequestCard } from '@/app/agent-card';
import { ChangeCard } from '@/app/change-card';
import { AccessCard, type PressAccess } from '@/app/access-card';
// The Owner's answer posts through a server action: loaded only when a waiting proposal is drawn for an Owner, so the
// chat's own bundle and its tests never load the server module.
const ChangeAnswer=lazy(()=>import('@/app/c/[slug]/[[...section]]/agent-change-card').then(module=>({default:module.ChangeAnswer})));
import { AgentMadeToast, ReaderTime } from '@/app/agent-made';
import { ReplyCard } from '@/app/reply-card';
import type { ConnectApps } from '@/app/connect-card';
import { signInToApp } from '@/app/app-sign-in';
import { useAppsReader, useAppsSheet } from '@/app/apps-sheet-open';
import { appsChanged } from '@/app/company-apps-read';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { ModelLine } from '@/app/model-line';
import { modelOutcome } from '@/lib/model-causes';
import type { ConversationRecord } from '@/lib/conversation-frame';
import { localeFor } from '@/lib/i18n.mjs';
import { useReportRun } from '@/lib/live-runs';
import { useArrivals, useSentIntoNewChat, type Arrival } from '@/lib/arrivals';
import { useSending, type Send, type Sending } from '@/lib/sending';
import { reportWait } from '@/lib/waits';

export type ThreadConversation=ConversationRecord['conversation'];
type Text=(key:string,...values:unknown[])=>string;
type BidiText=(key:string,...values:ReactNode[])=>ReactNode[];
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
// The cause of a model error a retry cannot fix (#457), as the record names it.
const refusalCause={credit:'noCredit',key:'keyRefused',model:'modelMissing',access:'noAccess'} as const;

export function useConversationText() {
 const {language}=useI18n(); const own:Record<string,string>=language==='ar'?conversationAr:conversationEn;
 const c:Text=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 // The same, each value isolated in its own direction (a name or a rule in the other script).
 const cb:BidiText=(key,...values)=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 return {c,cb};
}

// What a Conversation draws while it is open: its frame, with each message its person sends drawn at once, before the
// send is answered (#756, `sending`), and the Agent shown working from then. Its messages are its Engine session's, which
// the Conversation's own view reads and lays in (app/c/[slug]/conversations/[id]/conversation.tsx); nothing here asks
// the server for a record (#883).
export function useConversationRecord({company,initial}:{company:string,initial:ConversationRecord}) {
 const {list:sendingList,start:sending,reading,release}=useSending({company,conversation:initial.conversation.id});
 const drawn=useMemo(()=>withSending(initial,sendingList),[initial,sendingList]);
 return {record:drawn,sending,reading,release};
}
// The record as drawn: the messages just sent after it, and the Agent working on them.
const withSending=(record:ConversationRecord,list:Sending[]):ConversationRecord=>!list.length?record:{...record,pending:true,
 messages:[...record.messages,...list.map(sending=>({id:sending.id,author:'person' as const,author_name:'',body:sending.body,created_at:sending.at,kind:'sending' as const,
  ...(sending.posting?{posting:true as const}:{}),...(sending.run?{run:sending.run}:{}),...(sending.queued?{behind:true as const}:{}),...(sending.files.length?{files:sending.files.map((name,at)=>({id:at,name}))}:{})}))]};

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
// it is written and its steps (app/api/conversation-live).
// `ending` (#879): a Run seen to fail or stop did not finish, and `again` sends the person's message again; `stopped`
// (#878): its person stopped it, mid-reply or before it wrote any. `card` is what the Run waits on its person for,
// drawn in its live turn.
export type EngineLive={view:LiveRun|null,reply:string,working:boolean,ending?:'unfinished',stopped?:'reply'|'before'|null,again?:()=>void,card?:ReactNode};
export function ConversationTurns({slug,company,record,writer,asked,details=false,live:engineLive}:{slug:string,company:string,record:ConversationRecord,writer:boolean,asked:()=>void,details?:boolean,live:EngineLive}) {
 const openSheet=useAppsSheet(); const appsReader=useAppsReader(company);
 // An Owner's answer to a proposal from the chat comes back to this chat (#19).
 const here=usePathname();
 const {t}=useI18n(); const {c,cb}=useConversationText();
 const {conversation,messages,pending,failed}=record;
 const modelCause=record.noModel?'noModel' as const:record.modelRefused?refusalCause[record.modelRefused.reason]:null;
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
   if(body.state==='available') return {state:'available'};
   if(body.at&&(body.state==='dismissed'||body.state==='asked'||body.state==='opened'||body.state==='declined')) return {state:body.state==='dismissed'?'dismissed':'asked',at:body.at};
   return {error:'conversationFailed'};
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
  const ms=Date.now()-Date.parse(newestReply.created_at);
  if(Number.isFinite(ms)) requestAnimationFrame(()=>reportWait({event:'reply_drawn',company,conversation:conversation.id,ms,from:'stored'}));
 },[newest,newestReply,company,conversation.id]);
 // The open Run's steps are its own live read's (#876), which the Conversation's view follows.
 const steps=engineLive.view;
 const landing=useLanding({working,live:steps,newest});
 // The open Run's face, on the page and in a Card's sheet alike (#184, #700): thinking until its first step, working
 // after it, done once it ended well in front of the reader. A Run waiting on its person's answer (#138) has ended for
 // the face, as the reference's has when its question card is drawn, and waits on them; one that failed or was stopped
 // shows the state the sidebar reads for it.
 // On the Engine's live read (#878) the Run waiting on its question stays the live turn that draws the card, and the face
 // waits on its person.
 const waitsOnPerson=!!engineLive&&record.asking===true;
 useReportRun(conversation.agent_id,waitsOnPerson?'ended':working?(steps&&(steps.steps.length||steps.now)?'working':'thinking'):failed||record.asking?'ended':'well');
 const live=landing.view;
 const rise=(index:number)=>rises(drawn[index])&&!(messages[index].author==='agent'&&landing.landed(messages[index].id))?' msg-in':'';
 // The sender's face: the Conversation's Agent's, or the one the message itself names — a job command's answer is the
 // target Agent's, drawn with its own face (#358).
 // A file of the Conversation (#880), by its key under its message in the Engine's session.
 const fileHref=(file:{id:number,key?:string})=>`/c/${slug}/files/conversation/${conversation.id}/${file.key??''}`;
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
   :message.kind==='decided'&&message.decided?<DecidedLine key={`decided${message.id}`} decided={message.decided} c={c} cb={cb} rise={rise(index)} lead={<div className="sender">{face(20)}<bdi>{conversation.agent_name}</bdi><ReaderTime at={message.created_at} className="sender__time"/></div>}/>:message.author==='person'?<li key={`${message.kind||'m'}${message.id}`} className={`turn turn--user msg${(message.kind==='queued'||message.kind==='sending')&&message.behind?' is-queued':''}${message.posting?' is-sending':''}${rise(index)}`} data-author="person" data-kind={message.kind} aria-busy={message.posting?true:undefined}>
   {!!message.body.trim()&&<div className="bubble-row"><ReaderTime at={message.created_at} className="bubble__time"/><div className="bubble bubble--user" dir="auto">{message.body}</div></div>}
   {/* A message being sent has no stored files to open yet: their names alone (#756). */}
   {!!message.files?.length&&message.kind==='sending'&&<div className="msg-files">{message.files.map(file=><span key={file.id} className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></span>)}</div>}
   {/* A person's image on the Engine (#880) is drawn from the session that carried it to the Agent, as a thumbnail of
       itself; it has no name of its own there. */}
   {!!message.files?.length&&message.kind!=='sending'&&<div className="msg-files">{message.files.map(file=>file.key
    ?<a key={file.key} className="file-thumb" href={fileHref(file)} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name||c('conversationImage',file.id+1))} data-file={file.key}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the file's own private route, never an optimised image */}
      <img src={fileHref(file)} alt={file.name||c('conversationImage',file.id+1)} loading="lazy"/></a>
    :<a key={file.id} className="file-chip" href={fileHref(file)} target="_blank" rel="noreferrer"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}
   {(message.kind==='queued'||message.kind==='sending')&&message.behind&&<span className="queued"><ShellIcon name="clock"/>{c('conversationQueued')}</span>}
   {message.kind==='answer'&&message.failed&&<p className="note" role="status">{c('conversationAnswerNotDelivered')}</p>}
   {message.kind==='note'&&<span className="queued" data-addressed>{c('conversationAddressed',message.to||'')}</span>}
   {message.lost&&<p className="note" data-outcome="lost">{t('conversationRunLost')}</p>}
  </li>:<Fragment key={`${message.kind||'m'}${message.id}`}><li className={`turn turn--agent msg${rise(index)}`} data-author="agent" data-kind={message.kind}>
   <div className="sender">{face(20,message.face,message.author_name)}<bdi>{message.author_name}</bdi>{message.kind==='handed'&&message.to&&<span className="sender__to">{cb('handoverTo',message.to)}</span>}<ReaderTime at={message.created_at} className="sender__time"/></div>
   {!!message.steps?.list.length&&<StepsList steps={message.steps} c={c} cb={cb} opened={landing.opened(message.id)}/>}
   {message.body&&<div className="bubble bubble--agent" dir="auto">{message.body}</div>}
   <ReplyFiles files={message.files} missed={message.missed} href={fileHref}/>
   {/* A tool the Engine could not run because the Company's work sandbox is down (#398): one plain line under the reply,
       which the Conversation still gave. */}
   {message.steps?.list.some(step=>step.sandbox)&&<p className="note" role="alert" data-outcome="sandbox">{t('workSandboxNotRunning')}</p>}
   {message.cards?.map(card=>card.kind==='made'?<Fragment key={card.agent.id}><MadeCard slug={slug} agent={card.agent} fresh={rises(madeArrival(message,card.agent.id))}/>{card.agent.fresh&&<AgentMadeToast company={company} slug={slug} agent={card.agent}/>}</Fragment>:card.kind==='request'?<RequestCard key={`request${card.request.id}`} slug={slug} request={card.request}/>
    :card.kind==='change'?<ChangeCard key={`change${card.change.id}`} change={card.change} company={company} owner={record.changeOwner===true}
     answer={card.change.state==='waiting'&&record.changeOwner?<Suspense fallback={null}><ChangeAnswer slug={slug} company={company} change={card.change} alone={record.alone===true} back={here}/></Suspense>:undefined}/>
    :card.kind==='access'?<AccessCard key={`access${card.access.id}`} card={card.access} fresh={!drawnAccess.has(card.access.id)} press={writer?pressAccess:undefined} c={c} cb={cb}/>
    :card.kind==='handed'?handed(card,`handed${message.id}:${card.name}:${card.goal}`,'p')
    :card.kind==='morning'?<MorningCard key="morning" slug={slug} card={card.morning}/>
    :<ReplyCard key={`reply${card.card.id}`} card={card.card} fresh={!drawnCards.has(card.card.id)} chips={record.lead===true} may={record.permit} connect={connect} openScreen={writer?openScreen:undefined}/>)}
  </li>{message.steps?.list.flatMap((step,at)=>step.routine?[<RoutineLine key={at} routine={step.routine} details={details} rise={rise(index)}/>]:step.card?[<CardLine key={at} slug={slug} card={step.card} rise={rise(index)}/>]:[])}</Fragment>)}
   {working&&<LiveTurn key={`live${live?.run??''}`} view={live} agent={conversation.agent_name} face={conversation.face} c={c} cb={cb} open={landing.open} toggled={landing.toggled} reply={engineLive?.reply}>{engineLive?.card}</LiveTurn>}</ol>
  {working&&!waitsOnPerson&&<WorkingLine view={live} working={record.workingFor?cb('conversationWorkingForPerson',record.workingFor):undefined} agent={conversation.agent_name} face={conversation.face} c={c} cb={cb}/>}
  {failed&&(modelCause
   // The Company has no model at all (#422), or a model error a retry cannot fix (#457): sending again cannot work, so
   // the line says its cause and where the Owner fixes it.
   ?<p className="note convo-status" role="alert" data-outcome={modelOutcome(modelCause)}><ModelLine cause={modelCause} agent={record.modelRefused?.agent??conversation.agent_name} slug={slug} owner={(record.noModel??record.modelRefused)?.owner===true} resets={record.modelRefused?.resetsAt} ranOut={record.modelRefused?.ranOut}/></p>
   // A Conversation on the Engine (#879): the reply did not finish, or none came, and Try again sends the words again.
   // A Run its person stopped (#878; design-reference: stopRun's note): it stopped mid-reply, or before it replied.
   :engineLive?.ending&&engineLive.stopped?<p className="note note--icon convo-status" role="status" data-outcome="stopped"><ShellIcon name="stop" className="note__icon"/><span>{cb(engineLive.stopped==='reply'?'conversationStoppedMidReply':'conversationStoppedBefore',conversation.agent_name)}
    {writer&&engineLive.again&&<> <button type="button" className="link-btn" onClick={engineLive.again}>{c('conversationTryAgain')}</button></>}</span></p>
   :engineLive?.ending?<p className="note convo-status" role="alert" data-outcome="unfinished">{c('conversationNotFinished')}
    {writer&&engineLive.again&&<> <button type="button" className="link-btn" onClick={engineLive.again}>{c('conversationTryAgain')}</button></>}</p>
   :<p className="note convo-status" role="alert">{t('conversationReplyFailed')}</p>)}
 </>;
}

// What goes under the messages (design-reference: composerHTML): the composer for a person who may write, whose stop
// square stops the open run for the person who started it, or a Manager or Owner; the view-only line for a Viewer. The
// Conversation's own page adds its usage line; a Card's sheet draws none. While the record is still on its way (#172) it
// already takes a message, with no stop square, and keeps the usage line's place.
// A message sent is drawn in the transcript at once (`sending`, #756), so the box lets it go as it is sent and takes it
// back if the send is refused.
// A Conversation whose messages are the Engine's steers its open Run through `steer` (#878): its stop square stops the
// Run the page follows, and while the Run waits on a question the person's typed words answer it (`answer`) rather than
// start another Run; a refused answer stays in the box.
export type Steer={stop?:()=>Promise<string|null>,answer?:(text:string)=>Promise<string|null>};
export function ConversationComposer({company,conversation,record,writer,asked,sending,box,usage,sent,steer}:{company:string,conversation:ThreadConversation,record:ConversationRecord|null,writer:boolean,asked:()=>void,sending?:Send,box?:Ref<MessageBoxHandle>,usage:boolean,sent?:()=>void,steer?:Steer}) {
 const {t,language}=useI18n(); const {c}=useConversationText();
 // A Run waiting on its person's answer is not working (#138): the box keeps its send arrow, as the reference's does.
 const working=record?.asking?null:record?.working; const canStop=record?.canStop;
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 // A waiting message the Engine refused for the Conversation's model (#158) is told as a sent one is, while it is the latest.
 const last=record?.messages.at(-1); const refused=last?.kind==='queued'&&last.failed&&last.model_refused?{key:`${last.created_at}:${last.body}`,text:last.body}:undefined;
 return <>
  {writer?<MessageBox ref={box} placeholder={t('writeTo',conversation.agent_name)} model={{company,conversation:conversation.id,agent:conversation.agent_name}} voice={conversation.agent_id?{company,agent:conversation.agent_id}:undefined} to={conversation.agent_id} refused={refused} stop={steer?.stop?{label:c('conversationStop',conversation.agent_name),run:steer.stop}:working&&canStop?{label:c('conversationStop',conversation.agent_name),run:async()=>{
   const failure=await postMessage({company,conversation:conversation.id,intent:'stop'});
   if(!failure) asked();
   return failure;
  }}:undefined} drawn={!!sending&&!steer?.answer} send={async(message,sendKey,files)=>{
   if(steer?.answer&&!files.length) return await steer.answer(message);
   const settled=sending?.(sendKey,message,files);
   const {failure,answer}=files.length?await postMessageWithFilesAnswer({company,conversation:conversation.id,message,sendKey},files):await postMessageAnswer({company,conversation:conversation.id,message,sendKey});
   settled?.(failure,answer);
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
