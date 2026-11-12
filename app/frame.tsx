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
 useEffect(()=>{
  if(!open) return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);menu.current?.focus();}};
  document.addEventListener('keydown',close);
  return ()=>document.removeEventListener('keydown',close);
 },[open]);
 return <div className={`gw app-layout bg-background${chat?' is-chat':''}`}>
  <aside id="sidebar" className={`sidebar${open?' is-open':''}`} aria-label={t('mainMenu')} onClick={event=>{if((event.target as HTMLElement).closest('a')) setOpen(false);}}>{sidebar}</aside>
  <div className="scrim" hidden={!open} onClick={()=>{setOpen(false);menu.current?.focus();}}/>
  <div className="shell">
   <header className="topbar h-(--sz-60px) shrink-0 flex items-center gap-2 border-b border-border px-4 md:px-6">
    <button ref={menu} type="button" className="mobile-menu circle-btn md:hidden" aria-label={t('openMenu')} aria-controls="sidebar" aria-expanded={open} onClick={()=>setOpen(true)}><ShellIcon name="menu"/></button>
    {breadcrumb??<div className="heading m-0 min-w-0"><h1 className="text-sm font-medium uppercase tracking-wide">{title}</h1></div>}
   </header>
   <div className="app-content flex-1 min-h-0 overflow-auto">{children}</div>
  </div>
 </div>;
}
