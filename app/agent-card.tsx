// Lead's agent cards (design-reference: agentCardHTML): an Agent Lead made, and a Member's request for one (#17) as the
// Member who asked and the Owner who answers see it. Their strings live in agent-card.en.json and agent-card.ar.json,
// loaded only by the Conversation and "Waiting on you".
import enText from '@/lib/messages/agent-card.en.json';
import arText from '@/lib/messages/agent-card.ar.json';
import { Fragment, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { madeDay, useZone } from '@/app/agent-made';
import type { AgentRequestView, MadeAgent } from '@/lib/conversations';

// The card's own text: `c` fills its values, `cb` isolates each value in its own direction (a name or a reason in the
// other script).
export function useCardText() {
 const {language}=useI18n(); const own:Record<string,string>=language==='ar'?arText:enText;
 const c=(key:string,...values:unknown[])=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const cb=(key:string,...values:ReactNode[])=>own[key].split(/\{(\d+)\}/).map((part,index)=>index%2?<bdi key={index}>{values[Number(part)]}</bdi>:part);
 return {c,cb};
}

// Its job, its apps, and the three things no Agent does without a person (ADR 0006, 0008).
const never=['madeAgentPublish','madeAgentSpend','madeAgentMessage'];
function AgentRows({job,apps,children}:{job:string,apps:string[],children?:ReactNode}) {
 const {c}=useCardText();
 return <dl className="kv ac-kv">
  <div className="kv__row"><dt>{c('madeAgentJob')}</dt><dd dir="auto">{job}</dd></div>
  <div className="kv__row"><dt>{c('madeAgentApps')}</dt><dd>{apps.length?apps.map((app,index)=><Fragment key={index}>{index>0&&c('madeAgentAppsJoin')}<bdi>{app}</bdi></Fragment>):c('madeAgentNoApps')}</dd></div>
  <div className="kv__row"><dt>{c('madeAgentNever')}</dt><dd><ul className="ac-never">{never.map(key=><li key={key}><ShellIcon name="hand"/><span>{c(key)}</span></li>)}</ul></dd></div>
  {children}
 </dl>;
}

// An Agent Lead made: "Made", with "New" until the person who asked opens it and its day after that; and the way into
// its own chat.
export function MadeCard({slug,agent}:{slug:string,agent:MadeAgent}) {
 const {t,language}=useI18n(); const zone=useZone(); const {c}=useCardText();
 return <div className="ac-card" role="group" aria-label={c('madeAgentLabel',agent.name)}>
  <div className="hcard__top"><span className="badge badge--made" data-utc={agent.fresh?undefined:zone}><ShellIcon name="check"/>{c('madeAgentMade')} · {agent.fresh?t('agentNew'):madeDay(agent.created_at,language,zone)}</span></div>
  <div className="card__head"><span aria-hidden="true"><CompanyAgentFace agent={agent} size={44}/></span><div className="card__titles"><span className="card__title"><bdi>{agent.name}</bdi></span></div></div>
  <AgentRows job={agent.job} apps={agent.apps}/>
  <div className="ac-actions"><Link className="btn btn--primary" href={`/c/${slug}/chat/${agent.id}`}>{c('madeAgentOpen',agent.name)}</Link></div>
  <p className="ac-tip"><ShellIcon name="chat"/><span>{c('madeAgentTip')}</span></p>
 </div>;
}

// A Member's request: dashed while it is not an Agent. The Member who asked sees it wait for the Owner, then the answer
// in place: made, with the way into the Agent, or the Owner's no with the reason. The Owner sees who asked and why, and
// answers with `answer`. A request has no Agent yet, so its face is drawn from the request until one is made.
export function RequestCard({slug,request,owner=false,answer}:{slug:string,request:AgentRequestView,owner?:boolean,answer?:ReactNode}) {
 const {language}=useI18n(); const {c,cb}=useCardText();
 const when=(at:string)=><time dateTime={at}>{new Date(at).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit'})}</time>;
 const made=request.state==='made'?request.agent:null;
 const badge=request.state==='waiting'?<span className="badge badge--req"><ShellIcon name="userPlus"/>{owner?cb('requestBadgeFrom',request.askedBy):c('requestBadge')}</span>
  :request.state==='made'?<span className="badge badge--made"><ShellIcon name="check"/>{cb('requestBadgeMade',request.by)}</span>
  :<span className="badge"><ShellIcon name="x"/>{cb('requestBadgeDeclined',request.by)}</span>;
 const owners=new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(request.state==='waiting'?request.owners:[]);
 return <div className={`ac-card${request.state!=='made'?' ac-card--req':''}${request.state==='waiting'?'':' is-resolved'}`} role="group" aria-label={c('requestLabel',made?.name??request.name)} data-request={request.state}>
  <div className="hcard__top">{badge}</div>
  <div className="card__head"><span aria-hidden="true"><CompanyAgentFace agent={made??{connection_id:`agent-request-${request.id}`,name:request.name}} size={44}/></span><div className="card__titles"><span className="card__title"><bdi>{made?.name??request.name}</bdi></span></div></div>
  <AgentRows job={request.job} apps={request.apps}>
   <div className="kv__row"><dt>{c('requestAskedBy')}</dt><dd><bdi>{request.askedBy}</bdi><span className="pp-sub" dir="auto">«{request.askedWith}»</span></dd></div>
   <div className="kv__row"><dt>{c('requestShowsFor')}</dt><dd>{cb('requestShowsForWho',request.askedBy)}</dd></div>
  </AgentRows>
  {request.state==='made'?<div className="card__outcome"><ShellIcon name="check"/><span>{cb('requestMade',request.by,when(request.at),made?.name??request.name,request.askedBy)}</span>
    {made&&<Link className="link-btn" href={`/c/${slug}/chat/${made.id}`}>{c('madeAgentOpen',made.name)}</Link>}</div>
   :request.state==='declined'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{cb('requestDeclined',request.by,when(request.at),request.reason)}</span></div>
   :owner?answer:<div className="card__outcome"><ShellIcon name="clock"/><span>{cb('requestWaiting',owners)}</span></div>}
 </div>;
}
