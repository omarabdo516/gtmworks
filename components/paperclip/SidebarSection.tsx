'use client';
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { cn } from './utils';

// Paperclip's section header and disclosure, bound to our translated navigation.
// The glyph and the header height stay as they were; the button around the glyph is a 44px tap area
// that reaches up into the gap above the header, so it never covers a link.
export function SidebarSection({label,children}:{label:string,children:ReactNode}) {
 const [open,setOpen]=useState(true);
 const {t,language}=useI18n();
 return <Collapsible asChild open={open} onOpenChange={setOpen}>
  <section className="nav-group gap-0" aria-label={label}>
   <div className="group/sidebar-section relative px-3 py-1.5 pointer-coarse:py-1">
    <div className="flex min-h-6 min-w-0 items-center gap-1">
     <CollapsibleTrigger asChild><button type="button" data-slot="icon-button" className="group/toggle absolute -start-3 -top-2 flex h-11 w-11 items-start justify-start pt-4 ps-2 pointer-coarse:-top-3 pointer-coarse:pt-4.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1" aria-label={t(open?'collapseGroup':'expandGroup',label)}>
      <span className="flex h-5 w-5 items-center justify-center rounded-sm transition-colors group-hover/toggle:bg-accent">
       <ChevronRight aria-hidden="true" className={cn('h-3 w-3 shrink-0 text-muted-foreground/60 transition-all opacity-0 max-md:opacity-100 group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:opacity-100',open?'rotate-90':language==='ar'&&'rotate-180')}/>
      </span>
     </button></CollapsibleTrigger>
     <div className="inline-flex min-w-0 max-w-full items-center px-1 py-0.5"><h2 className={cn('m-0 p-0 text-(length:--text-nano) font-medium uppercase leading-normal text-muted-foreground',language==='ar'?'tracking-normal':'tracking-widest font-mono')}>{label}</h2></div>
    </div>
   </div>
   <CollapsibleContent><div className="flex flex-col gap-0.5 mt-0.5">{children}</div></CollapsibleContent>
  </section>
 </Collapsible>;
}
