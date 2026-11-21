'use client';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { SettingsIcon } from './settings-icons';
import { leaveOverlay, returnFocusTo, takeReturnFocus } from './settings-opener';
import { holdLeave } from './settings-draft';
import { useLeave } from '@/lib/motion';

// Kept apart from the overlay's controls (settings-overlay-client.tsx), which import server actions, so the frame and
// its close button alone are a client module that a component test can render.

// Closing the overlay, as its close button and Escape do: a draft that differs keeps the page (the bar flashes and Save
// takes the focus); otherwise the overlay leaves with the dialog's exit and only then returns to the page it was opened
// from (#130; design-reference: sovClose). The overlay stays mounted from one section to the next, so moving between
// them plays neither its entrance nor its leave.
const CloseOverlay=createContext<()=>void>(()=>{});

// The full-window overlay (reference: dialog#sov): it holds the keyboard's first stop and closes on Escape.
export function OverlayFrame({slug,initialFocus,children}:{slug:string,initialFocus?:string,children:ReactNode}) {
 const router=useRouter();
 const {t}=useI18n();
 const box=useRef<HTMLDivElement>(null);
 const leaving=useLeave();
 const {close:leaveThen}=leaving;
 const close=useCallback(()=>{ if(!holdLeave(t('settingsSaveFirst'))) leaveThen(()=>router.push(leaveOverlay(slug))); },[leaveThen,router,slug,t]);
 // Opening moves focus into the overlay: to the element the page names (an Agent's page: its Settings tab, as the
 // reference's openSov and sov-agent do, also when a row of the list opens it), else the dialog itself, so Tab starts at
 // its close button and section list. Focus already inside (a list row taking it back) stays.
 // A field a lazy section draws a moment later (Good morning's Time, #183's "Change the time") is waited for, briefly,
 // and focused once it is there.
 useEffect(()=>{
  const named=initialFocus&&document.getElementById(initialFocus);
  if(named) { named.focus({preventScroll:true}); return; }
  if(!box.current?.contains(document.activeElement)) box.current?.focus({preventScroll:true});
  if(!initialFocus||!box.current) return;
  // A person who has moved into another field meanwhile keeps it: the wait ends, and the focus stays where they put it.
  const frame=box.current;
  const watch=new MutationObserver(()=>{
   const active=document.activeElement;
   if(active&&active!==frame&&active!==document.body&&frame.contains(active)) { watch.disconnect(); return; }
   const late=document.getElementById(initialFocus); if(late) { watch.disconnect(); late.focus(); late.scrollIntoView({block:'center'}); }
  });
  watch.observe(box.current,{childList:true,subtree:true});
  const stop=setTimeout(()=>watch.disconnect(),3000);
  return ()=>{ watch.disconnect(); clearTimeout(stop); };
 },[initialFocus]);
 useEffect(()=>{
  const keys=(event:globalThis.KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented) return;
   close();
  };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[close]);
 // While it leaves nothing in it can be pressed (a section link would move the page the leave is about to leave); once the
 // leave has run it is taken out, so the page behind shows while the address moves back to it.
 return <CloseOverlay.Provider value={close}><div className="gw sov-root" hidden={leaving.gone}><div ref={box} className={`sov${leaving.closing?' is-closing':''}`} inert={leaving.closing||undefined} role="dialog" aria-modal="true" aria-labelledby="sov-title" tabIndex={-1}>{children}</div></div></CloseOverlay.Provider>;
}

export function CloseButton() {
 const {t}=useI18n(); const close=useContext(CloseOverlay);
 return <button type="button" className="circle-btn" id="sov-close" aria-label={t('settingsCloseLabel')} title={t('settingsCloseTitle')} onClick={close}><SettingsIcon name="x"/></button>;
}

// From an Agent's page back to the Agents list, where that Agent's row takes the focus (reference: sov-agent-back and
// "Back" in The job). A draft that differs keeps the page, as every way out does.
export function BackLink({slug,agent,id,className,children}:{slug:string,agent:string,id?:string,className:string,children:ReactNode}) {
 const {t}=useI18n();
 return <Link className={className} id={id} href={overlayHref(slug,'agents')} replace onClick={event=>{ if(holdLeave(t('settingsSaveFirst'))) { event.preventDefault(); return; } returnFocusTo(`sov-ag-${agent}`); }}>{children}</Link>;
}

// From a Skill's page back to Learning, where the learned Skill's own link takes the focus (reference: sov-skill-back,
// design-reference/app.js 7585). The skill page's own Back is the first stop when it opens (OverlayFrame).
export function SkillBack({slug,agent,skill,rtl}:{slug:string,agent:string,skill:string,rtl:boolean}) {
 const {t}=useI18n();
 return <Link className="link-btn sov-back" id="sov-skill-back" href={overlayHref(slug,'learning')} replace onClick={()=>returnFocusTo(`ln-see-${agent}:${skill}`)}><SettingsIcon name="back" rtl={rtl}/><span>{t('settingsLearning')}</span></Link>;
}

// Drawn in a list: gives the focus back to the row whose page was just left, when that row is on this page.
export function FocusReturn({prefix='sov-ag-'}:{prefix?:string}={}) {
 useEffect(()=>{ const id=takeReturnFocus(stored=>stored.startsWith(prefix)); if(id) document.getElementById(id)?.focus(); },[prefix]);
 return null;
}
