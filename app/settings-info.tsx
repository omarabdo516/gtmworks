'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';

// Optional help in Settings (#614; DESIGN.md "Settings copy"): a row or a heading keeps its name and its control, and the
// longer explanation waits behind this small "i". A mouse resting on it, a keyboard landing on it, or a tap shows the
// text; Escape, moving away, a tap outside, or pressing it again hides it. The text stays in the page while hidden, so a
// field may still name it in aria-describedby and a screen reader reads it with the field.
//
// Open is three reasons, each kept apart so one ending does not end another: the pointer resting on it, the keyboard focus
// on it (or inside its text), and a press (click, tap, Enter or Space) that pins it. A press while pinned hides it, and
// Escape hides it wherever the focus is, without leaving Settings.
export function InfoTip({about,id,children}:{about:string,id?:string,children:ReactNode}) {
 const {t}=useI18n();
 const own=useId(); const panelId=id??`info-${own.replace(/:/g,'')}`;
 const [hovered,setHovered]=useState(false); const [focused,setFocused]=useState(false); const [pinned,setPinned]=useState(false);
 const box=useRef<HTMLSpanElement>(null); const pop=useRef<HTMLSpanElement>(null);
 const open=hovered||focused||pinned;
 const hide=()=>{ setHovered(false); setFocused(false); setPinned(false); };
 // A tap or a click anywhere else hides it; Escape hides it before Settings sees the key (the overlay leaves a key another
 // part took), also when the mouse opened it and the focus is elsewhere.
 useEffect(()=>{
  if(!open) return;
  const away=(event:PointerEvent)=>{ if(!box.current?.contains(event.target as Node)) hide(); };
  const escape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape') return;
   // Taken whole: neither Settings nor a field's own Escape (the knowledge editor's Cancel) gets the key that hid the help.
   event.preventDefault(); event.stopPropagation(); hide();
   if(box.current?.contains(document.activeElement)) box.current.querySelector('button')?.focus();
  };
  document.addEventListener('pointerdown',away);
  window.addEventListener('keydown',escape,true);
  return ()=>{ document.removeEventListener('pointerdown',away); window.removeEventListener('keydown',escape,true); };
 },[open]);
 // The text never runs off a phone's screen: once drawn, and whenever the window changes size, it moves back inside the
 // window's 16px gutter.
 useLayoutEffect(()=>{
  const panel=pop.current; if(!open||!panel) return;
  const place=()=>{
   panel.style.translate='';
   const gutter=16; const {left,right}=panel.getBoundingClientRect(); const width=document.documentElement.clientWidth;
   const shift=right>width-gutter?width-gutter-right:left<gutter?gutter-left:0;
   if(shift) panel.style.translate=`${shift}px 0`;
  };
  place(); window.addEventListener('resize',place);
  return ()=>window.removeEventListener('resize',place);
 },[open]);
 return <span className="info" ref={box}
  onPointerEnter={event=>{ if(event.pointerType==='mouse') setHovered(true); }}
  onPointerLeave={event=>{ if(event.pointerType==='mouse') setHovered(false); }}
  onBlur={event=>{ if(!box.current?.contains(event.relatedTarget as Node)) hide(); }}>
  <button type="button" className="info__btn" aria-label={t('settingsInfoAbout',about)} aria-expanded={open} aria-controls={panelId}
   // Focus shows the text only when it came from the keyboard; a click's focus is the press below.
   onFocus={event=>{ if(event.currentTarget.matches(':focus-visible')) setFocused(true); }}
   onClick={()=>{ if(pinned) hide(); else setPinned(true); }}>
   <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/></svg>
  </button>
  <span className="info__pop" id={panelId} role="note" ref={pop} hidden={!open}>{children}</span>
 </span>;
}

// Controls few people change (#614): kept under "Advanced", closed until the person opens it. A native disclosure, so
// pointer, keyboard and touch all open and close it, and its state is read out.
export function Advanced({id,children}:{id?:string,children:ReactNode}) {
 const {t,language}=useI18n();
 return <details className="set-adv" id={id}><summary className="set-adv__sum"><SettingsIcon name="forward" rtl={language==='ar'}/><span>{t('settingsAdvanced')}</span></summary><div className="set-adv__body">{children}</div></details>;
}
