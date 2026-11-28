'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { inviteeName } from '@/lib/invite.mjs';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { SettingsIcon } from './settings-icons';
import { InviteSection } from './invite-section';
import { InviteLinkSection, type MakeLink } from './invite-link-section';
import { PasswordLinkButton, PasswordLinkMade, type MakePasswordLink, type MadePasswordLink } from './password-link-section';
import { toast } from './toast';

// The Team table (#15, #185, #187; design-reference: teamTableHTML): one row per Member, the main Agent shown to all,
// and a switch per Agent beside it. Settings, Company and the Team dialog in the account menu draw the same table, so it
// is one component with its saves handed in: the two overlay wrappers bind them to the server actions.
export type TeamAgent={id:string,connection_id:string,name:string,is_default?:boolean};
export type TeamMember={person_id:string,role:string,people:{name:string|null}|null};
export type TeamInvitation={id:string,email:string,role:string};
export type TeamLink={id:string,label:string,role:string,made_by_name:string|null,ends_at:string};
export type TeamData={members:TeamMember[],invitations:TeamInvitation[],links:TeamLink[],agents:TeamAgent[],allowed:string[],invitedAllowed:string[]};
export type SaveSwitch=(company:string,target:{member:string}|{invitation:string},agent:string,visible:boolean)=>Promise<string>;
export type SendInvite=(email:string,role:string)=>Promise<{error?:string}>;
export type CancelLink=(link:string)=>Promise<string>;

const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

// One Member × Agent switch, or one on an invited row, kept with the invitation until the person joins. It turns at
// once and goes back, with the reason, when the database refuses.
function AgentSwitch({company,target,agent,agentName,personName,on,label,save}:{company:string,target:{member:string}|{invitation:string},agent:string,agentName:string,personName:string,on:boolean,label:string,save:SaveSwitch}) {
 const {t}=useI18n(); const router=useRouter();
 const [checked,setChecked]=useState(on); const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 // The table reads its access again after an invite, and a refresh can bring another Manager's change: a switch shows the
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

export function TeamTable({company,members,invitations,links=[],agents,allowed,invitedAllowed,userId,owner,save,saveInvitation,send,makeLink,cancelLink,makePasswordLink,hint=true}:{company:string,members:TeamMember[],invitations:TeamInvitation[],links?:TeamLink[],agents:TeamAgent[],allowed:ReadonlySet<string>,invitedAllowed:ReadonlySet<string>,userId:string,owner:boolean,save:SaveSwitch,saveInvitation:SaveSwitch,send:SendInvite,makeLink?:MakeLink,cancelLink?:CancelLink,makePasswordLink?:MakePasswordLink,hint?:boolean}) {
 const {t}=useI18n();
 const [passwordLink,setPasswordLink]=useState<MadePasswordLink|null>(null);
 // A password link (#954): an Administrator makes one for any other Member, a Manager for any but an Administrator.
 const linkFor=(member:TeamMember)=>member.person_id!==userId&&(owner||member.role!=='owner')?makePasswordLink:undefined;
 const who=(member:TeamMember)=>{const label=member.people?.name||t('member'); return <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(label)}</span><span className="od-field"><span className="ta-name"><bdi>{label}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="ta-role">{t(member.role)}</span></span></span>;};
 const others=agents.filter(agent=>!agent.is_default);
 return <><div className="table-wrap"><table className="table ta-table">
  <thead><tr><th scope="col">{t('settingsMember')}</th>{agents.map(agent=><th scope="col" key={agent.id}><span className="ta-ag"><AgentFace agent={agent.id} size={24}/><bdi>{agent.name}</bdi></span></th>)}</tr></thead>
  <tbody>{members.map(member=>{const name=(member.people?.name||t('member')).split(' ')[0], make=linkFor(member); return <tr key={member.person_id}><th scope="row">{make?<span className="ta-link">{who(member)}<PasswordLinkButton person={member.person_id} name={member.people?.name||t('member')} make={make} made={setPasswordLink}/></span>:who(member)}</th>
   {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
   {member.role==='owner'?(others.length>0&&<td colSpan={others.length}><span className="ta-all">{t('settingsOwnerSeesAll')}</span></td>)
    :others.map(agent=><td key={agent.id}><AgentSwitch company={company} target={{member:member.person_id}} agent={agent.id} agentName={agent.name} personName={name} on={allowed.has(`${member.person_id}:${agent.id}`)} label={`${member.people?.name||t('member')} · ${agent.name}`} save={save}/></td>)}
  </tr>;})}
  {/* An invited person, drawn as the reference draws a pending one (teamTableHTML: Q.pending). */}
  {invitations.map(invitation=>{const name=inviteeName(invitation.email); return <tr key={invitation.id}><th scope="row"><span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(name)}</span><span className="od-field"><span className="ta-name"><bdi>{name}</bdi></span><span className="ta-role">{t(invitation.role)} · <bdi dir="ltr">{invitation.email}</bdi></span><span className="badge ta-pending"><SettingsIcon name="clock"/>{t('settingsInvitePending')}</span></span></span></th>
   {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
   {others.map(agent=><td key={agent.id}><AgentSwitch company={company} target={{invitation:invitation.id}} agent={agent.id} agentName={agent.name} personName={name} on={invitedAllowed.has(`${invitation.id}:${agent.id}`)} label={`${name} · ${agent.name}`} save={saveInvitation}/></td>)}
  </tr>;})}
   {/* An Invite link (#951) still waiting for its Person: its label, Role, maker, end, and Cancel. */}
   {owner&&cancelLink&&links.map(link=><InviteLinkRow key={link.id} link={link} cancelLink={cancelLink} cols={agents.length+1}/>)}
  </tbody></table></div>
 {passwordLink&&<PasswordLinkMade key={passwordLink.link} made={passwordLink} close={()=>setPasswordLink(null)}/>}
 {hint&&<p className="set-hint ta-hint">{t('settingsTeamHint')}</p>}
 {owner&&<InviteSection mode="table" roles={inviteRoles(t)} send={send}/>}
 {/* An Invite link (#950): the Administrator's way in for a new Person, with the Agents they will see. */}
 {owner&&makeLink&&<InviteLinkSection agents={others} make={makeLink}/>}</>;
}
