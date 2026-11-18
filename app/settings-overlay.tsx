import './tokens.css';
import './shell.css';
import './settings.css';
import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { AgentFaceDot } from './agent-face-dot';
import { agentStates, statusKeys, type AgentStatus } from '@/lib/agent-details.mjs';
import { pickSection, overlayHref, agentsMainFirst, usageTotals, type OverlaySection } from '@/lib/settings-overlay.mjs';
import { OverlayChrome } from './settings-overlay-chrome';
import { BackLink, FocusReturn } from './settings-overlay-frame';
import { AccountChoices, MakeMain, DeleteAgent, CompanyName, Invite, AgentSwitch, RuleSaid, RemoveRule } from './settings-overlay-client';
import { SettingsIcon } from './settings-icons';
import PasswordSettings from './password-settings';
import { UsageTable, type UsageDay } from './c/[slug]/[[...section]]/usage';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { readCompanySignIns } from '@/lib/company-sign-in.mjs';
import { AgentLevel, CompanySubscriptions, MemberNote } from './settings-lazy';
import { MadeLine, OpenedMark } from './agent-made';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { isNewFor } from '@/lib/sidebar.mjs';
import { isolate } from '@/lib/bidi';
import { inviteeName } from '@/lib/invite.mjs';
import AppsSection from './settings-apps';
import { CompanyKnowledge } from './company-knowledge';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean,created_at:string|null,requested_by:string|null,requester_opened_at:string|null,requester:unknown,lead_made_agents:unknown};
type Member={person_id:string,role:string,people:{name:string|null}|null};
type Invitation={id:string,email:string,role:string};
type Rule={id:string,body:string,said_by:string,said_at:string,teller:{name:string|null}|null};
type T=Awaited<ReturnType<typeof getI18n>>['t'];
const roleRank:Record<string,number>={owner:0,manager:1,contributor:2,viewer:3};
const roleDescription:Record<string,string>={owner:'settingsRoleOwnerD',manager:'settingsRoleManagerD',contributor:'settingsRoleContributorD',viewer:'settingsRoleViewerD'};

