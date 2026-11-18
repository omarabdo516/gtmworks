'use client';
import '@/app/log.css';
import { Suspense, memo, use, useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as KeyEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { MadeLine } from '@/app/agent-made';
import type { Made } from '@/lib/agent-made';
import { onComposerFocus } from '@/lib/composer-focus';
import { pickTab, statusKeys, type DetailsTab } from '@/lib/agent-details.mjs';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { rememberOpener, takeReturnFocus } from '@/app/settings-opener';
import type { AgentDetailsView } from '@/app/agent-details-server';

export type DetailsAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,made?:Made|null};
// The reference keeps the details beside the chat from 1024px up; below that they slide over it (design-reference:
// overlayDetails, @media (max-width: 1023px) .details).
const overlayQuery='(max-width: 1023px)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(overlayQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};
export type DetailsPanel={overlay:boolean,expanded:boolean,toggle:()=>void,open:()=>void,close:()=>void};

// Beside the chat the panel starts open and the title pill hides or shows it; over the chat it starts closed and the
// pill opens it (design-reference: state.detailsOpen, toggle-details).
export function useDetailsPanel():DetailsPanel {
 const overlay=useSyncExternalStore(subscribe,()=>window.matchMedia(overlayQuery).matches,()=>false);
 const [beside,setBeside]=useState(true); const [over,setOver]=useState(false);
 const close=useCallback(()=>(overlay?setOver:setBeside)(false),[overlay]);
 const open=useCallback(()=>(overlay?setOver:setBeside)(true),[overlay]);
 return {overlay,expanded:overlay?over:beside,toggle:()=>(overlay?setOver:setBeside)(value=>!value),open,close};
}

// The chat's floating title (design-reference: .head-pill). With an Agent, or a channel's `details` label, it is the
// button that shows the details. `corner` sits in the bar's end corner (design-reference: .chat__corner).
export function HeadPill({panel,agent,details,face,title,titleDir,corner}:{panel?:DetailsPanel,agent?:string,details?:string,face:ReactNode,title:string,titleDir?:'auto',corner?:ReactNode}) {
 const {t}=useI18n();
 const inside=<>{face}<span className="head-pill__title" dir={titleDir}>{title}</span></>;
 const label=details??(agent?t('chatDetailsOf',agent):undefined);
 return <div className="chat__top"><h1 className="chat__h">{panel&&label?<button type="button" className="head-pill" id="btn-details" aria-controls="details" aria-expanded={panel.expanded} aria-label={`${title} · ${label}`} onClick={panel.toggle}>{inside}</button>:<span className="head-pill">{inside}</span>}</h1>{corner}</div>;
}

const tabs=[{key:'activity',label:'chatTabActivity'},{key:'tasks',label:'chatTabTasks'},{key:'files',label:'chatTabFiles'},{key:'memory',label:'chatTabMemory'},{key:'log',label:'chatTabLog'}] as const;
type Tab=(typeof tabs)[number]['key'];
const open=tabs;

