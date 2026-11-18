'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { inviteeName } from '@/lib/invite.mjs';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { SettingsIcon } from './settings-icons';
import { InviteSection } from './invite-section';

// The Team table (#15, #185, #187; design-reference: teamTableHTML): one row per Member, the main Agent shown to all,
// and a switch per Agent beside it. Settings, Company and the Team dialog in the account menu draw the same table, so it
// is one component with its saves handed in: the two overlay wrappers bind them to the server actions.
export type TeamAgent={id:string,connection_id:string,name:string,is_default?:boolean};
export type TeamMember={person_id:string,role:string,people:{name:string|null}|null};
export type TeamInvitation={id:string,email:string,role:string};
export type TeamData={members:TeamMember[],invitations:TeamInvitation[],agents:TeamAgent[],allowed:string[],invitedAllowed:string[]};
export type SaveSwitch=(company:string,target:{member:string}|{invitation:string},agent:string,visible:boolean)=>Promise<string>;
export type SendInvite=(email:string,role:string)=>Promise<{error?:string}>;

const initial=(name:string)=>name.trim().slice(0,1).toUpperCase()||'?';

// One Member × Agent switch, or one on an invited row, kept with the invitation until the person joins. It turns at
// once and goes back, with the reason, when the database refuses.
function AgentSwitch({company,target,agent,on,label,save}:{company:string,target:{member:string}|{invitation:string},agent:string,on:boolean,label:string,save:SaveSwitch}) {
 const {t}=useI18n(); const router=useRouter();
 const [checked,setChecked]=useState(on); const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <><button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={pending} onClick={()=>startTransition(async()=>{
  const next=!checked; setChecked(next); setError('');
  const failure=await save(company,target,agent,next);
  if(failure) { setChecked(!next); setError(failure); } else router.refresh();
 })}/>{error&&<span className="set-err" role="alert">{t(error)}</span>}</>;
}

export function TeamTable({company,members,invitations,agents,allowed,invitedAllowed,userId,owner,save,saveInvitation,send}:{company:string,members:TeamMember[],invitations:TeamInvitation[],agents:TeamAgent[],allowed:ReadonlySet<string>,invitedAllowed:ReadonlySet<string>,userId:string,owner:boolean,save:SaveSwitch,saveInvitation:SaveSwitch,send:SendInvite}) {
 const {t}=useI18n();
 const who=(member:TeamMember)=>{const label=member.people?.name||t('member'); return <span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(label)}</span><span className="od-field"><span className="ta-name"><bdi>{label}</bdi>{member.person_id===userId&&<> <span className="ch-you">{t('settingsYouMark')}</span></>}</span><span className="ta-role">{t(member.role)}</span></span></span>;};
 const others=agents.filter(agent=>!agent.is_default);
 return <><div className="table-wrap"><table className="table ta-table">
  <thead><tr><th scope="col">{t('settingsMember')}</th>{agents.map(agent=><th scope="col" key={agent.id}><span className="ta-ag"><CompanyAgentFace agent={agent} size={24}/><bdi>{agent.name}</bdi></span></th>)}</tr></thead>
  <tbody>{members.map(member=><tr key={member.person_id}><th scope="row">{who(member)}</th>
   {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
   {member.role==='owner'?(others.length>0&&<td colSpan={others.length}><span className="ta-all">{t('settingsOwnerSeesAll')}</span></td>)
    :others.map(agent=><td key={agent.id}><AgentSwitch company={company} target={{member:member.person_id}} agent={agent.id} on={allowed.has(`${member.person_id}:${agent.id}`)} label={`${member.people?.name||t('member')} · ${agent.name}`} save={save}/></td>)}
  </tr>)}
  {/* An invited person, drawn as the reference draws a pending one (teamTableHTML: Q.pending). */}
  {invitations.map(invitation=>{const name=inviteeName(invitation.email); return <tr key={invitation.id}><th scope="row"><span className="ta-who"><span className="me__av pp-av" aria-hidden="true">{initial(name)}</span><span className="od-field"><span className="ta-name"><bdi>{name}</bdi></span><span className="ta-role">{t(invitation.role)} · <bdi dir="ltr">{invitation.email}</bdi></span><span className="badge ta-pending"><SettingsIcon name="clock"/>{t('settingsInvitePending')}</span></span></span></th>
   {agents.length>0&&<td><span className="ta-all">{t('settingsShownToAll')}</span></td>}
   {others.map(agent=><td key={agent.id}><AgentSwitch company={company} target={{invitation:invitation.id}} agent={agent.id} on={invitedAllowed.has(`${invitation.id}:${agent.id}`)} label={`${name} · ${agent.name}`} save={saveInvitation}/></td>)}
  </tr>;})}</tbody></table></div>
 <p className="set-hint ta-hint">{t('settingsTeamHint')}</p>
 {owner&&<InviteSection mode="table" roles={inviteRoles(t)} send={send}/>}</>;
}
