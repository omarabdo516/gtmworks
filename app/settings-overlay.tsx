import './shell.css';
import './settings.css';
import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { visibleSections, pickSection, overlayHref, agentsMainFirst, usageTotals, type OverlaySection } from '@/lib/settings-overlay.mjs';
import { OverlayFrame, CloseButton, AccountChoices, MakeMain, DeleteAgent, CompanyName } from './settings-overlay-client';
import MemberNote from './member-note-lazy';
import { SettingsIcon } from './settings-icons';
import PasswordSettings from './password-settings';
import { UsageTable, type UsageDay } from './c/[slug]/[[...section]]/usage';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { readCompanySignIns } from '@/lib/company-sign-in.mjs';
import { AgentLevel, CompanySubscriptions } from './company-engine-client';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean};
type Member={person_id:string,role:string,people:{name:string|null}|null};
type T=Awaited<ReturnType<typeof getI18n>>['t'];
const roleRank:Record<string,number>={owner:0,manager:1,contributor:2,viewer:3};

// The settings overlay (#26; reference: dialog#sov in design-reference/app.js, renderSov). It is route-backed:
// /c/<slug>/settings opens it on the person's first section and ?section=…&agent=… opens any other state, so the
// account menu, links and tests all reach the same screen. It covers the whole window like the reference's dialog,
// so no page is drawn behind it; closing returns to the page it was opened from. Data is read with the signed-in
// person's session (RLS); every change goes through an existing server action or route that checks the role again.
export default async function SettingsOverlay({slug,company,userId,role,personName,query}:{slug:string,company:{id:string,name:string},userId:string,role:string,personName:string,query:{section?:string,agent?:string,period?:string}}) {
 const {t,language,locale,theme}=await getI18n(); const rtl=language==='ar';
 const db=await supabase();
 // ?agent=<id> alone opens that Agent's page.
 const section=pickSection(query.section??(query.agent?'agents':undefined),role);
 const owner=role==='owner', canManage=owner||role==='manager', canWrite=role!=='viewer';
 const needAgents=['company','agents'].includes(section);
 const agents:Agent[]=needAgents?agentsMainFirst((await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name')).data||[]):[];
 const members:Member[]=section==='company'?(((await db.from('members').select('person_id,role,people(name)').eq('company_id',company.id).is('removed_at',null)).data||[]) as unknown as Member[]).sort((a,b)=>(roleRank[a.role]??9)-(roleRank[b.role]??9)||(a.people?.name||'').localeCompare(b.people?.name||'')):[];
 const sharedEngine=section==='company'&&owner?(await db.rpc('bundled_engine_shared',{c:company.id})).data===true:false;
 // The Company's Agent level, and for its Owner the Agents whose engine offers terminal, code or file tools while the
 // Company has more than one member (agent_tool_warning returns nothing to anyone else).
 const agentLevel=section==='company'?Number((await db.from('companies').select('agent_level').eq('id',company.id).maybeSingle()).data?.agent_level)||1:1;
 const toolWarning=section==='company'&&owner?((await db.rpc('agent_tool_warning',{c:company.id})).data||[]) as {agent_name:string}[]:[];
 // The Company's model sign-in, read from its own profile in the agent engine (#3). The service role reads only the
 // key of that Company's bundled Connection, after the database said the person is a member (company_engine_target).
 const subscriptions=section==='models'?await (async()=>{ try { return await readCompanySignIns(db,createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}}),{company:company.id,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY}); } catch { return {profile:null,signIns:null}; } })():null;
 const usageRows:UsageDay[]=section==='usage'?((await db.rpc('usage_by_day')).data||[]) as UsageDay[]:[];
 // The person's own note for the Agents in this Company (RLS: nobody else reads it).
 const memberNote=section==='account'?(await db.from('member_notes').select('note').eq('company_id',company.id).eq('person_id',userId).maybeSingle()).data?.note||'':'';
 const agent=section==='agents'&&query.agent?agents.find(item=>item.id===query.agent):undefined;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const ro=!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>;
 const page=section==='company'?<CompanySection t={t} company={company} members={members} agents={agents} userId={userId} slug={slug} owner={owner} canManage={canManage} sharedEngine={sharedEngine} agentLevel={agentLevel} toolWarning={toolWarning.map(row=>row.agent_name)} roleNames={roleNames} ro={ro}/>
  :section==='agents'?(agent?<AgentPage t={t} rtl={rtl} slug={slug} company={company.id} agent={agent} main={agents[0]} owner={owner} canManage={canManage} canWrite={canWrite}/>:<AgentsSection t={t} rtl={rtl} slug={slug} agents={agents} canManage={canManage} canWrite={canWrite} owner={owner}/>)
  :section==='usage'?<UsageSection t={t} locale={locale} slug={slug} company={company.id} rows={usageRows} period={query.period==='30'?30:7}/>
  :section==='account'?<AccountSection t={t} theme={theme} personName={personName} role={role} roleName={roleNames[role]||''} companyName={company.name} company={company.id} memberNote={memberNote}/>
  :<SoonSection t={t} section={section} ro={ro} models={<ModelsSubscriptions company={company.id} owner={owner} subscriptions={subscriptions}/>}/>;
 const item=([key,label,icon]:readonly [OverlaySection,string,Parameters<typeof SettingsIcon>[0]['name'],boolean,boolean])=><Link key={key} replace className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} aria-current={key===section?'page':undefined}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span></Link>;
 const list=visibleSections(role);
 return <OverlayFrame slug={slug}>
  <header className="sov__bar">
   <svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
   <h2 className="sov__title" id="sov-title">{t('settings')}</h2><span className="sov__co"><bdi>{company.name}</bdi></span><span className="od-fill"/>
   {!canManage&&<span className="badge sov-ro"><SettingsIcon name="eye"/>{t('settingsReadOnly')}</span>}
   <CloseButton slug={slug}/>
  </header>
  <div className="sov__body">
   <nav className="sov-nav" aria-label={t('settingsSectionsLabel')}>
    <p className="sov-nav__l"><bdi>{company.name}</bdi></p>{list.filter(entry=>!entry[4]).map(item)}
    <p className="sov-nav__l">{t('settingsYou')}</p>{list.filter(entry=>entry[4]).map(item)}
   </nav>
   <div className="sov-main" id="sov-main"><div className={`sov-page sov-page--${section}`}>{page}</div></div>
  </div>
 </OverlayFrame>;
}

