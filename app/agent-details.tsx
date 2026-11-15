'use client';
import '@/app/log.css';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as KeyEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { MadeLine } from '@/app/agent-made';
import type { Made } from '@/lib/agent-made';
import type { AgentDetailsView } from '@/app/agent-details-server';

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

// The chat's floating title (design-reference: .head-pill). With an Agent it is the button that shows its details.
export function HeadPill({panel,agent,face,title,titleDir}:{panel?:DetailsPanel,agent?:string,face:ReactNode,title:string,titleDir?:'auto'}) {
 const {t}=useI18n();
 const inside=<>{face}<span className="head-pill__title" dir={titleDir}>{title}</span></>;
 return <div className="chat__top"><h1 className="chat__h">{panel&&agent?<button type="button" className="head-pill" id="btn-details" aria-controls="details" aria-expanded={panel.expanded} aria-label={`${title} · ${t('chatDetailsOf',agent)}`} onClick={panel.toggle}>{inside}</button>:<span className="head-pill">{inside}</span>}</h1></div>;
}

const tabs=[{key:'activity',label:'chatTabActivity'},{key:'tasks',label:'chatTabTasks'},{key:'files',label:'chatTabFiles',soon:true},{key:'memory',label:'chatTabMemory',soon:true},{key:'log',label:'chatTabLog'}] as const;
type Tab=Exclude<(typeof tabs)[number],{soon:true}>['key'];
const open=tabs.filter((tab):tab is Extract<(typeof tabs)[number],{key:Tab}>=>!('soon' in tab));
const statusKeys={working:'agentStatusWorking',waiting:'agentStatusWaiting',idle:'agentStatusIdle'};

export function AgentDetails({panel,agent,details,settingsHref}:{panel:DetailsPanel,agent:DetailsAgent,details:AgentDetailsView,settingsHref:string}) {
 const {t,language}=useI18n(); const close=useRef<HTMLButtonElement>(null);
 const [tab,setTab]=useState<Tab>('activity');
 const covering=panel.overlay&&panel.expanded;
 const {close:hide}=panel;
 const done=useCallback(()=>{hide();document.getElementById('btn-details')?.focus();},[hide]);
 // Over the chat the panel takes the focus, and Escape gives it back to the title pill.
 useEffect(()=>{
  if(!covering) return;
  close.current?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape') done();};
  document.addEventListener('keydown',escape);
  return ()=>document.removeEventListener('keydown',escape);
 },[covering,done]);
 const move=(event:KeyEvent<HTMLButtonElement>)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  event.preventDefault();
  const step=(event.key==='ArrowLeft')===(language==='ar')?1:-1;
  const next=open[(open.findIndex(item=>item.key===tab)+step+open.length)%open.length].key;
  setTab(next); document.getElementById(`dp-tab-${next}`)?.focus();
 };
 return <>
  {covering&&<div className="dp-scrim" onClick={done}/>}
  <aside id="details" className={`details${covering?' is-open':''}`} aria-label={t('chatDetailsOf',agent.name)} hidden={!panel.overlay&&!panel.expanded}>
   <div className="dp-top">
    {details.actions&&<Link className="circle-btn" href={settingsHref} aria-label={t('chatAgentSettings',agent.name)} title={t('settings')}><ShellIcon name="gear"/></Link>}
    <button ref={close} type="button" className="circle-btn" aria-label={t('chatCloseDetails')} onClick={done}><ShellIcon name="x"/></button>
   </div>
   <div className="dp-scroll">
    <div className="dp-id">
     <span className="face-wrap face-wrap--lg" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/><span className={`dot dot--${details.status}`}/></span>
     <div>
      <div className="dp-id__name"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
      <div className="dp-id__role">{agent.speciality&&<><bdi>{agent.speciality}</bdi>{'\u00a0'}</>}<span className="dp-id__state">{agent.speciality&&'·\u00a0'}{t(statusKeys[details.status])}</span></div>
      {agent.made&&<MadeLine made={agent.made} where="panel"/>}
     </div>
    </div>
    <div className="segmented dp-tabs" role="tablist" aria-label={t('chatDetailsOf',agent.name)}>{tabs.map(item=>'soon' in item
     ?<button key={item.key} type="button" role="tab" id={`dp-tab-${item.key}`} aria-selected="false" aria-disabled="true" tabIndex={-1} title={t('soon')}>{t(item.label)}<span className="sr-only"> · {t('soon')}</span></button>
     :<button key={item.key} type="button" role="tab" id={`dp-tab-${item.key}`} aria-selected={tab===item.key} aria-controls="dp-panel" tabIndex={tab===item.key?0:-1} onClick={()=>setTab(item.key)} onKeyDown={move}>{t(item.label)}</button>)}</div>
    <div id="dp-panel" role="tabpanel" aria-labelledby={`dp-tab-${tab}`} className="dp-sections">{details.tabs[tab]}</div>
   </div>
  </aside>
 </>;
}
