'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { toast } from '@/app/toast';
import { useSaidWhen } from '@/app/agent-made';
import type { StandingPermission } from '@/lib/standing-permissions.mjs';

// An Agent's "Standing permissions" (#166; design-reference: permsHTML): what it may do without asking again, one row
// per entry its own Engine profile keeps. The first line names the app and the tool, or the entry as the Engine wrote
// it; the second says who allowed it and when, from gtmworks's own record of that decision, and is left out when there
// is none. The reference's made-up limit is not drawn: the Engine keeps no limit for an entry. Not drawn at all when the
// list is empty. It sits after Tools in the Agent's settings and at the end of the Activity tab of its details panel.
// The Owner and Managers see "Revoke" (canRevoke); the server checks the Role again (/api/agent-permissions). After it the
// row goes, the toast says the Agent will ask again, and focus moves as the reference's does: to the panel's settings
// button in the details (`returnTo`), else to the next row's Revoke, the one before it, or the Agent's settings tab.
export function StandingPermissions({company,agent,permissions,canRevoke,returnTo}:{company:string,agent:string,permissions:StandingPermission[],canRevoke:boolean,returnTo?:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [gone,setGone]=useState<string[]>([]); const [pending,setPending]=useState<string|null>(null); const [failed,setFailed]=useState<string|null>(null);
 const shown=permissions.filter(permission=>!gone.includes(permission.entry));
 if(!shown.length) return null;
 const revoke=async(permission:StandingPermission,button:HTMLButtonElement)=>{
  if(pending) return;
  setPending(permission.entry); setFailed(null);
  const done=await fetch('/api/agent-permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,entry:permission.entry})}).then(response=>response.ok,()=>false);
  setPending(null);
  if(!done) { setFailed(permission.entry); return; }
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.sp-revoke')]; const at=buttons.indexOf(button);
  const next=returnTo?document.getElementById(returnTo):buttons[at+1]||buttons[at-1]||document.getElementById('sov-tab-settings');
  setGone(list=>[...list,permission.entry]);
  next?.focus();
  toast(t('agentPermissionRevoked'));
  router.refresh();
 };
 return <section className="dp-sec sp" aria-labelledby={`sp-h-${agent}`}><h3 className="dp-label" id={`sp-h-${agent}`}><span>{t('agentStandingPermissions')}</span></h3>
  <ul className="panel-card">{shown.map(permission=><li key={permission.entry} className="panel-row sp-row">
   <span className="panel-row__icon"><ShellIcon name="shield"/></span>
   <span className="panel-row__text"><span className="panel-row__t"><PermissionName permission={permission}/></span>
    {permission.allowedBy&&permission.allowedAt&&<AllowedBy by={permission.allowedBy} at={permission.allowedAt}/>}
    {failed===permission.entry&&<span className="set-err" role="alert">{t('agentPermissionRevokeFailed')}</span>}</span>
   {canRevoke&&<button type="button" className="link-btn sp-revoke" disabled={pending===permission.entry} aria-label={t('agentPermissionRevokeLabel',nameOf(permission))}
    onClick={event=>revoke(permission,event.currentTarget)}>{t('agentPermissionRevoke')}</button>}
  </li>)}</ul></section>;
}

const nameOf=(permission:StandingPermission)=>permission.app?`${permission.app.name} · ${permission.tool}`:permission.entry;
function PermissionName({permission}:{permission:StandingPermission}) {
 if(!permission.app) return <bdi dir="auto" className="sp-entry">{permission.entry}</bdi>;
 return <><bdi>{permission.app.name}</bdi> · <bdi dir="ltr" className="sp-tool">{permission.tool}</bdi></>;
}
function AllowedBy({by,at}:{by:string,at:string}) {
 const {t}=useI18n(); const {zone,when}=useSaidWhen(at);
 return <span className="panel-row__d sp-by" data-utc={zone}>{t('agentPermissionAllowedBy',by,when)}</span>;
}