const Head=({title,sub,extra}:{title:string,sub?:string,extra?:ReactNode})=><header className="sov-head"><div className="sov-head__t"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{title}</h3>{sub&&<p className="sov-sub">{sub}</p>}</div>{extra}</header>;
const Label=({id,children}:{id:string,children:ReactNode})=><h4 className="dp-label" id={id}><span>{children}</span></h4>;
// A part of the reference whose feature is not built yet: drawn in its place, empty, and saying "Soon".
const Soon=({t}:{t:T})=><div className="panel-card sov-soon" aria-disabled="true" title={t('soon')}><p className="panel-empty">{t('soon')}</p></div>;
const SoonSec=({t,id,label}:{t:T,id:string,label:string})=><section className="dp-sec" aria-labelledby={id}><Label id={id}>{label}</Label><Soon t={t}/></section>;
const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

function CompanySection({t,company,members,agents,userId,slug,owner,canManage,sharedEngine,agentLevel,toolWarning,roleNames,ro}:{t:T,company:{id:string,name:string},members:Member[],agents:Agent[],userId:string,slug:string,owner:boolean,canManage:boolean,sharedEngine:boolean,agentLevel:number,toolWarning:string[],roleNames:Record<string,string>,ro:ReactNode}) {
 const count=members.length; const solo=count<=1;
 const name=<section className="dp-sec" aria-labelledby="co-h-name"><Label id="co-h-name">{t('settingsCompanyName')}</Label>
  <div className="panel-card set-card">{owner?<div className="set-field"><label className="set-label" htmlFor="co-name">{t('settingsCompanyNameHint')}</label>
   {/* Only the Owner renames the Company (#26); the server checks it again. Other Roles read the name. */}
   <CompanyName key={company.id} company={company.id} name={company.name}/></div>
   :<p className="ro-text"><bdi>{company.name}</bdi></p>}</div></section>;
 const mode=<section className="dp-sec" aria-labelledby="co-h-mode"><Label id="co-h-mode">{t('settingsMode')}</Label>
  <div className="panel-card"><div className="panel-row"><span className="panel-row__icon"><SettingsIcon name={solo?'user':'team'}/></span><span className="panel-row__text">
   <span className="panel-row__t">{solo?t('settingsModeAlone'):t('settingsModeTeam',count)}</span><span className="panel-row__d">{solo?t('settingsModeAloneD'):t('settingsModeTeamD')}</span></span></div></div></section>;
 const others=agents.filter(agent=>!agent.is_default);
 const who=(member:Member)=>{const label=member.people?.name||t('member'); return <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(label)}</span><span className="od-field"><span className="ta-name"><bdi>{label}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="ta-role">{roleNames[member.role]||''}</span></span></span>;};
 const table=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('settingsMembersAgents')}</Label><div className="ta sov-ta">
  <div className="table-wrap"><table className="table ta-table">
   <thead><tr><th scope="col">{t('settingsMember')}</th>{agents.map(agent=><th scope="col" key={agent.id}><span className="ta-ag"><CompanyAgentFace agent={agent} size={24}/><bdi>{agent.name}</bdi></span></th>)}</tr></thead>
   <tbody>{members.map(member=><tr key={member.person_id}><th scope="row">{who(member)}</th>
    {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
    {member.role==='owner'?(others.length>0&&<td colSpan={others.length}><span className="ta-all">{t('settingsOwnerSeesAll')}</span></td>)
     /* Choosing which Agents each member works with (#15) is not built: today every member works with every Agent. */
     :others.map(agent=><td key={agent.id}><button type="button" className="switch" role="switch" aria-checked="true" aria-disabled="true" title={t('soon')} aria-label={`${member.people?.name||t('member')} · ${agent.name} · ${t('soon')}`}/></td>)}
   </tr>)}</tbody></table></div>
  <p className="set-hint ta-hint">{t('settingsTeamHint')}</p>
  {owner&&<section className="inv-sec" aria-labelledby="inv-h"><h4 className="sr-only" id="inv-h">{t('settingsInvite')}</h4><Link className="btn btn--secondary inv-open" href={`/c/${slug}/settings/members`}><SettingsIcon name="plus"/><span>{t('settingsInvite')}</span></Link></section>}
 </div></section>;
 const list=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('members')} <span className="muted num">{count}</span></Label>
  <div className="panel-card">{members.map(member=><div className="panel-row" key={member.person_id}><span className="me__av pp-av" aria-hidden="true">{initial(member.people?.name||t('member'))}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{member.people?.name||t('member')}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="panel-row__d">{roleNames[member.role]||''}</span></span></div>)}</div></section>;
 return <><Head title={t('settingsCompany')} sub={t('settingsCompanySub')}/>{ro}
  {sharedEngine&&<p className="ro-note sov-warn" role="note"><SettingsIcon name="shield"/><span>{t('sharedEngineWarning')}</span></p>}
  {toolWarning.length>0&&<p className="ro-note sov-warn" role="note" id="co-tool-warning"><SettingsIcon name="shield"/><span>{t('agentToolWarning',toolWarning.join(', '))}</span></p>}
  {name}{mode}<AgentLevel company={company.id} level={agentLevel} owner={owner}/>{canManage?table:list}</>;
}

