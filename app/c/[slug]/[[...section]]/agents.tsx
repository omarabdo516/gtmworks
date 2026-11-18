'use client';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import type { ReactNode } from 'react';
// Company settings > Agents: the Hermes connections (children). The agent keys and webhook panels went with the
// external-agent API (#341).
export default function Agents({slug,children}:{slug:string,children:ReactNode}) { const {t}=useI18n();
 return <>
  <nav className="tabs agent-tabs" aria-label={t('companySettings')}><Link className="button" href={`/c/${slug}/settings`}>{t('general')}</Link><Link className="button" href={`/c/${slug}/settings/members`}>{t('members')}</Link><Link className="button" href={`/c/${slug}/settings/work`}>{t('work')}</Link><Link className="button active" aria-current="page" href={`/c/${slug}/settings/agents`}>{t('agents')}</Link></nav>
  <div className="stack">{children}</div>
 </>;
}
