'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
export default function FirstRunForm({code,invalid}:{code?:string,invalid:boolean}) {
 const {t,language}=useI18n();
 const [pending,setPending]=useState(false);
 if(!code) return <p role="alert" className="mt-6">{t('setupNeedsLink')}</p>;
 return <form action="/first-run/submit" method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4">
  <input type="hidden" name="language" value={language}/>
  <input type="hidden" name="code" value={code}/>
  <label className="block text-xs text-muted-foreground">{t('yourName')}<Input className="field max-md:min-h-11" dir="auto" name="name" autoComplete="name" required maxLength={120}/></label>
  <label className="block text-xs text-muted-foreground">{t('email')}<Input className="field max-md:min-h-11" dir="ltr" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
  <label className="block text-xs text-muted-foreground">{t('firstCompanyName')}<Input className="field max-md:min-h-11" dir="auto" name="company" autoComplete="organization" required maxLength={120}/></label>
  {invalid && <p role="alert">{t('setupInvalid')}</p>}
  <Button className="w-full max-md:min-h-11" type="submit" disabled={pending}>{t('createAndSendLink')}</Button>
 </form>;
}
