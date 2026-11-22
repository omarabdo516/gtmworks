'use client';
import './tokens.css';
import './toast.css';
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { isolate } from '@/lib/bidi';
import { leave } from '@/lib/motion';

type ToastAction={label:string,run:()=>void};
type Toast={id:number,text:string,icon:ShellIconName,action?:ToastAction};
type ToastState={toast:Toast,leaving:boolean}|null;

// One toast at a time for the whole page (design-reference/app.js: toast). toastOut in toast.css runs 140ms.
let shown:ToastState=null;
let count=0;
let stop=()=>{};
const listeners=new Set<()=>void>();
function show(next:ToastState) { shown=next; listeners.forEach(listener=>listener()); }
function subscribe(listener:()=>void) { listeners.add(listener); return ()=>{ listeners.delete(listener); }; }

// The polite live region stays one element for the whole visit, so a toast is announced as a change to it. A modal
// dialog puts the rest of the page under it and makes it inert, so the region sits in the topmost open dialog: it moves
// when a toast is raised and whenever a dialog opens, closes or leaves the page with the region in it (Back from
// the card sheet unmounts it open), so a toast already showing follows the sheet in and survives it.
let region:HTMLDivElement|undefined;
function liveRegion() {
 if(!region) { region=document.createElement('div'); region.className='gw toast-host'; region.setAttribute('role','status'); region.setAttribute('aria-live','polite'); }
 return region;
}
function place() {
 const home=[...document.querySelectorAll('dialog[open]')].pop()??document.body;
 if(liveRegion().parentElement!==home) home.append(liveRegion());
}

// A new toast replaces the one showing and stops its clock, whichever step it is in. Its own clock starts once it is drawn
// (startClock): 2.8 seconds, or 6 with an action, before it leaves.
export function toast(text:string,{icon='check',action}:{icon?:ShellIconName,action?:ToastAction}={}) {
 place(); stop(); stop=()=>{};
 show({toast:{id:++count,text,icon,action},leaving:false});
}

// The clock runs from the frame the toast is first drawn in, not from the call (#561): a page busy drawing what an answer
// brought back can go seconds without a frame, and a toast timed from the call would come and go in them unseen. A page
// in a tab out of sight draws no frame either, so the toast waits there until the person comes back.
function startClock(current:Toast) {
 let timer:ReturnType<typeof setTimeout>|undefined;
 const frame=requestAnimationFrame(()=>{ timer=setTimeout(()=>{ stop=leave(140,()=>show({toast:current,leaving:true}),()=>show(null)); },current.action?6000:2800); });
 stop=()=>{ cancelAnimationFrame(frame); clearTimeout(timer); };
}

// Take the toast away now, as an action on it does once it has taken the person where they were going.
export function dismissToast() {
 stop();
 show(null);
}

export function ToastHost() {
 const {language}=useI18n();
 const state=useSyncExternalStore(subscribe,()=>shown,()=>null);
 // Each toast's clock starts when the host has put it on the page; a toast that replaced it has already stopped the last.
 const arrived=state&&!state.leaving?state.toast:null;
 useEffect(()=>{ if(arrived) startClock(arrived); },[arrived]);
 useEffect(()=>{
  place();
  const dialogs=new MutationObserver(place);
  dialogs.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  return ()=>{ dialogs.disconnect(); stop(); show(null); liveRegion().remove(); };
 },[]);
 if(!state) return null;
 const {toast:current,leaving}=state;
 return createPortal(<div key={current.id} className={`toast${leaving?' is-leaving':''}`}>
  <ShellIcon name={current.icon}/><span>{isolate(current.text,language==='ar')}</span>
  {current.action&&<button type="button" className="toast__act" onClick={current.action.run}>{current.action.label}</button>}
 </div>,liveRegion());
}
