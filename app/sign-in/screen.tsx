'use client';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { LanguageProvider, useI18n } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import { Auth } from '@/components/paperclip/Auth';
import Form, { ForgotNote } from './form';
import FirstRunForm from '@/app/first-run/form';
import JoinForm, { type JoinInvalid } from '@/app/join/form';
import PasswordLinkForm, { type PasswordLinkInvalid } from '@/app/password/form';

type Mode='sign-in'|'first-run'|'first-owner'|'join'|'forgot'|'password-link';
const copy={'sign-in':['signIn','welcomeBackToYourWorkspace'],'first-run':['setUpGtmworks','firstRunDescription'],'first-owner':['setUpGtmworks','firstOwnerDescription'],join:['joinTitle','joinDescription'],forgot:['forgotPassword','forgotPasswordDescription'],'password-link':['setNewPassword','passwordLinkDescription']} as const;
export default function SignInScreen({next,wordmark,mode='sign-in',invalid,initialLanguage,notice}:{next:string,wordmark:ReactNode,mode?:Mode,invalid?:'setupInvalid'|'passwordTooShort'|'passwordsDoNotMatch'|'firstOwnerEmailTaken'|JoinInvalid|PasswordLinkInvalid,initialLanguage?:Language,notice?:'couldNotAcceptTheInvitation'}) {
 const initial=useI18n().language;
 const [language,setLanguage]=useState<Language>(initialLanguage??initial);
 const {t}=i18n(language);
 useLayoutEffect(()=>{
  const root=document.documentElement,previous={lang:root.lang,dir:root.dir};
  root.lang=language;root.dir=language==='ar'?'rtl':'ltr';
  return ()=>{root.lang=previous.lang;root.dir=previous.dir;};
 },[language]);
 const [title,description]=copy[mode];
 const firstRun=invalid==='inviteLinkEmailTaken'?undefined:invalid;
 return <LanguageProvider language={language}>
  <div className="absolute top-4 end-4 z-10"><label className="text-xs text-muted-foreground">{t('interfaceLanguage')} <select className={mode==='first-run'?'max-md:min-h-11':undefined} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="en">{t('english')}</option><option value="ar">{t('arabic')}</option></select></label></div>
  <Auth wordmark={wordmark} title={t(title)} description={t(description)}>{mode==='first-run'?<FirstRunForm invalid={firstRun}/>:mode==='first-owner'?<FirstRunForm owner invalid={firstRun}/>:mode==='join'?<JoinForm invalid={invalid==='firstOwnerEmailTaken'?undefined:invalid}/>:mode==='forgot'?<ForgotNote/>:mode==='password-link'?<PasswordLinkForm invalid={invalid==='passwordTooShort'||invalid==='passwordsDoNotMatch'?invalid:undefined}/>:<Form next={next} notice={notice}/>}</Auth>
 </LanguageProvider>;
}
