'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { useCompanyApps } from './company-apps-read';
import { connectedCount } from './settings-apps-client';
import type { ComposerPlace } from './conversation-composer';

// design-reference: open-apps, with Settings, Apps as its place until #202 opens the sheet. "N connected" is the count
// the sidebar's Connect apps shows, once the apps are read; the Owner and Managers are first told what it is for.
export default function ConnectApps({place}:{place:ComposerPlace}) {
 const {t,language}=useI18n(); const apps=useCompanyApps(place.company,language);
 const sub=[place.manage&&t('plusConnectTool'),apps&&t('plusConnected',connectedCount(apps))].filter(Boolean).join(' · ');
 return <Link className="menu__item" role="menuitem" href={`/c/${place.slug}/settings?section=apps`}>
  <ShellIcon name="plug"/><span className="menu__t">{t('shellConnectApps')}{sub&&<span className="menu__d">{sub}</span>}</span></Link>;
}
