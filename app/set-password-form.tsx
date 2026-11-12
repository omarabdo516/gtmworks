'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { passwordProblem } from '@/lib/password.mjs';
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
 const [message,setMessage]=useState<{key:'passwordTooShort'|'passwordsDoNotMatch'|'couldNotSavePassword'|'passwordSaved',saved?:boolean}|null>(null);
 const [pending,setPending]=useState(false);
 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form=event.currentTarget, data=new FormData(form);
  const problem=passwordProblem(data.get('password'),data.get('confirm') ?? '');
  if(problem) {setMessage({key:problem});return;}
  setPending(true);
  try {
   const {error}=await (await browserSupabase()).auth.updateUser({password:String(data.get('password'))});
   if(error) {
    reportClientError('password',error,{stage:'update'});
    setMessage({key:error.code==='weak_password'?'passwordTooShort':'couldNotSavePassword'});
   } else if(done) {window.location.replace(done);return;}
   else {form.reset();setMessage({key:'passwordSaved',saved:true});}
  } catch(error) { reportClientError('password',error,{stage:'update'}); setMessage({key:'couldNotSavePassword'}); }
  setPending(false);
 }
 return <form onSubmit={save} className="mt-6 space-y-4 password-form">
  <label className="block text-xs text-muted-foreground">{t('newPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required/></label>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  <Button className="max-md:min-h-11" type="submit" disabled={pending}>{t('savePassword')}</Button>
  {message && <p role={message.saved?'status':'alert'}>{t(message.key)}</p>}
 </form>;
}
