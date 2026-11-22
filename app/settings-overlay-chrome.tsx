import type { ReactNode } from 'react';
import type { I18n } from '@/lib/i18n.mjs';
import { overlaySections, sectionGroup, type OverlaySection } from '@/lib/settings-overlay.mjs';
import { OverlayFrame, CloseButton } from './settings-overlay-frame';
import { SettingsIcon } from './settings-icons';
import { SettingsNav } from './settings-nav';

// The overlay's bar, its section list with its search (settings-nav.tsx) and the place of the open section (reference:
// dialog#sov), around the section the server drew. It imports no server code, so a component test renders the overlay
// as the server does (#218).
export function OverlayChrome({t,slug,companyName,role,readOnly,section,learningWaiting,agentsWaiting=0,initialFocus,children}:{t:I18n['t'],slug:string,companyName:string,role:string,readOnly:boolean,section:OverlaySection,learningWaiting:number,agentsWaiting?:number,initialFocus?:string,children:ReactNode}) {
 // The breadcrumb (#612): Settings › the open page's group › the page, the last crumb the page itself.
 const page=overlaySections.find(([key])=>key===section)?.[1];
 // A page named as its group (Company, Agents) is one crumb, not the same word twice.
 const group=sectionGroup(section)?.label===page?null:sectionGroup(section);
 return <OverlayFrame slug={slug} initialFocus={initialFocus}>
  <header className="sov__bar">
   <nav className="sov-crumbs" aria-label={t('breadcrumb')}><ol>
    <li><h2 className="sov__title" id="sov-title">{t('settings')}</h2></li>
    {group&&<li><SettingsIcon name="back"/><span>{t(group.label)}</span></li>}
    {page&&<li aria-current="page"><SettingsIcon name="back"/><span className="sov-crumbs__cur">{t(page)}</span></li>}
   </ol></nav>
   <span className="sov__co"><bdi>{companyName}</bdi></span><span className="od-fill"/>
   {readOnly&&<span className="badge sov-ro"><SettingsIcon name="eye"/>{t('settingsReadOnly')}</span>}
   <CloseButton/>
  </header>
  <div className="sov__body">
   <SettingsNav slug={slug} role={role} section={section} learningWaiting={learningWaiting} agentsWaiting={agentsWaiting}/>
   <div className="sov-main" id="sov-main"><div className={`sov-page sov-page--${section}`}>{children}</div></div>
  </div>
 </OverlayFrame>;
}
