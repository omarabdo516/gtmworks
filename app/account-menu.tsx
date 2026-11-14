'use client';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import Link, { pendingPagePaths } from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import { moreSections, themeChoices } from '@/lib/sidebar.mjs';
import { rememberOpener } from './settings-opener';

const themeIcons={light:'sun',dark:'moon',device:'monitor'} as const;

// Each language is named in itself, the same in both catalogues.
const languages=[{key:'en',name:'languageNameEnglish',description:'languageEnglishDescription'},{key:'ar',name:'languageNameArabic',description:'languageArabicDescription'}] as const;

// The account row at the bottom of the sidebar (reference: #btn-me and its menu): who you are, Settings, the
// interface language and the theme. Both are saved to the account, so every device opens in them. The theme group
// keeps "Device" (follow the system), which the sun/moon button alone cannot choose. Connect apps is not built yet
// (#30). "More sections" reaches the company's existing sections that the reference has no place for. Settings opens
// the full-window settings overlay (app/settings-overlay.tsx), which closes back to the page it was opened from.
// Every page draws its own shell, so a page landing (closing a card, a refresh after a save) draws a new account
// menu. Whether it is open is kept here, outside the shell, for the page it was opened on: that page, or one whose
// data was already on its way when it was opened, so a menu opened while that page was still arriving stays open when
// it lands instead of closing under the pointer, with focus on the item that had it. Any other page, another company
// or Back and Forward close it, as do choosing an item, Escape and a press outside it.
type MenuState={open:boolean,company?:string,paths:string[],focus:number|null,fresh:boolean};
const closedMenu:MenuState={open:false,paths:[],focus:null,fresh:false};
let menuState=closedMenu;
const menuListeners=new Set<()=>void>();
const setMenuState=(next:MenuState)=>{ menuState=next; menuListeners.forEach(listener=>listener()); };
const closeMenu=()=>{ if(menuState.open) setMenuState(closedMenu); };
const subscribeMenu=(listener:()=>void)=>{ menuListeners.add(listener); return ()=>{ menuListeners.delete(listener); }; };