// The settings overlay (#26; reference: dialog#sov in design-reference/app.js, renderSov). It is route-backed:
// /c/<slug>/settings opens it on the person's first section and ?section=…&agent=… opens any other state, so the
// account menu, links and tests all reach the same screen. It covers the whole window like the reference's dialog,
// so no page is drawn behind it; closing returns to the page it was opened from. Data is read with the signed-in
// person's session (RLS); every change goes through an existing server action or route that checks the role again.
export default async function SettingsOverlay({slug,company,userId,role,personName,workMode,query}:{slug:string,company:{id:string,name:string},userId:string,role:string,personName:string,workMode?:string|null,query:{section?:string,agent?:string,period?:string,message?:string,part?:string,app?:string,signin?:string}}) {
 const {t,language,locale,theme}=await getI18n(); const rtl=language==='ar';
 const db=await supabase();
 // ?agent=<id> alone opens that Agent's page.
 const section=pickSection(query.section??(query.agent?'agents':undefined),role);
 const owner=role==='owner', canManage=owner||role==='manager', canWrite=role!=='viewer';
 const needAgents=['company','agents'].includes(section);
 const agents:Agent[]=needAgents?agentsMainFirst((await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('company_id',company.id).order('name')).data||[]):[];
 const members:Member[]=section==='company'?(((await db.from('members').select('person_id,role,people(name)').eq('company_id',company.id).is('removed_at',null)).data||[]) as unknown as Member[]).sort((a,b)=>(roleRank[a.role]??9)-(roleRank[b.role]??9)||(a.people?.name||'').localeCompare(b.people?.name||'')):[];
 // Which Agents each Member sees (#15): every Member's switches, read by an Owner or a Manager.
 const allowed=new Set(section==='company'&&canManage?((await db.from('member_agent_access').select('person_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.person_id}:${row.agent_id}`):[]);
 // Open invitations are rows of the same table (#185), with their own switches, until the person joins.
 const invitations:Invitation[]=section==='company'&&canManage?((await db.from('member_invitations').select('id,email,role').eq('company_id',company.id).is('claimed_at',null).order('created_at')).data||[]):[];
 const invitedAllowed=new Set(invitations.length?((await db.from('invitation_agent_access').select('invitation_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.invitation_id}:${row.agent_id}`):[]);
 const sharedEngine=section==='company'&&owner?(await db.rpc('bundled_engine_shared',{c:company.id})).data===true:false;
 // The Company's Agent level.
 const agentLevel=section==='company'?Number((await db.from('companies').select('agent_level').eq('id',company.id).maybeSingle()).data?.agent_level)||1:1;
 // The Company's model sign-in, read from its own profile in the agent engine (#3). The service role reads only the
 // key of that Company's bundled Connection, after the database said the person is a member (company_engine_target).
 const subscriptions=section==='models'?await (async()=>{ try { return await readCompanySignIns(db,createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}}),{company:company.id,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY}); } catch { return {profile:null,oneCompany:false,signIns:null}; } })():null;
 const usageRows:UsageDay[]=section==='usage'?((await db.rpc('usage_by_day')).data||[]) as UsageDay[]:[];
 // The person's own note for the Agents in this Company (RLS: nobody else reads it).
 const memberNote=section==='account'?(await db.from('member_notes').select('note').eq('company_id',company.id).eq('person_id',userId).maybeSingle()).data?.note||'':'';
 const agent=section==='agents'&&query.agent?agents.find(item=>item.id===query.agent):undefined;
 // Each Agent's state for this reader, read in one call as the sidebar reads it (#184).
 const stateOf=agentStates(section==='agents'?(await db.rpc('agent_states',{c:company.id})).data:null);
 // The Agent's rules in force for the team (#18), newest first as the reference lists them: a suggestion only once it is
 // approved (#25).
 // Learning suggestions waiting for this Owner's or Manager's OK (#25): their open items in "Waiting on you".
 const learningWaiting=canManage?(await db.from('waiting_items').select('id',{count:'exact',head:true}).eq('company_id',company.id).eq('kind','rule_suggestion').is('resolved_at',null)).count||0:0;
 const rules:Rule[]=agent?(((await db.from('agent_rules').select('id,body,said_by,said_at,teller:people!said_by(name)').eq('agent_id',agent.id).is('removed_at',null).or('suggestion.is.null,suggestion.eq.approved').order('said_at',{ascending:false})).data||[]) as unknown as Rule[]):[];
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const ro=!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>;
 const page=section==='company'?<CompanySection t={t} company={company} solo={workMode==='alone'} members={members} invitations={invitations} agents={agents} allowed={allowed} invitedAllowed={invitedAllowed} userId={userId} slug={slug} owner={owner} canManage={canManage} sharedEngine={sharedEngine} agentLevel={agentLevel} roleNames={roleNames} ro={ro}/>
  :section==='agents'?(agent?<AgentPage t={t} rtl={rtl} slug={slug} company={company.id} userId={userId} agent={agent} status={stateOf(agent.id)} main={agents[0]} rules={rules} owner={owner} canManage={canManage} canWrite={canWrite}/>:<AgentsSection t={t} rtl={rtl} slug={slug} agents={agents} stateOf={stateOf} canManage={canManage} canWrite={canWrite} owner={owner}/>)
  :section==='apps'?<AppsSection slug={slug} company={company.id} owner={owner} rtl={rtl} app={query.app} failed={query.signin==='failed'}/>
  :section==='usage'?<UsageSection t={t} locale={locale} slug={slug} company={company.id} rows={usageRows} period={query.period==='30'?30:7}/>
  :section==='account'?<AccountSection t={t} theme={theme} personName={personName} role={role} roleName={roleNames[role]||''} companyName={company.name} company={company.id} memberNote={memberNote}/>
  :section==='knowledge'?<><Head title={t('settingsKnowledge')} sub={t('settingsKnowledgeSub')}/>{ro}<CompanyKnowledge slug={slug} company={company.id} canManage={canManage} part={query.part}/></>
  :<SoonSection t={t} section={section} ro={ro} models={<ModelsSubscriptions company={company.id} owner={owner} subscriptions={subscriptions}/>}/>;
 return <OverlayChrome t={t} slug={slug} companyName={company.name} role={role} readOnly={!canManage} section={section} learningWaiting={learningWaiting} initialFocus={agent?'sov-tab-settings':undefined}>{page}</OverlayChrome>;
}

const Head=({title,sub,extra}:{title:string,sub?:string,extra?:ReactNode})=><header className="sov-head"><div className="sov-head__t"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{title}</h3>{sub&&<p className="sov-sub">{sub}</p>}</div>{extra}</header>;
const Label=({id,children}:{id:string,children:ReactNode})=><h4 className="dp-label" id={id}><span>{children}</span></h4>;
// A part of the reference whose feature is not built yet: drawn in its place, empty, and saying "Soon".
const Soon=({t}:{t:T})=><div className="panel-card sov-soon" aria-disabled="true" title={t('soon')}><p className="panel-empty">{t('soon')}</p></div>;
const SoonSec=({t,id,label}:{t:T,id:string,label:string})=><section className="dp-sec" aria-labelledby={id}><Label id={id}>{label}</Label><Soon t={t}/></section>;
const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

function CompanySection({t,company,solo,members,invitations,agents,allowed,invitedAllowed,userId,slug,owner,canManage,sharedEngine,agentLevel,roleNames,ro}:{t:T,company:{id:string,name:string},solo:boolean,members:Member[],invitations:Invitation[],agents:Agent[],allowed:Set<string>,invitedAllowed:Set<string>,userId:string,slug:string,owner:boolean,canManage:boolean,sharedEngine:boolean,agentLevel:number,roleNames:Record<string,string>,ro:ReactNode}) {
 const count=members.length;
 const name=<section className="dp-sec" aria-labelledby="co-h-name"><Label id="co-h-name">{t('settingsCompanyName')}</Label>
  <div className="panel-card set-card">{owner?<div className="set-field"><label className="set-label" htmlFor="co-name">{t('settingsCompanyNameHint')}</label>
   {/* Only the Owner renames the Company (#26); the server checks it again. Other Roles read the name. */}
   <CompanyName key={company.id} company={company.id} name={company.name}/></div>
   :<p className="ro-text"><bdi>{company.name}</bdi></p>}</div></section>;
 const mode=<section className="dp-sec" aria-labelledby="co-h-mode"><Label id="co-h-mode">{t('settingsMode')}</Label>
  <div className="panel-card"><div className="panel-row"><span className="panel-row__icon"><SettingsIcon name={solo?'user':'team'}/></span><span className="panel-row__text">
   <span className="panel-row__t">{solo?t('settingsModeAlone'):t('settingsModeTeam',count)}</span><span className="panel-row__d">{solo?t('settingsModeAloneD'):t('settingsModeTeamD')}</span></span></div></div></section>;
 const others=agents.filter(agent=>!agent.is_default);
 const inviteRoles=(['manager','contributor','viewer'] as const).map(key=>({key,name:roleNames[key],description:t(roleDescription[key])}));
 const who=(member:Member)=>{const label=member.people?.name||t('member'); return <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(label)}</span><span className="od-field"><span className="ta-name"><bdi>{label}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="ta-role">{roleNames[member.role]||''}</span></span></span>;};
 const table=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('settingsMembersAgents')}</Label><div className="ta sov-ta">
  <div className="table-wrap"><table className="table ta-table">
   <thead><tr><th scope="col">{t('settingsMember')}</th>{agents.map(agent=><th scope="col" key={agent.id}><span className="ta-ag"><CompanyAgentFace agent={agent} size={24}/><bdi>{agent.name}</bdi></span></th>)}</tr></thead>
   <tbody>{members.map(member=><tr key={member.person_id}><th scope="row">{who(member)}</th>
    {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
    {member.role==='owner'?(others.length>0&&<td colSpan={others.length}><span className="ta-all">{t('settingsOwnerSeesAll')}</span></td>)
     :others.map(agent=><td key={agent.id}><AgentSwitch company={company.id} target={{member:member.person_id}} agent={agent.id} on={allowed.has(`${member.person_id}:${agent.id}`)} label={`${member.people?.name||t('member')} · ${agent.name}`}/></td>)}
   </tr>)}
   {/* An invited person, drawn as the reference draws a pending one (teamTableHTML: Q.pending). */}
   {invitations.map(invitation=>{const name=inviteeName(invitation.email); return <tr key={invitation.id}><th scope="row"><span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(name)}</span><span className="od-field"><span className="ta-name"><bdi>{name}</bdi></span><span className="ta-role">{roleNames[invitation.role]||''} · <bdi dir="ltr">{invitation.email}</bdi></span><span className="badge ta-pending"><SettingsIcon name="clock"/>{t('settingsInvitePending')}</span></span></span></th>
    {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
    {others.map(agent=><td key={agent.id}><AgentSwitch company={company.id} target={{invitation:invitation.id}} agent={agent.id} on={invitedAllowed.has(`${invitation.id}:${agent.id}`)} label={`${name} · ${agent.name}`}/></td>)}
   </tr>;})}</tbody></table></div>
  <p className="set-hint ta-hint">{t('settingsTeamHint')}</p>
  {owner&&<Invite mode="table" company={company.id} slug={slug} roles={inviteRoles}/>}
 </div></section>;
 // Alone (#10): no members, no per-member Agents; the Owner invites the first Member here, and the Company becomes a
 // team when that Member accepts.
 const invite=owner&&<Invite mode="alone" company={company.id} slug={slug} roles={inviteRoles}/>;
 const list=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('members')} <span className="muted num">{count}</span></Label>
  <div className="panel-card">{members.map(member=><div className="panel-row" key={member.person_id}><span className="me__av pp-av" aria-hidden="true">{initial(member.people?.name||t('member'))}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{member.people?.name||t('member')}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="panel-row__d">{roleNames[member.role]||''}</span></span></div>)}</div></section>;
 return <><Head title={t('settingsCompany')} sub={t('settingsCompanySub')}/>{ro}
  {sharedEngine&&<p className="ro-note sov-warn" role="note"><SettingsIcon name="shield"/><span>{t('sharedEngineWarning')}</span></p>}
  {name}{mode}<AgentLevel company={company.id} level={agentLevel} owner={owner}/>{solo?invite:canManage?table:list}</>;
}

// What a face needs of an Agent: the client component is handed no more of the row than it draws.
const face=({id,connection_id,name}:Agent)=>({id,connection_id,name});

function TalkTip({t,rtl,text,talk}:{t:T,rtl:boolean,text:string,talk?:{href:string,name:string}}) {
 return <p className="talk-tip"><SettingsIcon name="chat"/><span>{isolate(text,rtl)}</span>{talk&&<Link className="link-btn" href={talk.href}>{t('settingsTalkTo',talk.name)}</Link>}</p>;
}

function AgentsSection({t,rtl,slug,agents,stateOf,canManage,canWrite,owner}:{t:T,rtl:boolean,slug:string,agents:Agent[],stateOf:(agent:string)=>AgentStatus,canManage:boolean,canWrite:boolean,owner:boolean}) {
 const main=agents.find(agent=>agent.is_default); const other=agents.find(agent=>!agent.is_default);
 const add=canWrite&&main?<Link className="btn btn--secondary btn--sm" href={`/c/${slug}/chat?new=agent`}><SettingsIcon name="chat"/><span>{owner?t('settingsAskLead',main.name):t('settingsAskAgent')}</span></Link>
  :canWrite&&<button type="button" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}><SettingsIcon name="chat"/><span>{t('settingsAskAgent')}</span></button>;
 return <><Head title={t('agents')} sub={t('settingsAgentsSub')} extra={add}/>
  {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
  <TalkTip t={t} rtl={rtl} text={t('settingsTalkTip')} talk={canWrite&&other?{href:`/c/${slug}/chat/${other.id}`,name:other.name}:undefined}/>
  <div className="panel-card sov-ags">{agents.length?agents.map(agent=><Link key={agent.id} className="panel-row sov-ag" id={`sov-ag-${agent.id}`} href={overlayHref(slug,'agents',{agent:agent.id})}>
   <AgentFaceDot agent={face(agent)} size={36} status={stateOf(agent.id)}/>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi>{agent.is_default&&<> <span className="badge sov-badge">{t('mainAgent')}</span></>}</span>
    {agent.speciality&&<span className="panel-row__d"><bdi>{agent.speciality}</bdi></span>}</span>
   <span className="panel-row__meta">{t(statusKeys[stateOf(agent.id)])}</span>
   <span className="panel-row__icon sov-chev"><SettingsIcon name="forward" rtl={rtl}/></span></Link>)
   :<p className="panel-empty">{t('noAgentsYet')}</p>}</div><FocusReturn/></>;
}

function AgentPage({t,rtl,slug,company,userId,agent,status,main,rules,owner,canManage,canWrite}:{t:T,rtl:boolean,slug:string,company:string,userId:string,agent:Agent,status:AgentStatus,main?:Agent,rules:Rule[],owner:boolean,canManage:boolean,canWrite:boolean}) {
 const isMain=agent.is_default; const made=madeOf(agent,userId,slug);
 const mainSec=owner?<section className="dp-sec" id="set-main" aria-labelledby="set-h-main"><Label id="set-h-main">{t('settingsMainAgent')}</Label><ul className="panel-card">
   {isMain?<li className="panel-row"><span className="panel-row__icon"><SettingsIcon name="check"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsIsMain',agent.name)}</span><span className="panel-row__d">{t('settingsIsMainD')}</span></span></li>
    :<MakeMain company={company} agent={agent} current={main?.name||''}/>}</ul></section>
  :isMain?<section className="dp-sec" id="set-main" aria-labelledby="set-h-main"><Label id="set-h-main">{t('settingsMainAgent')}</Label><div className="panel-card"><p className="panel-empty">{t('settingsMainOwnerOnly',agent.name)}</p></div></section>:null;
 return <>
  {isNewFor(agent,userId)&&<OpenedMark company={company} agent={agent.id}/>}
  <BackLink className="link-btn sov-back" id="sov-back" slug={slug} agent={agent.id}><SettingsIcon name="back" rtl={rtl}/><span>{t('settingsAllAgents')}</span></BackLink>
  <div className="sov-agent-id"><AgentFaceDot agent={face(agent)} size={48} status={status} lg/><div className="od-fill">
   <div className="dp-id__name"><bdi>{agent.name}</bdi>{isMain&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
   <div className="dp-id__role"><span>{agent.speciality&&<><bdi>{agent.speciality}</bdi> · </>}</span>{t(statusKeys[status])}</div>{made&&<MadeLine made={made} where="sov"/>}</div></div>
  {/* The Memory tab (#21) is not built yet. */}
  <div className="segmented sov-tabs" role="tablist" aria-label={agent.name}>
   <button type="button" role="tab" id="sov-tab-settings" aria-selected="true" aria-controls="sov-agent-panel" tabIndex={0}>{t('settings')}</button>
   <button type="button" role="tab" id="sov-tab-memory" aria-selected="false" aria-disabled="true" tabIndex={-1} title={t('soon')}>{t('settingsTabMemory')}</button>
  </div>
  <div id="sov-agent-panel" role="tabpanel" aria-labelledby="sov-tab-settings">
   <TalkTip t={t} rtl={rtl} text={t('settingsTalkTipAgent',agent.name)} talk={canWrite&&!isMain?{href:`/c/${slug}/chat/${agent.id}`,name:agent.name}:undefined}/>
   <div className="dp-sections sov-rules"><AgentRules t={t} company={company} userId={userId} rules={rules} canManage={canManage}/></div>
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
      <button type="button" id="danger-pause" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}>{t('settingsPauseButton')}</button></li>
     {isMain?<li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteMain')}</span></span></li>
      :<DeleteAgent company={company} slug={slug} agent={agent}/>}
    </ul></section>}
   </div>
  </div>
 </>;
}

// The rules the Agent was told in its chat and keeps (#18; design-reference: rulesHTML): each in its own direction, who
// said it ("you" for the reader, as the reference's firstName) and when. An Owner or a Manager may remove one; the server
// checks that again (remove_agent_rule).
function AgentRules({t,company,userId,rules,canManage}:{t:T,company:string,userId:string,rules:Rule[],canManage:boolean}) {
 return <section className="dp-sec" aria-labelledby="rl-h"><h4 className="dp-label" id="rl-h" tabIndex={-1}><span>{t('settingsRules')} <span className="muted num">{rules.length}</span></span></h4>
  {rules.length?<ul className="panel-card rl-list">{rules.map(rule=><li key={rule.id} className="panel-row rl-row"><span className="panel-row__icon"><SettingsIcon name="check"/></span>
   <span className="panel-row__text"><span className="panel-row__t" dir="auto">{rule.body}</span><RuleSaid by={rule.said_by===userId?t('settingsRuleYou'):rule.teller?.name||t('member')} at={rule.said_at}/></span>
   {canManage&&<RemoveRule company={company} rule={rule.id} body={rule.body}/>}</li>)}</ul>
  :<div className="panel-card"><p className="panel-empty">{t('settingsRulesEmpty')}</p></div>}</section>;
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
 return <><Head title={t('settingsAccount')} sub={t('settingsAccountSub')}/>
  <div className="panel-card">
   <div className="panel-row"><span className="me__av sov-av" aria-hidden="true">{initial(personName)}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{personName}</bdi></span><span className="panel-row__d">{roleName} · <bdi>{companyName}</bdi></span></span></div>
   <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="shield"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsYourRole',roleName)}</span>{roleDescription[role]&&<span className="panel-row__d">{t(roleDescription[role])}</span>}</span></div>
  </div>
  <AccountChoices theme={theme}/>
  <MemberNote company={company} note={memberNote}/>
  <PasswordSettings variant="overlay"/></>;
}

// The company's sections whose features come later (#28–#33): each keeps the reference's heading, its explanation and
// its parts in place, empty and marked "Soon", with no sample figures.
function SoonSection({t,section,ro,models}:{t:T,section:OverlaySection,ro:ReactNode,models:ReactNode}) {
 if(section==='learning') return <><Head title={t('settingsLearning')} sub={t('settingsLearningSub')}/>{ro}
  {(['settingsLearnSuggestions','settingsLearnCompany','settingsLearnPerAgent','settingsLearnRecent','settingsLearnRules'] as const).map(key=><SoonSec key={key} t={t} id={`ln-h-${key}`} label={t(key)}/>)}</>;
 if(section==='models') return <><Head title={t('settingsModels')} sub={t('settingsModelsSub')}/>{ro}
  {models}
  {(['settingsModelsDefault','settingsModelsEffort','settingsModelsEach'] as const).map(key=><SoonSec key={key} t={t} id={`md-h-${key}`} label={t(key)}/>)}</>;
 if(section==='routines') return <><Head title={t('settingsRoutines')} sub={t('settingsRoutinesSub')}/><Soon t={t}/></>;
 return <><Head title={t('settingsBackup')} sub={t('settingsBackupSub')}/>{ro}
  <SoonSec t={t} id="bk-h-list" label={t('settingsBackupList')}/><SoonSec t={t} id="bk-h-in" label={t('settingsBackupHolds')}/></>;
}

// The company's connected AI subscriptions. A company signs in to its subscription through the Hermes inside gtmworks
// (#3, ADR 0014; #123, ADR 0016): the state is read on the server from the agent engine, and the Owner's buttons call
// /api/company-sign-in, which checks the Owner again.
function ModelsSubscriptions({company,owner,subscriptions}:{company:string,owner:boolean,subscriptions:Awaited<ReturnType<typeof readCompanySignIns>>|null}) {
 return <CompanySubscriptions company={company} owner={owner} profile={subscriptions?.profile??null} oneCompany={subscriptions?.oneCompany??false} signIns={subscriptions?.signIns??null}/>;
}
