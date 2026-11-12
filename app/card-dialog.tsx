'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { IssueDetail } from '@/components/paperclip/IssueDetail';
import { Dialog, DialogContent, DialogTitle } from '@/components/paperclip/ui/dialog';

// A dialog opened in place passes no returnTo and only clears its own state; the routed /work/new page passes one.
// gtmworks keeps its route-backed card editor and server actions inside this surface.
export function CardDialog({title,returnTo,children,creating=false,onClose}:{title:string,returnTo?:string,children:ReactNode,creating?:boolean,onClose?:()=>void}) {
 const router=useRouter();
 if(!creating) return <IssueDetail title={title}>{children}</IssueDetail>;
 return <Dialog open onOpenChange={open=>{if(!open){onClose?.();if(returnTo)router.push(returnTo);}}}><DialogContent aria-describedby={undefined} className="modal small-modal sm:max-w-lg max-h-[90dvh] overflow-y-auto">
  <DialogTitle asChild><h2 dir="auto" className="authored-title">{title}</h2></DialogTitle>{children}
 </DialogContent></Dialog>;
}
