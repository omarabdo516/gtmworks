import { useCallback, useEffect, useRef, useState } from 'react';

// The one place that asks whether the person wants less motion (design-reference/app.js: reduced, later). Read at the
// moment of use, so a change of the setting applies to the next scroll or wait without a reload.
export function prefersReducedMotion(): boolean {
 return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A wait before the page moves on: at most 120ms for a person who wants less motion. Returns the timer, for clearTimeout.
export function later(ms:number,run:()=>void): number {
 return window.setTimeout(run,prefersReducedMotion()?Math.min(ms,120):ms);
}

// Something that leaves with the design's exit animation (design-reference: closeSheet, toast): its leaving look starts
// and it is gone once the animation has run; with reduced motion it is gone at once, with no leaving look. Returns what
// cancels a removal still pending.
export function leave(ms:number,start:()=>void,gone:()=>void):()=>void {
 if(prefersReducedMotion()) { gone(); return ()=>{}; }
 start();
 const timer=window.setTimeout(gone,ms);
 return ()=>clearTimeout(timer);
}

// The design's dialog leave (#130; design-reference: closeModal, closeDlg, sovClose): 190ms on the leave curve.
export const dialogLeaveMs=190;

// A part that leaves before what closing leads to (design-reference: closeModal and closeDlg add is-closing, wait, then
// close; openSheet cancels a leave still running). `close(then)` marks it closing, keeps it in the page while its leave
// runs, then marks it gone and runs `then`; with reduced motion it is gone and `then` runs at once, never closing. A
// second close during the leave adds nothing; `cancel` (the part opened again) stops the leave and draws it open. A
// leave still running when the part unmounts runs nothing after.
export function useLeave(ms:number=dialogLeaveMs) {
 const [state,setState]=useState<'open'|'closing'|'gone'>('open');
 const leaving=useRef(false); const stop=useRef(()=>{});
 useEffect(()=>()=>stop.current(),[]);
 const close=useCallback((then:()=>void)=>{
  if(leaving.current) return;
  leaving.current=true;
  stop.current=leave(ms,()=>setState('closing'),()=>{ stop.current=()=>{}; setState('gone'); then(); });
 },[ms]);
 const cancel=useCallback(()=>{ stop.current(); stop.current=()=>{}; leaving.current=false; setState('open'); },[]);
 return {closing:state==='closing',gone:state==='gone',close,cancel};
}
