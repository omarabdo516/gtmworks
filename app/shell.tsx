import { getI18n } from '@/lib/i18n-server';
import AccountMenu from './account-menu';
import Link from '@/lib/link';
import { primaryNav, navGroups } from '@/lib/navigation';
import { roleAgents } from '@/lib/role-agents';
import { AgentRoleFace } from '@/components/agent-role-face';
import { agentIdentities } from '@/lib/agent-identities';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import Switcher from '@/app/c/[slug]/[[...section]]/switcher';
import RecentCards, { RecentCardsProvider } from './recent-cards';
import { NewConversation } from './conversation-composer';
import type { ReactNode } from 'react';
import { MobileBottomNav } from '@/components/paperclip/MobileBottomNav';
import { Layout } from '@/components/paperclip/Layout';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import { Fragment } from 'react';
type Crumb={label:string,href?:string};
import { SidebarNavItem } from '@/components/paperclip/SidebarNavItem';
import { SidebarSection } from '@/components/paperclip/SidebarSection';
import { Search, House, Inbox, Columns3, Folder, Repeat, Target, Library, Send, Users, ChartColumn, Lightbulb, Bot, Sparkles, Unplug, History, Settings, MessagesSquare } from 'lucide-react';
type Company = {id:string,slug:string,name:string};
const icons={search:Search,home:House,approvals:Inbox,'work/board':Columns3,projects:Folder,recurring:Repeat,campaigns:Target,library:Library,publishing:Send,sales:Users,performance:ChartColumn,strategy:Lightbulb,agents:Bot,skills:Sparkles,connections:Unplug,history:History,settings:Settings};
export default async function Shell({company,companies,section,title,crumbs,personName,role,agency,children,approvalCount=0,cardId}:{company?:Company,companies:Company[],section:string,title:string,crumbs?:Crumb[],personName:string,role:string,agency:boolean,children:ReactNode,approvalCount?:number,cardId?:number}) { const {t,theme}=await getI18n();
 const slug=company?.slug;
 function item([path,label]:readonly [string,string]) {
  const active=path==='work/board'?section.startsWith('work/')&&section!=='work/new':path==='settings'?section.startsWith('settings'):section===path;
  const Icon=icons[path as keyof typeof icons];
  return <SidebarNavItem key={path} active={active} href={`/c/${slug}/${path}`} icon={<Icon className="icon h-4 w-4" aria-hidden="true"/>} badge={path==='approvals'?approvalCount:undefined}>{t(label)}</SidebarNavItem>;
 }
 const sidebar=<aside className="sidebar"><div className="brand">gtm<span>works</span></div>{company&&<div className="switch-wrap"><Switcher companies={companies} slug={section==='all-brands'?'':company.slug} agency={agency} section={section==='all-brands'?'home':section}/></div>}<nav className="nav" aria-label={t('mainNavigation')}>{slug&&<>
  <div className="nav-primary">{company?.id&&<NewConversation slug={slug} company={company.id}/>}{primaryNav.map(item)}</div>
  {navGroups.map(group=><SidebarSection key={group.label} label={t(group.label)}>{group.items.map(item)}</SidebarSection>)}
  <SidebarSection label={t('agents')}><Link href={`/c/${slug}/agents`}><MessagesSquare className="icon h-4 w-4" aria-hidden="true"/>{t('companyChat')}</Link>{roleAgents.map(agent=><Link key={agent.key} className="role-agent" aria-label={t(agent.name)} href={`/c/${slug}/agents`}><AgentRoleFace agent={agent}/>{t(agent.name)}</Link>)}</SidebarSection>
  {company?.id&&<RecentCards key={company.id} slug={slug}/>}
 </>}</nav><div className="sidebar-bottom"><AccountMenu personName={personName} role={role} theme={theme}/>{slug&&item(['settings','settings'])}</div></aside>;
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title. Rendered on the server so it adds no route JavaScript.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 const frame=<Layout sidebar={sidebar} title={title} breadcrumb={breadcrumb} mobileNav={slug?<MobileBottomNav slug={slug} section={section} newConversation={company?.id?<NewConversation slug={slug} company={company.id} mobile/>:null} count={approvalCount}/>:undefined}>{children}</Layout>;
 return <AgentIdentitiesProvider agents={await agentIdentities()}>{company?.id?<RecentCardsProvider key={company.id} company={company.id} cardId={cardId}>{frame}</RecentCardsProvider>:frame}</AgentIdentitiesProvider>;
}
