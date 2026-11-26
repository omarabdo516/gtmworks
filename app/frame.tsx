'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { onComposerFocus, takeComposerFocus } from '@/lib/composer-focus';
import { opensPage, pageShown } from '@/lib/page-fade';
import { useShellPlace } from './shell-place';

const narrowQuery='(max-width: 767px)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(narrowQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};

// The reference's frame: the sidebar beside the page, and below 768px a drawer that slides in over a scrim.
// One sidebar is rendered for both, so its links and menus exist once. The frame is drawn once by the Company's layout
// (#789) and stays while its pages change under it; each page draws its own top bar and content (PageFrame) inside it.
type Drawer={open:boolean,setOpen:(open:boolean)=>void,covered:boolean,menu:RefObject<HTMLButtonElement|null>};
const DrawerContext=createContext<Drawer>({open:false,setOpen:()=>{},covered:false,menu:{current:null}});

export function Frame({sidebar,chat,children}:{sidebar:ReactNode,chat?:boolean,children:ReactNode}) {
 const {t}=useI18n();
 // A chat page (a chat, a Conversation, a channel) lays the frame out for its thread; the place says which page is shown.
 const place=useShellPlace(); const isChat=chat??place.chat;
 const [open,setOpen]=useState(false);
 const menu=useRef<HTMLButtonElement>(null);
 const pathname=usePathname();
 // A new page closes the drawer, whatever opened it (a link, Back, a redirect).
 const [shown,setShown]=useState(pathname);
 if(shown!==pathname) { setShown(pathname); setOpen(false); }
 const drawer=useRef<HTMLElement>(null); const shell=useRef<HTMLDivElement>(null);
 // "N" (app/new-chat-key) closes the drawer, as a new page does.
 useEffect(()=>onComposerFocus(()=>setOpen(false)),[]);
 // On a narrow screen the open drawer covers the page: the page behind it (all but the menu button) is inert, so
 // neither the keyboard nor assistive technology reaches it.
 const narrow=useSyncExternalStore(subscribe,()=>window.matchMedia(narrowQuery).matches,()=>false);
 const covered=open&&narrow;
 const wasOpen=useRef(false);
 // While the drawer covers the page it holds the keyboard: focus moves into it, Tab and Shift+Tab wrap inside it,
 // Escape closes it, and closing it in any way gives focus back to the menu button. While it covers the page it is
 // announced as a modal dialog; beside the page it stays a labelled landmark.
 useEffect(()=>{
  // Closing gives focus back to the menu button, unless a new chat's composer waits for it or has already taken it.
  if(!open) {
   if(wasOpen.current) { const composer=shell.current?.querySelector<HTMLTextAreaElement>('.app-content .composer__input');
    if(composer&&takeComposerFocus(location.pathname+location.search)) composer.focus();
    else if(!document.activeElement||document.activeElement===document.body||drawer.current?.contains(document.activeElement)) menu.current?.focus(); }
   wasOpen.current=false; return;
  }
  wasOpen.current=true;
  const targets=()=>Array.from(drawer.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')||[]).filter(node=>node.getClientRects().length>0);
  targets()[0]?.focus();
  const keys=(event:KeyboardEvent)=>{
   // An open modal dialog (the apps sheet opened from the drawer, or any other) holds the keyboard: its Escape closes it alone.
   if(document.querySelector('dialog:modal')) return;
   if(event.key==='Escape') { setOpen(false); return; }
   // Tab wraps only while the drawer covers the page; beside a wide page the sidebar lets the keyboard walk on.
   if(event.key!=='Tab'||!window.matchMedia(narrowQuery).matches) return;
   const list=targets(); if(!list.length) return;
   const first=list[0],last=list[list.length-1],inside=drawer.current?.contains(document.activeElement);
   if(event.shiftKey&&(document.activeElement===first||!inside)) { event.preventDefault(); last.focus(); }
   else if(!event.shiftKey&&(document.activeElement===last||!inside)) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[open]);
 const value=useMemo(()=>({open,setOpen,covered,menu}),[open,covered]);
 return <div className={`gw app-layout bg-background${isChat?' is-chat':''}`}>
  <aside ref={drawer} id="sidebar" className={`sidebar${open?' is-open':''}`} aria-label={t('mainMenu')} role={covered?'dialog':undefined} aria-modal={covered||undefined}>{sidebar}</aside>
  <div className="scrim" hidden={!open} onClick={()=>setOpen(false)}/>
  <div ref={shell} className="shell"><DrawerContext value={value}>{children}</DrawerContext></div>
 </div>;
}

// A page inside the frame: its top bar (the menu button that opens the drawer, and the page's title or its trail) and
// its content. A page's loading frame (app/c/[slug]/loading.tsx) is one too, drawn the moment a link is pressed; it
// takes no part in the page's fade, which the page plays when it arrives.
export function PageFrame({title,breadcrumb,loading=false,children}:{title:string,breadcrumb?:ReactNode,loading?:boolean,children:ReactNode}) {
 const {t}=useI18n();
 const {open,setOpen,covered,menu}=useContext(DrawerContext);
 const pathname=usePathname();
 const content=useRef<HTMLDivElement>(null);
 // A new page fades in, as the reference's setView replays its view's fadeIn (app/shell.css .app-content.view-enter).
 // A page of another route fades as its frame mounts; within one route (another Agent's chat, the board's tabs) the
 // class is taken off and put back before the new page paints. A redraw of the same page (a poll, a save, the details
 // panel, a search change), a frame mounting again on the page it showed and a new chat going on as its Conversation
 // leave it alone (lib/page-fade).
 const [enters]=useState(()=>!loading&&opensPage(pathname));
 const faded=useRef<string|null>(null);
 useLayoutEffect(()=>{
  if(loading) return;
  const first=faded.current===null;
  if(faded.current===pathname) return;
  faded.current=pathname;
  if(!pageShown(pathname)||first) return;
  const region=content.current; if(!region) return;
  region.classList.remove('view-enter'); void region.offsetWidth; region.classList.add('view-enter');
 },[pathname,loading]);
 return <>
  <header className="topbar h-(--sz-60px) shrink-0 flex items-center gap-2 border-b border-border px-4 md:px-6">
   <button ref={menu} type="button" className="mobile-menu circle-btn md:hidden" aria-label={t('openMenu')} aria-controls="sidebar" aria-expanded={open} onClick={()=>setOpen(true)}><ShellIcon name="menu"/></button>
   <div className="contents" inert={covered}>{breadcrumb??<div className="heading m-0 min-w-0"><h1 className="text-sm font-medium uppercase tracking-wide">{title}</h1></div>}</div>
  </header>
  <div ref={content} className={`app-content${enters?' view-enter':''} flex-1 min-h-0 overflow-auto`} inert={covered} aria-busy={loading||undefined}>{children}</div>
 </>;
}
