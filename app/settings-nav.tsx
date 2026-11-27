'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { findGroups, leavingSections, overlayHref, type OverlaySection, type OverlaySectionEntry } from '@/lib/settings-overlay.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { SettingsIcon } from './settings-icons';
import { GuardedSectionLink } from './settings-guard-link';
import { holdLeave } from './settings-draft';

// A key typed here belongs to the field it is typed in: a slash in a name, a note or a search is never taken from it.
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));

// The overlay's section list in its groups (#612) with "Find a setting" above it (#613). The list is the Role's own
// (findGroups, built on overlayGroups), so a search shows a section only to someone who may open it. `/` anywhere in Settings outside a
// field takes the person to the search; Enter opens the first section found, Escape empties the search before it closes
// Settings, and a section opened (from the search or any other way) starts with an empty search, whichever of the
// layer's routes (#612) draws it.
export function SettingsNav({slug,role,section,learningWaiting,agentsWaiting}:{slug:string,role:string,section:OverlaySection,learningWaiting:number,agentsWaiting:number}) {
 const {t}=useI18n();
 const [query,setQuery]=useState('');
 const search=useRef<HTMLInputElement>(null);
 // A section opened starts with an empty search: the state follows the open section while it draws (React's pattern for
 // state reset by a prop), so no effect runs a second render.
 const [searchedOn,setSearchedOn]=useState(section);
 if(searchedOn!==section) { setSearchedOn(section); setQuery(''); }
 useEffect(()=>{
  const keys=(event:KeyboardEvent)=>{
   if(event.key!=='/'||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||editable(event.target)) return;
   // Only while Settings are in front: the overlay leaving (inert) or taken out (hidden), or a modal opened over it (a
   // file's preview), gives the key back to what is in front.
   const field=search.current; if(!field||field.closest('[inert], [hidden]')) return;
   const modal=document.querySelector('dialog:modal'); if(modal&&!modal.contains(field)) return;
   event.preventDefault(); field.focus(); field.select();
  };
  document.addEventListener('keydown',keys);
  return ()=>document.removeEventListener('keydown',keys);
 },[]);
 const groups=findGroups(query,role,t);
 const found=groups.flatMap(group=>group.sections);
 const wanted=query.trim();
 const clear=()=>{ setQuery(''); search.current?.focus(); };
 // The number beside a section: learning suggestions for an Owner or a Manager (#25), and the Agents' proposed changes
 // for an Owner (#178; design-reference: sovNavHTML's cnt), each read out as waiting for the reader's OK.
 const count=(n:number,said:string)=>n>0&&<span className="sov-count"><span aria-hidden="true">{n}</span><span className="sr-only">{t(said,n)}</span></span>;
 // A row that leaves Settings (the Company's Hermes dashboard, #869) is a plain link: the page it opens is not one of the
 // app's, so it loads in this tab as a whole page, held like every other way out while an Agent's draft differs.
 const item=([key,label,icon]:OverlaySectionEntry)=>leavingSections.has(key)
  ?<a key={key} className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} onClick={event=>{ if(holdLeave(t('settingsSaveFirst'))) event.preventDefault(); }}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span></a>
  :<GuardedSectionLink key={key} className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} current={key===section}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span>{key==='learning'?count(learningWaiting,'settingsLearningWaiting'):key==='agents'?count(agentsWaiting,'settingsAgentsWaiting'):null}</GuardedSectionLink>;
 return <div className="sov-side">
  <div className="sov-find" role="search">
   <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{t('settingsFind')}</span>
    <input ref={search} id="sov-find" type="search" autoComplete="off" spellCheck={false} aria-keyshortcuts="/" aria-controls="sov-nav" placeholder={t('settingsFind')} value={query}
     onChange={event=>setQuery(event.target.value)}
     onKeyDown={event=>{
      // A key that confirms a word an input method is composing belongs to that word.
      if(event.nativeEvent.isComposing) return;
      if(event.key==='Escape'&&query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
      else if(event.key==='Enter'&&wanted&&found[0]) { event.preventDefault(); document.getElementById(`sov-nav-${found[0][0]}`)?.click(); }
     }}/></label>
   {/* The search's own way back while it finds something; with nothing found, the empty line offers it instead. */}
   {wanted&&found.length>0&&<button type="button" className="link-btn sov-find__clear" onClick={clear}>{t('settingsFindClear')}</button>}
  </div>
  <nav className="sov-nav" id="sov-nav" aria-label={t('settingsSectionsLabel')}>
   {/* The sidebar's groups (#612): Company, Agents and Engine, each under its own name, then the pages that stand alone. */}
   {groups.map(({group:key,label,sections})=><div className={`sov-nav__g${key?'':' sov-nav__g--own'}`} key={key??'own'} role={label?'group':undefined} aria-labelledby={label?`sov-nav-l-${key}`:undefined}>
    {label&&<p className="sov-nav__l" id={`sov-nav-l-${key}`}>{t(label)}</p>}{sections.map(item)}</div>)}
   {wanted&&!found.length&&<div className="sov-find__none" role="status"><p>{t('settingsFindNone',wanted)}</p>
    <button type="button" className="link-btn" onClick={clear}>{t('settingsFindClear')}</button></div>}
  </nav>
 </div>;
}
