'use client';
import { useI18n } from '@/lib/i18n-client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
import { reportClientError } from '@/lib/client-errors';
import { signInMessage, signInFailure } from '@/lib/sign-in-message.mjs';
import { sendResetLink } from './actions';
// The Supabase browser client is large: it loads only when someone signs in.
const browserSupabase=async()=>(await import('@/lib/browser-supabase')).browserSupabase();
// The password goes from this browser straight to the auth service, through the install's gateway, never through gtmworks'
// server: the gateway then counts the auth service's rate limit per visitor's connection, not for the app as a whole.
// The links keep the language chosen on this page.
export default function Form({next}:{next:string}) {
 const {t,language}=useI18n();
 const [message,setMessage]=useState<''|'wrongEmailOrPassword'|'tooManySignInAttempts'|'couldNotSignIn'>('');
 const [pending,setPending]=useState(false);
 async function signIn(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  setPending(true);
  try {
   const {error}=await (await browserSupabase()).auth.signInWithPassword({email:String(data.get('email')||'').trim(),password:String(data.get('password')||'')});
   if(!error) {window.location.assign(next);return;}
   if(error.code!=='invalid_credentials' && error.status!==429) reportClientError('sign-in',signInFailure(error),{stage:'password'});
   setMessage(signInMessage(error));
  } catch(error) { reportClientError('sign-in',signInFailure(error),{stage:'password'}); setMessage('couldNotSignIn'); }
  setPending(false);
 }
 return <form onSubmit={signIn} className="mt-6 space-y-4"><label className="block text-xs text-muted-foreground">{t('email')}<Input dir="ltr" className="field" type="email" name="email" autoComplete="email" required /></label><label className="block text-xs text-muted-foreground">{t('password')}<Input dir="ltr" className="field" type="password" name="password" autoComplete="current-password" required /></label><Button className="w-full" disabled={pending}>{t('signIn')}</Button>{message && <p role="alert">{t(message)}</p>}<p className="text-sm"><a className="link" href={`/forgot-password?language=${language}`}>{t('forgotPassword')}</a></p></form>;
}
export function ForgotForm({invalidLink}:{invalidLink:boolean}) { const {t,language}=useI18n(); const [message, action, pending]=useActionState(sendResetLink,''); return <form action={action} className="mt-6 space-y-4">{invalidLink && !message && <p role="alert">{t('resetLinkInvalid')}</p>}<label className="block text-xs text-muted-foreground">{t('email')}<Input dir="ltr" className="field" type="email" name="email" autoComplete="email" required /></label><Button className="w-full" disabled={pending}>{t('sendResetLink')}</Button>{message && <p role="status">{t(message)}</p>}<p className="text-sm"><a className="link" href={`/sign-in?language=${language}`}>{t('backToSignIn')}</a></p></form>; }
