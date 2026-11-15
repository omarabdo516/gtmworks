'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { MadeLine } from '@/app/agent-made';
import type { Made } from '@/lib/agent-made';

export type DetailsAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,made?:Made|null};
// The reference keeps the details beside the chat from 1024px up; below that they slide over it (design-reference:
// overlayDetails, @media (max-width: 1023px) .details).
const overlayQuery='(max-width: 1023px)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(overlayQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};
export type DetailsPanel={overlay:boolean,expanded:boolean,toggle:()=>void,close:()=>void};

// Beside the chat the panel starts open and the title pill hides or shows it; over the chat it starts closed and the
// pill opens it (design-reference: state.detailsOpen, toggle-details).
export function useDetailsPanel():DetailsPanel {
 const overlay=useSyncExternalStore(subscribe,()=>window.matchMedia(overlayQuery).matches,()=>false);
 const [beside,setBeside]=useState(true); const [over,setOver]=useState(false);
 const close=useCallback(()=>(overlay?setOver:setBeside)(false),[overlay]);
 return {overlay,expanded:overlay?over:beside,toggle:()=>(overlay?setOver:setBeside)(value=>!value),close};
}

// The chat's floating title (design-reference: .head-pill). With an Agent, or a channel's `details` label, it is the
// button that shows the details.
export function HeadPill({panel,agent,details,face,title,titleDir}:{panel?:DetailsPanel,agent?:string,details?:string,face:ReactNode,title:string,titleDir?:'auto'}) {
 const {t}=useI18n();
 const inside=<>{face}<span className="head-pill__title" dir={titleDir}>{title}</span></>;
 const label=details??(agent?t('chatDetailsOf',agent):undefined);
 return <div className="chat__top"><h1 className="chat__h">{panel&&label?<button type="button" className="head-pill" id="btn-details" aria-controls="details" aria-expanded={panel.expanded} aria-label={`${title} · ${label}`} onClick={panel.toggle}>{inside}</button>:<span className="head-pill">{inside}</span>}</h1></div>;
}

const tabs=['chatTabActivity','chatTabTasks','chatTabFiles','chatTabMemory','chatTabLog'];

export function DetailsShell({panel,label,start,children}:{panel:DetailsPanel,label:string,start:ReactNode,children:ReactNode}) {
 const {t}=useI18n(); const close=useRef<HTMLButtonElement>(null);
 const covering=panel.overlay&&panel.expanded;
 const {close:hide}=panel;
 const done=useCallback(()=>{hide();document.getElementById('btn-details')?.focus();},[hide]);
 useEffect(()=>{
  if(!covering) return;
  close.current?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape') done();};
  document.addEventListener('keydown',escape);
  return ()=>document.removeEventListener('keydown',escape);
 },[covering,done]);
 return <>
  {covering&&<div className="dp-scrim" onClick={done}/>}
  <aside id="details" className={`details${covering?' is-open':''}`} aria-label={label} hidden={!panel.overlay&&!panel.expanded}>
   <div className="dp-top">
    {start}
    <button ref={close} type="button" className="circle-btn" aria-label={t('chatCloseDetails')} onClick={done}><ShellIcon name="x"/></button>
   </div>
   <div className="dp-scroll">{children}</div>
  </aside>
 </>;
}

// The Agent's details (design-reference: #details, renderDetailsPanel): its settings and close buttons, its face,
// name, main mark, speciality and, for an Agent Lead made, when and at whose request (#13), then the five tabs. Activity, tasks, files, memory and log are not built yet (#20,
// #21), so the tabs are drawn but say "Soon".
export function AgentDetails({panel,agent,settingsHref}:{panel:DetailsPanel,agent:DetailsAgent,settingsHref:string}) {
 const {t}=useI18n();
 return <DetailsShell panel={panel} label={t('chatDetailsOf',agent.name)} start={<Link className="circle-btn" href={settingsHref} aria-label={t('chatAgentSettings',agent.name)} title={t('settings')}><ShellIcon name="gear"/></Link>}>
  <div className="dp-id">
   <span className="face-wrap face-wrap--lg" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/></span>
   <div>
    <div className="dp-id__name"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
    {agent.speciality&&<div className="dp-id__role"><bdi>{agent.speciality}</bdi></div>}
    {agent.made&&<MadeLine made={agent.made} where="panel"/>}
   </div>
  </div>
  <div className="segmented dp-tabs" role="group" aria-label={t('chatDetailsOf',agent.name)}>{tabs.map((key,index)=><button key={key} type="button" aria-disabled="true" title={t('soon')} data-first={index===0||undefined}>{t(key)}<span className="sr-only"> · {t('soon')}</span></button>)}</div>
  <p className="panel-empty dp-soon">{t('chatDetailsSoon')}</p>
 </DetailsShell>;
}
