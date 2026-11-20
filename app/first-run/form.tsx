'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { setupCodeFromHash } from '@/lib/setup-link.mjs';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
const onHashChange=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
type Invalid='setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch'|'firstOwnerEmailTaken';
type Checked={code:string,state:'open'|'refused',company?:string};
// The one-time secret of first run's setup link or of a first-Owner link sits after `#` (issue #50, #383), so the page
// reads it from the fragment and sends it only in a submit body; the server never sees it in an address. A first-Owner
// link answers its check with the Company waiting behind it, which the form shows preset instead of asking for a name.
export default function FirstRunForm({invalid,owner=false}:{invalid?:Invalid,owner?:boolean}) {
 const {t,language}=useI18n();
 const [pending,setPending]=useState(false);
 const code=useSyncExternalStore(onHashChange,()=>setupCodeFromHash(window.location.hash),()=>null);
 const [checked,setChecked]=useState<Checked>();
 const endpoint=owner?'/first-owner/submit':'/first-run/submit';
 // The server confirms the link before the form shows. The check creates nothing, so opening a link never uses it up.
 useEffect(()=>{
  if(!code) return;
  let current=true;
  const body=new URLSearchParams();
  body.set('code',code);
  body.set('check','1');
  fetch(endpoint,{method:'POST',body}).then(async response=>{
    if(!response.ok) return false;
    if(!owner) return true;
    const answer=await response.json().catch(()=>null) as {company?:string}|null;
    return answer&&typeof answer.company==='string'&&answer.company?answer.company:false;
  },()=>false).then(open=>{
    if(current) setChecked({code,state:open?'open':'refused',company:typeof open==='string'?open:undefined});
  });
  return ()=>{ current=false; };
 },[code,endpoint,owner]);
 if(code===null || code && checked?.code!==code) return null;
 if(!code || checked?.state!=='open') return <p role="alert" className="mt-6">{t(owner?'firstOwnerNeedsLink':'setupNeedsLink')}</p>;
 return <form action={endpoint} method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4">
  <input type="hidden" name="language" value={language}/>
  <input type="hidden" name="code" value={code}/>
  <label className="block text-xs text-muted-foreground">{t('yourName')}<Input className="field max-md:min-h-11" dir="auto" name="name" autoComplete="name" required maxLength={120}/></label>
  <label className="block text-xs text-muted-foreground">{t('email')}<Input className="field max-md:min-h-11" dir="ltr" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
  {/* The length rule is checked on the server, so its message is shown in the page's language rather than the browser's. */}
  <label className="block text-xs text-muted-foreground">{t('password')}<Input className="field max-md:min-h-11" dir="ltr" name="password" type="password" autoComplete="new-password" required/></label>
  <label className="block text-xs text-muted-foreground">{t('confirmPassword')}<Input className="field max-md:min-h-11" dir="ltr" name="confirm" type="password" autoComplete="new-password" required/></label>
  {owner?<label className="block text-xs text-muted-foreground">{t('firstOwnerCompany')}<Input className="field max-md:min-h-11" dir="auto" value={checked.company??''} readOnly/></label>
   :<label className="block text-xs text-muted-foreground">{t('firstCompanyName')}<Input className="field max-md:min-h-11" dir="auto" name="company" autoComplete="organization" required maxLength={120}/></label>}
  {invalid && <p role="alert">{t(invalid)}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('createAndSignIn')}</Button>
 </form>;
}
