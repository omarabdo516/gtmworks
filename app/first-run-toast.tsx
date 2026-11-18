'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';

// First run's answer comes back on the page the new workspace lands on, in the address (#169): the toast says the
// workspace is ready and names its main Agent, then the flag leaves the address so a reload does not say it again.
export function FirstRunToast({mode,agent}:{mode:'alone'|'team',agent:string}) {
 const {t}=useI18n();
 useEffect(()=>{
  toast(t(mode==='alone'?'firstRunReadyAlone':'firstRunReadyTeam',agent),{icon:mode==='alone'?'check':'team'});
  const url=new URL(location.href); url.searchParams.delete('first');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 },[mode,agent,t]);
 return null;
}
