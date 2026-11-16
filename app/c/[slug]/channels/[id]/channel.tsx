'use client';
import channelEn from '@/lib/messages/channel.en.json';
import channelAr from '@/lib/messages/channel.ar.json';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { dayOf } from '@/lib/activity-log.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { DetailsShell, HeadPill, useDetailsPanel, type DetailsPanel } from '@/app/agent-details';
import { MessageBox, postMessage } from '@/app/conversation-composer';
import { madeDay, useZone } from '@/app/agent-made';
import { changeChannel, channelChoices } from '@/app/channel-actions';
import { channelTitle, firstName, withMention, type ChannelAgent, type ChannelMessage, type ChannelRecord } from '@/lib/channels';

type Say=(key:string,...values:unknown[])=>string;
type Choices=NonNullable<Awaited<ReturnType<typeof channelChoices>>>;
const roleKeys={owner:'owner',manager:'manager',contributor:'contributor',viewer:'viewer'} as const;

// Agent names inside a sentence, each isolated so a name in the other script never flips the text around it.
const Names=({agents,c}:{agents:ChannelAgent[],c:Say})=><>{agents.map((agent,index)=><Fragment key={agent.id}>{index>0&&c('channelNamesJoin')}<bdi>{agent.name}</bdi></Fragment>)}</>;