function TalkTip({t,text,talk}:{t:T,text:string,talk?:{href:string,name:string}}) {
 return <p className="talk-tip"><SettingsIcon name="chat"/><span>{text}</span>{talk&&<Link className="link-btn" href={talk.href}>{t('settingsTalkTo',talk.name)}</Link>}</p>;
}

function AgentsSection({t,rtl,slug,agents,canManage,canWrite,owner}:{t:T,rtl:boolean,slug:string,agents:Agent[],canManage:boolean,canWrite:boolean,owner:boolean}) {
 const main=agents.find(agent=>agent.is_default); const other=agents.find(agent=>!agent.is_default);
 // Asking the main Agent for a new Agent (#13, #17) is not built yet.
 const add=canWrite&&<button type="button" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}><SettingsIcon name="chat"/><span>{owner&&main?t('settingsAskLead',main.name):t('settingsAskAgent')}</span></button>;
 return <><Head title={t('agents')} sub={t('settingsAgentsSub')} extra={add}/>
  {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
  <TalkTip t={t} text={t('settingsTalkTip')} talk={canWrite&&other?{href:`/c/${slug}/chat/${other.id}`,name:other.name}:undefined}/>
  <div className="panel-card sov-ags">{agents.length?agents.map(agent=><Link key={agent.id} className="panel-row sov-ag" id={`sov-ag-${agent.id}`} href={overlayHref(slug,'agents',{agent:agent.id})}>
   <span className="face-wrap" aria-hidden="true"><CompanyAgentFace agent={agent} size={36}/></span>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi>{agent.is_default&&<> <span className="badge sov-badge">{t('mainAgent')}</span></>}</span>
    {agent.speciality&&<span className="panel-row__d"><bdi>{agent.speciality}</bdi></span>}</span>
   <span className="panel-row__icon sov-chev"><SettingsIcon name="forward" rtl={rtl}/></span></Link>)
   :<p className="panel-empty">{t('noAgentsYet')}</p>}</div></>;
}

