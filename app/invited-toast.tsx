'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';

// The members page's invitation ends with the Team table's toast (#169), not an inline line: the action comes back with
// the address it sent to, and the flag leaves the address so a reload does not say it again.
export function InvitedToast({email}:{email:string}) {
 const {t}=useI18n();
 useEffect(()=>{
  toast(t('settingsInviteSent',email));
  const url=new URL(location.href); url.searchParams.delete('invited');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 },[email,t]);
 return null;
}
