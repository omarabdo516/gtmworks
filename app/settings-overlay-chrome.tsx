import type { ReactNode } from 'react';
import type { I18n } from '@/lib/i18n.mjs';
import type { OverlaySection } from '@/lib/settings-overlay.mjs';
import { OverlayFrame, CloseButton } from './settings-overlay-frame';
import { SettingsIcon } from './settings-icons';
import { SettingsNav } from './settings-nav';

// The overlay's bar, its section list with its search (settings-nav.tsx) and the place of the open section (reference:
// dialog#sov), around the section the server drew. It imports no server code, so a component test renders the overlay as the server does (#218).
export function OverlayChrome({t,slug,companyName,role,readOnly,section,learningWaiting,agentsWaiting=0,initialFocus,children}:{t:I18n['t'],slug:string,companyName:string,role:string,readOnly:boolean,section:OverlaySection,learningWaiting:number,agentsWaiting?:number,initialFocus?:string,children:ReactNode}) {
 return <OverlayFrame slug={slug} initialFocus={initialFocus}>
  <header className="sov__bar">
   <svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
   <h2 className="sov__title" id="sov-title">{t('settings')}</h2><span className="sov__co"><bdi>{companyName}</bdi></span><span className="od-fill"/>
   {readOnly&&<span className="badge sov-ro"><SettingsIcon name="eye"/>{t('settingsReadOnly')}</span>}
   <CloseButton/>
  </header>
  <div className="sov__body">
   <SettingsNav slug={slug} companyName={companyName} role={role} section={section} learningWaiting={learningWaiting} agentsWaiting={agentsWaiting}/>
   <div className="sov-main" id="sov-main"><div className={`sov-page sov-page--${section}`}>{children}</div></div>
  </div>
 </OverlayFrame>;
}
