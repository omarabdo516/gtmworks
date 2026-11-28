'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { inviteeName } from '@/lib/invitee-name.mjs';
import { SettingsIcon } from './settings-icons';
import { InviteLinkSection, type MakeLink } from './invite-link-section';
import { AddMemberSection, type AddMember } from './add-member-section';
import { toast } from './toast';

// The Team table (#15, #185, #187; design-reference: teamTableHTML): one row per Member, the main Agent shown to all,
// and a switch per Agent beside it. Settings, Company and the Team dialog in the account menu draw the same table, so it
// is one component with its saves handed in: the two overlay wrappers bind them to the server actions. An email
// invitation made before Invite links (#953) is listed as ended and can no longer be claimed.
export type TeamAgent={id:string,connection_id:string,name:string,is_default?:boolean};
export type TeamMember={person_id:string,role:string,people:{name:string|null}|null};
export type TeamEndedInvitation={id:string,email:string,role:string};
export type TeamLink={id:string,label:string,role:string,made_by_name:string|null,ends_at:string};
// A Person the Administrator may add from another Company they administer (#952): the Company they come from is shown
// beside their name, as two People may share one.
export type TeamCandidate={person_id:string,name:string,company:string};
export type TeamData={members:TeamMember[],ended:TeamEndedInvitation[],links:TeamLink[],agents:TeamAgent[],allowed:string[],candidates:TeamCandidate[]};
export type SaveSwitch=(company:string,target:string,agent:string,visible:boolean)=>Promise<string>;
export type CancelLink=(link:string)=>Promise<string>;

const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

// One Member × Agent switch, kept as the database holds it. It turns at once and goes back, with the reason, when the
// database refuses.
function AgentSwitch({company,target,agent,agentName,personName,on,label,save}:{company:string,target:string,agent:string,agentName:string,personName:string,on:boolean,label:string,save:SaveSwitch}) {
 const {t}=useI18n(); const router=useRouter();
 const [checked,setChecked]=useState(on); const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 // The table reads its access again after a change, and a refresh can bring another Manager's change: a switch shows the
 // value it is given now, and keeps the one it turned to while its own save is still on its way.
 const given=useRef(on); const waiting=useRef(false);
 useEffect(()=>{
  if(pending) return;
  if(given.current!==on) { given.current=on; waiting.current=true; }
  if(!waiting.current) return;
  waiting.current=false; setChecked(on);
 },[on,pending]);
 return <><button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={pending} onClick={()=>startTransition(async()=>{
  const next=!checked; setChecked(next); setError('');
  const failure=await save(company,target,agent,next);
  if(failure) { setChecked(!next); setError(failure); }
  else { toast(t(next?'settingsAgentShown':'settingsAgentHidden',agentName,personName),{icon:next?'check':'x'}); router.refresh(); }
 })}/>{error&&<span className="set-err" role="alert">{t(error)}</span>}</>;
}

// The Administrator's Cancel on one pending Invite link (#951): it stops the link at once and says so; a refusal stays
// in place with its reason. Both the Team table's row and a Company worked alone's short list draw it.
function CancelInviteLink({link,label,cancelLink}:{link:string,label:string,cancelLink:CancelLink}) {
 const {t}=useI18n();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 const cancel=()=>startTransition(async()=>{
  setError('');
  const failure=await cancelLink(link).catch(()=> 'inviteLinkCancelFailed');
  if(failure) { setError(failure); return; }
  toast(t('inviteLinkCancelled',label),{icon:'x'});
 });
 return <span className="ta-link-act">{error&&<span className="set-err" role="alert">{t(error)}</span>}
  <button type="button" className="link-btn" disabled={pending} aria-label={t('inviteLinkCancelLabel',label)} onClick={cancel}>{t('inviteLinkCancel')}</button></span>;
}

// A pending Invite link (#951) in the Team table: its label, the Role it gives, who made it and when it ends, with the
// Administrator's Cancel. A used link leaves this list (the Person shows as a Member), and a cancelled or ended one stops
// working at once. The row takes its cancel as a prop, so its component test renders it with no server action.
function InviteLinkRow({link,cancelLink,cols}:{link:TeamLink,cancelLink:CancelLink,cols:number}) {
 const {t,locale}=useI18n();
 const day=new Date(link.ends_at).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'});
 return <tr><th scope="row" colSpan={cols}><span className="ta-link">
  <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(link.label)}</span>
   <span className="od-field"><span className="ta-name"><bdi>{link.label}</bdi></span>
    <span className="ta-role">{t(link.role)}{link.made_by_name?<> · {t('inviteLinkMadeBy',link.made_by_name)}</>:null} · {t('inviteLinkEnds',day)}</span>
    <span className="badge ta-pending"><SettingsIcon name="clock"/>{t('inviteLinkBadge')}</span></span></span>
  <CancelInviteLink link={link.id} label={link.label} cancelLink={cancelLink}/>
 </span></th></tr>;
}

