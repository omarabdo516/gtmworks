'use client';
// The strings only this page shows live in channel.en.json and channel.ar.json, in this route's own chunk.
import channelEn from '@/lib/messages/channel.en.json';
import channelAr from '@/lib/messages/channel.ar.json';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { dayOf } from '@/lib/activity-log.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { DetailsShell, HeadPill, useDetailsPanel, type DetailsPanel } from '@/app/agent-details';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { madeDay, useZone } from '@/app/agent-made';
import { firstName, withMention, type ChannelMessage, type ChannelRecord } from '@/lib/channels';

type Say=(key:string,...values:unknown[])=>string;
const roleKeys={owner:'owner',manager:'manager',contributor:'contributor',viewer:'viewer'} as const;

// A channel (#23), drawn as the reference draws its general channel (design-reference: renderChat, chIntroHTML,
// msgHTML): the title pill with its hash, the intro with who is in it and how Agents are called, the day, then the
// talk: another member's messages on the start side with their initial, name and role, the reader's own on the end
// side, an Agent's reply with its face. The Agent a message called is marked in it, and the message says while it
// replies or when it could not. The composer says that only an Agent called by name replies; a Viewer reads only. The
// page asks for the channel again every 1.5 s while a reply is coming, otherwise every 6 s while it is shown, and
// soon after a send.
export default function ChannelView({person,initial}:{person:string,initial:ChannelRecord}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?channelAr:channelEn;
 const c:Say=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel(); const zone=useZone();
 const {channel,members,agents,writer,messages,open}=record;
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(document.visibilityState==='visible') {
    try {
     const response=await fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'});
     if(response.ok&&!stopped) setRecord(await response.json() as ChannelRecord);
    } catch { /* The network is down: ask again. */ }
   }
   if(!stopped) timer=setTimeout(poll,open?1500:6000);
  };
  timer=setTimeout(poll,sent?300:open?1500:6000);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[open,sent,channel.company,channel.id]);
 // Opened, and after each new message, the channel shows its latest talk, as the reference does.
 const transcript=useRef<HTMLDivElement>(null); const last=messages.at(-1)?.id;
 useEffect(()=>{ const box=transcript.current; if(box) box.scrollTop=box.scrollHeight; },[last]);
 const name=t('shellGeneralChannel');
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const now=new Date(); const today=dayOf(now.toISOString(),zone); const yesterday=dayOf(new Date(now.getTime()-864e5).toISOString(),zone);
 const dayLabel=(at:string)=>{ const day=dayOf(at,zone); return day===today?t('today'):day===yesterday?t('yesterday'):madeDay(at,language,zone); };
 // The route tip names the main Agent as the example, marked as the reference marks a mention.
 const [before,after]=own.channelRouteTip.split('@{0}');
 const tip=agents[0]?<>{before}<bdi className="mention">@{agents[0].name}</bdi>{after}</>:c('channelRouteTipPlain');
 const waiting=messages.find((message):message is Extract<ChannelMessage,{author:'person'}>=>message.author==='person'&&message.mention?.state==='open');
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} details={c('channelDetails')} face={<span className="hp-hash" aria-hidden="true"><ShellIcon name="hash"/></span>} title={name}/>
  <div className="transcript" ref={transcript}><div className="transcript__col">
   <div className="ch-intro">
    <span className="ch-intro__h">#{name}</span>
    <span>{c('channelMembers',count(members.length))} · {agents.length?agents.map((agent,index)=><Fragment key={agent.id}>{index>0&&c('channelNamesJoin')}<bdi>{agent.name}</bdi></Fragment>):c('channelNoAgents')}</span>
    <p><ShellIcon name="at"/><span>{tip}</span></p>
   </div>
   <ol className="turns" aria-label={c('channelMessages',name)}>{messages.map((message,index)=><Fragment key={message.id}>
    {(index===0||dayOf(messages[index-1].at,zone)!==dayOf(message.at,zone))&&<li className="divider"><time dateTime={message.at} data-utc={zone}>{dayLabel(message.at)}</time></li>}
    <Turn message={message} time={time} c={c}/>
   </Fragment>)}</ol>
   {waiting?.mention&&<p className="thinking convo-status" role="status">{t('conversationWorking',waiting.mention.agent)}</p>}
  </div></div>
  <div className="composer-area">
   {writer?<MessageBox label={c('channelMessageLabel')} placeholder={c('channelPlaceholder',name)} send={async(message,sendKey)=>{
    const failure=await postMessage({company:channel.company,channel:channel.id,message,sendKey},'/api/channels');
    if(!failure) setSent(value=>value+1);
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}
  </div>
 </div><ChannelDetails panel={panel} name={name} person={person} record={record} tip={tip} c={c}/></div>;
}

function Turn({message,time,c}:{message:ChannelMessage,time:(value:string)=>string,c:Say}) {
 const {t}=useI18n();
 if(message.author==='agent') return <li className="turn turn--agent msg" data-author="agent">
  <div className="sender"><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:message.face,name:message.name}} size={20}/></span><bdi>{message.name}</bdi><time className="sender__time" dateTime={message.at}>{time(message.at)}</time></div>
  <div className="bubble bubble--agent" dir="auto">{message.body}</div>
 </li>;
 const body=withMention(message.body,message.mention?.agent).map((part,index)=>part.mention?<bdi key={index} className="mention">{part.text}</bdi>:<Fragment key={index}>{part.text}</Fragment>);
 const failed=message.mention?.state==='unanswered'&&<p className="note" role="alert">{c('channelCouldNotReply',message.mention.agent)}</p>;
 if(message.mine) return <li className="turn turn--user msg" data-author="person">
  <div className="bubble-row"><time className="bubble__time" dateTime={message.at}>{time(message.at)}</time><div className="bubble bubble--user" dir="auto">{body}</div></div>
  {failed}
 </li>;
 return <li className="turn turn--peer msg" data-author="person">
  <div className="sender"><Initial name={message.name} size={20}/><bdi>{firstName(message.name)}</bdi>{message.role&&<span className="sender__role">{t(roleKeys[message.role])}</span>}<time className="sender__time" dateTime={message.at}>{time(message.at)}</time></div>
  <div className="bubble bubble--peer" dir="auto">{body}</div>
  {failed}
 </li>;
}

