'use client';
import { Fragment, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { settingLabelKey } from '@/lib/engine-setting-labels.mjs';
import type { WaitingChange } from '@/lib/agent-change-waiting.mjs';
import { holdLeave } from './settings-draft';
import { SettingsIcon } from './settings-icons';

// A catalogue sentence with its {n} filled by nodes, each isolated in its own direction (design-reference: bx).
const fill=(text:string,values:ReactNode[])=>text.split(/\{(\d+)\}/).map((part,index)=>index%2?<Fragment key={index}>{values[Number(part)]}</Fragment>:part);

// What would change, in the words of the reference's chgWhat ("New model: {model}") and the proposal card's rows (#19).
function What({change}:{change:Pick<WaitingChange,'change'|'setting'|'value'>}) {
 const {t}=useI18n();
 const shown=(value:unknown)=>value===true?t('settingsPendOn'):value===false?t('settingsPendOff'):String(value??'');
 if(change.change==='model') return <>{fill(t('settingsPendModel','{0}'),[<bdi key="m" dir="ltr">{String(change.value)}</bdi>])}</>;
 if(change.change==='instructions') return <>{t('settingsPendInstructions')}</>;
 const label=change.change==='toolset'?(change.setting==='delegation'?t('settingsPendSubagents'):<bdi>{change.setting}</bdi>)
  :change.setting&&settingLabelKey(change.setting)!=='settingUnknown'?t(settingLabelKey(change.setting)):<bdi>{change.setting}</bdi>;
 return <>{fill(t('settingsPendSetting','{0}','{1}'),[label,<bdi key="v" dir="auto">{shown(change.value)}</bdi>])}</>;
}

// Under an Agent's tabs while a change it was proposed waits (#178; design-reference: sovAgentHTML's .sov-pend): who
// proposed what, and for whom it waits: "your OK" for an Owner, the Owners by name for the person whose Conversation it
// came from. "Open the proposal" leaves Settings for that Conversation's card, or the Owner's item in "Waiting on you",
// held like every way out while the Agent's draft differs.
export function ProposalNote({change,owner,owners,href}:{change:WaitingChange,owner:boolean,owners:string[],href:string|null}) {
 const {t,language}=useI18n();
 const names=new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(owners);
 const values=[<bdi key="by">{change.by}</bdi>,<What key="what" change={change}/>,<bdi key="who">{names}</bdi>];
 const text=owner?t('settingsPendNote','{0}','{1}'):owners.length?t('settingsPendNoteOther','{0}','{1}','{2}'):t('settingsPendNoteAnyOwner','{0}','{1}');
 return <div className="sov-pend" role="note" id="sov-pend"><SettingsIcon name="clock"/><span>{fill(text,values)}</span>
  {href&&<Link className="link-btn" id="sov-pend-open" href={href} onClick={event=>{ if(holdLeave(t('settingsSaveFirst'))) event.preventDefault(); }}>{t('settingsPendOpen')}</Link>}</div>;
}

// The end of an Agent's row in the Agents list while a change waits for this Owner (design-reference: sovAgentsHTML).
export function ProposalMark() {
 const {t}=useI18n();
 return <span className="panel-row__meta panel-row__meta--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('settingsPendRow')}</span>;
}
