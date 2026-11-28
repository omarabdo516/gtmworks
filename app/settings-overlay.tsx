import './tokens.css';
import './shell.css';
import './settings.css';
import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { AgentFace } from '@/components/agent-face';
import { agentFaceStates, faceStateWords, type AgentFaceState } from '@/lib/agent-face-states';
import { permitted } from '@/lib/route-permissions.mjs';
import { pickSection, pageReadAt, overlayHref, agentsMainFirst, agentTab, agentTabFocus, type OverlaySection, type AgentTab } from '@/lib/settings-overlay.mjs';
import { OverlayChrome } from './settings-overlay-chrome';
import { Group, Head, Label, SubLabel } from './settings-overlay-parts';
import { BackLink, FocusReturn } from './settings-overlay-frame';
import { AccountChoices, MakeMain, DeleteAgent, CompanyName, Invite, InviteLink, PendingInviteLinks, AddMember, SettingsTeamTable, RuleSaid, RemoveRule } from './settings-overlay-client';
import { SettingsIcon } from './settings-icons';
import { LookRow } from './agent-look-window';
import { InfoTip } from './settings-info';
import PasswordSettings from './password-settings';
import { readProviderNames } from '@/lib/provider-names.mjs';
import { readProviderOrder } from '@/lib/provider-order.mjs';
import { readFallbackModel } from '@/lib/fallback-model.mjs';
import { ModelsParts } from './settings-models-parts';
import { MemberNote, AgentSaveBar, VoiceSettings } from './settings-lazy';
import { AboutPart, HowPart, MorningPart, ThinkingPart, VoicePart, VoiceSpeedPart, PermissionsPart, SkillsPart } from './settings-agent-parts';
import { SandboxNote, UsagePart, LearningPart, SkillPagePart, RoutinesPart } from './settings-section-parts';
import { AgentMemoryPart } from './agent-details-parts';
import { PartsReader } from './settings-part-read';
import { MadeLine, OpenedMark } from './agent-made';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { isNewFor } from '@/lib/sidebar.mjs';
import { isolate } from '@/lib/bidi';
import { inviteRoles as teamInviteRoles, roleDescription, orderMembers } from '@/lib/member-roles.mjs';
import AppsSection from './settings-apps';
import { CompanyKnowledge, readKnowledgeStored } from './company-knowledge';
import { AgentTabs } from './settings-agent-tabs';
import { BackupSection } from './settings-backup';
import { AboutSection } from './settings-about';
import { ProposalNote, ProposalMark } from './settings-proposal';
import { readWaitingChange, readWaitingAgents, countWaitingChanges, waitingChangeHref } from '@/lib/agent-change-waiting.mjs';
import { ownerNames } from '@/lib/company-owners.mjs';
import { addablePeople } from '@/lib/addable-people.mjs';
import { markSettingsOpen } from '@/lib/settings-open-timing';
import { readStoredLearning } from '@/lib/company-learning.mjs';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean,created_at:string|null,requested_by:string|null,requester_opened_at:string|null,requester:unknown,lead_made_agents:unknown};
type Member={person_id:string,role:string,people:{name:string|null}|null};
type Invitation={id:string,email:string,role:string};
type InviteLink={id:string,label:string,role:string,made_by_name:string|null,ends_at:string};
type Rule={id:string,body:string,said_by:string,said_at:string,teller:{name:string|null}|null};
type T=Awaited<ReturnType<typeof getI18n>>['t'];

