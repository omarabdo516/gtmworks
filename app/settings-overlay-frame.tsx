'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { closeTarget } from '@/lib/settings-overlay.mjs';
import { SettingsIcon } from './settings-icons';
import { openedFrom as storedFrom } from './settings-opener';

// Kept apart from the overlay's controls (settings-overlay-client.tsx), which import server actions, so the frame and
// its close button alone are a client module that a component test can render.
// The full-window overlay (reference: dialog#sov): it holds the keyboard's first stop and closes on Escape.
export function OverlayFrame({slug,children}:{slug:string,children:ReactNode}) {
 const router=useRouter();
 const box=useRef<HTMLDivElement>(null);
 // Opening moves focus into the overlay (the dialog itself), so Tab starts at its close button and section list.
 useEffect(()=>{ if(!box.current?.contains(document.activeElement)) box.current?.focus({preventScroll:true}); },[]);
 useEffect(()=>{
  const keys=(event:globalThis.KeyboardEvent)=>{ if(event.key==='Escape'&&!event.defaultPrevented) router.push(closeTarget(storedFrom(),slug)); };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[router,slug]);
 return <div className="gw sov-root"><div ref={box} className="sov" role="dialog" aria-modal="true" aria-labelledby="sov-title" tabIndex={-1}>{children}</div></div>;
}

export function CloseButton({slug}:{slug:string}) {
 const {t}=useI18n(); const router=useRouter();
 return <button type="button" className="circle-btn" id="sov-close" aria-label={t('settingsCloseLabel')} title={t('settingsCloseTitle')} onClick={()=>router.push(closeTarget(storedFrom(),slug))}><SettingsIcon name="x"/></button>;
}
