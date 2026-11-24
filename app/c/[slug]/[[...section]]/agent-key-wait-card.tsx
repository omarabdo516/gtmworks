'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { workDate as date } from '@/lib/work-date.mjs';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { rememberOpener } from '@/app/settings-opener';
import type { WaitingItem } from '@/lib/approval-queue';

// An Agent made while the Company had no account that gives it a model waits on its own profile (#299). Every Agent
// starts with the Company's Providers as they stand (#660), so one still waiting truly lacks a subscription or key: the
// card says so in plain words and opens Settings at Providers, and the Agent starts on its own once one is connected.
export function AgentKeyWaitCard({item,slug}:{item:WaitingItem,slug:string}) {
 const {t,language}=useI18n();
 return <Link className="mcard mcard--rule" data-kind={item.kind} href={`${overlayHref(slug,'models')}#md-providers`} onClick={()=>rememberOpener()} aria-label={t('waitingAgentKeyLabel',item.title)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b dir="auto">{item.title}</b></span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  <span className="mcard__q">{t('waitingAgentKeyReason')}</span>
  <span className="ln-meta"><span>{t('waitingAgentKeyWayOut')}</span><span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('waitingAgentKeyBadge')}</span></span>
 </Link>;
}
