import './tokens.css';
import './shell.css';
import './settings.css';
import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { createClient } from '@supabase/supabase-js';
import { AgentFaceDot } from './agent-face-dot';
import { agentStates, statusKeys, type AgentStatus } from '@/lib/agent-details.mjs';
import { pickSection, overlayHref, agentsMainFirst, usageTotals, usageModels, usageHeaviest, usageEmpty, agentTab, agentTabFocus, type OverlaySection, type AgentTab } from '@/lib/settings-overlay.mjs';
import { OverlayChrome } from './settings-overlay-chrome';
import { Head, Label } from './settings-overlay-parts';
import { BackLink, FocusReturn } from './settings-overlay-frame';
import { AccountChoices, MakeMain, DeleteAgent, CompanyName, Invite, SettingsTeamTable, RuleSaid, RemoveRule } from './settings-overlay-client';
import { SettingsIcon } from './settings-icons';
import PasswordSettings from './password-settings';
import { UsageTable, UsageModels } from './c/[slug]/[[...section]]/usage';
import { managedUsage, type UsageRow } from '@/lib/company-app-items';
import { readCompanySignIns } from '@/lib/company-sign-in.mjs';
import { engineOf } from '@/lib/company-engine.mjs';
import { readWorkSandbox } from '@/lib/hermes.mjs';
import { readCompanyModels } from '@/lib/engine-settings.mjs';
import { readCompanyKeys } from '@/lib/provider-keys.mjs';
import { readCompanySpeech } from '@/lib/company-speech.mjs';
import { readAgentAbout, type AgentAbout } from '@/lib/agent-about.mjs';
import { readAgentSkills } from '@/lib/company-skills.mjs';
import { readCompanyLearning } from '@/lib/company-learning.mjs';
import { readCompanySkillPage } from '@/lib/company-skill-page.mjs';
import { LearningSection } from './settings-learning';
import { SkillPage } from './settings-skill-page';
import { readAgentInstructions } from '@/lib/agent-instructions.mjs';
import { readAgentVoice, type AgentVoice as AgentVoiceRead } from '@/lib/agent-voice.mjs';
import { CompanySubscriptions, MemberNote, AgentAbout as AgentAboutField, AgentInstructions as AgentInstructionsField, AgentInstructionsReadOnly as AgentInstructionsRead, AgentSkills, AgentSaveBar, AgentVoice as AgentVoiceField, AgentEffort, AgentMorning, DefaultEffort, ProviderKeys, SpeechToText, DefaultModel, EachAgent, AgentModel } from './settings-lazy';
import { MadeLine, OpenedMark } from './agent-made';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { isNewFor } from '@/lib/sidebar.mjs';
import { isolate } from '@/lib/bidi';
import { inviteRoles as teamInviteRoles, roleDescription, orderMembers } from '@/lib/member-roles.mjs';
import AppsSection from './settings-apps';
import { CompanyKnowledge } from './company-knowledge';
import { AgentMemory } from './agent-memory';
import { AgentTabs } from './settings-agent-tabs';
import { readAgentMemory } from '@/lib/agent-memory.mjs';
import type { MemoryNote } from '@/lib/engine.mjs';
import { BackupSection } from './settings-backup';
import { StandingPermissions } from './standing-permissions';
import { readAgentPermissions, type StandingPermission } from '@/lib/standing-permissions.mjs';
import { RoutinesSection } from './settings-routines';
import { readCompanyRoutines } from '@/lib/agent-routines.mjs';
import { readAgentMorning, type MorningRead } from '@/lib/agent-morning.mjs';
import { ProposalNote, ProposalMark } from './settings-proposal';
import { readWaitingChange, readWaitingAgents, countWaitingChanges, waitingChangeHref } from '@/lib/agent-change-waiting.mjs';
import { ownerNames } from '@/lib/company-owners.mjs';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean,created_at:string|null,requested_by:string|null,requester_opened_at:string|null,requester:unknown,lead_made_agents:unknown};
type Member={person_id:string,role:string,people:{name:string|null}|null};
type Invitation={id:string,email:string,role:string};
type Rule={id:string,body:string,said_by:string,said_at:string,teller:{name:string|null}|null};
type T=Awaited<ReturnType<typeof getI18n>>['t'];
// The service client the models section's Owner read settles key holds with (lib/provider-keys.mjs), as the route does.
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});

