'use client';
import { createContext, Fragment, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { sections } from '@/lib/navigation';
import { ShellIcon } from '@/components/shell-icon';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import Switcher from '@/app/c/[slug]/[[...section]]/switcher';
import ApprovalsCount from './approvals-count';
import { Frame } from './frame';

type Crumb={label:string,href?:string};
// What a page tells the Shell that its address does not: the trail naming an open Card, the Agent of an open
// Conversation, the Card a sheet shows and the count of what waits on the reader as the page read it.
type Told={crumbs?:Crumb[],agentId?:string,cardId?:number,approvals?:number|Promise<number>};
type Place={section:string,chat:boolean,agentId?:string,conversationId?:string,channelId?:string,cardId?:number};

const settingsLeaf:Record<string,string>={'settings/members':'members','settings/work':'workSettings'};

// The page a Company's address shows, read from the layout's segments, so the Shell drawn once by the layout
// (app/c/[slug]/layout.tsx, #789) marks the page as the page itself used to: on the server's first paint as after a move.
// The page slot's default is drawn only at Settings' own address (app/c/[slug]/default.tsx).
function placeOf(segments:string[],lead?:string):Place {
 if(segments.includes('__DEFAULT__')) return {section:'settings',chat:false};
 const parts=segments.flatMap(segment=>segment.split('/')).filter(part=>part&&!part.startsWith('__'));
 const [first,second,third]=parts;
 if(first==='chat') return {section:'chat',chat:true,agentId:second||lead};
 if(first==='conversations') return second?{section:'conversations',chat:true,conversationId:second}:{section:'all-conversations',chat:false};
 if(first==='channels') return {section:'channels',chat:true,channelId:second};
 if(first==='work'&&second==='board'&&third) return {section:'work/board',chat:false,cardId:Number(third)};
 return {section:parts.join('/')||'home',chat:false};
}

type ShellState={company:{name:string,slug:string},place:Place,told:Told,tell:(told:Told|null)=>void,approvals:Promise<number>};
const ShellContext=createContext<ShellState|null>(null);

export function ShellPageProvider({company,lead,approvals,children}:{company:{name:string,slug:string},lead?:string,approvals:Promise<number>,children:ReactNode}) {
 const [told,setTold]=useState<Told>({});
 const segments=useSelectedLayoutSegments();
 const key=segments.join('\n');
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const place=useMemo(()=>placeOf(segments,lead),[key,lead]);
 // One `tell` for the provider's life, so a page's word does not ask to be said again each time it is heard.
 const tell=useCallback((next:Told|null)=>setTold(next??{}),[]);
 const state=useMemo(()=>({company,place,told,tell,approvals}),[company,place,told,tell,approvals]);
 return <ShellContext.Provider value={state}>{children}</ShellContext.Provider>;
}

const home:Place={section:'home',chat:false};

// The open page as the Shell marks it: its section, whether it is a chat, and what is open on it. Drawn outside a
// Company's layout (a component test), the page is the Company's Home with nothing open.
export function useShellPage() {
 const state=useContext(ShellContext);
 const place=state?.place??home;
 const told=state?.told??{};
 return {...place,agentId:told.agentId??place.agentId,cardId:told.cardId??place.cardId,crumbs:told.crumbs,approvals:told.approvals};
}

// A page's word to the Shell (app/shell.tsx); it says nothing while the page shows, and its word ends with the page.
export function ShellPage({crumbs,agentId,cardId,approvals}:Told) {
 const state=useContext(ShellContext);
 const tell=state?.tell;
 const key=JSON.stringify({crumbs,agentId,cardId,count:typeof approvals==='number'?approvals:null});
 useLayoutEffect(()=>{
  if(!tell) return;
  tell({crumbs,agentId,cardId,approvals});
  return ()=>tell(null);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tell,key,approvals]);
 return null;
}

export function ShellFrame({sidebar,children}:{sidebar:ReactNode,children:ReactNode}) {
 const {t}=useI18n();
 const state=useContext(ShellContext);
 const page=useShellPage();
 const slug=state?.company.slug;
 const leaf=settingsLeaf[page.section];
 const crumbs=page.crumbs??(leaf&&state?[{label:state.company.name,href:`/c/${slug}/home`},{label:t('settings'),href:`/c/${slug}/settings`},{label:t(leaf)}]:undefined);
 const title=page.section==='log'?t('activityLog'):page.section==='numbers'?t('numbers'):page.section==='all-conversations'?t('allConversations'):t(sections[page.section]??sections.settings);
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 return <Frame sidebar={sidebar} title={page.chat?t('chats'):title} breadcrumb={page.chat?undefined:breadcrumb} chat={page.chat}>{children}</Frame>;
}

// The Company switcher keeps the open section when another Company is chosen; a chat opens the other's Home.
export function ShellSwitcher({companies}:{companies:{slug:string,name:string}[]}) {
 const state=useContext(ShellContext); const page=useShellPage();
 return <Switcher companies={companies} slug={state?.company.slug??''} section={page.chat?'home':page.section}/>;
}

export function ShellNavItem({path,label,icon}:{path:string,label:string,icon:Parameters<typeof ShellIcon>[0]['name']}) {
 const {t}=useI18n(); const state=useContext(ShellContext); const page=useShellPage();
 const active=path==='chat'?page.chat:path==='work/board'?page.section.startsWith('work/'):page.section===path;
 return <Link className="sb-item" href={`/c/${state?.company.slug}/${path}`} aria-current={active?'page':undefined}><ShellIcon name={icon}/><span className="od-fill">{t(label)}</span></Link>;
}

export function ShellAllConversations() {
 const {t}=useI18n(); const state=useContext(ShellContext); const page=useShellPage();
 return <Link className="sb-item sb-all" href={`/c/${state?.company.slug}/conversations`} aria-current={page.section==='all-conversations'?'page':undefined}><ShellIcon name="archive"/><span className="od-fill">{t('allConversations')}</span><ShellIcon name="chevron"/></Link>;
}

// The approvals entry beside Marketing board (app/approvals-count.tsx): the count the open page read, or the layout's
// while none has.
export function ShellApprovals() {
 const {t}=useI18n(); const state=useContext(ShellContext); const page=useShellPage();
 return <ApprovalsCount slug={state?.company.slug??''} current={page.section==='approvals'} count={page.approvals??state?.approvals??0} t={t}/>;
}
