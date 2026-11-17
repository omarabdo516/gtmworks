'use client';
import { useI18n } from '@/lib/i18n-client';
import { workDate as date } from '@/lib/work-date.mjs';
import type { WaitingItem } from '@/lib/approval-queue';

// An Agent made after the Company's key was set waits on its own profile (#299). No screen sets a key yet, so the card
// says what it waits for and how it ends, and offers nothing to press.
export function AgentKeyWaitCard({item}:{item:WaitingItem}) {
 const {t,language}=useI18n();
 return <div className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingAgentKeyLabel',item.title)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b dir="auto">{item.title}</b></span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  <span className="mcard__q">{t('waitingAgentKeyReason')}</span>
  <span className="ln-meta"><span>{t('waitingAgentKeyWayOut')}</span><span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('waitingAgentKeyBadge')}</span></span>
 </div>;
}