// The settings overlay (#26; reference: dialog#sov in design-reference/app.js, renderSov). It is route-backed:
// /c/<slug>/settings opens it on the person's first section and ?section=…&agent=… opens any other state, so the
// account menu, links and tests all reach the same screen. It covers the whole window like the reference's dialog,
// so no page is drawn behind it; closing returns to the page it was opened from. Data is read with the signed-in
// person's session (RLS); every change goes through an existing server action or route that checks the role again.
export default async function SettingsOverlay({slug,company,userId,role,personName,workMode,query}:{slug:string,company:{id:string,name:string},userId:string,role:string,personName:string,workMode?:string|null,query:{section?:string,agent?:string,period?:string,message?:string,part?:string,app?:string,signin?:string,skill?:string,tab?:string,focus?:string}}) {
 const {t,language,locale,theme}=await getI18n(); const rtl=language==='ar';
 const readAt=pageReadAt();
 const db=await supabase();
 // ?agent=<id> alone opens that Agent's page.
 const section=pickSection(query.section??(query.agent?'agents':undefined),role);
 const owner=role==='owner', canManage=owner||role==='manager', canWrite=role!=='viewer';
 // The Engine dashboard's row is the install owner's alone (#915), by the rule its routes ask; a failed read is no.
 const installOwner=owner&&await permitted(db,'installOwner',company.id,userId);
 const needAgents=['members','agents'].includes(section);
 const agents:Agent[]=needAgents?agentsMainFirst((await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('company_id',company.id).order('name')).data||[]):[];
 const members:Member[]=section==='members'?orderMembers(((await db.from('members').select('person_id,role,people(name)').eq('company_id',company.id).is('removed_at',null)).data||[]) as unknown as Member[]):[];
 // The team's size, for the Company page's way of working line; the people themselves are on Members (#612).
 const memberCount=section==='company'&&workMode!=='alone'?(await db.from('members').select('person_id',{count:'exact',head:true}).eq('company_id',company.id).is('removed_at',null)).count??0:0;
 // Which Agents each Member sees (#15): every Member's switches, read by an Owner or a Manager.
 const allowed=new Set(section==='members'&&canManage?((await db.from('member_agent_access').select('person_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.person_id}:${row.agent_id}`):[]);
 // Open invitations are rows of the same table (#185), with their own switches, until the person joins.
 const invitations:Invitation[]=section==='members'&&canManage?((await db.from('member_invitations').select('id,email,role').eq('company_id',company.id).is('claimed_at',null).order('created_at')).data||[]):[];
 const invitedAllowed=new Set(invitations.length?((await db.from('invitation_agent_access').select('invitation_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.invitation_id}:${row.agent_id}`):[]);
 // Invite links still waiting for their Person (#951), read only for an Administrator: pending_invite_links checks that
 // Role again, and another Role asks for none.
 const links:InviteLink[]=section==='members'&&owner?(((await db.rpc('pending_invite_links',{c:company.id})).data||[]) as unknown as InviteLink[]):[];
 // Settings → Models draws what gtmworks stores here and reads each part the Engine backs from the browser (#791, ADR
 // 0030; app/settings-models-parts.tsx): the sign-ins, the model choices, the keys, each Provider's models and speech.
 // The Company's Fallback model (#622), read for every Member; undefined when unread.
 const fallback=section==='models'?await readFallbackModel(db,company.id).catch(()=>undefined):undefined;
 const names=section==='models'?await readProviderNames(db,company.id):{};
 // The Owner's order of the Providers and which are switched off (#619), read for every Member; null when unread.
 const order=section==='models'?await readProviderOrder(db,company.id):null;
 // Every part the Engine backs (usage, learning, Routines, the work sandbox, an Agent's About, Skills, How it works,
 // voice, permissions, model and memory, the apps, the models) is read by the browser after the page is drawn (#898,
 // ADR 0030: app/settings-section-parts.tsx, app/settings-agent-parts.tsx): no Settings page waits on the Engine.
 // The person's own note for the Agents in this Company (RLS: nobody else reads it).
 const memberNote=section==='account'?(await db.from('member_notes').select('note').eq('company_id',company.id).eq('person_id',userId).maybeSingle()).data?.note||'':'';
 const agent=section==='agents'&&query.agent?agents.find(item=>item.id===query.agent):undefined;
 const tab:AgentTab=agentTab(query.tab);
 // Each Agent's state for this reader, read in one call as the sidebar reads it (#699).
 const stateOf=section==='agents'?(await agentFaceStates(db,company.id)).of:()=>({state:'idle' as const});
 // The Agent's rules in force for the team (#18), newest first as the reference lists them: a suggestion only once it is
 // approved (#25).
 // Learning suggestions waiting for this Owner's or Manager's OK (#25): their open items in "Waiting on you".
 const learningWaiting=canManage?(await db.from('waiting_items').select('id',{count:'exact',head:true}).eq('company_id',company.id).eq('kind','rule_suggestion').is('resolved_at',null)).count||0:0;
 // The changes Agents proposed for their own settings that wait for the Owner (#19, #178): every one for an Owner, and for
 // anyone else only one made in their own Conversation while they see both Agents (the database's agent_change_proposals_read).
 // An Owner's number on "Agents" is counted on every section; the Owner's rows are the Agents with one, read on the list,
 // and the note is the open Agent's oldest one. A read that fails leaves Settings as if nothing waited, and says so in the
 // server's log; with the Owners' names unread the note waits for "the Owner".
 const failed=<T,>(what:string,fallback:T)=>(failure:unknown):T=>{ console.error(`Settings: ${what} not read:`,company.id,(failure as {message?:string})?.message||'unknown error'); return fallback; };
 // The People an Administrator may add from another Company they administer (#952), for the Team table's add section.
 const candidates:{person_id:string,name:string,company:string}[]=section==='members'&&owner?await addablePeople(db,company.id).catch(failed('people from other Companies',[])):[];
 const agentsWaiting=owner?await countWaitingChanges(db,company.id).catch(failed('waiting proposals count',0)):0;
 const waitingAgents=owner&&section==='agents'&&!agent&&agentsWaiting>0?await readWaitingAgents(db,company.id).catch(failed('Agents with a waiting proposal',new Set<string>())):new Set<string>();
 const change=agent?await readWaitingChange(db,company.id,agent.id).catch(failed('waiting proposal',null)):null;
 const owners=change&&!owner?await ownerNames(db,company.id).catch(failed<string[]>('Owners',[])):[];
 const pend=change&&<ProposalNote change={change} owner={owner} owners={owners} href={waitingChangeHref(slug,change,{person:userId,owner})}/>;
 const rules:Rule[]=agent?(((await db.from('agent_rules').select('id,body,said_by,said_at,teller:people!said_by(name)').eq('agent_id',agent.id).is('removed_at',null).or('suggestion.is.null,suggestion.eq.approved').order('said_at',{ascending:false})).data||[]) as unknown as Rule[]):[];
 // What the database holds of Learning (#28): its Agents, their mode choices, the rules and the lessons, drawn before the
 // Engine's modes and learned Skills arrive (#898). A read that fails leaves the section's own unread lines.
 const storedLearning=section==='learning'?await readStoredLearning(db,{company:company.id}).catch(()=>({state:'failed' as const,agents:null,rules:null,lessons:null})):null;
 // Company knowledge's chosen part as gtmworks stores it: its last edit and the Agents that read it (#27).
 const knowledge=section==='knowledge'?await readKnowledgeStored(db,company.id,query.part):null;
 // Every read this page awaits is the database's (ADR 0030), and all of them are done here.
 markSettingsOpen('reads',section);
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const ro=!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>;
 // A learned Skill's page (#181) at ?agent=…&skill=…; one this person has no page for opens Learning once read.
 const skillAsked=!!(query.agent&&query.skill);
 const page=section==='company'?<CompanySection t={t} company={company} solo={workMode==='alone'} count={memberCount} owner={owner} ro={ro} readAt={readAt}/>
  :section==='members'?<MembersSection t={t} company={company} solo={workMode==='alone'} members={members} invitations={invitations} links={links} agents={agents} allowed={allowed} invitedAllowed={invitedAllowed} candidates={candidates} userId={userId} slug={slug} owner={owner} canManage={canManage} roleNames={roleNames} ro={ro}/>
  :section==='agents'?(agent?<AgentPage t={t} rtl={rtl} slug={slug} company={company.id} userId={userId} personName={personName} agent={agent} tab={tab} status={stateOf(agent.id).state} main={agents[0]} rules={rules} readAt={readAt} morningFocus={query.focus==='time'} owner={owner} canManage={canManage} canWrite={canWrite} learning={role!=='viewer'} pend={pend}/>:<AgentsSection t={t} rtl={rtl} slug={slug} agents={agents} stateOf={agent=>stateOf(agent).state} canManage={canManage} canWrite={canWrite} owner={owner} waiting={waitingAgents}/>)
  :section==='apps'?<AppsSection slug={slug} company={company.id} owner={owner} app={query.app} failed={query.signin==='failed'}/>
  // Voice is the Owner's and the Managers' (#863): pickSection opens it for no other Role, and only the Owner changes it.
  :section==='voice'&&canManage?<><Head title={t('settingsVoicePage')} info={t('settingsVoicePageSub')}/><VoiceSettings company={company.id} slug={slug} owner={owner}/></>
  :section==='usage'?<UsagePart slug={slug} company={company.id} period={query.period==='30'?30:7} asked={readAt}/>
  :section==='learning'?(skillAsked?<SkillPagePart slug={slug} company={company.id} agent={query.agent!} skill={query.skill!} canManage={canManage} owner={owner} stored={storedLearning} asked={readAt}/>:<LearningPart slug={slug} company={company.id} canManage={canManage} owner={owner} stored={storedLearning} asked={readAt}/>)
  :section==='account'?<AccountSection t={t} theme={theme} personName={personName} role={role} roleName={roleNames[role]||''} companyName={company.name} company={company.id} memberNote={memberNote}/>
  :section==='routines'?<>{ro}<RoutinesPart company={company.id} canManage={canManage} asked={readAt}/></>
  :section==='knowledge'?<><Head title={t('settingsKnowledge')} info={t('settingsKnowledgeSub')}/>{ro}<CompanyKnowledge slug={slug} company={company.id} canManage={canManage} stored={knowledge!} asked={readAt}/></>
  // Backup is the Owner's alone (#33): pickSection never opens it for another Role, and the server renders it only here.
  :section==='backup'&&owner?<BackupSection t={t}/>
  // About (#616) is every Role's: the version this image was built as, and the notes and licenses it ships.
  :section==='about'?<AboutSection t={t} language={language} locale={locale} version={process.env.GTMWORKS_VERSION}/>
  :<SoonSection t={t} section={section} ro={ro} models={<ModelsParts company={company.id} companyName={company.name} owner={owner} names={names} order={order} fallback={fallback} asked={readAt}/>}/>;
 // Nothing is left to wait for: the page's first bytes leave next.
 markSettingsOpen('firstByte');
 return <OverlayChrome t={t} slug={slug} companyName={company.name} role={role} installOwner={installOwner} readOnly={!canManage} section={section} learningWaiting={learningWaiting} agentsWaiting={agentsWaiting} initialFocus={section==='learning'&&skillAsked?'sov-skill-back':agent?agentTabFocus(tab):undefined}><PartsReader person={userId}/>{page}</OverlayChrome>;
}

// A part of the reference whose feature is not built yet: drawn in its place, empty, and saying "Soon".
const Soon=({t}:{t:T})=><div className="panel-card sov-soon" aria-disabled="true" title={t('soon')}><p className="panel-empty">{t('soon')}</p></div>;
const SoonSec=({t,id,label}:{t:T,id:string,label:string})=><section className="dp-sec" aria-labelledby={id}><SubLabel id={id}>{label}</SubLabel><Soon t={t}/></section>;
const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

function CompanySection({t,company,solo,count,owner,ro,readAt}:{t:T,company:{id:string,name:string},solo:boolean,count:number,owner:boolean,ro:ReactNode,readAt:number}) {
 const name=<section className="dp-sec" aria-labelledby="co-h-name"><Label id="co-h-name">{t('settingsCompanyName')}</Label>
  <div className="panel-card set-card">{owner?<div className="set-field"><label className="set-label" htmlFor="co-name">{t('settingsCompanyNameHint')}</label>
   {/* Only the Owner renames the Company (#26); the server checks it again. Other Roles read the name. */}
   <CompanyName key={company.id} company={company.id} name={company.name}/></div>
   :<p className="ro-text"><bdi>{company.name}</bdi></p>}</div></section>;
 const mode=<section className="dp-sec" aria-labelledby="co-h-mode"><Label id="co-h-mode">{t('settingsMode')}</Label>
  <div className="panel-card"><div className="panel-row"><span className="panel-row__icon"><SettingsIcon name={solo?'user':'team'}/></span><span className="panel-row__text">
   <span className="panel-row__t">{solo?t('settingsModeAlone'):t('settingsModeTeam',count)}</span><span className="panel-row__d">{solo?t('settingsModeAloneD'):t('settingsModeTeamD')}</span></span></div></div></section>;
 // Every Agent gets one fixed set of tools (ADR 0018): what they are, and that publishing and spending still wait for a
 // person, is the section's read-only value, not help (#614).
 const tools=<section className="dp-sec" aria-labelledby="co-h-tools"><Label id="co-h-tools">{t('agentToolsTitle')}</Label>
  <div className="panel-card"><div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="cpu"/></span><span className="panel-row__text"><span className="panel-row__t" id="co-tools">{t('agentToolsHint')}</span></span></div></div>
  {/* The Company's work sandbox not answering (#398), read by the browser from its own Engine (#898). */}
  <SandboxNote company={company.id} asked={readAt}/>
 </section>;
 return <><Head title={t('settingsCompany')} info={t('settingsCompanySub')}/>{ro}{name}{mode}{tools}</>;
}

// The Company's Members on their own page (#612): who is in the team and which Agents each one sees, for an Owner or a
// Manager; the names and Roles for anyone else; and, for a Company worked alone, the Owner's invitation to the first one.
function MembersSection({t,company,solo,members,invitations,links,agents,allowed,invitedAllowed,candidates,userId,slug,owner,canManage,roleNames,ro}:{t:T,company:{id:string,name:string},solo:boolean,members:Member[],invitations:Invitation[],links:InviteLink[],agents:Agent[],allowed:Set<string>,invitedAllowed:Set<string>,candidates:{person_id:string,name:string,company:string}[],userId:string,slug:string,owner:boolean,canManage:boolean,roleNames:Record<string,string>,ro:ReactNode}) {
 const count=members.length;
 const inviteRoles=teamInviteRoles(t);
 const table=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem" info={t('settingsTeamHint')}>{t('settingsMembersAgents')}</Label><div className="ta sov-ta">
  <SettingsTeamTable company={company.id} slug={slug} members={members} invitations={invitations} links={links} agents={agents} allowed={allowed} invitedAllowed={invitedAllowed} userId={userId} owner={owner} candidates={candidates}/>
 </div></section>;
 // Alone (#10): no members, no per-member Agents; the Owner invites the first Member here, and the Company becomes a
 // team when that Member accepts. A link made for that first Member waits here (#951), with its Cancel, until it is used.
 const invite=owner&&<>
  {links.length>0&&<section className="dp-sec" aria-labelledby="co-h-links"><Label id="co-h-links">{t('inviteLinks')}</Label><PendingInviteLinks company={company.id} links={links}/></section>}
  <Invite mode="alone" company={company.id} slug={slug} roles={inviteRoles}/><InviteLink company={company.id} agents={agents}/><AddMember company={company.id} candidates={candidates} agents={agents}/></>;
 const list=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('members')} <span className="muted num">{count}</span></Label>
  <div className="panel-card">{members.map(member=><div className="panel-row" key={member.person_id}><span className="me__av pp-av" aria-hidden="true">{initial(member.people?.name||t('member'))}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{member.people?.name||t('member')}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="panel-row__d">{roleNames[member.role]||''}</span></span></div>)}</div></section>;
 return <><Head title={t('members')}/>{ro}{solo?invite:canManage?table:list}</>;
}


// The simplest way to change an Agent is to tell it in its chat (#18): that sentence is optional help (#614), and the
// link to the chat stays on the page as an action.
const talkText=(text:string,rtl:boolean)=><span className="info__p">{isolate(text,rtl)}</span>;
function TalkTip({t,talk}:{t:T,talk?:{href:string,name:string}}) {
 return talk?<p className="talk-tip"><SettingsIcon name="chat"/><Link className="link-btn" href={talk.href}>{t('settingsTalkTo',talk.name)}</Link></p>:null;
}

function AgentsSection({t,rtl,slug,agents,stateOf,canManage,canWrite,owner,waiting}:{t:T,rtl:boolean,slug:string,agents:Agent[],stateOf:(agent:string)=>AgentFaceState,canManage:boolean,canWrite:boolean,owner:boolean,waiting:Set<string>}) {
 const main=agents.find(agent=>agent.is_default); const other=agents.find(agent=>!agent.is_default);
 const add=canWrite&&main?<Link className="btn btn--secondary btn--sm" href={`/c/${slug}/chat?new=agent`}><SettingsIcon name="chat"/><span>{owner?t('settingsAskLead',main.name):t('settingsAskAgent')}</span></Link>
  :canWrite&&<button type="button" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}><SettingsIcon name="chat"/><span>{t('settingsAskAgent')}</span></button>;
 return <><Head title={t('agents')} info={<><span className="info__p">{t('settingsAgentsSub')}</span>{talkText(t('settingsTalkTip'),rtl)}</>} extra={add}/>
  {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
  <TalkTip t={t} talk={canWrite&&other?{href:`/c/${slug}/chat/${other.id}`,name:other.name}:undefined}/>
  <div className="panel-card sov-ags">{agents.length?agents.map(agent=><Link key={agent.id} className="panel-row sov-ag" id={`sov-ag-${agent.id}`} href={overlayHref(slug,'agents',{agent:agent.id})}>
   <AgentFace agent={agent.id} size={36} state={stateOf(agent.id)} dot/>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi>{agent.is_default&&<> <span className="badge sov-badge">{t('mainAgent')}</span></>}</span>
    {agent.speciality&&<span className="panel-row__d"><bdi>{agent.speciality}</bdi></span>}</span>
   {/* An Agent with a change waiting for this Owner ends its row with it in place of its state (#178). */}
   {waiting.has(agent.id)?<ProposalMark/>:<span className="panel-row__meta">{t(faceStateWords[stateOf(agent.id)])}</span>}
   <span className="panel-row__icon sov-chev"><SettingsIcon name="forward" rtl={rtl}/></span></Link>)
   :<p className="panel-empty">{t('noAgentsYet')}</p>}</div><FocusReturn/></>;
}

function AgentPage({t,rtl,slug,company,userId,personName,agent,tab,status,main,rules,readAt,morningFocus,owner,canManage,canWrite,learning,pend}:{t:T,rtl:boolean,slug:string,company:string,userId:string,personName:string,agent:Agent,tab:AgentTab,status:AgentFaceState,main?:Agent,rules:Rule[],readAt:number,morningFocus:boolean,owner:boolean,canManage:boolean,canWrite:boolean,learning:boolean,pend:ReactNode}) {
 const isMain=agent.is_default; const made=madeOf(agent,userId,slug);
 // The handle gtmworks calls the Agent by in messages, which a change of the Engine's name would not touch
 // (lib/conversation-runs.mjs: @ and the name, lowercased).
 const handle=`@${agent.name.trim().toLowerCase()}`;
 // What the Agent's own Engine profile keeps (About, How it works, Good morning, its model and thinking level, its voice,
 // standing permissions and Skills, and its memory) is read by the browser, each part on its own, after the page is drawn
 // from what gtmworks stores (#898, ADR 0030: app/settings-agent-parts.tsx). Each part decides once read whether this
 // reader may change it, as the page did: About, Skills, voice and Good morning are the Owner's and the Managers' on the
 // Agent's own profile; How it works, the model and the thinking level are the Owner's.
 // The main mark is a row of Identity (#615): the Owner moves it here, and every other Role reads why only the Owner can.
 const mainRow=owner?(isMain?<li className="panel-row" id="set-main"><span className="panel-row__icon"><SettingsIcon name="check"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsIsMain',agent.name)}</span><span className="panel-row__d">{t('settingsIsMainD')}</span></span></li>
   :<MakeMain company={company} agent={agent} current={main?.name||''}/>)
  :isMain?<li className="panel-row" id="set-main"><span className="panel-row__text"><span className="panel-row__t">{t('settingsMainAgent')}</span><span className="panel-row__d">{t('settingsMainOwnerOnly',agent.name)}</span></span></li>:null;
 return <>
  {isNewFor(agent,userId)&&<OpenedMark company={company} agent={agent.id}/>}
  <BackLink className="link-btn sov-back" id="sov-back" slug={slug} agent={agent.id}><SettingsIcon name="back" rtl={rtl}/><span>{t('settingsAllAgents')}</span></BackLink>
  <div className="sov-agent-id"><AgentFace agent={agent.id} size={48} state={status} dot/><div className="od-fill">
   <div className="dp-id__name"><bdi>{agent.name}</bdi>{isMain&&<span className="badge dp-id__badge">{t('mainAgent')}</span>}</div>
   <div className="dp-id__role"><span>{agent.speciality&&<><bdi>{agent.speciality}</bdi> · </>}</span>{t(faceStateWords[status])}</div>{made&&<MadeLine made={made} where="sov"/>}</div></div>
  <AgentTabs slug={slug} agent={agent.id} tab={tab} label={agent.name}/>
  {/* design-reference: sovAgentHTML's ${pend}, under the tabs on either tab, while a proposed change waits. */}
  {pend}
  <div id="sov-agent-panel" role="tabpanel" aria-labelledby={`sov-tab-${tab}`}>
   {tab==='memory'
    ?<div className="dp-sections"><AgentMemoryPart key={agent.id} company={company} agent={{id:agent.id,name:agent.name}} canReset={owner} canEdit={canManage} canForget={owner} knowledgeHref={canWrite?overlayHref(slug,'knowledge'):undefined} introAsHelp/></div>
    :(<>
   <TalkTip t={t} talk={canWrite&&!isMain?{href:`/c/${slug}/chat/${agent.id}`,name:agent.name}:undefined}/>
   {/* The page in five groups by what is being changed (#615): Identity, How it works, Thinking, Voice, and Tools and
       skills, then Advanced, closed until opened, with the voice's speed, Pause and Delete. Every control, permission and
       confirmation is the one it was before; only its place changed. */}
   <div className="dp-sections set-groups">
    {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
    <Group id="set-h-identity" title={t('settingsGroupIdentity')}>
     {/* The pinned Engine writes neither a name nor a role for a named profile from its management listener (#161), so
         both are the reference's read-only rows, for every Role. */}
     <ul className="panel-card">
      <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsName')}</span><span className="panel-row__d ro-val" id="set-name-val"><bdi>{agent.name}</bdi> · <bdi dir="ltr">{handle}</bdi></span></span></li>
      <LookRow agent={{id:agent.id,name:agent.name}}/>
      <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsRole')}</span><span className="panel-row__d ro-val" id="set-role-val">{agent.speciality?<bdi>{agent.speciality}</bdi>:'—'}</span></span></li>
      {mainRow}
     </ul>
     {/* About is the Agent's profile description (#161). */}
     <section className="dp-sec" aria-labelledby="set-h-about"><SubLabel id="set-h-about" info={t('settingsAboutHint')} infoId="set-desc-hint">{t('settingsAbout')}</SubLabel>
      <AboutPart company={company} agent={agent.id} name={agent.name} canManage={canManage} asked={readAt}/></section>
    </Group>
    {/* How it works is the profile SOUL.md outside the team's rules section (#176): the Owner edits it, every other Role
        reads it with its line breaks; an Engine that could not be read shows no text at all. A Manager reads it
        read-only, and its own line says why. Good morning (#182) is the main Agent's one row here, and the rules it was
        told in its chat (#18) close the group. */}
    <Group id="set-h-how" title={t('settingsHow')} info={t('settingsHowHint',agent.name)} infoId="set-instr-hint">
     {!owner&&<p className="set-hint">{t('settingsHowRO')}</p>}
     <HowPart company={company} agent={agent.id} name={agent.name} owner={owner} asked={readAt}/>
     {isMain&&<MorningPart company={company} agent={agent.id} canManage={canManage} focus={morningFocus} asked={readAt}/>}
     <AgentRules t={t} company={company} userId={userId} rules={rules} canManage={canManage} info={talkText(t('settingsTalkTipAgent',agent.name),rtl)}/>
    </Group>
    {/* Thinking: the Agent's own Engine profile's model (#29), written there and read back, then its thinking level
        (#179): the eight the Engine accepts, saved with the same bar, read as text by every other Role. */}
    <Group id="set-h-thinks" title={t('settingsGroupThinking')} info={t('settingsThinksHint')}>
     <ThinkingPart company={company} agent={agent.id} name={agent.name} owner={owner} asked={readAt}/></Group>
    {/* The Agent's voice (#162): its real voice with Listen; the speed is in Advanced. The language it listens in is the
        Company's, on Settings → Voice (#863). */}
    <Group id="set-h-voice" title={t('settingsVoice')}>
     <VoicePart company={company} agent={agent.id} personName={personName} canManage={canManage} asked={readAt}/>
    </Group>
    <Group id="set-h-tools" title={t('settingsGroupTools')}>
     <SoonSec t={t} id="set-h-settingsTools" label={t('settingsTools')}/>
     {/* design-reference: settingsHTML, permsHTML after Tools (#166). */}
     <PermissionsPart company={company} agent={agent.id} canRevoke={canManage} asked={readAt}/>
     {/* The Agent's own Skills and their switches (#180); the Company's shared skills stay on the team's Skills page. */}
     <SkillsPart company={company} agent={agent.id} name={agent.name} slug={slug} learning={learning} canManage={canManage} asked={readAt}/>
    </Group>
    {/* Advanced (#615): closed when the page opens, for every Role. The voice's speed joins the page's save bar; Pause and
        Delete are the Owner's, with Delete's typed-name confirmation as before. */}
    <details className="set-advanced" id="set-advanced" key={agent.id}>
     <summary className="set-advanced__s" id="set-g-advanced"><h4 className="set-advanced__h">{t('settingsAdvanced')}</h4><SettingsIcon name="forward" rtl={rtl}/></summary>
     <div className="set-advanced__body">
      <VoiceSpeedPart company={company} agent={agent.id} canManage={canManage} asked={readAt}/>
      {owner&&<section className="dp-sec" aria-labelledby="set-h-danger"><SubLabel id="set-h-danger">{t('settingsDanger')}</SubLabel><ul className="panel-card">
       <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsPause')}</span><span className="panel-row__d">{t('settingsPauseD')}</span></span>
        <button type="button" id="danger-pause" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}>{t('settingsPauseButton')}</button></li>
       {isMain?<li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteMain')}</span></span></li>
        :<DeleteAgent company={company} slug={slug} agent={agent}/>}
      </ul></section>}
     </div>
    </details>
   </div>
   </>)}
  </div>
  {/* design-reference: sovAgentHTML's bar, after the tab panel: hidden until the draft differs from what was saved. Only
      the Owner and the Managers have a field it saves. */}
  {canManage&&<AgentSaveBar company={company} agent={agent.id} name={agent.name}/>}
 </>;
}

// The rules the Agent was told in its chat and keeps (#18; design-reference: rulesHTML): each in its own direction, who
// said it ("you" for the reader, as the reference's firstName) and when. An Owner or a Manager may remove one; the server
// checks that again (remove_agent_rule).
function AgentRules({t,company,userId,rules,canManage,info}:{t:T,company:string,userId:string,rules:Rule[],canManage:boolean,info:ReactNode}) {
 return <section className="dp-sec sov-rules" aria-labelledby="rl-h-t"><h5 className="dp-label" id="rl-h" tabIndex={-1}><span><span id="rl-h-t">{t('settingsRules')} <span className="muted num">{rules.length}</span></span><InfoTip about={t('settingsRules')} id="rl-h-info">{info}</InfoTip></span></h5>
  {rules.length?<ul className="panel-card rl-list">{rules.map(rule=><li key={rule.id} className="panel-row rl-row"><span className="panel-row__icon"><SettingsIcon name="check"/></span>
   <span className="panel-row__text"><span className="panel-row__t" dir="auto">{rule.body}</span><RuleSaid by={rule.said_by===userId?t('settingsRuleYou'):rule.teller?.name||t('member')} at={rule.said_at}/></span>
   {canManage&&<RemoveRule company={company} rule={rule.id} body={rule.body}/>}</li>)}</ul>
  :<div className="panel-card"><p className="panel-empty">{t('settingsRulesEmpty')}</p></div>}</section>;
}

function AccountSection({t,theme,personName,role,roleName,companyName,company,memberNote}:{t:T,theme:string,personName:string,role:string,roleName:string,companyName:string,company:string,memberNote:string}) {
 return <><Head title={t('settingsAccount')} info={t('settingsAccountSub')}/>
  <div className="panel-card">
   <div className="panel-row"><span className="me__av sov-av" aria-hidden="true">{initial(personName)}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{personName}</bdi></span><span className="panel-row__d">{roleName} · <bdi>{companyName}</bdi></span></span></div>
   <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="shield"/></span><span className="panel-row__text"><span className="panel-row__t">{t('settingsYourRole',roleName)}</span>{roleDescription[role]&&<span className="panel-row__d">{t(roleDescription[role])}</span>}</span></div>
  </div>
  <AccountChoices theme={theme}/>
  <MemberNote company={company} note={memberNote}/>
  <PasswordSettings variant="overlay"/></>;
}

// The company's sections whose features come later (#29–#33): each keeps the reference's heading, its explanation and
// its parts in place, empty and marked "Soon", with no sample figures. Learning (#28) has its own section.
function SoonSection({t,section,ro,models}:{t:T,section:OverlaySection,ro:ReactNode,models:ReactNode}) {
 // The Company's Providers, list and details (#617), then the defaults every Agent starts with and speech-to-text below
 // the list, as the approved Providers layout puts them (spec #610).
 if(section==='models') return <><Head title={t('settingsModels')} info={t('settingsModelsSub')}/>{ro}
  {models}</>;
 return null;
}