// The frame every details panel shares (an Agent's, a channel's): over the chat it takes the focus, and Escape gives
// it back to the title pill.
export function DetailsShell({panel,label,start,children}:{panel:DetailsPanel,label:string,start:ReactNode,children:ReactNode}) {
 const {t}=useI18n(); const close=useRef<HTMLButtonElement>(null);
 const covering=panel.overlay&&panel.expanded;
 const {close:hide}=panel;
 const done=useCallback(()=>{hide();document.getElementById('btn-details')?.focus();},[hide]);
 // "N" (app/new-chat-key) closes the details over the chat, as the reference's setView does, so the composer it focuses is
 // not left behind them.
 useEffect(()=>covering?onComposerFocus(hide):undefined,[covering,hide]);
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

// `details` may still be on its way (the chat page streams it, decision 0042): the panel is drawn at once with the Agent,
// and what its reads give (the state, the tab's lists) takes its place when they arrive. `tab` is then the open tab.
type Details=AgentDetailsView|Promise<AgentDetailsView>;
export function AgentDetails({panel,agent,details,tab:first,slug}:{panel:DetailsPanel,agent:DetailsAgent,details:Details,tab?:DetailsTab,slug:string}) {
 const {t,language}=useI18n();
 const [tab,setTab]=useState<Tab>(()=>pickTab(first??(details as AgentDetailsView).tab) as Tab);
 // Back from the Agent's settings the gear takes the focus again (reference: the overlay's close); over the chat the
 // panel starts closed, so it opens first. This runs after the panel's own focus on its close button. The first
 // hydrated render reads the window as wide (the server's answer), so it waits until the width is the real one.
 const back=useRef<boolean|null>(null);
 const {overlay,expanded,open:show}=panel;
 useEffect(()=>{
  back.current??=takeReturnFocus(id=>id==='dp-settings')!==null;
  if(!back.current||window.matchMedia(overlayQuery).matches!==overlay) return;
  if(overlay&&!expanded) { show(); return; }
  document.getElementById('dp-settings')?.focus(); back.current=false;
 },[overlay,expanded,show]);
 const move=(event:KeyEvent<HTMLButtonElement>)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  event.preventDefault();
  const step=(event.key==='ArrowLeft')===(language==='ar')?1:-1;
  const next=open[(open.findIndex(item=>item.key===tab)+step+open.length)%open.length].key;
  setTab(next); document.getElementById(`dp-tab-${next}`)?.focus();
 };
 return <DetailsShell panel={panel} label={t('chatDetailsOf',agent.name)} start={<Link className="circle-btn" id="dp-settings" href={overlayHref(slug,'agents',{agent:agent.id})} aria-haspopup="dialog" aria-label={t('chatAgentSettings',agent.name)} title={t('settings')} onClick={()=>rememberOpener('dp-settings')}><ShellIcon name="gear"/></Link>}>
  <div className="dp-id">
   <span className="face-wrap face-wrap--lg" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/><Later details={details} part="dot"/></span>
   <div>
    <div className="dp-id__name"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
    <div className="dp-id__role">{agent.speciality&&<><bdi>{agent.speciality}</bdi>{'\u00a0'}</>}<span className="dp-id__state">{agent.speciality&&'·\u00a0'}<Later details={details} part="state"/></span></div>
    {agent.made&&<MadeLine made={agent.made} where="panel"/>}
   </div>
  </div>
  <div className="segmented dp-tabs" role="tablist" aria-label={t('chatDetailsOf',agent.name)}>{tabs.map(item=>
   <button key={item.key} type="button" role="tab" id={`dp-tab-${item.key}`} aria-selected={tab===item.key} aria-controls="dp-panel" tabIndex={tab===item.key?0:-1} onClick={()=>setTab(item.key)} onKeyDown={move}>{t(item.label)}</button>)}</div>
  <div id="dp-panel" role="tabpanel" aria-labelledby={`dp-tab-${tab}`} className="dp-sections"><Later details={details} part={tab}/></div>
 </DetailsShell>;
}

// One part of the details once they are read; until then an idle state and an empty tab. Kept apart (memo), so the panel
// drawn again while a part still streams in does not draw that part a second time beside its streamed copy (#172).
const Later=memo(function Later({details,part}:{details:Details,part:'dot'|'state'|Tab}) {
 return 'then' in details?<Suspense fallback={part==='dot'||part==='state'?<Part view={{status:'idle'}} part={part}/>:null}><Read details={details} part={part}/></Suspense>:<Part view={details} part={part}/>;
});
const Read=({details,part}:{details:Promise<AgentDetailsView>,part:'dot'|'state'|Tab})=><Part view={use(details)} part={part}/>;
function Part({view,part}:{view:Pick<AgentDetailsView,'status'>&Partial<AgentDetailsView>,part:'dot'|'state'|Tab}) {
 const {t}=useI18n();
 if(part==='dot') return <span className={`dot dot--${view.status}`}/>;
 if(part==='state') return <>{t(statusKeys[view.status])}</>;
 return <>{view.tabs?.[part]}</>;
}
