'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { setupCodeFromHash } from '@/lib/setup-link.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
const onHashChange=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
export type PasswordLinkInvalid='passwordTooShort'|'passwordsDoNotMatch'|'passwordNeedsVerificationCode'|'passwordLinkCodeRefused';
export const passwordLinkInvalid:readonly string[]=['passwordTooShort','passwordsDoNotMatch','passwordNeedsVerificationCode','passwordLinkCodeRefused'];
type Checked={code:string,state:'open'|'refused',company?:string,person?:string,email?:string,twoStep?:boolean};

// A password link's page (#954, ADR 0019). Its secret sits after `#`, so the page reads it from the fragment and sends
// it only in a request body. It first asks the server whether the link is open, and for whom; that check changes
// nothing, so opening the link, or a chat app's preview of it, never uses it up. Sending the form does.
export default function PasswordLinkForm({invalid}:{invalid?:PasswordLinkInvalid}) {
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
  fetch('/password/submit',{method:'POST',body}).then(async response=>{
   if(!response.ok) return null;
   const answer=await response.json().catch(()=>null) as {company?:unknown,person?:unknown,email?:unknown,twoStep?:unknown}|null;
   return answer&&typeof answer.company==='string'&&answer.company&&typeof answer.person==='string'&&typeof answer.email==='string'?{company:answer.company,person:answer.person,email:answer.email,twoStep:answer.twoStep===true}:null;
  },()=>null).then(open=>{
   if(current) setChecked(open?{code,state:'open',...open}:{code,state:'refused'});
  });
  return ()=>{ current=false; };
 },[code]);
 if(code===null || code && checked?.code!==code) return null;
 if(!code || checked?.state!=='open') return <p role="alert" className="mt-6">{t('passwordLinkNeedsNew')}</p>;
 return <form action="/password/submit" method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4">
  <p className="text-sm"><bdi>{t('passwordLinkFor',checked.person??'',checked.company??'')}</bdi></p>
  <input type="hidden" name="language" value={language}/>
  <input type="hidden" name="code" value={code}/>
  {/* The account's email, for the browser's password manager to keep the new password with; the server never reads it. */}
  <input type="email" name="username" value={checked.email} autoComplete="username" readOnly hidden/>
  {/* The length rule is checked on the server too, so its message is shown in the page's language rather than the browser's. */}
  <label className="block text-xs text-muted-foreground">{t('newPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required aria-describedby="link-password-rule"/></label>
  <p className="text-xs text-muted-foreground" id="link-password-rule">{t('passwordTooShort')}</p>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  {/* With a verified authenticator the server checks its code before it spends the link (Omar, #954). */}
  {checked.twoStep && <label className="block text-xs text-muted-foreground">{t('verificationCode')}<Input className="field max-md:min-h-11" dir="ltr" name="verification" inputMode="numeric" autoComplete="one-time-code" required/></label>}
  {invalid && <p role="alert">{t(invalid)}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('passwordLinkSave')}</Button>
 </form>;
}
