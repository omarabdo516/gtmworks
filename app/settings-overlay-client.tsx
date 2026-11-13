'use client';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { closeTarget, overlayHref } from '@/lib/settings-overlay.mjs';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import { SettingsIcon } from './settings-icons';
import { openedFrom as storedFrom } from './settings-opener';


// The full-window overlay (reference: dialog#sov): it holds the keyboard's first stop and closes on Escape.
export function OverlayFrame({slug,children}:{slug:string,children:ReactNode}) {
 const router=useRouter();
 const box=useRef<HTMLDivElement>(null);
 // Opening moves focus into the overlay (the dialog itself), so Tab starts at its close button and section list.
 useEffect(()=>{ if(!box.current?.contains(document.activeElement)) box.current?.focus({preventScroll:true}); },[]);
 useEffect(()=>{
  const keys=(event:globalThis.KeyboardEvent)=>{ if(event.key==='Escape'&&!event.defaultPrevented) router.push(closeTarget(storedFrom(),slug)); };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[router,slug]);
 return <div className="gw sov-root"><div ref={box} className="sov" role="dialog" aria-modal="true" aria-labelledby="sov-title" tabIndex={-1}>{children}</div></div>;
}

export function CloseButton({slug}:{slug:string}) {
 const {t}=useI18n(); const router=useRouter();
 return <button type="button" className="circle-btn" id="sov-close" aria-label={t('settingsCloseLabel')} title={t('settingsCloseTitle')} onClick={()=>router.push(closeTarget(storedFrom(),slug))}><SettingsIcon name="x"/></button>;
}

// Arrow keys move between the choices of one radio group (WAI-ARIA radio pattern); the choice is made with Enter or Space.
function arrows(event:KeyboardEvent<HTMLElement>) {
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
 const items=[...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
 const at=items.indexOf(document.activeElement as HTMLElement); if(at<0) return;
 event.preventDefault();
 const forward=event.key==='ArrowDown'||(event.key==='ArrowLeft')===(document.documentElement.dir==='rtl');
 items[(at+(forward?1:-1)+items.length)%items.length].focus();
}

const darkQuery='(prefers-color-scheme: dark)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(darkQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};
const languages=[{key:'en',name:'languageNameEnglish',description:'languageEnglishDescription'},{key:'ar',name:'languageNameArabic',description:'languageArabicDescription'}] as const;

// "Your account": the look (Light or Dark, saved to the account; a saved "Device" shows what the system shows) and
// the interface language, each saved as soon as it is chosen.
export function AccountChoices({theme}:{theme:string}) {
 const {t,language}=useI18n();
 const systemDark=useSyncExternalStore(subscribe,()=>window.matchMedia(darkQuery).matches,()=>false);
 const dark=theme==='dark'||(theme==='device'&&systemDark);
 const [pending,startTransition]=useTransition();
 const [error,setError]=useState('');
 const save=(name:'theme'|'language',value:string)=>startTransition(async()=>{
  const form=new FormData(); form.set(name,value);
  setError(await (name==='theme'?saveTheme:saveLanguage)('',form));
 });
 return <>
  <section className="dp-sec" aria-labelledby="ac-h-th"><h4 className="dp-label" id="ac-h-th"><span>{t('settingsAppearance')}</span></h4>
   <div className="panel-card set-card"><div className="segmented segmented--field" role="radiogroup" aria-labelledby="ac-h-th" onKeyDown={arrows}>
    {(['light','dark'] as const).map(mode=>{const on=(mode==='dark')===dark; return <button key={mode} type="button" role="radio" id={`ac-th-${mode}`} aria-checked={on} tabIndex={on?0:-1} disabled={pending} onClick={()=>{ if(!on||theme==='device') save('theme',mode); }}>
     <SettingsIcon name={mode==='dark'?'moon':'sun'}/><span>{t(mode==='dark'?'settingsDark':'settingsLight')}</span></button>;})}
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

type Agent={id:string,name:string,is_default:boolean};
async function manage(company:string,intent:'default'|'remove',agent:string) {
 try {
  const response=await fetch('/api/hermes-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,intent,agent})});
  if(response.ok) return '';
  return ((await response.json()) as {error?:string}).error||'hermesAgentFailed';
 } catch { return 'hermesAgentFailed'; }
}

// "Make it main" (reference: mainSetHTML) for the Owner; the server checks the role again (manage_hermes_agent).
export function MakeMain({company,agent,current}:{company:string,agent:Agent,current:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsMakeMain')}</span><span className="panel-row__d">{t('settingsMakeMainD',current)}</span>{error&&<span className="set-err" role="alert">{t(error)}</span>}</span>
  <button type="button" className="btn btn--secondary btn--sm" id="set-make-main" disabled={pending} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'default',agent.id); setError(failure); if(!failure) router.refresh(); })}>{t('settingsMakeMain')}</button></li>;
}

// The danger zone's delete (reference: settingsHTML danger): the name typed again confirms it. It removes the Agent
// from this company only; the main Agent cannot be removed here.
export function DeleteAgent({company,slug,agent}:{company:string,slug:string,agent:Agent}) {
 const {t}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(false); const [typed,setTyped]=useState('');
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <>
  <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteD')}</span></span>
   <button type="button" className="btn btn--secondary btn--sm" id="danger-delete" aria-expanded={open} onClick={()=>{setOpen(value=>!value);setTyped('');setError('');}}>{t('settingsDeleteButton')}</button></li>
  {open&&<li className="danger-confirm" role="group" aria-label={t('settingsDelete',agent.name)}>
   <p>{t('settingsDeleteConfirm',agent.name)}</p>
   <label className="set-label" htmlFor="del-confirm">{t('settingsDeleteType',agent.name)}</label>
   <input className="set-input" id="del-confirm" type="text" dir="auto" autoComplete="off" value={typed} onChange={event=>setTyped(event.target.value)}/>
   {error&&<p className="set-err" role="alert">{t(error)}</p>}
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>setOpen(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" id="del-go" disabled={pending||typed.trim()!==agent.name.trim()} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'remove',agent.id); setError(failure); if(!failure) { router.replace(overlayHref(slug,'agents')); router.refresh(); } })}>{t('settingsDeleteGo')}</button></div>
  </li>}
 </>;
}

