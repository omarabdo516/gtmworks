'use client';
import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { holdLeave } from './settings-draft';

// A section of the settings overlay, opened from its list (#161). Pressed while an Agent's draft differs it keeps the
// page, as every way out does (design-reference: sovGo and sovDirty), and gives the save bar its nudge.
export function GuardedSectionLink({id,href,current,className,children}:{id:string,href:string,current:boolean,className:string,children:ReactNode}) {
 const {t}=useI18n();
 return <Link replace className={className} id={id} href={href} aria-current={current?'page':undefined}
  onClick={event=>{ if(holdLeave(t('settingsSaveFirst'))) event.preventDefault(); }}>{children}</Link>;
}
