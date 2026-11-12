'use client';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { LanguageProvider, useI18n } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import { Auth } from '@/components/paperclip/Auth';
import Form from './form';
import FirstRunForm from '@/app/first-run/form';

export default function SignInScreen({next,wordmark,firstRun=false,invalid=false,message,initialLanguage}:{next:string,wordmark:ReactNode,firstRun?:boolean,invalid?:boolean,message?:string,initialLanguage?:Language}) {
 const initial=useI18n().language;
 const [language,setLanguage]=useState<Language>(initialLanguage??initial);
 const {t}=i18n(language);
 useLayoutEffect(()=>{
  const root=document.documentElement,previous={lang:root.lang,dir:root.dir};
  root.lang=language;root.dir=language==='ar'?'rtl':'ltr';
  return ()=>{root.lang=previous.lang;root.dir=previous.dir;};
 },[language]);
 return <LanguageProvider language={language}>
  <div className="absolute top-4 end-4 z-10"><label className="text-xs text-muted-foreground">{t('interfaceLanguage')} <select className={firstRun?'max-md:min-h-11':undefined} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="en">{t('english')}</option><option value="ar">{t('arabic')}</option></select></label></div>
  <Auth wordmark={wordmark} title={t(firstRun?'setUpGtmworks':'signIn')} description={t(firstRun?'firstRunDescription':'welcomeBackToYourWorkspace')}>{firstRun?<FirstRunForm invalid={invalid}/>:<Form next={next} message={message}/>}</Auth>
 </LanguageProvider>;
}
