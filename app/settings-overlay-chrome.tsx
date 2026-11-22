import type { ReactNode } from 'react';
import type { I18n } from '@/lib/i18n.mjs';
import { overlayGroups, overlaySections, sectionGroup, overlayHref, type OverlaySection, type OverlaySectionEntry } from '@/lib/settings-overlay.mjs';
import { OverlayFrame, CloseButton } from './settings-overlay-frame';
import { SettingsIcon } from './settings-icons';
import { GuardedSectionLink } from './settings-guard-link';

// The overlay's bar, its section list and the place of the open section (reference: dialog#sov), around the section the
// server drew. It imports no server code, so a component test renders the overlay as the server does (#218).
export function OverlayChrome({t,slug,companyName,role,readOnly,section,learningWaiting,agentsWaiting=0,initialFocus,children}:{t:I18n['t'],slug:string,companyName:string,role:string,readOnly:boolean,section:OverlaySection,learningWaiting:number,agentsWaiting?:number,initialFocus?:string,children:ReactNode}) {
 // The number beside a section: learning suggestions for an Owner or a Manager (#25), and the Agents' proposed changes
 // for an Owner (#178; design-reference: sovNavHTML's cnt), each read out as waiting for the reader's OK.
 const count=(n:number,said:string)=>n>0&&<span className="sov-count"><span aria-hidden="true">{n}</span><span className="sr-only">{t(said,n)}</span></span>;
 const item=([key,label,icon]:OverlaySectionEntry)=><GuardedSectionLink key={key} className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} current={key===section}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span>{key==='learning'?count(learningWaiting,'settingsLearningWaiting'):key==='agents'?count(agentsWaiting,'settingsAgentsWaiting'):null}</GuardedSectionLink>;
 // The sidebar's groups (#612): Company, Agents and Engine, each under its own name, then the pages that stand alone.
 const groups=overlayGroups(role);
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
   <nav className="sov-nav" aria-label={t('settingsSectionsLabel')}>
    {groups.map(({group:key,label,sections})=><div className={`sov-nav__g${key?'':' sov-nav__g--own'}`} key={key??'own'} role={label?'group':undefined} aria-labelledby={label?`sov-nav-l-${key}`:undefined}>
     {label&&<p className="sov-nav__l" id={`sov-nav-l-${key}`}>{t(label)}</p>}{sections.map(item)}</div>)}
   </nav>
   <div className="sov-main" id="sov-main"><div className={`sov-page sov-page--${section}`}>{children}</div></div>
  </div>
 </OverlayFrame>;
}
