'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';

// The reference's frame: the sidebar beside the page, and below 768px a drawer that slides in over a scrim.
// One sidebar is rendered for both, so its links and menus exist once.
export function Frame({sidebar,title,breadcrumb,chat=false,children}:{sidebar:ReactNode,title:string,breadcrumb?:ReactNode,chat?:boolean,children:ReactNode}) {
 const {t}=useI18n();
 const [open,setOpen]=useState(false);
 const menu=useRef<HTMLButtonElement>(null);
 const pathname=usePathname();
 // A new page closes the drawer, whatever opened it (a link, Back, a redirect).
 const [shown,setShown]=useState(pathname);
 if(shown!==pathname) { setShown(pathname); setOpen(false); }
 const drawer=useRef<HTMLElement>(null);
 const wasOpen=useRef(false);
 // While the drawer covers the page it holds the keyboard: focus moves into it, Tab and Shift+Tab wrap inside it,
 // Escape closes it, and closing it in any way gives focus back to the menu button.
 useEffect(()=>{
  if(!open) { if(wasOpen.current) menu.current?.focus(); wasOpen.current=false; return; }
  wasOpen.current=true;
  const targets=()=>Array.from(drawer.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')||[]).filter(node=>node.getClientRects().length>0);
  targets()[0]?.focus();
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape') { setOpen(false); return; }
   if(event.key!=='Tab') return;
   const list=targets(); if(!list.length) return;
   const first=list[0],last=list[list.length-1],inside=drawer.current?.contains(document.activeElement);
   if(event.shiftKey&&(document.activeElement===first||!inside)) { event.preventDefault(); last.focus(); }
   else if(!event.shiftKey&&(document.activeElement===last||!inside)) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[open]);
 return <div className={`gw app-layout bg-background${chat?' is-chat':''}`}>
  <aside ref={drawer} id="sidebar" className={`sidebar${open?' is-open':''}`} aria-label={t('mainMenu')} onClick={event=>{if((event.target as HTMLElement).closest('a')) setOpen(false);}}>{sidebar}</aside>
  <div className="scrim" hidden={!open} onClick={()=>setOpen(false)}/>
  <div className="shell">
   <header className="topbar h-(--sz-60px) shrink-0 flex items-center gap-2 border-b border-border px-4 md:px-6">
    <button ref={menu} type="button" className="mobile-menu circle-btn md:hidden" aria-label={t('openMenu')} aria-controls="sidebar" aria-expanded={open} onClick={()=>setOpen(true)}><ShellIcon name="menu"/></button>
    {breadcrumb??<div className="heading m-0 min-w-0"><h1 className="text-sm font-medium uppercase tracking-wide">{title}</h1></div>}
   </header>
   <div className="app-content flex-1 min-h-0 overflow-auto">{children}</div>
  </div>
 </div>;
}
