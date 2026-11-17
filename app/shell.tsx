import './tokens.css';
import './shell.css';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import AccountMenu, { ThemeToggle } from './account-menu';
import Link from '@/lib/link';
import { shellNav } from '@/lib/navigation';
import { companyAgents, isNewFor } from '@/lib/sidebar.mjs';
import ApprovalsCount from './approvals-count';
import { AgentFaceDot } from './agent-face-dot';
import { agentStates, statusKeys } from '@/lib/agent-details.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { agentIdentities } from '@/lib/agent-identities';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import { CallableAgentsProvider, ComposerPlaceProvider } from '@/app/conversation-composer';
import Switcher from '@/app/c/[slug]/[[...section]]/switcher';
import RecentCards, { RecentCardsProvider } from './recent-cards';
import RecentChats from './recent-chats';
import ChannelList from './channel-list';
import { channelSidebar } from '@/lib/channels';
import FirstRunChoice from './first-run-choice';
import NewChatKey from './new-chat-key';
import { SidebarSearchProvider, SearchToggle, SearchBox } from './sidebar-search';
import { Frame } from './frame';
import { AppsSheetProvider, AppsButton } from './apps-sheet';
import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import { Fragment } from 'react';
type Crumb={label:string,href?:string};
type Company = {id:string,slug:string,name:string};