function AgentPage({t,rtl,slug,company,agent,main,owner,canManage,canWrite}:{t:T,rtl:boolean,slug:string,company:string,agent:Agent,main?:Agent,owner:boolean,canManage:boolean,canWrite:boolean}) {
 const isMain=agent.is_default;
 const mainSec=owner?<section className="dp-sec" id="set-main" aria-labelledby="set-h-main"><Label id="set-h-main">{t('settingsMainAgent')}</Label><ul className="panel-card">
   {isMain?<li className="panel-row"><span className="panel-row__icon"><SettingsIcon name="check"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsIsMain',agent.name)}</span><span className="panel-row__d">{t('settingsIsMainD')}</span></span></li>
    :<MakeMain company={company} agent={agent} current={main?.name||''}/>}</ul></section>
  :isMain?<section className="dp-sec" id="set-main" aria-labelledby="set-h-main"><Label id="set-h-main">{t('settingsMainAgent')}</Label><div className="panel-card"><p className="panel-empty">{t('settingsMainOwnerOnly',agent.name)}</p></div></section>:null;
 return <>
  <Link className="link-btn sov-back" id="sov-back" href={overlayHref(slug,'agents')} replace><SettingsIcon name="back" rtl={rtl}/><span>{t('settingsAllAgents')}</span></Link>
  <div className="sov-agent-id"><span className="face-wrap face-wrap--lg" aria-hidden="true"><CompanyAgentFace agent={agent} size={48}/></span><div className="od-fill">
   <div className="dp-id__name"><bdi>{agent.name}</bdi>{isMain&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
   {agent.speciality&&<div className="dp-id__role"><bdi>{agent.speciality}</bdi></div>}</div></div>
  {/* The Memory tab (#21) is not built yet. */}
  <div className="segmented sov-tabs" role="tablist" aria-label={agent.name}>
   <button type="button" role="tab" id="sov-tab-settings" aria-selected="true" aria-controls="sov-agent-panel" tabIndex={0}>{t('settings')}</button>
   <button type="button" role="tab" id="sov-tab-memory" aria-selected="false" aria-disabled="true" tabIndex={-1} title={t('soon')}>{t('settingsTabMemory')}</button>
  </div>
  <div id="sov-agent-panel" role="tabpanel" aria-labelledby="sov-tab-settings">
   <TalkTip t={t} text={t('settingsTalkTipAgent',agent.name)} talk={canWrite&&!isMain?{href:`/c/${slug}/chat/${agent.id}`,name:agent.name}:undefined}/>
   <div className="dp-sections sov-rules"><SoonSec t={t} id="rl-h" label={t('settingsRules')}/></div>
   <div className="dp-sections">
    {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
    <section className="dp-sec" aria-labelledby="set-h-job"><Label id="set-h-job">{t('settingsJob')}</Label>
     {/* Renaming an Agent or changing its role is not built yet: the fields show them read only. */}
     <div className="panel-card set-card">
      <div className="set-field"><label className="set-label" htmlFor="set-name">{t('settingsName')}</label><input className="set-input" id="set-name" type="text" dir="auto" readOnly aria-disabled="true" title={t('soon')} defaultValue={agent.name}/></div>
      <div className="set-field"><label className="set-label" htmlFor="set-role">{t('settingsRole')}</label><input className="set-input" id="set-role" type="text" dir="auto" readOnly aria-disabled="true" title={t('soon')} defaultValue={agent.speciality} aria-describedby="set-role-hint"/>
       <span className="set-hint" id="set-role-hint">{t('settingsRoleHint')}</span></div>
     </div></section>
    {mainSec}
    {isMain&&<section className="dp-sec" aria-labelledby="set-h-ck"><Label id="set-h-ck">{t('settingsGoodMorning')}</Label><ul className="panel-card">
     <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t" id="set-ck-t">{t('settingsCheckin')}</span><span className="panel-row__d">{t('settingsCheckinD')}</span></span>
      <button type="button" className="switch" role="switch" aria-checked="false" aria-disabled="true" aria-labelledby="set-ck-t" title={t('soon')}/></li></ul></section>}
    {/* Model, tools and core instructions change only with the Owner's approval (#19); none of these is built yet. */}
    {(['settingsAbout','settingsHow','settingsThinks','settingsVoice','settingsTools','settingsSkills'] as const).map(key=><SoonSec key={key} t={t} id={`set-h-${key}`} label={t(key)}/>)}
    {owner&&<section className="dp-sec" aria-labelledby="set-h-danger"><Label id="set-h-danger">{t('settingsDanger')}</Label><ul className="panel-card">
     <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsPause')}</span><span className="panel-row__d">{t('settingsPauseD')}</span></span>
      <button type="button" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}>{t('settingsPauseButton')}</button></li>
     {isMain?<li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteMain')}</span></span></li>
      :<DeleteAgent company={company} slug={slug} agent={agent}/>}
    </ul></section>}
   </div>
  </div>
 </>;
}

function UsageSection({t,locale,slug,company,rows,period}:{t:T,locale:string,slug:string,company:string,rows:UsageDay[],period:7|30}) {
 const totals=usageTotals(rows,company,period);
 const seg=<div className="segmented use-seg" role="group" aria-label={t('settingsPeriod')}>{([[7,'settingsLast7'],[30,'settingsLast30']] as const).map(([days,label])=><Link key={days} replace href={overlayHref(slug,'usage',days===30?{period:'30'}:{})} aria-pressed={period===days} id={`use-p-${days}`}>{t(label)}</Link>)}</div>;
 const kpi=(label:string,value:number)=><div className="kpi"><span className="kpi__label">{label}</span><span className="kpi__val num">{new Intl.NumberFormat(locale).format(value)}</span></div>;
 return <><Head title={t('usage')} sub={t('settingsUsageSub')} extra={seg}/>
  <div className="kpis use-kpis">{kpi(t('settingsTokens'),totals.tokens)}{kpi(t('usageRuns'),totals.runs)}{kpi(t('usageUnknown'),totals.unknown)}</div>
  <section className="dp-sec" aria-labelledby="use-h"><Label id="use-h">{t('settingsPerDay')}</Label>
   {rows.length?<div className="sov-ta"><UsageTable rows={rows}/></div>:<div className="panel-card"><p className="panel-empty">{t('usageNone')}</p></div>}</section></>;
}

function AccountSection({t,theme,personName,role,roleName,companyName,company,memberNote}:{t:T,theme:string,personName:string,role:string,roleName:string,companyName:string,company:string,memberNote:string}) {
 const roleD:Record<string,string>={owner:'settingsRoleOwnerD',manager:'settingsRoleManagerD',contributor:'settingsRoleContributorD',viewer:'settingsRoleViewerD'};
 return <><Head title={t('settingsAccount')} sub={t('settingsAccountSub')}/>
  <div className="panel-card">
   <div className="panel-row"><span className="me__av sov-av" aria-hidden="true">{initial(personName)}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{personName}</bdi></span><span className="panel-row__d">{roleName} · <bdi>{companyName}</bdi></span></span></div>
   <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="shield"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsYourRole',roleName)}</span>{roleD[role]&&<span className="panel-row__d">{t(roleD[role])}</span>}</span></div>
  </div>
  <AccountChoices theme={theme}/>
  <MemberNote company={company} note={memberNote}/>
  <PasswordSettings variant="overlay"/></>;
}

// The company's sections whose features come later (#27–#33): each keeps the reference's heading, its explanation and
// its parts in place, empty and marked "Soon", with no sample figures.
function SoonSection({t,section,ro,models}:{t:T,section:OverlaySection,ro:ReactNode,models:ReactNode}) {
 if(section==='knowledge') return <><Head title={t('settingsKnowledge')} sub={t('settingsKnowledgeSub')}/>{ro}
  <div className="know-vs"><div className="know-vs__c"><b><SettingsIcon name="book"/>{t('settingsKnowledge')}</b><p>{t('settingsKnowCompanyD')}</p></div>
   <div className="know-vs__c"><b><SettingsIcon name="bulb"/>{t('settingsKnowMemory')}</b><p>{t('settingsKnowMemoryD')}</p></div></div>
  <Soon t={t}/></>;
 if(section==='learning') return <><Head title={t('settingsLearning')} sub={t('settingsLearningSub')}/>{ro}
  {(['settingsLearnSuggestions','settingsLearnCompany','settingsLearnPerAgent','settingsLearnRecent','settingsLearnRules'] as const).map(key=><SoonSec key={key} t={t} id={`ln-h-${key}`} label={t(key)}/>)}</>;
 if(section==='models') return <><Head title={t('settingsModels')} sub={t('settingsModelsSub')}/>{ro}
  {models}
  {(['settingsModelsDefault','settingsModelsEffort','settingsModelsEach'] as const).map(key=><SoonSec key={key} t={t} id={`md-h-${key}`} label={t(key)}/>)}</>;
 if(section==='apps') return <><Head title={t('settingsApps')}/><Soon t={t}/></>;
 if(section==='routines') return <><Head title={t('settingsRoutines')} sub={t('settingsRoutinesSub')}/><Soon t={t}/></>;
 return <><Head title={t('settingsBackup')} sub={t('settingsBackupSub')}/>{ro}
  <SoonSec t={t} id="bk-h-list" label={t('settingsBackupList')}/><SoonSec t={t} id="bk-h-in" label={t('settingsBackupHolds')}/></>;
}

// The company's connected AI subscriptions. A company signs in to its own subscription through the Hermes inside
// gtmworks (#3, ADR 0014): the state is read on the server from the company's own profile, and the Owner's buttons
// call /api/company-sign-in, which checks the Owner again.
function ModelsSubscriptions({company,owner,subscriptions}:{company:string,owner:boolean,subscriptions:Awaited<ReturnType<typeof readCompanySignIns>>|null}) {
 return <CompanySubscriptions company={company} owner={owner} profile={subscriptions?.profile??null} signIns={subscriptions?.signIns??null}/>;
}
