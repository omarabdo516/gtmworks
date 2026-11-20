'use client';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { useCompanyApps } from './company-apps-read';
import { useAppsSheet } from './apps-sheet-open';
import { connectedCount } from './settings-apps-client';
import type { ComposerPlace } from './conversation-composer';

// design-reference: plusMenuHTML's open-apps item and the open-apps case (#202): the menu closes first and the apps
// sheet (app/apps-sheet.tsx) opens over the page with this composer's "+" as its opener, so the address and the
// message being written stay. "N connected" is the count the sidebar's Connect apps shows, once the apps are read; the
// Owner, who alone may connect, is first told what it is for.
export default function ConnectApps({place,close,opener}:{place:ComposerPlace,close:()=>void,opener:()=>HTMLElement|null}) {
 const {t,language}=useI18n(); const apps=useCompanyApps(place.company,language); const open=useAppsSheet();
 const sub=[place.owner&&t('plusConnectTool'),apps&&t('plusConnected',connectedCount(apps))].filter(Boolean).join(' · ');
 return <button type="button" className="menu__item" role="menuitem" aria-haspopup="dialog" onClick={()=>{ close(); open?.(opener()); }}>
  <ShellIcon name="plug"/><span className="menu__t">{t('shellConnectApps')}{sub&&<span className="menu__d">{sub}</span>}</span></button>;
}
