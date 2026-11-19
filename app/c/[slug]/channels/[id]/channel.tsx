'use client';
import channelEn from '@/lib/messages/channel.en.json';
import channelAr from '@/lib/messages/channel.ar.json';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { columnLabel } from '@/lib/board-columns.mjs';
import { dayOf } from '@/lib/activity-log.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { named } from '@/lib/bidi';
import { AgentFaceDot } from '@/app/agent-face-dot';
import { statusKeys } from '@/lib/agent-details.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { DetailsShell, HeadPill, useDetailsPanel, type DetailsPanel } from '@/app/agent-details';
import { MessageBox, postMessage, postMessageWithFiles } from '@/app/conversation-composer';
import { madeDay, useZone } from '@/app/agent-made';
import { changeChannel, channelChoices } from '@/app/channel-actions';
import { channelTitle, firstName, withMention, type ChannelAgent, type ChannelMention, type ChannelMessage, type ChannelRecord } from '@/lib/channels';
import { PermissionCard, type DecidePermission, type PermissionOutcome } from '@/app/permission-card';
import { ReplyCard } from '@/app/reply-card';
import type { AnswerQuestion } from '@/app/question-card';
import type { MarkHandDone } from '@/app/hand-card';
import { StepsList, type StepsBidiText } from '@/app/run-steps';
import { offeredChoices } from '@/lib/conversations';

type Say=(key:string,...values:unknown[])=>string;
type Choices=NonNullable<Awaited<ReturnType<typeof channelChoices>>>;
const roleKeys={owner:'owner',manager:'manager',contributor:'contributor',viewer:'viewer'} as const;
// The Agents a message called (#152), in the order they were named. A message from an older drawing carries only the
// first one, which is the one Agent it called.
const mentionsOf=(message:ChannelMessage):ChannelMention[]=>message.author==='person'?message.mentions??(message.mention?[message.mention]:[]):[];

// Agent names inside a sentence, each isolated so a name in the other script never flips the text around it.
const Names=({agents,c}:{agents:ChannelAgent[],c:Say})=><>{agents.map((agent,index)=><Fragment key={agent.id}>{index>0&&c('channelNamesJoin')}<bdi>{agent.name}</bdi></Fragment>)}</>;

