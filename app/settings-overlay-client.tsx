'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import AccountChoicesView from './account-choices-view';
import { setAgentVisible } from './agent-visibility-actions';
import { makeInviteLink, cancelInviteLink } from './invite-link-actions';
import { InviteLinkSection } from './invite-link-section';
import { TeamTable, PendingLinks, type TeamAgent, type TeamEndedInvitation, type TeamLink, type TeamMember } from './team-table';
import { useSaidWhen } from './agent-made';
import { toast } from './toast';

// "Your account": the look and the interface language, each saved as soon as it is chosen (account-choices-view.tsx).
export function AccountChoices({theme}:{theme:string}) {
 return <AccountChoicesView theme={theme} saveTheme={saveTheme} saveLanguage={saveLanguage}/>;
}

type Agent={id:string,name:string,is_default:boolean};
async function manage(company:string,intent:'default'|'remove',agent:string) {
 try {
  const response=await fetch('/api/hermes-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,intent,agent})});
  if(response.ok) return '';
  return ((await response.json()) as {error?:string}).error||'hermesAgentFailed';
 } catch { return 'hermesAgentFailed'; }
}

// "Make it main" (reference: mainSetHTML) for the Owner; the server checks the role again (manage_hermes_agent).
export function MakeMain({company,agent,current}:{company:string,agent:Agent,current:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsMakeMain')}</span><span className="panel-row__d">{t('settingsMakeMainD',current)}</span>{error&&<span className="set-err" role="alert">{t(error)}</span>}</span>
  <button type="button" className="btn btn--secondary btn--sm" id="set-make-main" disabled={pending} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'default',agent.id); setError(failure); if(!failure) { toast(t('settingsMainToast',agent.name)); router.refresh(); } })}>{t('settingsMakeMain')}</button></li>;
}

