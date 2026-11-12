'use client';
import { useState, useTransition } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/paperclip/ui/dropdown-menu';
import { saveTheme } from './theme-actions';
export default function AccountMenu({personName,role,theme}:{personName:string,role:string,theme:string}) {
 const {t,language}=useI18n();
 const [error,setError]=useState('');
 const [pending,startTransition]=useTransition();
 return <><DropdownMenu dir={language==='ar'?'rtl':'ltr'}><DropdownMenuTrigger asChild><button type="button" className="profile w-full text-start" aria-label={t('accountMenu')}><span className="avatar">{personName[0]}</span><span><bdi>{personName}</bdi><br/>{role}</span></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" className="w-56">
  <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel><DropdownMenuRadioGroup value={theme} onValueChange={(choice:string)=>startTransition(async()=>{const form=new FormData();form.set('theme',choice);setError(await saveTheme('',form));})}>
   {([['light',Sun],['dark',Moon],['device',Monitor]] as const).map(([choice,Icon])=><DropdownMenuRadioItem className="min-h-11 px-2 ps-8 [&>span]:start-2 rtl:[&>span]:left-auto" key={choice} value={choice} disabled={pending}><Icon aria-hidden="true"/>{t(choice)}</DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup>
 </DropdownMenuContent></DropdownMenu>{error&&<p role="alert">{error}</p>}</>;
}
