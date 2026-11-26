'use client';
import { useEffect, useRef, useState } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { waitingLabel } from '@/lib/sidebar.mjs';

// The pill's name: Approvals while its count is on its way, then how many things wait.
const label=(t:(key:string,...values:unknown[])=>string,count?:number)=>{ const [key,...values]=count===undefined?['approvals']:waitingLabel(count); return t(key,...values); };
import { useShellPlace } from './shell-place';
import { useSidebarApprovals } from './sidebar-live';

// The sidebar's count of what waits on the reader (app/approvals-count.tsx). When it is drawn again during a visit with a
// higher count than before, it pops once (#131; design-reference: syncWaitMarks, .sb-count.is-pop); a page load, a count
// that falls or stays, and a count still on its way do not. The pill is drawn once per Company (keyed by its address),
// so another Company's count is never read as a rise. A second rise takes the class off for a frame, so the pop plays
// again on the same link and the keyboard keeps its place on it.
export function CountPill({href,current:drawn,count}:{href:string,current?:boolean,count?:number}) {
 const {t}=useI18n();
 // Current while Waiting on you is the page shown (app/shell-place).
 const place=useShellPlace(); const current=drawn??place.section==='approvals';
 // The sidebar's poll counts again while a page stays open (#789); until it answers, the Shell's count stands.
 const polled=useSidebarApprovals(); if(polled!==undefined) count=polled;
 const seen=useRef<number|undefined>(undefined);
 const [pop,setPop]=useState(false);
 useEffect(()=>{
  if(count===undefined) return;
  const before=seen.current; seen.current=count;
  if(before===undefined) return;
  if(count<=before) { setPop(false); return; }
  setPop(false);
  const frame=requestAnimationFrame(()=>setPop(true));
  return ()=>cancelAnimationFrame(frame);
 },[count]);
 return <Link className={`sb-count${count?'':' sb-count--none'}${pop?' is-pop':''}`} href={href} aria-current={current?'page':undefined} aria-label={label(t,count)}><span className="sb-count__n">{count}</span></Link>;
}
