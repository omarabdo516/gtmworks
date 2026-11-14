'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { setupCodeFromHash } from '@/lib/setup-link.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
const onHashChange=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
export default function FirstRunForm({invalid}:{invalid?:'setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch'}) {
 const {t,language}=useI18n();
 const [pending,setPending]=useState(false);
 // The setup link's code, from its fragment (issue #50); null on the server, which never sees the fragment.
 const code=useSyncExternalStore(onHashChange,()=>setupCodeFromHash(window.location.hash),()=>null);
 const [checked,setChecked]=useState<{code:string,state:'open'|'refused'}>();
 // The server confirms the code before the form shows. It is asked in the body of a submit request, as the submission
 // carries the code, so no request address or log line holds it; a check creates nothing.
 useEffect(()=>{
  if(!code) return;
  let current=true;
  const body=new URLSearchParams();
  body.set('code',code);
  body.set('check','1');
  fetch('/first-run/submit',{method:'POST',body}).then(response=>response.status===204,()=>false).then(open=>{
   if(current) setChecked({code,state:open?'open':'refused'});
  });
  return ()=>{ current=false; };
 },[code]);
 if(code===null || code && checked?.code!==code) return null;
 if(!code || checked?.state!=='open') return <p role="alert" className="mt-6">{t('setupNeedsLink')}</p>;
 return <form action="/first-run/submit" method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4">
  <input type="hidden" name="language" value={language}/>
  <input type="hidden" name="code" value={code}/>
  <label className="block text-xs text-muted-foreground">{t('yourName')}<Input className="field max-md:min-h-11" dir="auto" name="name" autoComplete="name" required maxLength={120}/></label>
  <label className="block text-xs text-muted-foreground">{t('email')}<Input className="field max-md:min-h-11" dir="ltr" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
  {/* The length rule is checked on the server, so its message is shown in the page's language rather than the browser's. */}
  <label className="block text-xs text-muted-foreground">{t('password')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required/></label>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  <label className="block text-xs text-muted-foreground">{t('firstCompanyName')}<Input className="field max-md:min-h-11" dir="auto" name="company" autoComplete="organization" required maxLength={120}/></label>
  {invalid && <p role="alert">{t(invalid)}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('createAndSignIn')}</Button>
 </form>;
}
