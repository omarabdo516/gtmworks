'use client';
import { House, CircleCheck, Users, Inbox } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { Badge } from './ui/badge';
import { useMobileNavVisibility } from './useMobileNavVisibility';
import { cn } from './utils';
export function MobileBottomNav({slug,section,newConversation,count}:{slug:string,section:string,newConversation:ReactNode,count:number}) {
 const {t}=useI18n();
 const visible=useMobileNavVisibility(true,`${slug}/${section}`);
 const links=[{path:'home',label:'home',icon:House},{path:'work/board',label:'work',icon:CircleCheck},{path:'agents',label:'agents',icon:Users},{path:'approvals',label:'inbox',icon:Inbox}];
 // New sits in the middle, as in the approved prototype; it opens the composer instead of a page.
 const items=newConversation?[...links.slice(0,2),{path:'new',label:'conversationNew',icon:House},...links.slice(2)]:links;
 return <nav className="mobile-bottom-nav fixed bottom-0 start-0 end-0 z-30 bg-muted md:hidden pb-[env(safe-area-inset-bottom)]" data-visible={visible} inert={!visible} aria-label={t('mobileNavigation')}>
  <div className="grid h-16 px-1" style={{gridTemplateColumns:`repeat(${items.length},minmax(0,1fr))`}}>
   {items.map(({path,label,icon:Icon})=>path==='new'?<Fragment key={path}>{newConversation}</Fragment>:<Link key={path} href={`/c/${slug}/${path}`} aria-current={section===path?'page':undefined} className={cn('relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors',section===path?'text-foreground':'text-muted-foreground hover:text-foreground')}><span className="relative"><Icon className="h-[18px] w-[18px]"/>{path==='approvals'&&count>0&&<Badge variant="ghost" className="absolute -end-2 -top-2 bg-primary px-1.5 text-[10px] leading-none text-primary-foreground">{count>99?t('moreThan99'):count}</Badge>}</span><span className="truncate">{t(label)}</span></Link>)}
  </div>
 </nav>;
}