// The email invitations ended by #953, where no Team table is drawn (a Company worked alone and its short Team dialog):
// the name made from each email, its Role and that it is done, so the Administrator makes that Person an Invite link.
export function EndedInvitations({ended}:{ended:TeamEndedInvitation[]}) {
 const {t}=useI18n();
 return <ul className="panel-card" aria-label={t('settingsInviteEnded')}>
  {ended.map(invitation=>{const name=inviteeName(invitation.email); return <li className="panel-row" key={invitation.id}>
   <span className="me__av pp-av" aria-hidden="true">{initial(name)}</span>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{name}</bdi></span>
    <span className="panel-row__d">{t(invitation.role)} · <bdi dir="ltr">{invitation.email}</bdi></span>
    <span className="badge ta-pending"><SettingsIcon name="clock"/>{t('settingsInviteEnded')}</span></span>
  </li>;})}
 </ul>;
}

// The same pending links (#951) where no Team table is drawn: a Company worked alone sees its first teammate's link in a
// short list, with the same Cancel, instead of losing track of it until someone joins.
export function PendingLinks({links,cancelLink}:{links:TeamLink[],cancelLink:CancelLink}) {
 const {t,locale}=useI18n();
 return <ul className="panel-card" aria-label={t('inviteLinks')}>
  {links.map(link=>{
   const day=new Date(link.ends_at).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'});
   return <li className="panel-row" key={link.id}>
    <span className="me__av pp-av" aria-hidden="true">{initial(link.label)}</span>
    <span className="panel-row__text"><span className="panel-row__t"><bdi>{link.label}</bdi></span>
     <span className="panel-row__d">{t(link.role)}{link.made_by_name?<> · {t('inviteLinkMadeBy',link.made_by_name)}</>:null} · {t('inviteLinkEnds',day)}</span>
     <span className="badge ta-pending"><SettingsIcon name="clock"/>{t('inviteLinkBadge')}</span></span>
    <CancelInviteLink link={link.id} label={link.label} cancelLink={cancelLink}/>
   </li>;
  })}
 </ul>;
}

export function TeamTable({company,members,ended,links=[],agents,allowed,userId,owner,save,makeLink,cancelLink,add,candidates,hint=true}:{company:string,members:TeamMember[],ended:TeamEndedInvitation[],links?:TeamLink[],agents:TeamAgent[],allowed:ReadonlySet<string>,userId:string,owner:boolean,save:SaveSwitch,makeLink?:MakeLink,cancelLink?:CancelLink,add?:AddMember,candidates?:TeamCandidate[],hint?:boolean}) {
 const {t}=useI18n();
 const who=(member:TeamMember)=>{const label=member.people?.name||t('member'); return <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(label)}</span><span className="od-field"><span className="ta-name"><bdi>{label}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="ta-role">{t(member.role)}</span></span></span>;};
 const others=agents.filter(agent=>!agent.is_default);
 return <><div className="table-wrap"><table className="table ta-table">
  <thead><tr><th scope="col">{t('settingsMember')}</th>{agents.map(agent=><th scope="col" key={agent.id}><span className="ta-ag"><AgentFace agent={agent.id} size={24}/><bdi>{agent.name}</bdi></span></th>)}</tr></thead>
  <tbody>{members.map(member=>{const name=(member.people?.name||t('member')).split(' ')[0]; return <tr key={member.person_id}><th scope="row">{who(member)}</th>
   {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
   {member.role==='owner'?(others.length>0&&<td colSpan={others.length}><span className="ta-all">{t('settingsOwnerSeesAll')}</span></td>)
    :others.map(agent=><td key={agent.id}><AgentSwitch company={company} target={member.person_id} agent={agent.id} agentName={agent.name} personName={name} on={allowed.has(`${member.person_id}:${agent.id}`)} label={`${member.people?.name||t('member')} · ${agent.name}`} save={save}/></td>)}
  </tr>;})}
  {/* An email invitation from before Invite links (#953), ended by the migration: its name, Role and why it is done. */}
  {ended.map(invitation=>{const name=inviteeName(invitation.email); return <tr key={invitation.id}><th scope="row" colSpan={agents.length+1}><span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(name)}</span><span className="od-field"><span className="ta-name"><bdi>{name}</bdi></span><span className="ta-role">{t(invitation.role)} · <bdi dir="ltr">{invitation.email}</bdi></span><span className="badge ta-pending"><SettingsIcon name="clock"/>{t('settingsInviteEnded')}</span></span></span></th></tr>;})}
   {/* An Invite link (#951) still waiting for its Person: its label, Role, maker, end, and Cancel. */}
   {owner&&cancelLink&&links.map(link=><InviteLinkRow key={link.id} link={link} cancelLink={cancelLink} cols={agents.length+1}/>)}
  </tbody></table></div>
 {hint&&<p className="set-hint ta-hint">{t('settingsTeamHint')}</p>}
 {/* An Invite link (#950): the Administrator's way in for a new Person, with the Agents they will see. */}
 {owner&&makeLink&&<InviteLinkSection agents={others} make={makeLink}/>}
 {/* A Person from another Company the Administrator administers, with a Role and Agents and no link (#952). */}
 {owner&&add&&candidates&&candidates.length>0&&<AddMemberSection people={candidates} agents={others} add={add}/>}</>;
}
