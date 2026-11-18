'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';

// First run's answer comes back on the page the new workspace lands on, in the address (#169, #186): the toast says the
// workspace is ready and names its main Agent, then the flag leaves the address so a reload does not say it again. A
// team that invited people says how many went: one, several, or none when the step was skipped.
export function FirstRunToast({mode,agent}:{mode:'alone'|'team',agent:string}) {
 const {t}=useI18n();
 useEffect(()=>{
  const url=new URL(location.href);
  const invites=Number.parseInt(url.searchParams.get('invites')||'0',10);
  const text=mode==='alone'?t('firstRunReadyAlone',agent)
   :invites===1?t('firstRunInviteOne',agent)
   :invites>1?t('firstRunInvites',String(invites),agent)
   :t('firstRunReadyTeam',agent);
  toast(text,{icon:mode==='alone'?'check':'team'});
  url.searchParams.delete('first');
  url.searchParams.delete('invites');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 },[mode,agent,t]);
 return null;
}