// The frame every screen sits in (design-reference: #sidebar). From the top: the Company, search and a new chat with
// Lead; the four entries; the Agents with Lead first; the channels this person is in with their unread counts (#23,
// #24; none in a Company worked alone), this person's recent chats and cards; Connect apps, which opens the apps as a
// sheet over the page (#201), the account and theme.
// `agentId` and `conversationId` mark the open Conversation in the sidebar, `channelId` the open channel; `personId` is
// the signed-in person, for whom an Agent Lead made at their request is marked new until they open it (#13).
// `approvalCount` may still be on its way (app/approvals-count.tsx).
export default async function Shell({company,companies,section,title,crumbs,personId,personName,role,owner=false,children,approvalCount=0,cardId,agentId,conversationId,channelId}:{company?:Company,companies:Company[],section:string,title:string,crumbs?:Crumb[],personId:string,personName:string,role:string,owner?:boolean,children:ReactNode,approvalCount?:number|Promise<number>,cardId?:number,agentId?:string,conversationId?:string,channelId?:string}) { const {t,theme,language}=await getI18n();
 const slug=company?.slug;
 const chat=section==='chat'||section==='conversations'||section==='channels';
 const db=await supabase();
 // Every Agent's state for this reader (#184), read in one call beside the Agents themselves; a failed read leaves them idle.
 const [agents,stateOf]=company?.id?await Promise.all([companyAgents(db,company.id),db.rpc('agent_states',{c:company.id}).then(({data})=>agentStates(data))]):[[],agentStates(null)];
 const conversations=company?.id?(await db.from('conversations').select('id,agent_name,created_at').eq('company_id',company.id).order('created_at',{ascending:false}).limit(20)).data||[]:[];
 // Each listed chat reads its own first message, so a long chat never crowds another out of the titles.
 const firsts=await Promise.all(conversations.map(async c=>(await db.from('conversation_messages').select('body').eq('conversation_id',c.id).eq('author','person').order('id').limit(1).maybeSingle()).data?.body as string|undefined));
 // A chat is named by the first line of its first message, as its own page names it (lib/conversations titleOf).
 const chats=conversations.map((c,index)=>({id:c.id,created_at:c.created_at,title:firsts[index]?.split('\n')[0]||c.agent_name}));
 const workMode=company?.id?(await db.from('companies').select('work_mode').eq('id',company.id).maybeSingle()).data?.work_mode as string|null|undefined:undefined;
 const channels=company?.id?await channelSidebar(db,company.id):[];
 const manage=company?.id?!!(await db.rpc('can_manage_company',{target:company.id})).data:false;
 // Who can write a chat: "N" opens a new one for them (app/new-chat-key), and a Member asks Lead for an Agent.
 const writer=!!company?.id&&(owner||(await db.rpc('conversation_can_write',{c:company.id})).data===true);
 const asksForAgents=writer&&!owner;
 const account=<><AccountMenu slug={slug} personName={personName} role={role} theme={theme} companyName={company?.name} settingsHref={slug?`/c/${slug}/settings`:undefined}/><ThemeToggle theme={theme}/></>;
 const active=(path:string)=>path==='chat'?chat:path==='work/board'?section.startsWith('work/'):section===path;
 const sidebar=<SidebarSearchProvider>
  <div className="sb-top">
   <div className="ws">
    <svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    {company?<Switcher companies={companies} slug={company.slug} section={chat?'home':section}/>:<bdi className="ws__name">gtm<span>works</span></bdi>}
   </div>
   {slug&&<div className="sb-icons">
    <SearchToggle/>
    <Link className="circle-btn" href={`/c/${slug}/chat`} aria-label={t('newChat')} title={t('newChat')}><ShellIcon name="compose"/></Link>
   </div>}
  </div>
  {slug&&<SearchBox/>}
  {slug&&writer&&<NewChatKey href={`/c/${slug}/chat`}/>}
  <nav className="sb-scroll nav" aria-label={t('navigation')}>{slug&&<>
   <div className="sb-nav">{shellNav.map(([path,label,icon])=><div key={path} className="sb-row">
    <Link className="sb-item" href={`/c/${slug}/${path}`} aria-current={active(path)?'page':undefined}><ShellIcon name={icon}/><span className="od-fill">{t(label)}</span></Link>
    {path==='work/board'&&<ApprovalsCount slug={slug} current={section==='approvals'} count={approvalCount} t={t}/>}
   </div>)}</div>
   <section className="sb-sec" aria-labelledby="lbl-agents">
    <h2 className="sb-label" id="lbl-agents">{t('agents')}</h2>
    <ul className="agent-grid">{agents.map(agent=>{const fresh=isNewFor(agent,personId); const status=stateOf(agent.id); return <li key={agent.id}>
     <Link className="agent-tile" href={`/c/${slug}/chat/${agent.id}`} aria-current={chat&&agentId===agent.id?'true':undefined} aria-label={[agent.name,agent.is_default&&t('mainAgent'),fresh&&t('agentNew'),agent.speciality,t(statusKeys[status])].filter(Boolean).join(' · ')} title={agent.speciality?`${agent.name} · ${agent.speciality}`:agent.name}>
      <AgentFaceDot live agent={{id:agent.id,connection_id:agent.connection_id,name:agent.name}} size={52} status={status}/><bdi className="agent-tile__name">{agent.name}</bdi>{agent.is_default&&<span className="agent-tile__main" aria-hidden="true">{t('mainAgent')}</span>}
      {fresh&&<span className="agent-tile__new" aria-hidden="true">{t('agentNew')}</span>}
     </Link>
    </li>;})}
    {(owner||asksForAgents)&&<li><Link className="agent-tile agent-tile--new" href={`/c/${slug}/chat?new=agent`}><span className="agent-tile__plus"><ShellIcon name="plus"/></span><span className="agent-tile__name">{t(owner?'newAgent':'settingsAskAgent')}</span></Link></li>}</ul>
   </section>
   <section className="sb-sec" id="sb-recent" aria-label={t('recentChats')}>
    {company?.id&&<ChannelList slug={slug} company={company.id} person={personId} initial={channels} current={channelId} manage={manage}/>}
    <RecentChats slug={slug} chats={chats} current={conversationId} lead={agents[0]?.name||'Lead'}/>
    {company?.id&&<RecentCards key={company.id} slug={slug}/>}
   </section>
  </>}</nav>
  {/* The apps are read by the browser (app/company-apps-read.ts): the page is drawn with no Engine read and the count lands after. */}
  <div className="sb-foot sidebar-bottom">{company?<><AppsButton/>{account}</>:account}</div>
 </SidebarSearchProvider>;
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title. Rendered on the server so it adds no route JavaScript.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 // First run's one question (#9): while the Company has no answer, its Owner is asked before anything else, over an
 // inert workspace.
 const asking=!!company?.id&&owner&&workMode===null;
 const mark=<svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
 const main=agents.find(agent=>agent.is_default);
 const question=asking&&company?<FirstRunChoice slug={company.slug} company={company.id} companyName={company.name} personName={personName} lead={main?{name:main.name,connection_id:main.connection_id}:null} mark={mark} brand={<>gtm<span>works</span></>}/>:null;
 const frame=<Frame sidebar={sidebar} title={chat?t('chats'):title} breadcrumb={chat?undefined:breadcrumb} chat={chat}>{children}</Frame>;
 // The apps sheet sits around the whole frame, so the sidebar, the account menu and every composer's "+" open it (#202).
 const framed=company?.id?<AppsSheetProvider company={company.id} owner={owner} rtl={language==='ar'}>{frame}</AppsSheetProvider>:frame;
 const shown=question?<><div style={{display:'contents'}} inert>{framed}</div>{question}</>:framed;
 // The composer's "+" menu calls the Agents this Member sees, as the sidebar lists them (#153).
 const callable=agents.map(({id,connection_id,name})=>({id,connection_id,name}));
 // Its New channel, Connect apps and Model (#158) read the Company and this reader's role.
 const place=company?.id?{slug:company.slug,company:company.id,person:personId,owner,manage,alone:workMode==='alone'}:null;
 return <AgentIdentitiesProvider agents={await agentIdentities()}><CallableAgentsProvider agents={callable}><ComposerPlaceProvider place={place}>{company?.id?<RecentCardsProvider key={company.id} company={company.id} cardId={cardId}>{shown}</RecentCardsProvider>:shown}</ComposerPlaceProvider></CallableAgentsProvider></AgentIdentitiesProvider>;
}