export default function AccountMenu({slug,personName,role,theme,companyName,settingsHref}:{slug?:string,personName:string,role:string,theme:string,companyName?:string,settingsHref?:string}) {
 const {t,language}=useI18n();
 const pathname=usePathname();
 const state=useSyncExternalStore(subscribeMenu,()=>menuState,()=>closedMenu);
 const open=state.open&&state.company===slug&&state.paths.includes(pathname);
 const toggle=()=>open?closeMenu():setMenuState({open:true,company:slug,paths:[pathname,...pendingPagePaths()],focus:null,fresh:true});
 // Kept open for another page or company: it is closed there.
 useEffect(()=>{ if(state.open&&!open) closeMenu(); },[state.open,open]);
 useEffect(()=>{ window.addEventListener('popstate',closeMenu); return ()=>window.removeEventListener('popstate',closeMenu); },[]);
 const [error,setError]=useState('');
 const [pending,startTransition]=useTransition();
 const box=useRef<HTMLDivElement>(null); const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open) return;
  const outside=(event:PointerEvent)=>{if(!box.current?.contains(event.target as Node)) closeMenu();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();closeMenu();button.current?.focus();}};
  document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape,true);
  // Opening focuses the chosen or first item; a menu drawn again for its page puts focus back on the item that had it.
  // `fresh` and `focus` are read only here, so changing them in place redraws nothing.
  const items=[...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')||[])];
  if(menuState.fresh) { box.current?.querySelector<HTMLElement>('[aria-checked="true"],[role^="menuitem"]')?.focus(); menuState.fresh=false; }
  else if(menuState.focus!=null) items[menuState.focus]?.focus();
  return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[open]);
 const choose=(next:string)=>startTransition(async()=>{
  if(next===language) { closeMenu(); return; }
  const form=new FormData(); form.set('language',next);
  const failure=await saveLanguage('',form);
  setError(failure); if(!failure) closeMenu();
 });
 const chooseTheme=(next:string)=>startTransition(async()=>{
  if(next===theme) { closeMenu(); return; }
  const form=new FormData(); form.set('theme',next);
  const failure=await saveTheme('',form);
  setError(failure); if(!failure) closeMenu();
 });
 const initial=personName.trim().slice(0,1).toUpperCase();
 return <div ref={box} className="contents">
  {open&&<div className="menu me-menu" id="me-menu" role="menu" aria-labelledby="btn-me" onFocus={event=>{ const index=[...event.currentTarget.querySelectorAll('[role^="menuitem"]')].indexOf(event.target); if(index>=0) menuState.focus=index; }}>
   <div className="me-menu__head"><span className="me__av" aria-hidden="true">{initial}</span><span className="me__text"><span className="me__name"><bdi>{personName}</bdi></span><span className="me__role">{role}{companyName&&<> · <bdi>{companyName}</bdi></>}</span></span></div>
   {settingsHref&&<><div className="menu__sep" role="separator"/>
    <Link className="menu__item" role="menuitem" href={settingsHref} onClick={()=>{rememberOpener();closeMenu();}}><ShellIcon name="gear"/><span className="menu__t">{t('settings')}<span className="menu__d">{t('settingsMenuDescription')}</span></span></Link></>}
   <div className="menu__sep" role="separator"/>
   <div className="menu__label" id="me-lang-lbl">{t('interfaceLanguage')}</div>
   <div role="group" aria-labelledby="me-lang-lbl">{languages.map(item=><button key={item.key} type="button" className="menu__item" role="menuitemradio" aria-checked={item.key===language} disabled={pending} onClick={()=>choose(item.key)}>
    <span className="menu__t"><span className="lang-native" lang={item.key} dir={item.key==='ar'?'rtl':'ltr'}>{t(item.name)}</span><span className="menu__d">{t(item.description)}</span></span>{item.key===language&&<ShellIcon name="check" className="menu__check"/>}
   </button>)}</div>
   <div className="menu__sep" role="separator"/>
   <div className="menu__label" id="me-theme-lbl">{t('theme')}</div>
   <div role="group" aria-labelledby="me-theme-lbl">{themeChoices.map(choice=><button key={choice} type="button" className="menu__item" role="menuitemradio" aria-checked={choice===theme} disabled={pending} onClick={()=>chooseTheme(choice)}>
    <ShellIcon name={themeIcons[choice]}/><span className="menu__t">{t(choice)}</span>{choice===theme&&<ShellIcon name="check" className="menu__check"/>}
   </button>)}</div>
   {slug&&<><div className="menu__sep" role="separator"/>
    <button type="button" className="menu__item" role="menuitem" aria-disabled="true" title={t('soon')}><ShellIcon name="plug"/><span className="menu__t">{t('shellConnectApps')}<span className="menu__d">{t('soon')}</span></span></button>
    <div className="menu__sep" role="separator"/>
    <div className="menu__label" id="me-more-lbl">{t('shellMoreSections')}</div>
    <div role="group" aria-labelledby="me-more-lbl">{moreSections.map(([path,label,icon])=><Link key={path} className="menu__item" role="menuitem" href={`/c/${slug}/${path}`} onClick={()=>closeMenu()}><ShellIcon name={icon}/><span className="menu__t">{t(label)}</span></Link>)}</div>
   </>}
  </div>}
  <button ref={button} type="button" className="me" id="btn-me" aria-haspopup="menu" aria-expanded={open} aria-controls="me-menu" aria-label={t('accountMenu')} onClick={toggle}>
   <span className="me__av" aria-hidden="true">{initial}</span>
   <span className="me__text"><span className="me__name"><bdi>{personName}</bdi></span><span className="me__role">{role}</span></span>
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