export default function ChannelView({person,slug,initial}:{person:string,slug:string,initial:ChannelRecord}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?channelAr:channelEn;
 const c:Say=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 // The same, for the steps' tool lines: each value isolated in its own direction, as a Conversation draws them.
 const cb:StepsBidiText=(key,...values)=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel(); const zone=useZone();
 const {channel,members,agents,writer,messages,open,handover,may,board}=record;
 const refresh=useCallback(async()=>{
  try {
   const response=await fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'});
   if(response.ok) setRecord(await response.json() as ChannelRecord);
  } catch {}
 },[channel.company,channel.id]);
 // Opening the channel reads it, and asks for it fresh: the page may be a prefetch drawn before the newest messages. The
 // answer replaces only that first drawing, never a newer one from a poll or a send. Opened from a mention (#200), the
 // read names the message the Member opened, so their own waiting item is done; the address is then the channel's again.
 useEffect(()=>{
  const mention=/^#mention-\d+$/.test(location.hash)?location.hash.slice('#mention-'.length):null;
  void fetch(`/api/channels?company=${channel.company}&channel=${channel.id}${mention?`&mention=${mention}`:''}`,{cache:'no-store'}).then(async response=>{
   if(mention) history.replaceState(history.state,'',location.pathname+location.search);
   if(response.ok) { const fresh=await response.json() as ChannelRecord; setRecord(current=>current===initial?fresh:current); } else await response.arrayBuffer();
  }).catch(()=>{});
 },[channel.company,channel.id,initial]);
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(document.visibilityState==='visible') {
    try {
     const response=await fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'});
     if(response.ok&&!stopped) setRecord(await response.json() as ChannelRecord);
    } catch {}
   }
   if(!stopped) timer=setTimeout(poll,(open||handover)?1500:6000);
  };
  timer=setTimeout(poll,sent?300:(open||handover)?1500:6000);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[open,handover,sent,channel.company,channel.id]);
 // The Member who called the Agent decides its Run's request (#165), as a Conversation's person does (#163); the choice
 // then goes to the waiting Run after the answer, and the next read shows the reply.
 const permit:DecidePermission=async(request,choice)=>{
  try {
   const response=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:channel.company,channel:channel.id,intent:'permit',request,choice})});
   const body=await response.json() as {state?:PermissionOutcome['state'],choice?:typeof choice,at?:string,first?:boolean,error?:string};
   if(!response.ok||!body.state) return {error:body.error==='channelNotAllowed'?body.error:'conversationFailed'};
   setSent(value=>value+1);
   return body.state==='decided'&&body.choice&&body.at?{state:'decided',choice:body.choice,at:body.at,first:body.first===true}:{state:'closed',first:body.first===true};
  } catch { return {error:'conversationFailed'}; }
 };
 // A Member of the channel picks an option on the question its Agent waits on (#149): the answer is kept once for the
 // whole team, then the channel is read again. Another Member may have picked first, and the card says so.
 const answer:AnswerQuestion=async(card,choice,answerKey)=>{
  try {
   const response=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:channel.company,channel:channel.id,intent:'answer',card,choice,answerKey})});
   const body=await response.json() as {state?:string,error?:string};
   if(!response.ok||!body.state) return body.error==='channelNotAllowed'?body.error:body.error==='questionTaken'?'questionTaken':body.error==='questionClosed'?'questionClosed':'conversationFailed';
   setSent(value=>value+1);
   return null;
  } catch { return 'conversationFailed'; }
 };
 // "Done it" on a step an Agent handed the team (#149): the record keeps who did it and when, the first press starts the
 // Agent's Run that picks up, and the channel is read again. A press another Member made first starts nothing here.
 const done:MarkHandDone=async(card)=>{
  try {
   const response=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:channel.company,channel:channel.id,intent:'done',card})});
   const body=await response.json() as {at?:string,first?:boolean,error?:string};
   if(!response.ok||!body.at) return {error:body.error||'conversationFailed'};
   if(body.first===true) setSent(value=>value+1);
   return {at:body.at,first:body.first===true};
  } catch { return {error:'conversationFailed'}; }
 };
 // A card an Agent's Run shows while the channel is open rises in once (design-reference: card-in); those already there
 // do not. A question is drawn under the message, a reply's cards under the Agent's reply.
 const [drawnCards]=useState(()=>new Set(initial.messages.flatMap(message=>message.author==='person'
  ?mentionsOf(message).flatMap(mention=>[...mention.questions.map(card=>card.id),...mention.permissions.map(card=>card.id)])
  :message.author==='agent'?message.cards?.map(card=>card.id)??[]:[])));
 const transcript=useRef<HTMLDivElement>(null); const last=messages.at(-1)?.id;
 // Opened from "Waiting on you" at a card (#165, #149: `#permission-<id>`, `#question-<id>` or `#hand-<id>`): that card
 // in view and focused, not the newest message, on the first draw only; the address is then the channel's again. Opened
 // from a mention (#200, `#mention-<id>`): that message a third of the way down and ringed for 1.6 seconds, a still ring
 // with reduced motion (design-reference: spotIn, openMention).
 const landed=useRef(false);
 useLayoutEffect(()=>{
  const card=/^#(permission|question|hand)-\d+$/.test(location.hash)?transcript.current?.querySelector<HTMLElement>(location.hash):null;
  if(card) {
   landed.current=true;
   card.scrollIntoView({block:'center'}); card.focus({preventScroll:true});
   history.replaceState(history.state,'',location.pathname+location.search);
   return;
  }
  const mention=/^#mention-(\d+)$/.exec(location.hash); const box=transcript.current;
  const bubble=mention&&box?box.querySelector<HTMLElement>(`[data-msg="${mention[1]}"] .bubble`):null;
  if(!bubble||!box) return;
  landed.current=true;
  box.scrollTop+=bubble.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight/3;
  bubble.classList.remove('is-spot'); void bubble.offsetWidth; bubble.classList.add('is-spot');
 },[]); // eslint-disable-line react-hooks/exhaustive-deps
 const seen=useRef(last);
 useEffect(()=>{ const box=transcript.current; if(landed.current&&seen.current===last) return; landed.current=false; seen.current=last; if(box) box.scrollTop=box.scrollHeight; },[last]);
 const name=channelTitle(t,channel);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const now=new Date(); const today=dayOf(now.toISOString(),zone); const yesterday=dayOf(new Date(now.getTime()-864e5).toISOString(),zone);
 const dayLabel=(at:string)=>{ const day=dayOf(at,zone); return day===today?t('today'):day===yesterday?t('yesterday'):madeDay(at,language,zone); };
 const [before,after]=own.channelRouteTip.split('@{0}');
 const tip=agents[0]?<>{before}<bdi className="mention">@{agents[0].name}</bdi>{after}</>:c('channelRouteTipPlain');
 const only=agents.filter(agent=>agent.only);
 const [onlyBefore,onlyAfter]=own[only.length>1?'channelShownHereMany':'channelShownHereOne'].split('{0}');
 // Every name a message can give a Member, full or first, so the channel marks it bold for every reader (#200) as it
 // marks the called Agent's; an invited person has no @name yet (#207).
 const memberNames=members.flatMap(member=>{ const name=member.person&&!member.invitation?member.name.trim():''; return name?[name,firstName(name)]:[]; });
 // The Agent working now: the first Run still open, since a message's Agents answer one after another (#152).
 const waiting=messages.find((message):message is Extract<ChannelMessage,{author:'person'}>=>message.author==='person'&&mentionsOf(message).some(mention=>mention.state==='open'));
 const workingNow=waiting?mentionsOf(waiting).find(mention=>mention.state==='open')??null:null;
 const boardColumn=board?t(columnLabel(board.column,writer)):'';
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} details={c('channelDetails')} face={<span className="hp-hash" aria-hidden="true"><ShellIcon name="hash"/></span>} title={name}
   corner={board&&<div className="chat__corner"><Link className={`corner-pill${board.waiting?' is-waiting':''}`} href={`/c/${slug}/work/board?show=${board.card}`} aria-label={`${c('channelOnTheBoard')} ${boardColumn}`}>
    <span className={`dot dot--${board.waiting?'waiting':'idle'}`} aria-hidden="true"/><span className="corner-pill__lbl">{c('channelOnTheBoard')}</span><span className="corner-pill__col">{boardColumn}</span>
   </Link></div>}/>
  <div className="transcript" ref={transcript}><div className="transcript__col">
   <div className="ch-intro">
    <span className="ch-intro__h">#<bdi>{name}</bdi></span>
    <span>{c(members.length===1?'channelMember':'channelMembers',count(members.length))} · {agents.length?<Names agents={agents} c={c}/>:c('channelNoAgents')}</span>
    <p><ShellIcon name="at"/><span>{tip}</span></p>
    {only.length>0&&<p className="ch-intro__only"><ShellIcon name="eye"/><span>{onlyBefore}<Names agents={only} c={c}/>{onlyAfter}</span></p>}
   </div>
   <ol className="turns" aria-label={c('channelMessages',name)}>{messages.map((message,index)=><Fragment key={message.id}>
    {(index===0||dayOf(messages[index-1].at,zone)!==dayOf(message.at,zone))&&<li className="divider"><time dateTime={message.at} data-utc={zone}>{dayLabel(message.at)}</time></li>}
    <Turn message={message} time={time} c={c} slug={slug} name={name} cb={cb} drawnCards={drawnCards} memberNames={memberNames} done={writer?done:undefined}/>
    {message.author==='person'&&mentionsOf(message).some(mention=>mention.questions.length>0||mention.permissions.length>0)&&mentionsOf(message).filter(mention=>mention.questions.length>0||mention.permissions.length>0).map(mention=><li key={mention.agent} className="turn turn--agent msg" data-author="agent">
     <div className="sender"><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:mention.face,name:mention.agent}} size={20}/></span><bdi>{mention.agent}</bdi></div>
     {mention.questions.map(card=><ReplyCard key={`question${card.id}`} card={card} fresh={!drawnCards.has(card.id)} chips={card.chips}
       answer={writer&&(!card.chips||message.mine)?answer:undefined}
       waitingFor={card.chips&&!message.mine?firstName(message.name):null}/>)}
     {mention.permissions.map(card=><PermissionCard key={card.id} card={card} fresh={!drawnCards.has(card.id)} offered={offeredChoices(card,may)} decide={message.mine&&writer?permit:undefined}/>)}
    </li>)}
   </Fragment>)}</ol>
   {workingNow&&<p className="thinking convo-status" role="status">{t('conversationWorking',workingNow.agent)}</p>}
  </div></div>
  <div className="composer-area">
   {writer?<MessageBox label={c('channelMessageLabel')} placeholder={c('channelPlaceholder',name)} voice={{company:channel.company,channel:channel.id}} call={{people:members.flatMap(member=>member.person&&member.person!==person?[{id:member.person,name:member.name,role:member.role}]:[]),agents}} send={async(message,sendKey,files)=>{
    const fields={company:channel.company,channel:channel.id,message,sendKey};
    const failure=files.length?await postMessageWithFiles(fields,files,'/api/channels'):await postMessage(fields,'/api/channels');
    if(!failure) setSent(value=>value+1);
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
  </div>
 </div><ChannelDetails panel={panel} slug={slug} name={name} person={person} record={record} tip={tip} c={c} time={time} refresh={refresh}/></div>;
}

function Turn({message,time,c,slug,name,cb,drawnCards,memberNames,done}:{message:ChannelMessage,time:(value:string)=>string,c:Say,slug:string,name:string,cb:StepsBidiText,drawnCards:Set<number>,memberNames:string[],done?:MarkHandDone}) {
 const {t,language}=useI18n();
 // The quiet message "Done it" wrote asks its Agent to pick up (#149): the card shows the press, never a bubble of it.
 if(message.author==='person'&&message.handDone) return null;
 // The quiet line an invitation adds (#207): not a message, and the channel's own name is the one it joined. The quiet
 // line a channel's Card adds (#151) says where the Card went, in the time it was added.
 if(message.author==='note') return <li className="note note--icon" data-kind={message.kind}>
  <ShellIcon name={message.kind==='card'?'board':'team'} className="note__icon"/><span>{message.kind==='card'?c('channelCardNote',t('boardColProgress')):c('channelInviteNote',firstName(message.actor),message.name,name)}</span>
 </li>;
 // A job the main Agent handed another Agent of the channel (#150; design-reference: the handoff row, `.handoff`): both
 // faces with the arrow between them, the Agent it went to, and the job. It has nothing to press.
 if(message.author==='handoff') return <li className="handed" role="note" data-handover>
  <span className="handed__faces"><CompanyAgentFace agent={{connection_id:message.from.face,name:message.from.name}} size={18}/><ShellIcon name={language==='ar'?'arrow':'arrowLtr'} className="handed__arrow"/><CompanyAgentFace agent={{connection_id:message.to.face,name:message.to.name}} size={18}/></span>
  <span className="handed__t">{named(c,'channelHandedTo',message.to.name)}</span>
  {message.goal&&<span className="handed__d"><bdi>{message.goal}</bdi></span>}
 </li>;
 if(message.author==='agent') return <li className="turn turn--agent msg" data-author="agent">
  <div className="sender"><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:message.face,name:message.name}} size={20}/></span><bdi>{message.name}</bdi>{message.to&&<span className="sender__to">{c('channelSenderTo',message.to)}</span>}<time className="sender__time" dateTime={message.at}>{time(message.at)}</time></div>
  {!!message.steps?.list.length&&<StepsList steps={message.steps} c={c} cb={cb}/>}
  <div className="bubble bubble--agent" dir="auto">{message.body}</div>
  {message.cards?.map(card=><ReplyCard key={`reply${card.id}`} card={card} fresh={!drawnCards.has(card.id)} done={done} team/>)}
 </li>;
 // Every name that called an Agent is marked, so is every Member's name a message gives (#200), and each Agent that could
 // not reply gets its own line (#152).
 const called=mentionsOf(message);
 const body=withMention(message.body,[...called.map(mention=>mention.agent),...memberNames]).map((part,index)=>part.mention?<bdi key={index} className="mention">{part.text}</bdi>:<Fragment key={index}>{part.text}</Fragment>);
 const failed=called.filter(mention=>mention.state==='unanswered').map(mention=><p key={mention.agent} className="note" role="alert">{c('channelCouldNotReply',mention.agent)}</p>);
 // The images the message carries (#156), under its bubble on the writer's side for the writer and on the start side for
 // every other Member (design-reference: filesHTML; `.turn--user` and `.turn--peer` put them on their own side).
 const files=!!message.files.length&&<div className="msg-files">{message.files.map(file=><a key={file.id} className="file-chip" href={`/c/${slug}/files/channel/${file.id}`} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>;
 if(message.mine) return <li className="turn turn--user msg" data-author="person" data-msg={message.id}>
  {!!message.body.trim()&&<div className="bubble-row"><time className="bubble__time" dateTime={message.at}>{time(message.at)}</time><div className="bubble bubble--user" dir="auto">{body}</div></div>}
  {files}
  {failed}
 </li>;
 return <li className="turn turn--peer msg" data-author="person" data-msg={message.id}>
  <div className="sender"><Initial name={message.name} size={20}/><bdi>{firstName(message.name)}</bdi>{message.role&&<span className="sender__role">{t(roleKeys[message.role])}</span>}<time className="sender__time" dateTime={message.at}>{time(message.at)}</time></div>
  {!!message.body.trim()&&<div className="bubble bubble--peer" dir="auto">{body}</div>}
  {files}
  {failed}
 </li>;
}

const Initial=({name,size}:{name:string,size:number})=><span className="me__av lg-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;

// design-reference: renderTeamDetails, with its "On the board" (#151) and "Handoffs" (#150) sections.
function ChannelDetails({panel,slug,name,person,record,tip,c,time,refresh}:{panel:DetailsPanel,slug:string,name:string,person:string,record:ChannelRecord,tip:ReactNode,c:Say,time:(value:string)=>string,refresh:()=>Promise<void>}) {
 const {t,language}=useI18n();
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const {channel,members,agents,manage,managers,handoffs,writer}=record;
 const team=channel.kind==='team';
 const [addingPerson,setAddingPerson]=useState(false); const [addingAgent,setAddingAgent]=useState(false);
 const [choices,setChoices]=useState<Choices|null>(null); const [failed,setFailed]=useState(false);
 const pick=async(open:boolean,set:(value:boolean)=>void)=>{
  set(open);
  if(open&&!choices) setChoices(await channelChoices(channel.company));
 };
 const change=async(made:{person:string,present:boolean}|{invitation:string,present:boolean}|{agent:string,present:boolean},opener:string)=>{
  const failure=await changeChannel(channel.company,channel.id,made);
  setFailed(!!failure);
  if(failure) return;
  if('person' in made) setAddingPerson(false); else setAddingAgent(false);
  await refresh();
  document.getElementById(opener)?.focus();
 };
 const remove=(id:string,label:string,made:{person:string,present:boolean}|{invitation:string,present:boolean}|{agent:string,present:boolean},opener:string)=>
  <button type="button" className="link-btn" id={id} aria-label={c('channelRemoveFrom',label)} onClick={()=>void change(made,opener)}>{c('channelRemove')}</button>;
 const addRow=(id:string,open:boolean,label:string,toggle:()=>void)=><li><button type="button" className="panel-row tm-add" id={id} aria-expanded={open} onClick={toggle}>
  <span className="panel-row__icon"><ShellIcon name={open?'x':'plus'}/></span><span className="panel-row__text"><span className="panel-row__t">{open?c('channelAddDone'):label}</span></span></button></li>;
 const personCandidates=(choices?.people||[]).filter(candidate=>!members.some(member=>member.person?member.person===candidate.person:member.invitation===candidate.invitation));
 const agentCandidates=(choices?.agents||[]).filter(candidate=>!agents.some(agent=>agent.id===candidate.id));
 const empty=(text:string)=><li className="panel-row"><span className="panel-row__text"><span className="panel-row__d">{text}</span></span></li>;
 const byName=managers.map(manager=>c(manager.role==='owner'?'channelByOwner':'channelByManager',manager.name));
 const managedBy=byName.length>1?`${byName.slice(0,-1).join(c('channelNamesJoin'))}${c('channelNamesLast')}${byName.at(-1)}`:byName[0]||'';
 const working=agents.filter(agent=>agent.state==='working').length;
 return <DetailsShell panel={panel} label={c('channelDetails')} start={<span className="dp-top__l">{c('channelKind')}</span>}>
  <div className="dp-id">
   <span className="hp-hash hp-hash--xl" aria-hidden="true"><ShellIcon name="hash"/></span>
   <div><div className="dp-id__name">#<bdi>{name}</bdi></div><div className="dp-id__role">{c(members.length===1?'channelMember':'channelMembers',count(members.length))} · {c(agents.length===1?'channelAgent':'channelAgents',count(agents.length))}{working>0&&<> · <span className="dot dot--working" aria-hidden="true"/>{count(working)} {c('channelWorking')}</>}</div></div>
  </div>
  <div className="dp-sections">
   <section className="dp-sec" aria-labelledby="ch-h-p">
    <h3 className="dp-label" id="ch-h-p"><span>{t('members')} <span className="muted num">{count(members.length)}</span></span></h3>
    <ul className="panel-card">
     {members.map(member=><li key={member.person??member.invitation} className="panel-row"><Initial name={member.name} size={28}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{member.name}</bdi>{member.person===person&&<> <span className="ch-you">{c('channelYou')}</span></>}</span>
       <span className="panel-row__d">{t(roleKeys[member.role])}{member.email&&<> · <bdi dir="ltr">{member.email}</bdi></>}{member.role==='viewer'&&` · ${c('channelReadsOnly')}`}{member.invitation&&` · ${t('settingsInvitePending')}`}</span></span>
      {manage&&member.person!==person&&remove(`ch-rm-${member.person??member.invitation}`,member.name,member.person?{person:member.person,present:false}:{invitation:member.invitation!,present:false},'ch-add-open')}</li>)}
     {manage&&addRow('ch-add-open',addingPerson,c('channelAddMember'),()=>void pick(!addingPerson,setAddingPerson))}
     {manage&&addingPerson&&choices&&(personCandidates.length?personCandidates.map(candidate=><li key={candidate.person??candidate.invitation} className="panel-row tm-cand"><Initial name={candidate.name} size={28}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{candidate.name}</bdi></span><span className="panel-row__d">{t(roleKeys[candidate.role])}{candidate.email&&<> · <bdi dir="ltr">{candidate.email}</bdi></>}</span></span>
      <button type="button" className="btn btn--secondary btn--sm" id={`ch-add-${candidate.person??candidate.invitation}`} onClick={()=>void change(candidate.person?{person:candidate.person,present:true}:{invitation:candidate.invitation!,present:true},'ch-add-open')}>{c('channelAdd')}</button></li>)
      :empty(c('channelEveryoneHere')))}
     {!team&&<li className="tm-hint"><ShellIcon name="team"/><span>{c('channelEveryone',name)}</span></li>}
    </ul>
   </section>
   <section className="dp-sec" aria-labelledby="ch-h-a">
    <h3 className="dp-label" id="ch-h-a"><span>{t('agents')} <span className="muted num">{count(agents.length)}</span></span></h3>
    <ul className="panel-card">
     {agents.length?agents.map(agent=><li key={agent.id} className="panel-row"><AgentFaceDot agent={agent} size={28} status={agent.state}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span>{agent.only?<span className="panel-row__d">{c('channelShownHere')}</span>:<span className="panel-row__d">{agent.speciality&&<><bdi>{agent.speciality}</bdi>{' · '}</>}{t(statusKeys[agent.state])}</span>}</span>
      {manage&&remove(`tm-rm-${agent.id}`,agent.name,{agent:agent.id,present:false},'tm-add-open')}</li>)
     :empty(team?c('channelNoAgentsYet'):c('channelNoAgents'))}
     {manage&&addRow('tm-add-open',addingAgent,c('channelAddAgent'),()=>void pick(!addingAgent,setAddingAgent))}
     {manage&&addingAgent&&choices&&(agentCandidates.length?agentCandidates.map(candidate=><li key={candidate.id} className="panel-row tm-cand"><span aria-hidden="true"><CompanyAgentFace agent={candidate} size={28}/></span>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{candidate.name}</bdi></span><span className="panel-row__d"><bdi>{candidate.speciality||t('newAgent')}</bdi></span></span>
      <button type="button" className="btn btn--secondary btn--sm" id={`tm-add-${candidate.id}`} onClick={()=>void change({agent:candidate.id,present:true},'tm-add-open')}>{c('channelAdd')}</button></li>)
      :empty(c('channelEveryAgentHere')))}
     <li className="tm-hint"><ShellIcon name="at"/><span>{tip}</span></li>
     {team&&<li className="tm-hint"><ShellIcon name="eye"/><span>{c('channelSeesAgents')}</span></li>}
    </ul>
    {failed&&<p className="set-err ch-who" role="alert">{c('channelChangeFailed')}</p>}
    {team&&!manage&&managedBy&&<p className="set-hint ch-who">{c('channelManagedBy',managedBy)}</p>}
   </section>
   {record.board&&<section className="dp-sec" aria-labelledby="ch-h-b">
    <h3 className="dp-label" id="ch-h-b"><span>{c('channelOnTheBoardSection')}</span></h3>
    <div className="panel-card"><Link className="panel-row" href={`/c/${slug}/work/board?show=${record.board.card}`}>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{record.board.title}</bdi></span><span className="panel-row__d">{record.board.line}</span></span>
     <span className={`panel-row__meta${record.board.waiting?' panel-row__meta--wait':''}`}>{record.board.waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}{t(columnLabel(record.board.column,writer))}</span>
    </Link></div>
   </section>}
   {handoffs.length>0&&<section className="dp-sec" aria-labelledby="ch-h-h">
    <h3 className="dp-label" id="ch-h-h"><span>{c('channelHandoffs')} <span className="muted num">{count(handoffs.length)}</span></span></h3>
    <ul className="panel-card">
     {handoffs.slice(0,4).map(handoff=><li key={handoff.id} className="panel-row">
      <span className="handed__faces"><CompanyAgentFace agent={{connection_id:handoff.from.face,name:handoff.from.name}} size={20}/><ShellIcon name={language==='ar'?'arrow':'arrowLtr'} className="handed__arrow"/><CompanyAgentFace agent={{connection_id:handoff.to.face,name:handoff.to.name}} size={20}/></span>
      <span className="panel-row__text"><span className="panel-row__t">{named(c,'channelHandedTo',handoff.to.name)}</span>
       <span className="panel-row__d">{handoff.goal&&<><bdi>{handoff.goal}</bdi>{' · '}</>}{time(handoff.at)}</span></span>
     </li>)}
    </ul>
   </section>}
  </div>
 </DetailsShell>;
}
