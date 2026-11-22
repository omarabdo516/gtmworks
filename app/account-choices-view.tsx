'use client';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';
import { themeChoices } from '@/lib/sidebar.mjs';

// Arrow keys move between the choices of one radio group (WAI-ARIA radio pattern); the choice is made with Enter or Space.
function arrows(event:KeyboardEvent<HTMLElement>) {
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
 const items=[...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
 const at=items.indexOf(document.activeElement as HTMLElement); if(at<0) return;
 event.preventDefault();
 const forward=event.key==='ArrowDown'||(event.key==='ArrowLeft')===(document.documentElement.dir==='rtl');
 items[(at+(forward?1:-1)+items.length)%items.length].focus();
}

const languages=[{key:'en',name:'languageNameEnglish',description:'languageEnglishDescription'},{key:'ar',name:'languageNameArabic',description:'languageArabicDescription'}] as const;
type Save=(state:string,form:FormData)=>Promise<string>;

// The three looks (#616): Light and Dark are kept as chosen; System is saved as the account's "device" and follows the
// device's own light or dark setting, as the page's CSS reads it.
// The choices are the account menu's (lib/sidebar.mjs); only their icon and label are drawn here.
const themeLook={light:{icon:'sun',label:'settingsLight'},dark:{icon:'moon',label:'settingsDark'},device:{icon:'monitor',label:'device'}} as const;

// "Your account": the look (Light, Dark or System, saved to the account) and the interface language, each saved as soon
// as it is chosen. While one save is on its way every choice waits, so two saves never race. It takes its two saves as
// props, so its component test renders it with no server action (#218).
export default function AccountChoicesView({theme,saveTheme,saveLanguage}:{theme:string,saveTheme:Save,saveLanguage:Save}) {
 const {t,language}=useI18n();
 const [pending,startTransition]=useTransition();
 const [error,setError]=useState('');
 const save=(name:'theme'|'language',value:string)=>startTransition(async()=>{
  const form=new FormData(); form.set(name,value);
  setError(await (name==='theme'?saveTheme:saveLanguage)('',form));
 });
 return <>
  <section className="dp-sec" aria-labelledby="ac-h-th"><h4 className="dp-label" id="ac-h-th"><span>{t('settingsAppearance')}</span></h4>
   <div className="panel-card set-card"><div className="segmented segmented--field" role="radiogroup" aria-labelledby="ac-h-th" onKeyDown={arrows}>
    {themeChoices.map(key=>{const on=key===theme, look=themeLook[key]; return <button key={key} type="button" role="radio" id={`ac-th-${key}`} aria-checked={on} tabIndex={on?0:-1} disabled={pending} onClick={()=>{ if(!on) save('theme',key); }}>
     <SettingsIcon name={look.icon}/><span>{t(look.label)}</span></button>;})}
   </div></div></section>
  <section className="dp-sec" aria-labelledby="ac-h-lang"><h4 className="dp-label" id="ac-h-lang"><span>{t('interfaceLanguage')}</span></h4>
   <div className="panel-card" role="radiogroup" aria-labelledby="ac-h-lang" onKeyDown={arrows}>{languages.map(item=><button key={item.key} type="button" className="panel-row" role="radio" id={`ac-lang-${item.key}`} aria-checked={item.key===language} tabIndex={item.key===language?0:-1} disabled={pending} onClick={()=>{ if(item.key!==language) save('language',item.key); }}>
    <span className="panel-row__text"><span className="panel-row__t lang-native" lang={item.key} dir={item.key==='ar'?'rtl':'ltr'}>{t(item.name)}</span><span className="panel-row__d">{t(item.description)}</span></span>
    {item.key===language&&<span className="panel-row__meta"><SettingsIcon name="check"/></span>}
   </button>)}</div>
   <p className="set-hint">{t('settingsChatsStayArabic')}</p>
   {error&&<p className="set-err" role="alert">{error}</p>}
  </section>
 </>;
}
