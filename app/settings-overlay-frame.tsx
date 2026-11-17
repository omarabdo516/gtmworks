'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { SettingsIcon } from './settings-icons';
import { leaveOverlay, returnFocusTo, takeReturnFocus } from './settings-opener';

// Kept apart from the overlay's controls (settings-overlay-client.tsx), which import server actions, so the frame and
// its close button alone are a client module that a component test can render.
// The full-window overlay (reference: dialog#sov): it holds the keyboard's first stop and closes on Escape.
export function OverlayFrame({slug,initialFocus,children}:{slug:string,initialFocus?:string,children:ReactNode}) {
 const router=useRouter();
 const box=useRef<HTMLDivElement>(null);
 // Opening moves focus into the overlay: to the element the page names (an Agent's page: its Settings tab, as the
 // reference's openSov does), else the dialog itself, so Tab starts at its close button and section list.
 useEffect(()=>{ if(!box.current?.contains(document.activeElement)) ((initialFocus&&document.getElementById(initialFocus))||box.current)?.focus({preventScroll:true}); },[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  const keys=(event:globalThis.KeyboardEvent)=>{ if(event.key==='Escape'&&!event.defaultPrevented) router.push(leaveOverlay(slug)); };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[router,slug]);
 return <div className="gw sov-root"><div ref={box} className="sov" role="dialog" aria-modal="true" aria-labelledby="sov-title" tabIndex={-1}>{children}</div></div>;
}

export function CloseButton({slug}:{slug:string}) {
 const {t}=useI18n(); const router=useRouter();
 return <button type="button" className="circle-btn" id="sov-close" aria-label={t('settingsCloseLabel')} title={t('settingsCloseTitle')} onClick={()=>router.push(leaveOverlay(slug))}><SettingsIcon name="x"/></button>;
}

// From an Agent's page back to the Agents list, where that Agent's row takes the focus (reference: sov-agent-back and
// "Back" in The job).
export function BackLink({slug,agent,id,className,children}:{slug:string,agent:string,id?:string,className:string,children:ReactNode}) {
 return <Link className={className} id={id} href={overlayHref(slug,'agents')} replace onClick={()=>returnFocusTo(`sov-ag-${agent}`)}>{children}</Link>;
}

// Drawn in the Agents list: gives the focus to the row of the Agent whose page was just left.
export function FocusReturn() {
 useEffect(()=>{ const id=takeReturnFocus(stored=>stored.startsWith('sov-ag-')); if(id) document.getElementById(id)?.focus(); },[]);
 return null;
}
