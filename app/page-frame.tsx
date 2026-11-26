import { Fragment, type ReactNode } from 'react';
import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import { PageFrame } from './frame';
import { PageMarks } from './shell-place';
type Crumb={label:string,href?:string};

// A page of a Company inside the Shell its layout draws (#789): its top bar with its title, or the trail of its crumbs,
// and its content. `agent` and `card` name what the address does not say of the page, for the sidebar's marks: the Agent
// of the open chat or Conversation, the Card open over the board.
export default async function Page({title,crumbs,agent,card,children}:{title:string,crumbs?:Crumb[],agent?:string,card?:number,children:ReactNode}) {
 const {t}=await getI18n();
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title. Rendered on the server so it adds no route JavaScript.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 return <><PageMarks agent={agent} card={card}/><PageFrame title={title} breadcrumb={breadcrumb}>{children}</PageFrame></>;
}