export default function ChannelView({person,initial}:{person:string,initial:ChannelRecord}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?channelAr:channelEn;
 const c:Say=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const [record,setRecord]=useState(initial); const [sent,setSent]=useState(0); const panel=useDetailsPanel(); const zone=useZone();
 const {channel,members,agents,writer,messages,open}=record;
 const refresh=useCallback(async()=>{
  try {
   const response=await fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'});
   if(response.ok) setRecord(await response.json() as ChannelRecord);
  } catch {}
 },[channel.company,channel.id]);
 // Opening the channel is reading it; the page's own render never marks it, since a render can be one nobody saw.
 // The answer is read to its end: a response left unread keeps its request open, and the page never settles.
 useEffect(()=>{ void fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'}).then(response=>response.arrayBuffer()).catch(()=>{}); },[channel.company,channel.id]);
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(document.visibilityState==='visible') {
    try {
     const response=await fetch(`/api/channels?company=${channel.company}&channel=${channel.id}`,{cache:'no-store'});
     if(response.ok&&!stopped) setRecord(await response.json() as ChannelRecord);
    } catch {}
   }
   if(!stopped) timer=setTimeout(poll,open?1500:6000);
  };
  timer=setTimeout(poll,sent?300:open?1500:6000);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[open,sent,channel.company,channel.id]);
 const transcript=useRef<HTMLDivElement>(null); const last=messages.at(-1)?.id;
 useEffect(()=>{ const box=transcript.current; if(box) box.scrollTop=box.scrollHeight; },[last]);
 const name=channelTitle(t,channel);
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const time=(value:string)=>new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'});
 const now=new Date(); const today=dayOf(now.toISOString(),zone); const yesterday=dayOf(new Date(now.getTime()-864e5).toISOString(),zone);
 const dayLabel=(at:string)=>{ const day=dayOf(at,zone); return day===today?t('today'):day===yesterday?t('yesterday'):madeDay(at,language,zone); };
 const [before,after]=own.channelRouteTip.split('@{0}');
 const tip=agents[0]?<>{before}<bdi className="mention">@{agents[0].name}</bdi>{after}</>:c('channelRouteTipPlain');
 const only=agents.filter(agent=>agent.only);
 const [onlyBefore,onlyAfter]=own[only.length>1?'channelShownHereMany':'channelShownHereOne'].split('{0}');
 const waiting=messages.find((message):message is Extract<ChannelMessage,{author:'person'}>=>message.author==='person'&&message.mention?.state==='open');
 return <div className="convo"><div className="chat">
  <HeadPill panel={panel} details={c('channelDetails')} face={<span className="hp-hash" aria-hidden="true"><ShellIcon name="hash"/></span>} title={name}/>
  <div className="transcript" ref={transcript}><div className="transcript__col">
   <div className="ch-intro">
    <span className="ch-intro__h">#<bdi>{name}</bdi></span>
    <span>{c(members.length===1?'channelMember':'channelMembers',count(members.length))} · {agents.length?<Names agents={agents} c={c}/>:c('channelNoAgents')}</span>
    <p><ShellIcon name="at"/><span>{tip}</span></p>
    {only.length>0&&<p className="ch-intro__only"><ShellIcon name="eye"/><span>{onlyBefore}<Names agents={only} c={c}/>{onlyAfter}</span></p>}
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
 </div><ChannelDetails panel={panel} name={name} person={person} record={record} tip={tip} c={c} refresh={refresh}/></div>;
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

const Initial=({name,size}:{name:string,size:number})=><span className="me__av lg-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;

// design-reference: renderTeamDetails; its "On the board" and "Handoffs" sections are not built.
function ChannelDetails({panel,name,person,record,tip,c,refresh}:{panel:DetailsPanel,name:string,person:string,record:ChannelRecord,tip:ReactNode,c:Say,refresh:()=>Promise<void>}) {
 const {t,language}=useI18n();
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const {channel,members,agents,manage,managers}=record;
 const team=channel.kind==='team';
 const [addingPerson,setAddingPerson]=useState(false); const [addingAgent,setAddingAgent]=useState(false);
 const [choices,setChoices]=useState<Choices|null>(null); const [failed,setFailed]=useState(false);
 const pick=async(open:boolean,set:(value:boolean)=>void)=>{
  set(open);
  if(open&&!choices) setChoices(await channelChoices(channel.company));
 };
 const change=async(made:{person:string,present:boolean}|{agent:string,present:boolean},opener:string)=>{
  const failure=await changeChannel(channel.company,channel.id,made);
  setFailed(!!failure);
  if(failure) return;
  if('person' in made) setAddingPerson(false); else setAddingAgent(false);
  await refresh();
  document.getElementById(opener)?.focus();
 };
 const remove=(id:string,label:string,made:{person:string,present:boolean}|{agent:string,present:boolean},opener:string)=>
  <button type="button" className="link-btn" id={id} aria-label={c('channelRemoveFrom',label)} onClick={()=>void change(made,opener)}>{c('channelRemove')}</button>;
 const addRow=(id:string,open:boolean,label:string,toggle:()=>void)=><li><button type="button" className="panel-row tm-add" id={id} aria-expanded={open} onClick={toggle}>
  <span className="panel-row__icon"><ShellIcon name={open?'x':'plus'}/></span><span className="panel-row__text"><span className="panel-row__t">{open?c('channelAddDone'):label}</span></span></button></li>;
 const personCandidates=(choices?.people||[]).filter(candidate=>!members.some(member=>member.person===candidate.person));
 const agentCandidates=(choices?.agents||[]).filter(candidate=>!agents.some(agent=>agent.id===candidate.id));
 const empty=(text:string)=><li className="panel-row"><span className="panel-row__text"><span className="panel-row__d">{text}</span></span></li>;
 const byName=managers.map(manager=>c(manager.role==='owner'?'channelByOwner':'channelByManager',manager.name));
 const managedBy=byName.length>1?`${byName.slice(0,-1).join(c('channelNamesJoin'))}${c('channelNamesLast')}${byName.at(-1)}`:byName[0]||'';
 return <DetailsShell panel={panel} label={c('channelDetails')} start={<span className="dp-top__l">{c('channelKind')}</span>}>
  <div className="dp-id">
   <span className="hp-hash hp-hash--xl" aria-hidden="true"><ShellIcon name="hash"/></span>
   <div><div className="dp-id__name">#<bdi>{name}</bdi></div><div className="dp-id__role">{c(members.length===1?'channelMember':'channelMembers',count(members.length))} · {c(agents.length===1?'channelAgent':'channelAgents',count(agents.length))}</div></div>
  </div>
  <div className="dp-sections">
   <section className="dp-sec" aria-labelledby="ch-h-p">
    <h3 className="dp-label" id="ch-h-p"><span>{t('members')} <span className="muted num">{count(members.length)}</span></span></h3>
    <ul className="panel-card">
     {members.map(member=><li key={member.person} className="panel-row"><Initial name={member.name} size={28}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{member.name}</bdi>{member.person===person&&<> <span className="ch-you">{c('channelYou')}</span></>}</span>
       <span className="panel-row__d">{t(roleKeys[member.role])}{member.role==='viewer'&&` · ${c('channelReadsOnly')}`}</span></span>
      {manage&&member.person!==person&&remove(`ch-rm-${member.person}`,member.name,{person:member.person,present:false},'ch-add-open')}</li>)}
     {manage&&addRow('ch-add-open',addingPerson,c('channelAddMember'),()=>void pick(!addingPerson,setAddingPerson))}
     {manage&&addingPerson&&choices&&(personCandidates.length?personCandidates.map(candidate=><li key={candidate.person} className="panel-row tm-cand"><Initial name={candidate.name} size={28}/>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{candidate.name}</bdi></span><span className="panel-row__d">{t(roleKeys[candidate.role])}</span></span>
      <button type="button" className="btn btn--secondary btn--sm" id={`ch-add-${candidate.person}`} onClick={()=>void change({person:candidate.person,present:true},'ch-add-open')}>{c('channelAdd')}</button></li>)
      :empty(c('channelEveryoneHere')))}
     {!team&&<li className="tm-hint"><ShellIcon name="team"/><span>{c('channelEveryone',name)}</span></li>}
    </ul>
   </section>
   <section className="dp-sec" aria-labelledby="ch-h-a">
    <h3 className="dp-label" id="ch-h-a"><span>{t('agents')} <span className="muted num">{count(agents.length)}</span></span></h3>
    <ul className="panel-card">
     {agents.length?agents.map(agent=><li key={agent.id} className="panel-row"><span aria-hidden="true"><CompanyAgentFace agent={agent} size={28}/></span>
      <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span>{agent.only?<span className="panel-row__d">{c('channelShownHere')}</span>:agent.speciality&&<span className="panel-row__d"><bdi>{agent.speciality}</bdi></span>}</span>
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
  </div>
 </DetailsShell>;
}
