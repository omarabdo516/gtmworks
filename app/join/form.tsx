'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { setupCodeFromHash } from '@/lib/setup-link.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
import { inviteRoleKeys } from '@/lib/member-roles.mjs';
const onHashChange=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
export type JoinInvalid='setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch'|'inviteLinkEmailTaken';
type Checked={code:string,state:'open'|'refused',company?:string,role?:string};
const roles=new Set(inviteRoleKeys);

// An Invite link's page (#950, ADR 0019). Its secret sits after `#`, so the page reads it from the fragment and sends
// it only in a request body. It first asks the server whether the link is open, and which Company and Role it gives;
// that check changes nothing, so opening the link, or a chat app's preview of it, never uses it up. Sending the form does.
export default function JoinForm({invalid}:{invalid?:JoinInvalid}) {
 const {t,language}=useI18n();
 const [pending,setPending]=useState(false);
 const code=useSyncExternalStore(onHashChange,()=>setupCodeFromHash(window.location.hash),()=>null);
 const [checked,setChecked]=useState<Checked>();
 useEffect(()=>{
  if(!code) return;
  let current=true;
  const body=new URLSearchParams();
  body.set('code',code);
  body.set('check','1');
  fetch('/join/submit',{method:'POST',body}).then(async response=>{
   if(!response.ok) return null;
   const answer=await response.json().catch(()=>null) as {company?:unknown,role?:unknown}|null;
   return answer&&typeof answer.company==='string'&&answer.company&&typeof answer.role==='string'&&roles.has(answer.role)?{company:answer.company,role:answer.role}:null;
  },()=>null).then(open=>{
   if(current) setChecked(open?{code,state:'open',...open}:{code,state:'refused'});
  });
  return ()=>{ current=false; };
 },[code]);
 if(code===null || code && checked?.code!==code) return null;
 if(!code || checked?.state!=='open') return <p role="alert" className="mt-6">{t('inviteLinkNeedsNew')}</p>;
 return <form action="/join/submit" method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4">
  <p className="text-sm"><bdi>{t('joinCompanyAs',checked.company??'',t(checked.role??''))}</bdi></p>
  <input type="hidden" name="language" value={language}/>
  <input type="hidden" name="code" value={code}/>
  <label className="block text-xs text-muted-foreground">{t('yourName')}<Input className="field max-md:min-h-11" dir="auto" name="name" autoComplete="name" required maxLength={120}/></label>
  <label className="block text-xs text-muted-foreground">{t('email')}<Input className="field max-md:min-h-11" dir="ltr" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
  {/* The length rule is checked on the server too, so its message is shown in the page's language rather than the browser's. */}
  <label className="block text-xs text-muted-foreground">{t('password')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required aria-describedby="join-password-rule"/></label>
  <p className="text-xs text-muted-foreground" id="join-password-rule">{t('passwordTooShort')}</p>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  {invalid && <p role="alert">{t(invalid)}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('joinAndSignIn')}</Button>
 </form>;
}
