'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { setupCodeFromHash } from '@/lib/setup-link.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
import { inviteRoleKeys } from '@/lib/member-roles.mjs';
import { reportClientError } from '@/lib/client-errors';
import { signInMessage, signInFailure } from '@/lib/sign-in-message.mjs';
const onHashChange=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
// The Supabase browser client is large: it loads only when someone signs in.
const browserSupabase=async()=>(await import('@/lib/browser-supabase')).browserSupabase();
export type JoinInvalid='setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch'|'inviteLinkEmailTaken'|'couldNotSignIn';
type Checked={code:string,state:'open'|'refused',company?:string,role?:string,member?:boolean};
const roles=new Set(inviteRoleKeys);

// An Invite link's page (#950, ADR 0019). Its secret sits after `#`, so the page reads it from the fragment and sends
// it only in a request body. It first asks the server whether the link is open, and which Company and Role it gives;
// that check changes nothing, so opening the link, or a chat app's preview of it, never uses it up. Sending the form does.
// A Person who already has an account signs in here instead of making a second one (#952): the password goes from this
// browser straight to the auth service, as the sign-in page's does, and the signed-in session sends the link's form.
export default function JoinForm({invalid,signIn=false}:{invalid?:JoinInvalid,signIn?:boolean}) {
 const {t,language}=useI18n();
 const [pending,setPending]=useState(false);
 const [signingIn,setSigningIn]=useState(signIn);
 const [signInError,setSignInError]=useState<''|'wrongEmailOrPassword'|'tooManySignInAttempts'|'couldNotSignIn'>('');
 const signedInForm=useRef<HTMLFormElement>(null);
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
   const answer=await response.json().catch(()=>null) as {company?:unknown,role?:unknown,member?:unknown}|null;
   return answer&&typeof answer.company==='string'&&answer.company&&typeof answer.role==='string'&&roles.has(answer.role)?{company:answer.company,role:answer.role,member:answer.member===true}:null;
  },()=>null).then(open=>{
   if(current) setChecked(open?{code,state:'open',...open}:{code,state:'refused'});
  });
  return ()=>{ current=false; };
 },[code]);
 // Sent back here when the signed-in person was already a Member when the link was claimed (#775, #952): the page's own
 // check sees the still-unused link and the session, and says so without showing the form.
 if(code===null || code && checked?.code!==code) return null;
 if(!code || checked?.state!=='open') return <p role="alert" className="mt-6">{t('inviteLinkNeedsNew')}</p>;
 if(checked.member) return <p role="status" className="mt-6">{t('inviteLinkAlreadyMember')}</p>;
 // The signed-in form sends the link's own form, never the password: the password goes only to the auth service, and the
 // session the browser just made goes with the next request. The server reads the link's hash and spends it in
 // claim_invite_link's one transaction.
 async function joinWithAccount(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  setPending(true); setSignInError('');
  try {
   const {error}=await (await browserSupabase()).auth.signInWithPassword({email:String(data.get('email')||'').trim(),password:String(data.get('password')||'')});
   if(error) {
    if(error.code!=='invalid_credentials' && error.status!==429) reportClientError('join',signInFailure(error),{stage:'password'});
    setSignInError(signInMessage(error)); setPending(false); return;
   }
   signedInForm.current?.submit();
  } catch(error) {
   reportClientError('join',signInFailure(error),{stage:'password'});
   setSignInError('couldNotSignIn'); setPending(false);
  }
 }
 if(signingIn) return <>
  <form onSubmit={joinWithAccount} className="mt-6 space-y-4">
   <p className="text-sm"><bdi>{t('joinCompanyAs',checked.company??'',t(checked.role??''))}</bdi></p>
   <label className="block text-xs text-muted-foreground">{t('email')}<Input className="field max-md:min-h-11" dir="ltr" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
   <label className="block text-xs text-muted-foreground">{t('password')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="current-password" required/></label>
   {signInError && <p role="alert">{t(signInError)}</p>}
   {invalid && signIn && <p role="alert">{t(invalid)}</p>}
   <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('inviteLinkSignInJoin')}</Button>
   <p className="text-sm"><Button type="button" variant="link" className="px-0 text-sm" disabled={pending} onClick={()=>{setSigningIn(false);setSignInError('');}}>{t('inviteLinkMakeAccount')}</Button></p>
  </form>
  <form ref={signedInForm} action="/join/submit" method="post" className="hidden" aria-hidden="true">
   <input type="hidden" name="language" value={language}/>
   <input type="hidden" name="code" value={code}/>
   <input type="hidden" name="mode" value="signin"/>
  </form>
 </>;
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
  {invalid && !signIn && <p role="alert">{t(invalid)}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('joinAndSignIn')}</Button>
  <p className="text-sm"><Button type="button" variant="link" className="px-0 text-sm" disabled={pending} onClick={()=>{setSigningIn(true);setSignInError('');}}>{t('inviteLinkHaveAccount')}</Button></p>
 </form>;
}
