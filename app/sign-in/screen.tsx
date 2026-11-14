'use client';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { LanguageProvider, useI18n } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import { Auth } from '@/components/paperclip/Auth';
import Form, { ForgotForm } from './form';
import FirstRunForm from '@/app/first-run/form';
import SetPasswordForm from '@/app/set-password-form';

type Mode='sign-in'|'first-run'|'forgot'|'reset';
const copy={'sign-in':['signIn','welcomeBackToYourWorkspace'],'first-run':['setUpGtmworks','firstRunDescription'],forgot:['forgotPassword','resetPasswordDescription'],reset:['setNewPassword','setNewPasswordDescription']} as const;
export default function SignInScreen({next,wordmark,mode='sign-in',invalid,invalidLink=false,initialLanguage}:{next:string,wordmark:ReactNode,mode?:Mode,invalid?:'setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch',invalidLink?:boolean,initialLanguage?:Language}) {
 const initial=useI18n().language;
 const [language,setLanguage]=useState<Language>(initialLanguage??initial);
 const {t}=i18n(language);
 useLayoutEffect(()=>{
  const root=document.documentElement,previous={lang:root.lang,dir:root.dir};
  root.lang=language;root.dir=language==='ar'?'rtl':'ltr';
  return ()=>{root.lang=previous.lang;root.dir=previous.dir;};
 },[language]);
 const [title,description]=copy[mode];
 return <LanguageProvider language={language}>
  <div className="absolute top-4 end-4 z-10"><label className="text-xs text-muted-foreground">{t('interfaceLanguage')} <select className={mode==='first-run'?'max-md:min-h-11':undefined} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="en">{t('english')}</option><option value="ar">{t('arabic')}</option></select></label></div>
  <Auth wordmark={wordmark} title={t(title)} description={t(description)}>{mode==='first-run'?<FirstRunForm invalid={invalid}/>:mode==='forgot'?<ForgotForm invalidLink={invalidLink}/>:mode==='reset'?<SetPasswordForm done={next}/>:<Form next={next}/>}</Auth>
 </LanguageProvider>;
}
