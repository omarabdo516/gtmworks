import './tokens.css';
import './shell.css';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import AccountMenu, { ThemeToggle } from './account-menu';
import Link from '@/lib/link';
import { shellNav } from '@/lib/navigation';
import { conversationTitle } from '@/lib/conversation-title.mjs';
import { companyAgents, isNewFor } from '@/lib/sidebar.mjs';
import { Birth } from '@/components/face-moments';
import ApprovalsCount from './approvals-count';
import { companyLooks } from '@/lib/agent-looks';
import { LooksProvider } from '@/lib/agent-looks-client';
import { changeAgentLook, resetAgentLook } from './agent-look-actions';
import { agentFaceStates, type AgentFaceState } from '@/lib/agent-face-states';
import { ShellIcon } from '@/components/shell-icon';
import { agentIdentities } from '@/lib/agent-identities';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import { CallableAgentsProvider, ComposerPlaceProvider } from '@/app/conversation-composer';
import Switcher from '@/app/c/[slug]/[[...section]]/switcher';
import RecentCards, { RecentCardsProvider } from './recent-cards';
import RecentChats from './recent-chats';
import ChannelList from './channel-list';
import { AgentTile, SidebarLive } from './sidebar-live';
import { channelSidebar } from '@/lib/channels';
import { screenHands } from '@/lib/agent-screen.mjs';
import FirstRunChoice from './first-run-choice';
import AgentGrid from './agent-grid';
import { chooseWorkMode } from './work-mode-actions';
import NewChatKey from './new-chat-key';
import { SidebarSearchProvider, SearchToggle, SearchBox } from './sidebar-search';
import { Frame } from './frame';
import { markOpen } from '@/lib/chat-open-timing';
import { AppsSheetProvider, AppsButton } from './apps-sheet';
import UpdateReady from './update-ready';
import InstallUpdate from './install-update';
import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/paperclip/ui/breadcrumb';
import { Fragment, cache } from 'react';
type Crumb={label:string,href?:string};

// The sidebar's reads, once per request: they go out together, as a page's own do, each one round trip (decision 0042).
// Every Agent's state for this reader (#699) is read in one call beside the Agents themselves; a failed read leaves them
// idle, and the sidebar's poll (app/sidebar-live) follows it from there. The Company's looks are read here once for every face under the Shell (#697). A page may start them before it
// draws the Shell (the chat does), so they wait beside its own reads.
export const sidebarReads=cache(async(id:string|undefined)=>{
 const db=await supabase();
 return Promise.all([
  id?Promise.all([companyAgents(db,id),agentFaceStates(db,id).then(({states})=>states)]):[[],{} as Record<string,AgentFaceState>] as const,
  // Each listed chat with its own first message (a limit per chat), so a long chat never crowds another out of the titles.
  // The twenty current ones with the newest messages (#673); All conversations holds the rest, and the archived (#674).
  id?db.from('conversations').select('id,agent_name,last_message_at,good_morning_day,conversation_messages(body,conversation_attachments(name))').eq('company_id',id).is('archived_at',null).eq('conversation_messages.author','person')
   .order('last_message_at',{ascending:false}).order('id',{ascending:false}).order('id',{referencedTable:'conversation_messages'}).limit(1,{referencedTable:'conversation_messages'}).limit(20)
   .then(({data})=>(data||[]) as {id:string,agent_name:string,last_message_at:string,good_morning_day:string|null,conversation_messages:{body:string,conversation_attachments:{name:string}[]}[]}[]):[],
  id?db.from('companies').select('work_mode').eq('id',id).maybeSingle().then(({data})=>data?.work_mode as string|null|undefined):undefined,
  id?channelSidebar(db,id):[],
  id?db.rpc('can_manage_company',{target:id}).then(({data})=>!!data):false,
  // Who can write a chat: "N" opens a new one for them (app/new-chat-key), and a Member asks Lead for an Agent.
  !!id&&db.rpc('conversation_can_write',{c:id}).then(({data})=>data===true),
  agentIdentities(),
  companyLooks(db,id),
  // The steps handed to this reader on an Agent's Screen (#714): those the page is drawn with are no arrival for the toast.
  id?screenHands(db,id):[],
 ]);
});
type Company = {id:string,slug:string,name:string};

