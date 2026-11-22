'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { findSections, overlayHref, type OverlaySection } from '@/lib/settings-overlay.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { SettingsIcon } from './settings-icons';
import { GuardedSectionLink } from './settings-guard-link';

// A key typed here belongs to the field it is typed in: a slash in a name, a note or a search is never taken from it.
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));

// The overlay's section list with "Find a setting" above it (#613). The list is the Role's own (findSections, built on
// visibleSections), so a search shows a section only to someone who may open it. `/` anywhere in Settings outside a
// field takes the person to the search; Enter opens the first section found, Escape empties the search before it closes
// Settings, and the search stays as typed from one section to the next until the person clears it.
export function SettingsNav({slug,companyName,role,section,learningWaiting,agentsWaiting}:{slug:string,companyName:string,role:string,section:OverlaySection,learningWaiting:number,agentsWaiting:number}) {
 const {t}=useI18n();
 const [query,setQuery]=useState('');
 const search=useRef<HTMLInputElement>(null);
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
 const found=findSections(query,role,t);
 const wanted=query.trim();
 const clear=()=>{ setQuery(''); search.current?.focus(); };
 // The number beside a section: learning suggestions for an Owner or a Manager (#25), and the Agents' proposed changes
 // for an Owner (#178; design-reference: sovNavHTML's cnt), each read out as waiting for the reader's OK.
 const count=(n:number,said:string)=>n>0&&<span className="sov-count"><span aria-hidden="true">{n}</span><span className="sr-only">{t(said,n)}</span></span>;
 const item=([key,label,icon]:(typeof found)[number])=><GuardedSectionLink key={key} className="sb-item sov-nav__i" id={`sov-nav-${key}`} href={overlayHref(slug,key)} current={key===section}><SettingsIcon name={icon}/><span className="od-fill">{t(label)}</span>{key==='learning'?count(learningWaiting,'settingsLearningWaiting'):key==='agents'?count(agentsWaiting,'settingsAgentsWaiting'):null}</GuardedSectionLink>;
 const company=found.filter(entry=>!entry[4]), you=found.filter(entry=>entry[4]);
 return <div className="sov-side">
  <div className="sov-find" role="search">
   <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{t('settingsFind')}</span>
    <input ref={search} id="sov-find" type="search" autoComplete="off" spellCheck={false} aria-keyshortcuts="/" aria-controls="sov-nav" placeholder={t('settingsFind')} value={query}
     onChange={event=>setQuery(event.target.value)}
     onKeyDown={event=>{
      if(event.key==='Escape'&&query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
      else if(event.key==='Enter'&&wanted&&found[0]) { event.preventDefault(); document.getElementById(`sov-nav-${found[0][0]}`)?.click(); }
     }}/></label>
   {/* The search's own way back while it finds something; with nothing found, the empty line offers it instead. */}
   {wanted&&found.length>0&&<button type="button" className="link-btn sov-find__clear" onClick={clear}>{t('settingsFindClear')}</button>}
  </div>
  <nav className="sov-nav" id="sov-nav" aria-label={t('settingsSectionsLabel')}>
   {company.length>0&&<><p className="sov-nav__l"><bdi>{companyName}</bdi></p>{company.map(item)}</>}
   {you.length>0&&<><p className="sov-nav__l">{t('settingsYou')}</p>{you.map(item)}</>}
   {wanted&&!found.length&&<div className="sov-find__none" role="status"><p>{t('settingsFindNone',wanted)}</p>
    <button type="button" className="link-btn" onClick={clear}>{t('settingsFindClear')}</button></div>}
  </nav>
 </div>;
}
