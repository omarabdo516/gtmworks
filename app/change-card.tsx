'use client';
// A change an Agent proposed to its own settings, or Lead to another Agent's (#19; design-reference: chgHTML, chgWhat,
// waitLineHTML): who proposed it for whom, what would change, the value after the Owner's OK and the reason. While it
// waits, an Owner sees "Waiting on you" and the answer (`answer`); anyone else the wait line naming the Owners. Answered,
// it says who approved or declined and when, with the reason of a decline. A proposal of something that cannot be
// proposed says so and waits on nobody. The card follows the interface's direction; every value keeps its own.
import { type ReactNode } from 'react';
import { useCardText } from '@/app/agent-card';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { settingLabelKey } from '@/lib/engine-setting-labels.mjs';
import { madeDay, useZone } from '@/app/agent-made';
import { dayOf } from '@/lib/activity-log.mjs';
import type { ChangeProposalView } from '@/lib/conversations';

export function ChangeCard({change,owner=false,unread=false,answer}:{change:ChangeProposalView,owner?:boolean,unread?:boolean,answer?:ReactNode}) {
 const {t,language}=useI18n(); const zone=useZone(); const {c,cb}=useCardText();
 // Today its time, another day its day, as the other cards of a chat say when they were answered.
 const when=(at:string)=><time dateTime={at} data-utc={zone}>{dayOf(new Date().toISOString(),zone)===dayOf(at,zone)
  ?new Date(at).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit',timeZone:zone}):madeDay(at,language,zone)}</time>;
 const shown=(value:unknown)=>value===true?c('changeOn'):value===false?c('changeOff'):String(value??'');
 // A proposal read in part names what would change and nothing of its value.
 const what=change.change==='model'?(unread?t('settingModel'):cb('changeModel',String(change.value))):change.change==='instructions'?c('changeInstructions')
  :change.change==='toolset'?(change.setting==='delegation'?c('changeSubagents'):<bdi>{change.setting}</bdi>):change.setting&&settingLabelKey(change.setting)!=='settingUnknown'?t(settingLabelKey(change.setting)):<bdi>{change.setting}</bdi>;
 const self=change.by.id===change.agent.id;
 const owners=new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(change.state==='waiting'?change.owners:[]);
 const badge=change.state==='waiting'?(owner?<span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{c('changeBadgeYou')}</span>
   :<span className="badge"><ShellIcon name="clock"/>{change.owners.length?cb('changeBadgeOwner',owners):c('changeBadgeAnyOwner')}</span>)
  :<span className="badge"><ShellIcon name={change.state==='approved'?'check':'x'}/>{c(change.state==='approved'?'changeBadgeApproved':change.state==='declined'?'changeBadgeDeclined':'changeBadgeRefused')}</span>;
 const outcome=change.state==='approved'?<div className="card__outcome"><ShellIcon name="check"/><span>{change.change==='model'
   ?cb('changeApprovedModel',change.answeredBy,when(change.at),change.agent.name,String(change.value)):cb('changeApproved',change.answeredBy,when(change.at),change.agent.name)}</span></div>
  :change.state==='declined'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{change.answer?cb('changeDeclinedReason',change.answeredBy,when(change.at),change.answer):cb('changeDeclined',change.answeredBy,when(change.at))}</span></div>
  :change.state==='refused'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{c('changeRefused')}</span></div>
  :owner?answer:<div className="card__outcome"><ShellIcon name="clock"/><span>{change.owners.length?cb('changeWaiting',owners):c('changeWaitingAnyOwner')}</span></div>;
 return <div id={`change-${change.id}`} className={`ac-card chg-card${change.state==='waiting'?'':' is-resolved'}`} role="group" aria-label={c('changeLabel',change.agent.name)} data-change={change.state}>
  <div className="hcard__top">{badge}</div>
  <div className="card__head"><span aria-hidden="true"><CompanyAgentFace agent={change.agent} size={44}/></span>
   <div className="card__titles"><span className="card__title">{cb('changeTitle',change.agent.name)}</span>
    <span className="card__sub">{self?cb('changeSelf',change.agent.name):cb('changeFor',change.by.name,change.agent.name)}</span></div></div>
  <dl className="kv ac-kv pp-kv">
   <div className="kv__row"><dt>{c('changeRow')}</dt><dd>{what}</dd></div>
   {!unread&&<div className="kv__row"><dt>{c('changeAfter')}</dt><dd dir="auto" className={change.change==='instructions'?'chg-text':undefined}>{shown(change.value)}</dd></div>}
   {!unread&&<div className="kv__row"><dt>{c('changeWhy')}</dt><dd dir="auto">{change.reason}</dd></div>}
  </dl>
  {outcome}
 </div>;
}
