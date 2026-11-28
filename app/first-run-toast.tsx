'use client';
import { useI18n } from '@/lib/i18n-client';
import { useFlagToast } from './use-flag-toast';

// First run's answer comes back on the page the new workspace lands on, in the address (#169, #186): the toast says the
// workspace is ready and names its main Agent, then the flag leaves the address so a reload does not say it again. A
// team whose step made Invite links says how many: one, several, or none when the step was skipped (#953).
export function FirstRunToast({mode,agent,invites=0}:{mode:'alone'|'team',agent:string,invites?:number}) {
 const {t}=useI18n();
 const text=mode==='alone'?t('firstRunReadyAlone',agent)
  :invites===1?t('firstRunInviteOne',agent)
  :invites>1?t('firstRunInvites',String(invites),agent)
  :t('firstRunReadyTeam',agent);
 useFlagToast(['first','invites'],text,mode==='alone'?'check':'team');
 return null;
}
