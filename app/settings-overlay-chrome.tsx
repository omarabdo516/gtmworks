import type { ReactNode } from 'react';
import Link from '@/lib/link';
import type { I18n } from '@/lib/i18n.mjs';
import { visibleSections, overlayHref, type OverlaySection } from '@/lib/settings-overlay.mjs';
import { OverlayFrame, CloseButton } from './settings-overlay-frame';
import { SettingsIcon } from './settings-icons';

// The overlay's bar, its section list and the place of the open section (reference: dialog#sov), around the section the
// server drew. It imports no server code, so a component test renders the overlay as the server does (#218).
export function OverlayChrome({t,slug,companyName,role,readOnly,section,learningWaiting,initialFocus,children}:{t:I18n['t'],slug:string,companyName:string,role:string,readOnly:boolean,section:OverlaySection,learningWaiting:number,initialFocus?:string,children:ReactNode}) {
 const item=([key,label,icon]:readonly [OverlaySection,string,Parameters<typeof SettingsIcon>[0]['name'],boolean,boolean])=><Link key={key} replace className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} aria-current={key===section?'page':undefined}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span>{key==='learning'&&learningWaiting>0&&<span className="sov-count"><span aria-hidden="true">{learningWaiting}</span><span className="sr-only">{t('settingsLearningWaiting',learningWaiting)}</span></span>}</Link>;
 const list=visibleSections(role);
 return <OverlayFrame slug={slug} initialFocus={initialFocus}>
  <header className="sov__bar">
   <svg className="ws__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
   <h2 className="sov__title" id="sov-title">{t('settings')}</h2><span className="sov__co"><bdi>{companyName}</bdi></span><span className="od-fill"/>
   {readOnly&&<span className="badge sov-ro"><SettingsIcon name="eye"/>{t('settingsReadOnly')}</span>}
   <CloseButton slug={slug}/>
  </header>
  <div className="sov__body">
   <nav className="sov-nav" aria-label={t('settingsSectionsLabel')}>
    <p className="sov-nav__l"><bdi>{companyName}</bdi></p>{list.filter(entry=>!entry[4]).map(item)}
    <p className="sov-nav__l">{t('settingsYou')}</p>{list.filter(entry=>entry[4]).map(item)}
   </nav>
   <div className="sov-main" id="sov-main"><div className={`sov-page sov-page--${section}`}>{children}</div></div>
  </div>
 </OverlayFrame>;
}