// The danger zone's delete (reference: settingsHTML danger): the name typed again confirms it. It removes the Agent
// from this company only; the main Agent cannot be removed here.
export function DeleteAgent({company,slug,agent}:{company:string,slug:string,agent:Agent}) {
 const {t}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(false); const [typed,setTyped]=useState('');
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <>
  <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteD')}</span></span>
   <button type="button" className="btn btn--secondary btn--sm" id="danger-delete" aria-expanded={open} onClick={()=>{setOpen(value=>!value);setTyped('');setError('');}}>{t('settingsDeleteButton')}</button></li>
  {open&&<li className="danger-confirm" role="group" aria-label={t('settingsDelete',agent.name)}>
   <p>{t('settingsDeleteConfirm',agent.name)}</p>
   <label className="set-label" htmlFor="del-confirm">{t('settingsDeleteType',agent.name)}</label>
   <input className="set-input" id="del-confirm" type="text" dir="auto" autoComplete="off" value={typed} onChange={event=>setTyped(event.target.value)}/>
   {error&&<p className="set-err" role="alert">{t(error)}</p>}
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>setOpen(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" id="del-go" disabled={pending||typed.trim()!==agent.name.trim()} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'remove',agent.id); setError(failure); if(!failure) { router.replace(overlayHref(slug,'agents')); router.refresh(); } })}>{t('settingsDeleteGo')}</button></div>
  </li>}
 </>;
}


// The company name (reference: settings Company, name field) for the Owner. The server checks the Owner again
// (/api/company-name, rename_company), so the field is only a convenience.
export function CompanyName({company,name}:{company:string,name:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [value,setValue]=useState(name); const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 const save=()=>startTransition(async()=>{
  try {
   const response=await fetch('/api/company-name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,name:value})});
   const body=await response.json() as {name?:string,error?:string};
   if(!response.ok) { setError(body.error||'companyNameInvalid'); return; }
   const renamed=body.name||value;
   setValue(renamed); setError(''); toast(t('settingsCompanyRenamed',renamed)); router.refresh();
  } catch { setError('companyNameInvalid'); }
 });
 const trimmed=value.trim();
 return <form className="co-name-form" onSubmit={event=>{event.preventDefault(); save();}}>
  <div className="co-name"><input className="set-input" id="co-name" name="name" type="text" dir="auto" maxLength={80} required autoComplete="organization" aria-describedby={error?'co-name-status':undefined} value={value} onChange={event=>{setValue(event.target.value); setError('');}}/>
   <button type="submit" className="btn btn--primary btn--sm" disabled={pending||!trimmed||trimmed===name.trim()}>{t('save')}</button></div>
  {error&&<p id="co-name-status" className="set-err" role="alert">{t(error)}</p>}
 </form>;
}

// "Make an invite link" (#950) for a Company worked alone, its make bound to the Administrator's server action. The page
// reads the section again after a successful make, so the new link joins the pending list above it at once (#951).
export function InviteLink({company,agents}:{company:string,agents:TeamAgent[]}) {
 const router=useRouter();
 const make=async(label:string,role:string,chosen:string[])=>{
  const answer=await makeInviteLink(company,label,role,chosen);
  if(answer.link) router.refresh();
  return answer;
 };
 return <InviteLinkSection agents={agents.filter(agent=>!agent.is_default)} make={make}/>;
}

// The pending Invite links of a Company worked alone (#951), cancelled through the Administrator's action; the page reads
// the section again after a cancel, so the row leaves at once.
export function PendingInviteLinks({company,links}:{company:string,links:TeamLink[]}) {
 const router=useRouter();
 const cancelLink=async(link:string)=>{
  const failure=await cancelInviteLink(company,link);
  if(!failure) router.refresh();
  return failure;
 };
 return <PendingLinks links={links} cancelLink={cancelLink}/>;
}

// The Team table (#187), with its switches and its Administrator's Invite links bound to the server actions that check
// the Role again. The same table is drawn by the Team dialog in the account menu (app/team-dialog.tsx). A pending Invite
// link (#951) is made and cancelled through the Administrator's actions; the page reads the table again after either.
export function SettingsTeamTable({company,members,ended,links,agents,allowed,userId,owner}:{company:string,members:TeamMember[],ended:TeamEndedInvitation[],links:TeamLink[],agents:TeamAgent[],allowed:ReadonlySet<string>,userId:string,owner:boolean}) {
 const router=useRouter();
 const makeLink=async(label:string,role:string,chosen:string[])=>{
  const answer=await makeInviteLink(company,label,role,chosen);
  if(answer.link) router.refresh();
  return answer;
 };
 const cancelLink=async(link:string)=>{
  const failure=await cancelInviteLink(company,link);
  if(!failure) router.refresh();
  return failure;
 };
 return <TeamTable company={company} members={members} ended={ended} links={links} agents={agents} allowed={allowed} userId={userId} owner={owner} hint={false}
  save={setAgentVisible} makeLink={makeLink} cancelLink={cancelLink}/>;
}

// Who told the Agent a rule and when (#18; design-reference: rulesHTML, "Said by Omar · Yesterday · 6:40 PM"), in the
// reader's own time zone once the page has hydrated, as the made line is.
export function RuleSaid({by,at}:{by:string,at:string}) {
 const {t}=useI18n(); const {zone,when}=useSaidWhen(at);
 return <span className="panel-row__d rl-said" data-utc={zone}>{t('settingsRuleSaidBy',by,when)}</span>;
}

// An Owner's or a Manager's quiet "Remove" on one rule (#18), drawn like the reference's "Forget this" on a memory note.
// The server checks the role again (remove_agent_rule). Focus moves to the next rule's Remove, or to the list's heading
// when none is left, before the row goes.
export function RemoveRule({company,rule,body}:{company:string,rule:string,body:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const remove=(button:HTMLButtonElement)=>startTransition(async()=>{
  setFailed(false);
  const removed=await fetch('/api/agent-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,rule})}).then(response=>response.ok,()=>false);
  if(!removed) { setFailed(true); return; }
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.rl-remove')]; const at=buttons.indexOf(button);
  (buttons[at+1]||buttons[at-1]||document.getElementById('rl-h'))?.focus();
  router.refresh();
 });
 return <span className="rl-act">{failed&&<span className="set-err" role="alert">{t('settingsRuleRemoveFailed')}</span>}
  <button type="button" className="link-btn rl-remove" disabled={pending} aria-label={t('settingsRuleRemoveLabel',body.length>40?`${body.slice(0,40)}…`:body)} onClick={event=>remove(event.currentTarget)}>{t('settingsRuleRemove')}</button></span>;
}
