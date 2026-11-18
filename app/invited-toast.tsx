'use client';
import { useI18n } from '@/lib/i18n-client';
import { useFlagToast } from './use-flag-toast';

// The members page's invitation ends with the Team table's toast (#169), not an inline line: the action comes back with
// the invitation's id, the page reads that invitation's email as the person reading it, and the flag leaves the address so
// a reload does not say it again.
export function InvitedToast({email}:{email:string}) {
 const {t}=useI18n();
 useFlagToast(['invited'],t('settingsInviteSent',email));
 return null;
}
