'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { leave } from '@/lib/motion';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { InviteSection } from './invite-section';
import { InviteLinkSection, type MakeLink } from './invite-link-section';
import { TeamTable, PendingLinks, type SendInvite, type SaveSwitch, type TeamData } from './team-table';
import './settings.css';
import './team-dialog.css';

// The Team dialog (#187; design-reference: teamDlgHTML, teamSoloHTML, openTeamDlg): the account menu's "Team" opens it
// over whatever page is open. It is the reference's native dialog, so Escape and a press outside close it; "Done" and
// the x do too. The table is the one Settings, Company draws (app/team-table.tsx), and the Owner alone invites from it.
// A Company worked alone gets the narrower form: the Owner's own row, the invite form already open and the note on what
// joining turns on. The data is read by the server for an Owner or a Manager only, so the dialog holds nothing else; a
// refused read closes it.
export type TeamActions={load:(company:string)=>Promise<TeamData|null>,save:SaveSwitch,saveInvitation:SaveSwitch,invite:SendInvite,makeLink:MakeLink,cancelLink:(link:string)=>Promise<string>};

const leaveMs=190;

export default function TeamDialog({company,alone,userId,owner,role,personName,actions,close}:{company:string,alone:boolean,userId:string,owner:boolean,role:string,personName:string,actions:TeamActions,close:()=>void}) {
 const {t}=useI18n();
 const box=useRef<HTMLDialogElement>(null);
 const [data,setData]=useState<TeamData|null>(null);
 const [closing,setClosing]=useState(false);
 const stop=useRef(()=>{});
 useLayoutEffect(()=>{ const dialog=box.current; if(dialog&&!dialog.open) dialog.showModal(); },[]);
 useEffect(()=>{
  let live=true;
  actions.load(company).then(found=>{ if(live) { if(found) setData(found); else close(); } },()=>{ if(live) close(); });
  return ()=>{ live=false; };
 },[company]); // eslint-disable-line react-hooks/exhaustive-deps -- one read per opening, not per redraw of its answer
 // Opening moves the focus in as the reference does: the first switch, or the email field when working alone. It waits
 // for the read so the first switch exists when the focus arrives.
 useEffect(()=>{
  if(!data||closing) return;
  (alone?document.getElementById('inv-email'):box.current?.querySelector<HTMLElement>('.switch'))?.focus();
 },[data,alone,closing]);
 useEffect(()=>()=>stop.current(),[]);
 const finish=()=>{ stop.current(); const dialog=box.current; if(dialog?.open) dialog.close(); };
 const requestClose=()=>{ if(closing) return; setClosing(true); stop.current=leave(leaveMs,()=>{},finish); };
 // A press on the dialog's own surface (the space around the panel) closes it, but only when it starts and ends there: a
 // selection dragged out of the panel ends on that same surface, and the browser aims the click at the dialog they share.
 const pressed=useRef(false);
 const allowed=new Set(data?.allowed||[]); const invitedAllowed=new Set(data?.invitedAllowed||[]);
 // An invitation sent from the dialog joins the table at once, as the reference redraws its own (sendInvite).
 const invite:SendInvite=async(email,role)=>{
  const answer=await actions.invite(email,role);
  if(!answer.error) { const found=await actions.load(company).catch(()=>null); if(found) setData(found); }
  return answer;
 };
 // A made or cancelled Invite link (#951) joins or leaves the table at once, as the invitation above does.
 const makeLink:MakeLink=async(label,role,agents)=>{
  const answer=await actions.makeLink(label,role,agents);
  if(answer.link) { const found=await actions.load(company).catch(()=>null); if(found) setData(found); }
  return answer;
 };
 const cancelLink=async(link:string)=>{
  const failure=await actions.cancelLink(link).catch(()=> 'inviteLinkCancelFailed');
  if(failure) return failure;
  const found=await actions.load(company).catch(()=>null);
  if(found) setData(found);
  return '';
 };
 return <dialog ref={box} className={`gw modal team-dlg${alone?' team-dlg--solo':''}${closing?' is-closing':''}`} id="team" aria-labelledby="team-title" aria-describedby="team-sub"
  onCancel={event=>{ if(event.cancelable) { event.preventDefault(); requestClose(); } }}
  onMouseDown={event=>{ pressed.current=event.target===event.currentTarget; }}
  onMouseUp={event=>{ const onSurface=pressed.current&&event.target===event.currentTarget; pressed.current=false; if(onSurface) requestClose(); }}
  onClose={()=>{ stop.current(); close(); }}>
  <div className="modal__inner">
   <header className="modal__head">
    <div className="modal__titles"><h2 className="modal__title" id="team-title">{t('team')}</h2><p className="modal__sub" id="team-sub">{alone?t('teamSoloSub'):t('teamSub')}</p></div>
    <button type="button" className="circle-btn" aria-label={t('close')} onClick={requestClose}><ShellIcon name="x"/></button>
   </header>
   {alone?<div className="modal__body ta ta--solo">
    <ul className="panel-card" aria-label={t('teamSoloMembers')}><li className="panel-row"><span className="me__av pp-av" aria-hidden="true">{(personName.trim().slice(0,1)||'?').toUpperCase()}</span>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{personName}</bdi> <span className="ch-you">{t('settingsYouMark')}</span></span><span className="panel-row__d">{role} · {t('teamSoloOwnerD')}</span></span></li></ul>
    {owner&&data&&data.links.length>0&&<PendingLinks links={data.links} cancelLink={cancelLink}/>}
    {owner&&<InviteSection mode="alone" roles={inviteRoles(t)} send={invite}/>}
    {owner&&data&&<InviteLinkSection agents={data.agents.filter(agent=>!agent.is_default)} make={makeLink}/>}
    <p className="inv-note"><ShellIcon name="team"/><span>{t('settingsModeAloneD')}</span></p>
   </div>
   :<div className="modal__body ta sov-ta" aria-busy={!data||undefined}>{data&&<TeamTable company={company} members={data.members} invitations={data.invitations} links={data.links} agents={data.agents} allowed={allowed} invitedAllowed={invitedAllowed} userId={userId} owner={owner} save={actions.save} saveInvitation={actions.saveInvitation} send={invite} makeLink={makeLink} cancelLink={cancelLink}/>}</div>}
   <footer className="modal__foot modal__foot--end"><button type="button" className={alone?'btn btn--secondary':'btn btn--primary'} onClick={requestClose}>{t('teamDone')}</button></footer>
  </div>
 </dialog>;
}