// A member's initial in a round mark (design-reference: personAv).
const Initial=({name,size}:{name:string,size:number})=><span className="me__av lg-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;

// The channel's details (design-reference: renderTeamDetails), read-only: who is in it with their roles, that the
// general channel always has everyone, the Agents the reader can call here, and how to call one.
function ChannelDetails({panel,name,person,record,tip,c}:{panel:DetailsPanel,name:string,person:string,record:ChannelRecord,tip:ReactNode,c:Say}) {
 const {t,language}=useI18n();
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const {members,agents}=record;
 return <DetailsShell panel={panel} label={c('channelDetails')} start={<span className="dp-top__l">{c('channelKind')}</span>}>
  <div className="dp-id">
   <span className="hp-hash hp-hash--xl" aria-hidden="true"><ShellIcon name="hash"/></span>
   <div><div className="dp-id__name">#{name}</div><div className="dp-id__role">{c('channelMembers',count(members.length))} · {c('channelAgents',count(agents.length))}</div></div>
  </div>
  <div className="dp-sections">
   <section className="dp-sec" aria-labelledby="ch-h-p">
    <h3 className="dp-label" id="ch-h-p"><span>{t('members')} <span className="muted num">{count(members.length)}</span></span></h3>
    <ul className="panel-card">
     {members.map(member=><li key={member.person} className="panel-row"><Initial name={member.name} size={28}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{member.name}</bdi>{member.person===person&&<> <span className="ch-you">{c('channelYou')}</span></>}</span>
       <span className="panel-row__d">{t(roleKeys[member.role])}{member.role==='viewer'&&` · ${c('channelReadsOnly')}`}</span></span></li>)}
     <li className="tm-hint"><ShellIcon name="team"/><span>{c('channelEveryone',name)}</span></li>
    </ul>
   </section>
   <section className="dp-sec" aria-labelledby="ch-h-a">
    <h3 className="dp-label" id="ch-h-a"><span>{t('agents')} <span className="muted num">{count(agents.length)}</span></span></h3>
    <ul className="panel-card">
     {agents.length?agents.map(agent=><li key={agent.id} className="panel-row"><span aria-hidden="true"><CompanyAgentFace agent={agent} size={28}/></span>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span>{agent.speciality&&<span className="panel-row__d"><bdi>{agent.speciality}</bdi></span>}</span></li>)
     :<li className="panel-row"><span className="panel-row__text"><span className="panel-row__d">{c('channelNoAgents')}</span></span></li>}
     <li className="tm-hint"><ShellIcon name="at"/><span>{tip}</span></li>
    </ul>
   </section>
  </div>
 </DetailsShell>;
}
