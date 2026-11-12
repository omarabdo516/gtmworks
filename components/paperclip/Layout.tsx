'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from './ui/sheet';

const subscribe=(notify:()=>void)=>{
 const media=window.matchMedia('(max-width:767px)');
 media.addEventListener('change',notify);
 return ()=>media.removeEventListener('change',notify);
};
// Paperclip Layout/BreadcrumbBar: the product supplies navigation and page content.
export function Layout({sidebar,title,breadcrumb,children,mobileNav}:{sidebar:ReactNode,title:string,breadcrumb?:ReactNode,children:ReactNode,mobileNav?:ReactNode}) {
 const {t,language}=useI18n();
 const [open,setOpen]=useState(false);
 const isMobile=useSyncExternalStore(subscribe,()=>window.matchMedia('(max-width:767px)').matches,()=>false);
 return <Sheet open={open&&isMobile} onOpenChange={setOpen}><div className="app-layout flex h-dvh overflow-hidden bg-background">
  {!isMobile&&<div className="desktop-sidebar shrink-0">{sidebar}</div>}
  {isMobile&&<>
   <SheetContent side={language==='ar'?'right':'left'} className="mobile-sidebar gap-0 p-0 w-[240px]" showCloseButton={false} onClick={event=>{if((event.target as HTMLElement).closest('a')) setOpen(false);}}>
    <SheetTitle className="sr-only">{t('mainNavigation')}</SheetTitle><SheetDescription className="sr-only">{t('chooseCompany')}</SheetDescription>{sidebar}
   </SheetContent>
  </>}
  <div className="shell flex min-w-0 flex-1 flex-col">
   <header className="topbar h-(--sz-60px) shrink-0 flex items-center border-b border-border px-4 md:px-6">
    <SheetTrigger asChild><Button variant="ghost" size="icon-sm" className="mobile-menu me-2 md:hidden" aria-label={t('openSidebar')}><Menu className="h-5 w-5"/></Button></SheetTrigger>
    {breadcrumb??<div className="heading m-0"><h1 className="text-sm font-medium uppercase tracking-wide">{title}</h1></div>}
   </header>
   <div className="app-content flex-1 min-h-0 overflow-auto">{children}</div>
  </div>{mobileNav}
 </div></Sheet>;
}