// The settings overlay (#26; reference: dialog#sov in design-reference/app.js, renderSov). It is route-backed:
// /c/<slug>/settings opens it on the person's first section and ?section=…&agent=… opens any other state, so the
// account menu, links and tests all reach the same screen. It covers the whole window like the reference's dialog,
// so no page is drawn behind it; closing returns to the page it was opened from. Data is read with the signed-in
// person's session (RLS); every change goes through an existing server action or route that checks the role again.
export default async function SettingsOverlay({slug,company,userId,role,personName,workMode,query}:{slug:string,company:{id:string,name:string},userId:string,role:string,personName:string,workMode?:string|null,query:{section?:string,agent?:string,period?:string,message?:string,part?:string,app?:string,signin?:string,skill?:string,tab?:string,focus?:string}}) {
 const {t,language,locale,theme}=await getI18n(); const rtl=language==='ar';
 const db=await supabase();
 // ?agent=<id> alone opens that Agent's page.
 const section=pickSection(query.section??(query.agent?'agents':undefined),role);
 const owner=role==='owner', canManage=owner||role==='manager', canWrite=role!=='viewer';
 const needAgents=['company','agents'].includes(section);
 const agents:Agent[]=needAgents?agentsMainFirst((await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('company_id',company.id).order('name')).data||[]):[];
 const members:Member[]=section==='company'?orderMembers(((await db.from('members').select('person_id,role,people(name)').eq('company_id',company.id).is('removed_at',null)).data||[]) as unknown as Member[]):[];
 // Which Agents each Member sees (#15): every Member's switches, read by an Owner or a Manager.
 const allowed=new Set(section==='company'&&canManage?((await db.from('member_agent_access').select('person_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.person_id}:${row.agent_id}`):[]);
 // Open invitations are rows of the same table (#185), with their own switches, until the person joins.
 const invitations:Invitation[]=section==='company'&&canManage?((await db.from('member_invitations').select('id,email,role').eq('company_id',company.id).is('claimed_at',null).order('created_at')).data||[]):[];
 const invitedAllowed=new Set(invitations.length?((await db.from('invitation_agent_access').select('invitation_id,agent_id').eq('company_id',company.id)).data||[]).map(row=>`${row.invitation_id}:${row.agent_id}`):[]);
 // The Company's model sign-in, read from the root profile of its own Engine (#384, ADR 0018), with that Engine's key,
 // after the database said the person is a member (company_engine_target).
 const subscriptions=section==='models'?await (async()=>{ try { return await readCompanySignIns(db,{company:company.id}); } catch { return {profile:null,profiles:null,signIns:null}; } })():null;
 // Whether the Company's work sandbox answers (#398), read once from its own Engine's ssh backend for the section that
 // says what every Agent can use. The Engine itself not answering leaves this unread; the models section names that.
 const workSandbox=section==='company'?await (async()=>{ try { return await readWorkSandbox(await engineOf(company.id)); } catch { return {state:'unreachable' as const}; } })():null;
 // The Company's default model, each Agent's own and the Owner's model choices (#29), and the providers the Engine takes a
 // key for with whether each has one. Both are read on the server; no key value is ever one of the fields.
 const models=section==='models'?await (async()=>{ try { return await readCompanyModels(db,{company:company.id,owner}); } catch { return {models:null}; } })():null;
 const keys=section==='models'?await (async()=>{ try { return await readCompanyKeys(db,service(),{company:company.id}); } catch { return null; } })():null;
 const speech=section==='models'?await readCompanySpeech(db,{company:company.id}).catch(()=>({provider:null,missing:null})):null;
 // The token use of the period, read from each Company's Agents' profiles in the bundled Engine (#347, #32): the
 // Owner and the Managers see every Company they manage, the same read the database checks.
 const usageRows=section==='usage'?await managedUsage(userId,query.period==='30'?30:7):[];
 // How each Agent learns, and what it learned (#28): its mode read from its own Engine profile, its rules from the
 // database, the Skills the Engine's learning graph marks, and the Company's lessons. A read that fails leaves the
 // service's own refusal on the page, never an empty mode.
 const skillPage=section==='learning'&&query.agent&&query.skill?await readCompanySkillPage(db,{company:company.id,agent:query.agent,name:query.skill,person:userId}).catch(()=>null):null;
 const learning=section==='learning'&&!skillPage?await readCompanyLearning(db,{company:company.id}).catch(()=>({state:'failed' as const,agents:null,rules:null,lessons:null})):null;
 // Every Routine of every Agent the reader sees (#31), read from each Agent's own Engine profile; gtmworks keeps no copy.
 const routines=section==='routines'?await readCompanyRoutines(db,{company:company.id}).catch(()=>({state:'failed' as const,agents:null})):null;
 // The person's own note for the Agents in this Company (RLS: nobody else reads it).
 const memberNote=section==='account'?(await db.from('member_notes').select('note').eq('company_id',company.id).eq('person_id',userId).maybeSingle()).data?.note||'':'';
 const agent=section==='agents'&&query.agent?agents.find(item=>item.id===query.agent):undefined;
 const tab:AgentTab=agentTab(query.tab);
 // The Settings tab reads these (the Memory tab reads only its memory, below). The Agent's own Engine profile: its name,
 // About and title, and whether the profile is its own (#161). Read only on an
 // Agent's page; another Agent on the Company's shared profile would change the main Agent too, so its About is read only.
 // Its own Skills come from that same profile, each as the Engine lists it, with what it learned on its own (#180), and
 // its standing instructions (#176) are the profile's SOUL.md outside the team's rules section, read for every Role.
 // The Agent's voice is its own profile's settings too (#162): the language it listens in, the voice of its provider and
 // the speed, read with the Engine's own defaults. Listen is the Engine speaking with them, asked for from the page.
 // What the Agent may do without asking again (#166): its own Engine profile's standing permissions, with who allowed
 // each, for every Role that sees it. An Engine that cannot be read draws no section, as an empty list does.
 const [about,skills,how,voice,permissions]=agent&&tab==='settings'?await Promise.all([readAgentAbout(db,{company:company.id,agent:agent.id}),readAgentSkills(db,{company:company.id,agent:agent.id}),readAgentInstructions(db,{company:company.id,agent:agent.id}),readAgentVoice(db,{company:company.id,agent:agent.id}),
  readAgentPermissions(db,{company:company.id,agent:agent.id}).catch(()=>({state:'failed',permissions:null}))]):[null,null,null,null,null];
 // The Agent's own model choices (#29), from the Engine for that Agent's profile, so its "Thinks with" rows can change it.
 const agentModel=agent&&tab==='settings'?await (async()=>{ try { return await readCompanyModels(db,{company:company.id,agent:agent.id,owner}); } catch { return {models:null}; } })():null;
 // Good morning (#182): the main Agent's daily message, read from the one job of its own Engine profile; gtmworks keeps
 // no schedule of its own. An Engine that cannot be read leaves the row unread, never drawn off.
 const morning=agent?.is_default&&tab==='settings'?await readAgentMorning(db,{company:company.id,agent:agent.id}).catch(()=>({state:'failed' as const})):null;
 // The memory tab (#193) draws the same AgentMemory as the details panel from this Agent's own Engine profile (#350); an
 // Agent the reader is not shown is not found above, so the page shows the Agents list instead. An Engine that cannot be
 // read leaves the tab unread rather than empty.
 const memory=agent&&tab==='memory'?await readAgentMemory(db,{company:company.id,agent:agent.id}).catch(()=>({state:'failed' as const,main:false,notes:null})):null;
 // Each Agent's state for this reader, read in one call as the sidebar reads it (#184).
 const stateOf=agentStates(section==='agents'?(await db.rpc('agent_states',{c:company.id})).data:null);
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
 const agentsWaiting=owner?await countWaitingChanges(db,company.id).catch(failed('waiting proposals count',0)):0;
 const waitingAgents=owner&&section==='agents'&&!agent&&agentsWaiting>0?await readWaitingAgents(db,company.id).catch(failed('Agents with a waiting proposal',new Set<string>())):new Set<string>();
 const change=agent?await readWaitingChange(db,company.id,agent.id).catch(failed('waiting proposal',null)):null;
 const owners=change&&!owner?await ownerNames(db,company.id).catch(failed<string[]>('Owners',[])):[];
 const pend=change&&<ProposalNote change={change} owner={owner} owners={owners} href={waitingChangeHref(slug,change,{person:userId,owner})}/>;
 const rules:Rule[]=agent?(((await db.from('agent_rules').select('id,body,said_by,said_at,teller:people!said_by(name)').eq('agent_id',agent.id).is('removed_at',null).or('suggestion.is.null,suggestion.eq.approved').order('said_at',{ascending:false})).data||[]) as unknown as Rule[]):[];
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const ro=!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>;
 const page=section==='company'?<CompanySection t={t} company={company} solo={workMode==='alone'} members={members} invitations={invitations} agents={agents} allowed={allowed} invitedAllowed={invitedAllowed} userId={userId} slug={slug} owner={owner} canManage={canManage} roleNames={roleNames} ro={ro} sandbox={workSandbox?.state==='notRunning'}/>
  :section==='agents'?(agent?<AgentPage t={t} rtl={rtl} slug={slug} company={company.id} userId={userId} personName={personName} agent={agent} tab={tab} memory={memory} about={about} skills={skills} how={how} voice={voice} status={stateOf(agent.id)} main={agents[0]} rules={rules} agentModel={agentModel} permissions={permissions?.permissions??[]} morning={morning} owner={owner} canManage={canManage} canWrite={canWrite} learning={role!=='viewer'} pend={pend}/>:<AgentsSection t={t} rtl={rtl} slug={slug} agents={agents} stateOf={stateOf} canManage={canManage} canWrite={canWrite} owner={owner} waiting={waitingAgents}/>)
  :section==='apps'?<AppsSection slug={slug} company={company.id} owner={owner} rtl={rtl} app={query.app} failed={query.signin==='failed'}/>
  :section==='usage'?<UsageSection t={t} locale={locale} slug={slug} company={company.id} rows={usageRows} period={query.period==='30'?30:7}/>
  :section==='learning'?(skillPage?<SkillPage t={t} slug={slug} rtl={rtl} data={skillPage}/>:<LearningSection t={t} slug={slug} company={company.id} canManage={canManage} owner={owner} data={learning}/>)
  :section==='account'?<AccountSection t={t} theme={theme} personName={personName} role={role} roleName={roleNames[role]||''} companyName={company.name} company={company.id} memberNote={memberNote}/>
  :section==='routines'&&routines?<>{ro}<RoutinesSection company={company.id} state={routines.state} agents={routines.agents??[]} canManage={canManage} now={new Date().toISOString()}/></>
  :section==='knowledge'?<><Head title={t('settingsKnowledge')} sub={t('settingsKnowledgeSub')}/>{ro}<CompanyKnowledge slug={slug} company={company.id} canManage={canManage} part={query.part}/></>
  // Backup is the Owner's alone (#33): pickSection never opens it for another Role, and the server renders it only here.
  :section==='backup'&&owner?<BackupSection t={t}/>
  :<SoonSection t={t} section={section} ro={ro} subscriptions={<ModelsSubscriptions company={company.id} companyName={company.name} owner={owner} subscriptions={subscriptions} keyed={keys?.keys?.filter(key=>key.set).map(key=>key.provider)??[]}/>}
    keys={<><ProviderKeys company={company.id} owner={owner} data={keys}/><SpeechToText company={company.id} owner={owner} data={speech}/></>}
    defaultModel={models?.models?<DefaultModel company={company.id} owner={owner} models={models.models.default}/>:null}
    eachAgent={models?.models?<EachAgent company={company.id} owner={owner} models={models.models}/>:null}
    defaultEffort={<DefaultEffort/>}/>;
 // "Change the time" on the morning's card (#183; design-reference: checkin-settings) opens this page on Time, or on the
 // switch while the message is off and Time cannot take the focus.
 const morningFocus=query.focus==='time'&&morning?.state==='found'&&canManage?(morning.routine?.on?'set-ck-time':'set-ck-on'):undefined;
 return <OverlayChrome t={t} slug={slug} companyName={company.name} role={role} readOnly={!canManage} section={section} learningWaiting={learningWaiting} agentsWaiting={agentsWaiting} initialFocus={skillPage?'sov-skill-back':agent?morningFocus??agentTabFocus(tab):undefined}>{page}</OverlayChrome>;
}

// A part of the reference whose feature is not built yet: drawn in its place, empty, and saying "Soon".
const Soon=({t}:{t:T})=><div className="panel-card sov-soon" aria-disabled="true" title={t('soon')}><p className="panel-empty">{t('soon')}</p></div>;
const SoonSec=({t,id,label}:{t:T,id:string,label:string})=><section className="dp-sec" aria-labelledby={id}><Label id={id}>{label}</Label><Soon t={t}/></section>;
const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

function CompanySection({t,company,solo,members,invitations,agents,allowed,invitedAllowed,userId,slug,owner,canManage,roleNames,ro,sandbox}:{t:T,company:{id:string,name:string},solo:boolean,members:Member[],invitations:Invitation[],agents:Agent[],allowed:Set<string>,invitedAllowed:Set<string>,userId:string,slug:string,owner:boolean,canManage:boolean,roleNames:Record<string,string>,ro:ReactNode,sandbox:boolean}) {
 const count=members.length;
 const name=<section className="dp-sec" aria-labelledby="co-h-name"><Label id="co-h-name">{t('settingsCompanyName')}</Label>
  <div className="panel-card set-card">{owner?<div className="set-field"><label className="set-label" htmlFor="co-name">{t('settingsCompanyNameHint')}</label>
   {/* Only the Owner renames the Company (#26); the server checks it again. Other Roles read the name. */}
   <CompanyName key={company.id} company={company.id} name={company.name}/></div>
   :<p className="ro-text"><bdi>{company.name}</bdi></p>}</div></section>;
 const mode=<section className="dp-sec" aria-labelledby="co-h-mode"><Label id="co-h-mode">{t('settingsMode')}</Label>
  <div className="panel-card"><div className="panel-row"><span className="panel-row__icon"><SettingsIcon name={solo?'user':'team'}/></span><span className="panel-row__text">
   <span className="panel-row__t">{solo?t('settingsModeAlone'):t('settingsModeTeam',count)}</span><span className="panel-row__d">{solo?t('settingsModeAloneD'):t('settingsModeTeamD')}</span></span></div></div></section>;
 // Every Agent gets one fixed set of tools (ADR 0018): a read-only line where the level choice was, in the section and
 // hint styles the other Company settings use.
 const tools=<section className="dp-sec" aria-labelledby="co-h-tools"><Label id="co-h-tools">{t('agentToolsTitle')}</Label>
  <p className="set-hint">{t('agentToolsHint')}</p>
  {/* The Company's work sandbox not answering (#398): one plain state in the existing notice style, and no control. */}
  {sandbox&&<p className="ro-note sov-warn" role="note" id="co-sandbox"><SettingsIcon name="shield"/><span>{t('workSandboxNotRunning')}</span></p>}
 </section>;
 const inviteRoles=teamInviteRoles(t);
 const table=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('settingsMembersAgents')}</Label><div className="ta sov-ta">
  <SettingsTeamTable company={company.id} slug={slug} members={members} invitations={invitations} agents={agents} allowed={allowed} invitedAllowed={invitedAllowed} userId={userId} owner={owner}/>
 </div></section>;
 // Alone (#10): no members, no per-member Agents; the Owner invites the first Member here, and the Company becomes a
 // team when that Member accepts.
 const invite=owner&&<Invite mode="alone" company={company.id} slug={slug} roles={inviteRoles}/>;
 const list=<section className="dp-sec" aria-labelledby="co-h-mem"><Label id="co-h-mem">{t('members')} <span className="muted num">{count}</span></Label>
  <div className="panel-card">{members.map(member=><div className="panel-row" key={member.person_id}><span className="me__av pp-av" aria-hidden="true">{initial(member.people?.name||t('member'))}</span><span className="panel-row__text"><span className="panel-row__t"><bdi>{member.people?.name||t('member')}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="panel-row__d">{roleNames[member.role]||''}</span></span></div>)}</div></section>;
 return <><Head title={t('settingsCompany')} sub={t('settingsCompanySub')}/>{ro}
  {name}{mode}{tools}{solo?invite:canManage?table:list}</>;
}

// What a face needs of an Agent: the client component is handed no more of the row than it draws.
const face=({id,connection_id,name}:Agent)=>({id,connection_id,name});

function TalkTip({t,rtl,text,talk}:{t:T,rtl:boolean,text:string,talk?:{href:string,name:string}}) {
 return <p className="talk-tip"><SettingsIcon name="chat"/><span>{isolate(text,rtl)}</span>{talk&&<Link className="link-btn" href={talk.href}>{t('settingsTalkTo',talk.name)}</Link>}</p>;
}

function AgentsSection({t,rtl,slug,agents,stateOf,canManage,canWrite,owner,waiting}:{t:T,rtl:boolean,slug:string,agents:Agent[],stateOf:(agent:string)=>AgentStatus,canManage:boolean,canWrite:boolean,owner:boolean,waiting:Set<string>}) {
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
   {/* An Agent with a change waiting for this Owner ends its row with it in place of its state (#178). */}
   {waiting.has(agent.id)?<ProposalMark/>:<span className="panel-row__meta">{t(statusKeys[stateOf(agent.id)])}</span>}
   <span className="panel-row__icon sov-chev"><SettingsIcon name="forward" rtl={rtl}/></span></Link>)
   :<p className="panel-empty">{t('noAgentsYet')}</p>}</div><FocusReturn/></>;
}

function AgentPage({t,rtl,slug,company,userId,personName,agent,tab,memory,about,skills,how,voice,status,main,rules,agentModel,permissions,morning,owner,canManage,canWrite,learning,pend}:{t:T,rtl:boolean,slug:string,company:string,userId:string,personName:string,agent:Agent,tab:AgentTab,memory:{state:string,main:boolean,notes:MemoryNote[]|null}|null,about:AgentAbout|null,skills:Awaited<ReturnType<typeof readAgentSkills>>,how:Awaited<ReturnType<typeof readAgentInstructions>>,voice:AgentVoiceRead|null,status:AgentStatus,main?:Agent,rules:Rule[],agentModel:{models:{agents:{model:string|null,own:boolean,choosable:boolean,effort:string|null,options:{provider:string,providerName:string,model:string}[]}[]}|null}|null,permissions:StandingPermission[],morning:MorningRead|null,owner:boolean,canManage:boolean,canWrite:boolean,learning:boolean,pend:ReactNode}) {
 const isMain=agent.is_default; const made=madeOf(agent,userId,slug);
 // The handle gtmworks calls the Agent by in messages, which a change of the Engine's name would not touch
 // (lib/conversation-runs.mjs: @ and the name, lowercased).
 const handle=`@${agent.name.trim().toLowerCase()}`;
 // About is editable by the Owner and Managers who see the Agent, on the Agent's own Engine profile only, and only when
 // the Engine was read: an unknown description is never drawn empty and saved over.
 const editable=canManage&&about?.state==='found'&&about.own;
 // A Skill is switchable by the same people, on that same own profile, and only once the Engine listed it (#180).
 const skillsEditable=canManage&&skills?.state==='found'&&skills.own;
 // The standing instructions are the Owner's alone (#176), on the Agent's own profile and only when the Engine was read.
 const howEditable=owner&&how?.state==='found'&&how.own;
 // The Voice section (#162) is editable on the Agent's own profile, and read-only for everyone else: its rows name the
 // speaking language and the real voice with the speed, as the reference's read-only form does.
 const voiceEditable=canManage&&voice?.state==='found'&&voice.own;
 // The thinking level is the Owner's alone (#179), on the Agent's own profile — the Company's `co-` profile is the main
 // Agent's own while it is the profile's keeper — and only once the Engine was read, so an unread level is never drawn
 // as Medium. It is `own`: the keeper's model is choosable too (#425), and an Agent another one shares a profile with has
 // neither.
 const effortEditable=owner&&agentModel?.models?.agents[0]?.own===true&&agentModel.models.agents[0].effort!==null;
 // Good morning (#182) is the Owner's and the Managers' on the main Agent's own profile, once the Engine was read.
 const morningEditable=canManage&&morning?.state==='found';
 const morningProps=morning?.state==='found'?{made:!!morning.routine,on:morning.routine?.on===true,time:morning.routine?.time??null,expr:morning.routine?.schedule.expr??null,display:morning.routine?.schedule.display??null,timezone:morning.routine?.timezone??null,quietYesterday:morning.quietYesterday}:null;
 const spokenLanguage=voice?.state!=='found'?null:voice.language==='ar'?t('settingsVoiceArabic'):voice.language==='en'?t('settingsVoiceEnglish'):voice.language||t('settingsVoiceDetect');
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
  <AgentTabs slug={slug} agent={agent.id} tab={tab} label={agent.name}/>
  {/* design-reference: sovAgentHTML's ${pend}, under the tabs on either tab, while a proposed change waits. */}
  {pend}
  <div id="sov-agent-panel" role="tabpanel" aria-labelledby={`sov-tab-${tab}`}>
   {tab==='memory'
    ?<div className="dp-sections">{memory?.state==='found'?<AgentMemory key={agent.id} company={company} agent={{id:agent.id,name:agent.name}} notes={memory.notes||[]} main={memory.main} canReset={owner} canEdit={canManage} canForget={owner} knowledgeHref={canWrite?overlayHref(slug,'knowledge'):undefined}/>:<section className="dp-sec"><p className="panel-empty">{t('agentMemoryUnread')}</p></section>}</div>
    :(<>
   <TalkTip t={t} rtl={rtl} text={t('settingsTalkTipAgent',agent.name)} talk={canWrite&&!isMain?{href:`/c/${slug}/chat/${agent.id}`,name:agent.name}:undefined}/>
   <div className="dp-sections sov-rules"><AgentRules t={t} company={company} userId={userId} rules={rules} canManage={canManage}/></div>
   <div className="dp-sections">
    {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsAgentsRO')}</span></p>}
    <section className="dp-sec" aria-labelledby="set-h-job"><Label id="set-h-job">{t('settingsJob')}</Label>
     {/* The pinned Engine writes neither a name nor a role for a named profile from its management listener (#161), so
         both are the reference's read-only rows, for every Role. */}
     <ul className="panel-card">
      <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsName')}</span><span className="panel-row__d ro-val" id="set-name-val"><bdi>{agent.name}</bdi> · <bdi dir="ltr">{handle}</bdi></span></span></li>
      <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsRole')}</span><span className="panel-row__d ro-val" id="set-role-val">{agent.speciality?<bdi>{agent.speciality}</bdi>:'—'}</span></span></li>
     </ul></section>
    {mainSec}
    {/* Good morning (#182): the main Agent's daily message, its switch and time saved with the bar; one row for the rest. */}
    {isMain&&<AgentMorning agent={agent.id} editable={morningEditable} morning={morningProps}/>}
    {/* About is the Agent's profile description (#161); the fields after it join its save bar later. */}
    <section className="dp-sec" aria-labelledby="set-h-about"><Label id="set-h-about">{t('settingsAbout')}</Label>
     {editable?<AgentAboutField agent={agent.id} name={agent.name} description={about?.description??''}/>
      :<div className="panel-card"><p className="ro-text" id="set-about">{about?.description||'—'}</p></div>}</section>
    {/* How it works is the profile SOUL.md outside the team's rules section (#176): the Owner edits it, every other Role
        reads it with its line breaks; an Engine that could not be read shows no text at all. A Manager reads the section
        read-only, and its own line says why, apart from the page's one read-only note (the reference's settingsReadHTML). */}
    <section className="dp-sec" aria-labelledby="set-h-how"><Label id="set-h-how">{t('settingsHow')}</Label>
     {!owner&&<p className="set-hint">{t('settingsHowRO')}</p>}
     {howEditable?<AgentInstructionsField agent={agent.id} name={agent.name} instructions={how?.instructions??''} sectionChars={how?.sectionChars??0} limit={how?.limit??20000}/>
      :<AgentInstructionsRead instructions={how?.state==='found'?how.instructions:''} empty={how?.state==='found'?t('settingsHowEmpty'):'—'}/>}</section>
    {/* Thinks with: the Agent's own Engine profile's model (#29), written there and read back, then its thinking level
        (#179): the eight the Engine accepts, saved with the same bar, read as text by every other Role. */}
    <section className="dp-sec" aria-labelledby="set-h-thinks"><Label id="set-h-thinks">{t('settingsThinks')}</Label>
     {agentModel?.models?.agents[0]?<>
      <AgentModel company={company} agent={agent.id} name={agent.name} model={agentModel.models.agents[0].model} options={agentModel.models.agents[0].options} choosable={agentModel.models.agents[0].choosable} owner={owner}/>
      <AgentEffort agent={agent.id} effort={agentModel.models.agents[0].effort} editable={effortEditable}/>
     </>:<div className="panel-card"><p className="panel-empty">{t('settingsModelsUnread')}</p></div>}
     <p className="set-hint">{t('settingsThinksHint')}</p></section>
    {/* The Agent's voice (#162): its language, its real voice with Listen, and the speed. */}
    <section className="dp-sec" aria-labelledby="set-h-voice"><Label id="set-h-voice">{t('settingsVoice')}</Label>
     {voiceEditable?<AgentVoiceField company={company} agent={agent.id} personName={personName} voice={voice}/>
      :<ul className="panel-card">
       <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsVoiceLang')}</span>
        <span className="panel-row__d ro-val" id="set-voice-lang-val">{spokenLanguage??'—'}</span></span></li>
       <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsVoice')}</span>
        <span className="panel-row__d ro-val" id="set-voice-val">{voice?.state==='found'?voice.voiceName??'—':'—'}{voice?.state==='found'&&<> · <bdi dir="ltr">{voice.speed}×</bdi></>}</span></span></li>
      </ul>}
    </section>
    <SoonSec t={t} id="set-h-settingsTools" label={t('settingsTools')}/>
    {/* design-reference: settingsHTML, permsHTML after Tools (#166). */}
    <StandingPermissions key={agent.id} company={company} agent={agent.id} permissions={permissions} canRevoke={canManage}/>
    {/* The Agent's own Skills and their switches (#180); the Company's shared skills stay on the team's Skills page. */}
    <AgentSkills agent={agent.id} name={agent.name} slug={slug} learning={learning} skills={skills?.state==='found'?skills.skills:null} editable={skillsEditable}/>
    {owner&&<section className="dp-sec" aria-labelledby="set-h-danger"><Label id="set-h-danger">{t('settingsDanger')}</Label><ul className="panel-card">
     <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsPause')}</span><span className="panel-row__d">{t('settingsPauseD')}</span></span>
      <button type="button" id="danger-pause" className="btn btn--secondary btn--sm" aria-disabled="true" title={t('soon')}>{t('settingsPauseButton')}</button></li>
     {isMain?<li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteMain')}</span></span></li>
      :<DeleteAgent company={company} slug={slug} agent={agent}/>}
    </ul></section>}
   </div>
   </>)}
  </div>
  {/* design-reference: sovAgentHTML's bar, after the tab panel: hidden until the draft differs from what was saved. */}
  {(editable||skillsEditable||howEditable||voiceEditable||effortEditable||morningEditable)&&<AgentSaveBar company={company} agent={agent.id} name={agent.name}/>}
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

function UsageSection({t,locale,slug,company,rows,period}:{t:T,locale:string,slug:string,company:string,rows:UsageRow[],period:7|30}) {
 const totals=usageTotals(rows,company);
 const models=usageModels(rows,company);
 const heaviest=usageHeaviest(rows,company);
 const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 // A profile two Agents share is one row with both names, as the reference names each Agent on the profile.
 const heaviestName=heaviest?new Intl.ListFormat(locale,{type:'unit'}).format(heaviest.agents.map(agent=>agent.name)):'—';
 const seg=<div className="segmented use-seg" role="group" aria-label={t('settingsPeriod')}>{([[7,'settingsLast7'],[30,'settingsLast30']] as const).map(([days,label])=><Link key={days} replace href={overlayHref(slug,'usage',days===30?{period:'30'}:{})} aria-pressed={period===days} id={`use-p-${days}`}>{t(label)}</Link>)}</div>;
 const kpi=(label:string,value:ReactNode)=><div className="kpi"><span className="kpi__label">{label}</span><span className="kpi__val num">{value}</span></div>;
 return <><Head title={t('usage')} sub={t('settingsUsageSub')} extra={seg}/>
  {usageEmpty(rows)?<div className="panel-card"><p className="panel-empty">{t('usageNone')}</p></div>:<>
   <div className="kpis use-kpis">{kpi(t('settingsTokens'),count(totals.tokens))}{kpi(t('usageSessions'),count(totals.sessions))}{kpi(t('usageHeaviest'),<bdi>{heaviestName}</bdi>)}</div>
   <section className="dp-sec" aria-labelledby="use-h"><Label id="use-h">{t('settingsPerAgent')}</Label>
    <div className="sov-ta"><UsageTable rows={rows}/></div></section>
   {/* Each model's own count, apart from the totals: Hermes merges auxiliary usage into these rows (#32). */}
   {models.length>0&&<section className="dp-sec" aria-labelledby="use-h-model"><Label id="use-h-model">{t('settingsPerModel')}</Label>
    <div className="sov-ta"><UsageModels models={models}/></div></section>}
  </>}</>;
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

// The company's sections whose features come later (#29–#33): each keeps the reference's heading, its explanation and
// its parts in place, empty and marked "Soon", with no sample figures. Learning (#28) has its own section.
function SoonSection({t,section,ro,subscriptions,keys,defaultModel,eachAgent,defaultEffort}:{t:T,section:OverlaySection,ro:ReactNode,subscriptions:ReactNode,keys:ReactNode,defaultModel:ReactNode,eachAgent:ReactNode,defaultEffort:ReactNode}) {
 if(section==='models') return <><Head title={t('settingsModels')} sub={t('settingsModelsSub')}/>{ro}
  {subscriptions}{keys}{defaultModel??<div className="panel-card"><p className="panel-empty">{t('settingsModelsUnread')}</p></div>}
  {defaultEffort}{eachAgent}</>;
 return null;
}

// The Company's connected AI subscriptions. A Company signs its subscription in once on the root profile of its own
// Engine (#384, ADR 0018): the state is read on the server from that Engine, and the Owner's buttons call
// /api/company-sign-in, which checks the Owner again.
function ModelsSubscriptions({company,companyName,owner,subscriptions,keyed}:{company:string,companyName:string,owner:boolean,subscriptions:Awaited<ReturnType<typeof readCompanySignIns>>|null,keyed:string[]}) {
 return <CompanySubscriptions company={company} companyName={companyName} owner={owner} available={subscriptions?.profiles!=null} signIns={subscriptions?.signIns??null} noEngine={subscriptions?.noEngine===true} keyed={keyed}/>;
}
