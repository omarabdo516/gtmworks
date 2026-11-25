'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/paperclip/ui/dialog';

// The New card dialog: opened in place it passes no returnTo and only clears its own state; the routed /work/new page
// passes one. A Card itself opens in its window (app/card-window.tsx, #678).
export function CardDialog({title,returnTo,children,onClose}:{title:string,returnTo?:string,children:ReactNode,onClose?:()=>void}) {
 const router=useRouter();
 return <Dialog open onOpenChange={open=>{if(!open){onClose?.();if(returnTo)router.push(returnTo);}}}><DialogContent aria-describedby={undefined} className="modal small-modal sm:max-w-lg max-h-[90dvh] overflow-y-auto">
  <DialogTitle asChild><h2 dir="auto" className="authored-title">{title}</h2></DialogTitle>{children}
 </DialogContent></Dialog>;
}
