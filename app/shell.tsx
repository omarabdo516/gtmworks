import './shell.css';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import AccountMenu, { ThemeToggle } from './account-menu';
import Link from '@/lib/link';
import { shellNav } from '@/lib/navigation';
import { orderAgents } from '@/lib/sidebar.mjs';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { agentIdentities } from '@/lib/agent-identities';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import Switcher from '@/app/c/[slug]/[[...section]]/switcher';
import RecentCards, { RecentCardsProvider } from './recent-cards';
import RecentChats from './recent-chats';
import { Frame } from './frame';
import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import { Fragment } from 'react';
type Crumb={label:string,href?:string};
type Company = {id:string,slug:string,name:string};
type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean};

// The frame every screen sits in (design-reference: #sidebar). From the top: the Company, search and a new chat with
// Lead; the four entries; the Agents with Lead first; this person's recent chats and cards; the account and theme.
// `agentId` and `conversationId` mark the open Conversation in the sidebar.
export default async function Shell({company,companies,section,title,crumbs,personName,role,agency,children,approvalCount=0,cardId,agentId,conversationId}:{company?:Company,companies:Company[],section:string,title:string,crumbs?:Crumb[],personName:string,role:string,agency:boolean,children:ReactNode,approvalCount?:number,cardId?:number,agentId?:string,conversationId?:string}) { const {t,theme}=await getI18n();
 const slug=company?.slug;
 const chat=section==='chat'||section==='conversations';
 const db=await supabase();
 const agents=company?.id?orderAgents(((await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name')).data||[]) as Agent[]):[];
 const conversations=company?.id?(await db.from('conversations').select('id,agent_name,created_at').eq('company_id',company.id).order('created_at',{ascending:false}).limit(20)).data||[]:[];
 const firsts=conversations.length?(await db.from('conversation_messages').select('conversation_id,body').in('conversation_id',conversations.map(c=>c.id)).eq('author','person').order('id').limit(500)).data||[]:[];
 // A chat is named by the first line of its first message, as its own page names it (lib/conversations titleOf).
 const chats=conversations.map(c=>({id:c.id,created_at:c.created_at,title:firsts.find(m=>m.conversation_id===c.id)?.body.split('\n')[0]||c.agent_name}));
 const active=(path:string)=>path==='chat'?chat:path==='work/board'?section.startsWith('work/'):section===path;
 const sidebar=<>
  <div className="sb-top">
   <div className="ws">
    <svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    {company?<Switcher companies={companies} slug={section==='all-brands'?'':company.slug} agency={agency} section={section==='all-brands'||chat?'home':section}/>:<bdi className="ws__name">gtm<span>works</span></bdi>}
   </div>
   {slug&&<div className="sb-icons">
    <Link className="circle-btn" href={`/c/${slug}/search`} aria-label={t('searchChats')}><ShellIcon name="search"/></Link>
    <Link className="circle-btn" href={`/c/${slug}/chat`} aria-label={t('newChat')} title={t('newChat')}><ShellIcon name="compose"/></Link>
   </div>}
  </div>
  <nav className="sb-scroll nav" aria-label={t('navigation')}>{slug&&<>
   <div className="sb-nav">{shellNav.map(([path,label,icon])=><div key={path} className="sb-row">
    <Link className="sb-item" href={`/c/${slug}/${path}`} aria-current={active(path)?'page':undefined}><ShellIcon name={icon}/><span className="od-fill">{t(label)}</span></Link>
    {path==='work/board'&&approvalCount>0&&<Link className="sb-count badge" href={`/c/${slug}/approvals`} aria-label={t('thingsWaitingOnYou',approvalCount)}>{approvalCount}</Link>}
   </div>)}</div>
   <section className="sb-sec" aria-labelledby="lbl-agents">
    <h2 className="sb-label" id="lbl-agents">{t('agents')}</h2>
    <ul className="agent-grid">{agents.map(agent=><li key={agent.id}>
     <Link className="agent-tile" href={`/c/${slug}/chat/${agent.id}`} aria-current={chat&&agentId===agent.id?'true':undefined} aria-label={agent.is_default?`${agent.name} · ${t('mainAgent')}`:agent.name} title={agent.name}>
      <span aria-hidden="true"><AgentFace id={agent.connection_id} role="account_manager" name={agent.name} size={52}/></span><bdi className="agent-tile__name">{agent.name}</bdi>{agent.is_default&&<span className="agent-tile__main" aria-hidden="true">{t('mainAgent')}</span>}
     </Link>
    </li>)}
    {agency&&<li><Link className="agent-tile agent-tile--new" href={`/c/${slug}/agents`}><span className="agent-tile__plus"><ShellIcon name="plus"/></span><span className="agent-tile__name">{t('newAgent')}</span></Link></li>}</ul>
   </section>
   <section className="sb-sec" aria-label={t('recentChats')}>
    <RecentChats slug={slug} chats={chats} current={conversationId} lead={agents[0]?.name||'Lead'}/>
    {company?.id&&<RecentCards key={company.id} slug={slug}/>}
   </section>
  </>}</nav>
  <div className="sb-foot sidebar-bottom">
   <AccountMenu personName={personName} role={role} companyName={company?.name} settingsHref={slug?`/c/${slug}/settings`:undefined}/>
   <ThemeToggle theme={theme}/>
  </div>
 </>;
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title. Rendered on the server so it adds no route JavaScript.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 const frame=<Frame sidebar={sidebar} title={chat?t('chats'):title} breadcrumb={chat?undefined:breadcrumb} chat={chat}>{children}</Frame>;
 return <AgentIdentitiesProvider agents={await agentIdentities()}>{company?.id?<RecentCardsProvider key={company.id} company={company.id} cardId={cardId}>{frame}</RecentCardsProvider>:frame}</AgentIdentitiesProvider>;
}
