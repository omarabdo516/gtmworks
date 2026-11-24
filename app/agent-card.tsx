// Lead's agent cards (design-reference: agentCardHTML).
import enText from '@/lib/messages/agent-card.en.json';
import arText from '@/lib/messages/agent-card.ar.json';
import { Fragment, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { AgentFace } from '@/components/agent-face';
import { Birth } from '@/components/face-moments';
import { useRequestAgent } from '@/lib/agent-looks-client';
import { ChangeLookLink } from '@/app/agent-look-window';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { markOf } from '@/lib/app-mark.mjs';
import { knownApp } from '@/lib/app-catalogue.mjs';
import { madeDay, useZone } from '@/app/agent-made';
import type { AgentRequestView, MadeAgent } from '@/lib/conversations';

// `cb` isolates each value in its own direction (a name or a reason in the other script).
export function useCardText() {
 const {language}=useI18n(); const own:Record<string,string>=language==='ar'?arText:enText;
 const c=(key:string,...values:unknown[])=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const cb=(key:string,...values:ReactNode[])=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 return {c,cb};
}

// The three things no Agent does without a person (ADR 0006, 0008).
const never=['madeAgentPublish','madeAgentSpend','madeAgentMessage'];
// A request names its apps in words, so its tile is the known app of that name, else the name's first letter (#577).
const appOf=(name:string)=>knownApp(name)??{key:'',mark:markOf(name)};
function AgentRows({job,apps,tiles=false,children}:{job:string,apps:string[]|null,tiles?:boolean,children?:ReactNode}) {
 const {c}=useCardText();
 return <dl className="kv ac-kv">
  <div className="kv__row"><dt>{c('madeAgentJob')}</dt><dd dir="auto">{job}</dd></div>
  {apps&&<div className="kv__row"><dt>{c('madeAgentApps')}</dt><dd>{tiles&&apps.length>0&&<span className="pp-tools">{apps.map((app,index)=><AppTile key={index} app={appOf(app)}/>)}</span>}{apps.length?apps.map((app,index)=><Fragment key={index}>{index>0&&c('madeAgentAppsJoin')}<bdi>{app}</bdi></Fragment>):c('madeAgentNoApps')}</dd></div>}
  <div className="kv__row"><dt>{c('madeAgentNever')}</dt><dd><ul className="ac-never">{never.map(key=><li key={key}><ShellIcon name="hand"/><span>{c(key)}</span></li>)}</ul></dd></div>
  {children}
 </dl>;
}

// `fresh`: Lead made it while the Conversation was open, so it rises in (design-reference: agentCardHTML's card-in).
export function MadeCard({slug,agent,fresh=false}:{slug:string,agent:MadeAgent,fresh?:boolean}) {
 const {t,language}=useI18n(); const zone=useZone(); const {c}=useCardText();
 return <div className={`ac-card${fresh?' card-in':''}`} role="group" aria-label={c('madeAgentLabel',agent.name)}>
  <div className="hcard__top"><span className="badge badge--made" data-utc={agent.fresh?undefined:zone}><ShellIcon name="check"/>{c('madeAgentMade')} · {agent.fresh?t('agentNew'):madeDay(agent.created_at,language,zone)}</span></div>
  <div className="card__head"><span aria-hidden="true" data-birth><AgentFace agent={agent.id} size={48}/></span><div className="card__titles"><span className="card__title"><bdi>{agent.name}</bdi></span></div></div>
  {agent.fresh&&<Birth agent={agent.id}/>}
  <AgentRows job={agent.job} apps={agent.apps}/>
  <div className="ac-actions"><Link className="btn btn--primary" href={`/c/${slug}/chat/${agent.id}`}>{c('madeAgentOpen',agent.name)}</Link><ChangeLookLink agent={agent}/></div>
  <p className="ac-tip"><ShellIcon name="chat"/><span>{c('madeAgentTip')}</span></p>
 </div>;
}

// A request has no Agent yet: its face is the look its Agent will be made with, asked for by the id that Agent will
// have (#696), so the request's card and the made Agent have one face. An `unread` request leaves out its
// apps and the message that asked, which could not be read, rather than show them empty.
export function RequestCard({slug,request,owner=false,unread=false,answer}:{slug:string,request:AgentRequestView,owner?:boolean,unread?:boolean,answer?:ReactNode}) {
 const {language}=useI18n(); const zone=useZone(); const {c,cb}=useCardText();
 const when=(at:string)=><time dateTime={at} data-utc={zone}>{new Date(at).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit',timeZone:zone})}</time>;
 const made=request.state==='made'?request.agent:null;
 const coming=useRequestAgent(request.id), madeAgent=made?.id??coming;
 const badge=request.state==='waiting'?<span className="badge badge--req"><ShellIcon name="userPlus"/>{owner?cb('requestBadgeFrom',request.askedBy):c('requestBadge')}</span>
  :request.state==='made'?<span className="badge badge--made"><ShellIcon name="check"/>{cb('requestBadgeMade',request.by)}</span>
  :<span className="badge"><ShellIcon name="x"/>{cb('requestBadgeDeclined',request.by)}</span>;
 const owners=new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(request.state==='waiting'?request.owners:[]);
 return <div className={`ac-card${request.state!=='made'?' ac-card--req':''}${request.state==='waiting'?'':' is-resolved'}`} role="group" aria-label={c('requestLabel',made?.name??request.name)} data-request={request.state}>
  <div className="hcard__top">{badge}</div>
  <div className="card__head"><span aria-hidden="true"><AgentFace agent={madeAgent} size={48}/></span><div className="card__titles"><span className="card__title"><bdi>{made?.name??request.name}</bdi></span></div></div>
  <AgentRows job={request.job} apps={unread?null:request.apps} tiles>
   <div className="kv__row"><dt>{c('requestAskedBy')}</dt><dd><bdi>{request.askedBy}</bdi>{!unread&&<span className="pp-sub" dir="auto">«{request.askedWith}»</span>}</dd></div>
   <div className="kv__row"><dt>{c('requestShowsFor')}</dt><dd>{cb('requestShowsForWho',request.askedBy)}</dd></div>
  </AgentRows>
  {request.state==='made'?<div className="card__outcome"><ShellIcon name="check"/><span>{cb('requestMade',request.by,when(request.at),made?.name??request.name,request.askedBy)}</span>
    {made&&<Link className="link-btn" href={`/c/${slug}/chat/${made.id}`}>{c('madeAgentOpen',made.name)}</Link>}</div>
   :request.state==='declined'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{cb('requestDeclined',request.by,when(request.at),request.reason)}</span></div>
   :owner?answer:<div className="card__outcome"><ShellIcon name="clock"/><span>{request.state==='waiting'&&!request.owners.length?cb('requestWaitingAnyOwner'):cb('requestWaiting',owners)}</span></div>}
 </div>;
}
