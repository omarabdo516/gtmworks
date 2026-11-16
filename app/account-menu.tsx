'use client';
import { useState, useSyncExternalStore, useTransition } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import AccountMenuView, { type AccountMenuProps } from './account-menu-view';

export default function AccountMenu(props:AccountMenuProps) {
 return <AccountMenuView {...props} saveLanguage={saveLanguage} saveTheme={saveTheme}/>;
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
