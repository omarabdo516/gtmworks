'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { passwordProblem, passwordNeedsSecondStep } from '@/lib/password.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
import { reportClientError } from '@/lib/client-errors';
// The Supabase browser client is large: it loads only when a password is saved.
const browserSupabase=async()=>(await import('@/lib/browser-supabase')).browserSupabase();
// Sets the signed-in person's password: after a reset link, from an invitation, or from their own settings. The password
// goes from this browser straight to the auth service, never through gtmworks' server. `done` is opened after saving;
// without it the form says the password was saved.
export default function SetPasswordForm({done}:{done?:string}) {
 const {t}=useI18n();
 const [message,setMessage]=useState<{key:'passwordTooShort'|'passwordsDoNotMatch'|'couldNotSavePassword'|'passwordSaved'|'passwordNeedsVerificationCode'|'couldNotStartVerification'|'incorrectCodeTryAgain',saved?:boolean}|null>(null);
 const [pending,setPending]=useState(false);
 // Shown once the session turns out to need the second step: a verified authenticator and an aal1 session (a password
 // sign-in or a reset link). The auth service refuses the password from such a session on its own.
 const [askCode,setAskCode]=useState(false);
 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form=event.currentTarget, data=new FormData(form);
  const problem=passwordProblem(data.get('password'),data.get('confirm') ?? '');
  if(problem) {setMessage({key:problem});return;}
  setPending(true);
  try {
   const db=await browserSupabase();
   const {data:level}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
   if(passwordNeedsSecondStep(level)) {
    const code=String(data.get('code') ?? '').replace(/\s+/g,'');
    if(!code) {setAskCode(true);setMessage({key:'passwordNeedsVerificationCode'});setPending(false);return;}
    const {data:factors}=await db.auth.mfa.listFactors();
    const factorId=factors?.totp[0]?.id;
    const challenge=factorId?await db.auth.mfa.challenge({factorId}):null;
    if(!factorId || !challenge?.data || challenge.error) {
     reportClientError('password',challenge?.error || new Error('No verified authenticator'),{stage:'challenge'});
     setMessage({key:'couldNotStartVerification'});setPending(false);return;
    }
    const verified=await db.auth.mfa.verify({factorId,challengeId:challenge.data.id,code});
    if(verified.error) {reportClientError('password',verified.error,{stage:'verify'});setMessage({key:'incorrectCodeTryAgain'});setPending(false);return;}
   }
   const {error}=await db.auth.updateUser({password:String(data.get('password'))});
   if(error) {
    reportClientError('password',error,{stage:'update'});
    if(error.code==='insufficient_aal') setAskCode(true);
    setMessage({key:error.code==='weak_password'?'passwordTooShort':error.code==='insufficient_aal'?'passwordNeedsVerificationCode':'couldNotSavePassword'});
   } else if(done) {window.location.replace(done);return;}
   else {form.reset();setMessage({key:'passwordSaved',saved:true});}
  } catch(error) { reportClientError('password',error,{stage:'update'}); setMessage({key:'couldNotSavePassword'}); }
  setPending(false);
 }
 return <form onSubmit={save} className="mt-6 space-y-4 password-form">
  <label className="block text-xs text-muted-foreground">{t('newPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required/></label>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  {askCode && <label className="block text-xs text-muted-foreground">{t('verificationCode')}<Input className="field max-md:min-h-11" dir="ltr" name="code" inputMode="numeric" autoComplete="one-time-code" required/></label>}
  <Button className="max-md:min-h-11" type="submit" disabled={pending}>{t('savePassword')}</Button>
  {message && <p role={message.saved?'status':'alert'}>{t(message.key)}</p>}
 </form>;
}
