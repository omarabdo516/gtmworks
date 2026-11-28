'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';
import { writeClipboard } from './settings-backup-copy';
import { toast } from './toast';

export type MakePasswordLink=(person:string)=>Promise<{link?:string,error?:string}>;
export type MadePasswordLink={name:string,link:string};

// "Password link" on a Member's row of the Team table (#954, ADR 0019), for an Administrator (any Member) and a
// Manager (any Member but an Administrator; the database refuses that one again). It makes the link at once and hands
// it up to be shown below the table; a refusal stays on the row with its reason. It takes its make as a prop, so its
// component test renders it with no server action.
export function PasswordLinkButton({person,name,make,made}:{person:string,name:string,make:MakePasswordLink,made:(link:MadePasswordLink)=>void}) {
 const {t}=useI18n();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 const go=()=>startTransition(async()=>{
  setError('');
  // A make that never answers (the connection dropped) is a failed one, so the button can be pressed again.
  const answer=await make(person).catch(()=>({error:'passwordLinkFailed'} as {link?:string,error?:string}));
  if(!answer.link) { setError(answer.error||'passwordLinkFailed'); return; }
  made({name,link:answer.link});
 });
 return <span className="ta-link-act">{error&&<span className="set-err" role="alert">{t(error)}</span>}
  <button type="button" className="link-btn" disabled={pending} aria-label={t('passwordLinkMakeLabel',name)} onClick={go}>{t('passwordLinkMake')}</button></span>;
}

// The made password link, shown once in full with a copy button, as an Invite link is (app/invite-link-section.tsx).
// Nothing keeps it after this closes: the database holds only its hash.
export function PasswordLinkMade({made,close}:{made:MadePasswordLink,close:()=>void}) {
 const {t}=useI18n();
 const [copied,setCopied]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
 // A newer link remounts this panel (its key is the link), so the copy state starts over with it.
 useEffect(()=>{ document.getElementById('pwl-copy')?.focus(); },[]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const copy=async()=>{
  if(!await writeClipboard(made.link)) return;
  setCopied(true); clearTimeout(timer.current); timer.current=setTimeout(()=>setCopied(false),2000);
  toast(t('passwordLinkCopied',made.name),{icon:'link'});
 };
 return <section className="inv-sec" aria-labelledby="pwl-h">
  <h3 className="dp-label" id="pwl-h"><span>{t('passwordLinkMadeFor',made.name)}</span><button type="button" className="link-btn" onClick={close}>{t('teamDone')}</button></h3>
  <div className="inv">
   <div className="set-field"><label className="set-label sr-only" htmlFor="pwl-link">{t('passwordLinkMadeFor',made.name)}</label>
    <div className="inv-row inv-row--link"><input className="set-input" id="pwl-link" type="text" dir="ltr" readOnly value={made.link} aria-describedby="pwl-link-d" onFocus={event=>event.currentTarget.select()}/>
     <button type="button" className="btn btn--primary inv-go inv-go--flush" id="pwl-copy" onClick={()=>void copy()}><SettingsIcon name="copy"/><span aria-live="polite">{copied?t('settingsBackupCopied'):t('inviteLinkCopy')}</span></button></div></div>
   <p className="set-hint" id="pwl-link-d">{t('passwordLinkOnce')}</p>
  </div></section>;
}
