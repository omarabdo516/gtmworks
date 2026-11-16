'use client';
import './tokens.css';
import './toast.css';
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { isolate } from '@/lib/bidi';
import { leave } from '@/lib/leave';

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
// dialog puts the rest of the page under it and makes it inert, so before each toast the region moves into the
// topmost open dialog, and out again when that dialog closes (the card sheet closes, then the page changes).
let region:HTMLDivElement|undefined;
function liveRegion() {
 if(!region) { region=document.createElement('div'); region.className='gw toast-host'; region.setAttribute('role','status'); region.setAttribute('aria-live','polite'); }
 return region;
}
function place() {
 const home=[...document.querySelectorAll('dialog[open]')].pop()??document.body;
 if(liveRegion().parentElement!==home) home.append(liveRegion());
 if(home instanceof HTMLDialogElement) home.addEventListener('close',place,{once:true});
}

// A new toast replaces the one showing and stops its clock, whichever step it is in, then starts its own: 2.8 seconds,
// or 6 with an action, before it leaves.
export function toast(text:string,{icon='check',action}:{icon?:ShellIconName,action?:ToastAction}={}) {
 place(); stop();
 const current:Toast={id:++count,text,icon,action};
 show({toast:current,leaving:false});
 const timer=setTimeout(()=>{ stop=leave(140,()=>show({toast:current,leaving:true}),()=>show(null)); },action?6000:2800);
 stop=()=>clearTimeout(timer);
}

export function ToastHost() {
 const {language}=useI18n();
 const state=useSyncExternalStore(subscribe,()=>shown,()=>null);
 useEffect(()=>{ place(); return ()=>{ stop(); show(null); liveRegion().remove(); }; },[]);
 if(!state) return null;
 const {toast:current,leaving}=state;
 return createPortal(<div key={current.id} className={`toast${leaving?' is-leaving':''}`}>
  <ShellIcon name={current.icon}/><span>{isolate(current.text,language==='ar')}</span>
  {current.action&&<button type="button" className="toast__act" onClick={current.action.run}>{current.action.label}</button>}
 </div>,liveRegion());
}
