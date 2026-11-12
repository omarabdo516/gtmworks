'use client';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';

// Each language is named in itself, the same in both catalogues.
const languages=[{key:'en',name:'languageNameEnglish',description:'languageEnglishDescription'},{key:'ar',name:'languageNameArabic',description:'languageArabicDescription'}] as const;

// The account row at the bottom of the sidebar (reference: #btn-me and its menu): who you are, Settings, and the
// interface language. The language is saved to the account, so every device opens in it.
export default function AccountMenu({personName,role,companyName,settingsHref}:{personName:string,role:string,companyName?:string,settingsHref?:string}) {
 const {t,language}=useI18n();
 const [open,setOpen]=useState(false);
 const [error,setError]=useState('');
 const [pending,startTransition]=useTransition();
 const box=useRef<HTMLDivElement>(null); const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open) return;
  const outside=(event:PointerEvent)=>{if(!box.current?.contains(event.target as Node)) setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape,true);
  box.current?.querySelector<HTMLElement>('[aria-checked="true"],[role^="menuitem"]')?.focus();
  return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[open]);
 const choose=(next:string)=>startTransition(async()=>{
  if(next===language) { setOpen(false); return; }
  const form=new FormData(); form.set('language',next);
  const failure=await saveLanguage('',form);
  setError(failure); if(!failure) setOpen(false);
 });
 const initial=personName.trim().slice(0,1).toUpperCase();
 return <div ref={box} className="contents">
  {open&&<div className="menu me-menu" id="me-menu" role="menu" aria-labelledby="btn-me">
   <div className="me-menu__head"><span className="me__av" aria-hidden="true">{initial}</span><span className="me__text"><bdi className="me__name">{personName}</bdi><span className="me__role">{role}{companyName&&<> · <bdi>{companyName}</bdi></>}</span></span></div>
   {settingsHref&&<><div className="menu__sep" role="separator"/>
    <Link className="menu__item" role="menuitem" href={settingsHref} onClick={()=>setOpen(false)}><ShellIcon name="gear"/><span className="menu__t">{t('settings')}<span className="menu__d">{t('settingsMenuDescription')}</span></span></Link></>}
   <div className="menu__sep" role="separator"/>
   <div className="menu__label" id="me-lang-lbl">{t('interfaceLanguage')}</div>
   <div role="group" aria-labelledby="me-lang-lbl">{languages.map(item=><button key={item.key} type="button" className="menu__item" role="menuitemradio" aria-checked={item.key===language} disabled={pending} onClick={()=>choose(item.key)}>
    <span className="menu__t"><span className="lang-native" lang={item.key} dir={item.key==='ar'?'rtl':'ltr'}>{t(item.name)}</span><span className="menu__d">{t(item.description)}</span></span>{item.key===language&&<ShellIcon name="check" className="menu__check"/>}
   </button>)}</div>
  </div>}
  <button ref={button} type="button" className="me" id="btn-me" aria-haspopup="menu" aria-expanded={open} aria-controls="me-menu" aria-label={t('accountMenu')} onClick={()=>setOpen(value=>!value)}>
   <span className="me__av" aria-hidden="true">{initial}</span>
   <span className="me__text"><bdi className="me__name">{personName}</bdi><span className="me__role">{role}</span></span>
   <span className="me__chev" aria-hidden="true"><ShellIcon name="up"/></span>
  </button>
  {error&&<p role="alert" className="sr-only">{error}</p>}
 </div>;
}

const darkQuery='(prefers-color-scheme: dark)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(darkQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};

// The reference's sun/moon button: it flips what is shown now and saves that choice to the account. A saved
// "device" follows the system until the first flip.
export function ThemeToggle({theme}:{theme:string}) {
 const {t}=useI18n();
 const systemDark=useSyncExternalStore(subscribe,()=>window.matchMedia(darkQuery).matches,()=>false);
 const [pending,startTransition]=useTransition();
 const [error,setError]=useState('');
 const dark=theme==='dark'||(theme==='device'&&systemDark);
 return <><button type="button" className="circle-btn" id="btn-theme" aria-pressed={dark} aria-label={dark?t('lightMode'):t('darkMode')} disabled={pending} onClick={()=>startTransition(async()=>{
  const form=new FormData(); form.set('theme',dark?'light':'dark'); setError(await saveTheme('',form));
 })}><ShellIcon name={dark?'sun':'moon'}/></button>{error&&<p role="alert" className="sr-only">{error}</p>}</>;
}