// The frame every screen sits in (design-reference: #sidebar). From the top: the Company, search and a new chat with
// Lead; the four entries; the Agents with Lead first; the channels this person is in with their unread counts (#23,
// #24; none in a Company worked alone), this person's recent chats and cards; Connect apps, which opens the apps as a
// sheet over the page (#201), the account and theme. An Owner also sees Update ready above Connect apps when a newer
// gtmworks exists (#442).
// `agentId` and `conversationId` mark the open Conversation in the sidebar, `channelId` the open channel; `personId` is
// the signed-in person, for whom an Agent Lead made at their request is marked new until they open it (#13).
// `approvalCount` may still be on its way (app/approvals-count.tsx).
export default async function Shell({company,companies,section,title,crumbs,personId,personName,role,owner=false,children,approvalCount=0,cardId,agentId,conversationId,channelId}:{company?:Company,companies:Company[],section:string,title:string,crumbs?:Crumb[],personId:string,personName:string,role:string,owner?:boolean,children:ReactNode,approvalCount?:number|Promise<number>,cardId?:number,agentId?:string,conversationId?:string,channelId?:string}) { const {t,theme,language}=await getI18n();
 const slug=company?.slug;
 const chat=section==='chat'||section==='conversations'||section==='channels';
 const id=company?.id;
 const [[agents,states],conversations,workMode,channels,manage,canWrite,ids,looks,handed]=await sidebarReads(id);
 const writer=!!id&&(owner||canWrite);
 markOpen('sidebar');
 // A chat is named as everywhere else (lib/conversation-title.mjs).
 const chats=conversations.map(c=>{ const first=c.conversation_messages[0];
  return {id:c.id,at:c.last_message_at,title:conversationTitle({morningDay:c.good_morning_day,body:first?.body,file:first?.conversation_attachments?.[0]?.name,agent:c.agent_name},t,language)}; });
 const asksForAgents=writer&&!owner;
 const account=<><AccountMenu slug={slug} company={company?.id} personId={personId} canManage={manage} owner={owner} alone={workMode==='alone'} personName={personName} role={role} theme={theme} companyName={company?.name} settingsHref={slug?`/c/${slug}/settings`:undefined}/><ThemeToggle theme={theme}/></>;
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
    {/* A tile that arrives during the visit flashes once (#134). */}
    <AgentGrid company={id||''} agents={agents.map(agent=>agent.id)}>{agents.map(agent=>{const fresh=isNewFor(agent,personId); return <li key={agent.id}>
     <AgentTile agent={agent.id} href={`/c/${slug}/chat/${agent.id}`} current={chat&&agentId===agent.id} named={[agent.name,agent.is_default&&t('mainAgent'),fresh&&t('agentNew'),agent.speciality].filter((part):part is string=>!!part)} title={agent.speciality?`${agent.name} · ${agent.speciality}`:agent.name}>
      <bdi className="agent-tile__name">{agent.name}</bdi>{agent.is_default&&<span className="agent-tile__main" aria-hidden="true">{t('mainAgent')}</span>}
      {fresh&&<><span className="agent-tile__new" aria-hidden="true">{t('agentNew')}</span><Birth agent={agent.id}/></>}
     </AgentTile>
    </li>;})}
    {(owner||asksForAgents)&&<li><Link className="agent-tile agent-tile--new" href={`/c/${slug}/chat?new=agent`}><span className="agent-tile__plus"><ShellIcon name="plus"/></span><span className="agent-tile__name">{t(owner?'newAgent':'settingsAskAgent')}</span></Link></li>}</AgentGrid>
   </section>
   <section className="sb-sec" id="sb-recent" aria-label={t('recentChats')}>
    {/* design-reference-card: the sidebar's "All conversations" row, over the channels and the recent chats (#673). */}
    <Link className="sb-item sb-all" href={`/c/${slug}/conversations`} aria-current={section==='all-conversations'?'page':undefined}><ShellIcon name="archive"/><span className="od-fill">{t('allConversations')}</span><ShellIcon name="chevron"/></Link>
    {company?.id&&<ChannelList slug={slug} company={company.id} person={personId} current={channelId} manage={manage}/>}
    <RecentChats slug={slug} company={company?.id||''} chats={chats} current={conversationId} lead={agents[0]?.name||'Lead'}/>
    {company?.id&&<RecentCards key={company.id} slug={slug}/>}
   </section>
  </>}</nav>
  {/* The apps are read by the browser (app/company-apps-read.ts): the page is drawn with no Engine read and the count lands after. */}
  {/* Update now (#443): the update an Owner asked for, and how it ended, read by the browser so the page waits for nothing. */}
  {owner&&<InstallUpdate/>}
  <div className="sb-foot sidebar-bottom">{company?<><UpdateReady company={company.id} person={personId} owner={owner}/><AppsButton/>{account}</>:account}</div>
 </SidebarSearchProvider>;
 // Paperclip BreadcrumbBar: a trail of two or more crumbs replaces the single page title. Rendered on the server so it adds no route JavaScript.
 const breadcrumb=crumbs&&crumbs.length>1?<div className="heading m-0 min-w-0 flex-1 overflow-hidden"><Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 overflow-hidden"><BreadcrumbList className="flex-nowrap">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <Fragment key={index}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem className={last?'min-w-0':'shrink-0'}>{last||!crumb.href?<BreadcrumbPage className="truncate"><bdi>{crumb.label}</bdi></BreadcrumbPage>:<Link className="hover:text-foreground transition-colors" href={crumb.href}><bdi>{crumb.label}</bdi></Link>}</BreadcrumbItem></Fragment>;})}</BreadcrumbList></Breadcrumb></div>:undefined;
 // First run's one question (#9): while the Company has no answer, its Owner is asked before anything else, over an
 // inert workspace.
 const asking=!!company?.id&&owner&&workMode===null;
 const mark=<svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
 const main=agents.find(agent=>agent.is_default);
 const question=asking&&company?<FirstRunChoice slug={company.slug} company={company.id} companyName={company.name} personName={personName} lead={main?{id:main.id,name:main.name}:null} mark={mark} brand={<>gtm<span>works</span></>} finish={chooseWorkMode}/>:null;
 const frame=<Frame sidebar={sidebar} title={chat?t('chats'):title} breadcrumb={chat?undefined:breadcrumb} chat={chat}>{children}</Frame>;
 // The apps sheet sits around the whole frame, so the sidebar, the account menu and every composer's "+" open it (#202).
 const framed=company?.id?<AppsSheetProvider company={company.id} person={personId} owner={owner} rtl={language==='ar'}>{frame}</AppsSheetProvider>:frame;
 const shown=question?<><div style={{display:'contents'}} inert>{framed}</div>{question}</>:framed;
 // The composer's "+" menu calls the Agents this Member sees, as the sidebar lists them (#153); the "@" list offers the
 // same Agents with the line under each name, their state and role (#154; design-reference: mentionMenu). Each Agent
 // carries the ready-made role it was made from, so the Commands can name it (#159).
 const callable=agents.map(({id,connection_id,name,speciality,template})=>({id,connection_id,name,speciality,role:template,status:states[id]??'idle'}));
 // Its New channel, Connect apps and Model (#158) read the Company and this reader's role.
 const place=company?.id?{slug:company.slug,company:company.id,person:personId,owner,manage,alone:workMode==='alone'}:null;
 return <LooksProvider looks={looks} change={owner&&company?{company:company.id,slug:company.slug,save:changeAgentLook,reset:resetAgentLook}:null}><AgentIdentitiesProvider agents={ids}><CallableAgentsProvider agents={callable}><ComposerPlaceProvider place={place}>{company?.id?<SidebarLive company={company.id} slug={company.slug} channels={channels} states={states} handed={handed}><RecentCardsProvider key={company.id} company={company.id} cardId={cardId}>{shown}</RecentCardsProvider></SidebarLive>:shown}</ComposerPlaceProvider></CallableAgentsProvider></AgentIdentitiesProvider></LooksProvider>;
}
