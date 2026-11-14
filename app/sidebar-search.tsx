'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';

type Search={open:boolean,query:string,toggle:()=>void,setQuery:(query:string)=>void};
const SearchContext=createContext<Search>({open:false,query:'',toggle:()=>{},setQuery:()=>{}});

// The reference's chat search (#btn-search, #sb-search): the magnifier opens a field under the workspace row, and
// what is typed narrows the recent chats by title. Closing it clears the search.
export function SidebarSearchProvider({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false); const [query,setQuery]=useState('');
 return <SearchContext.Provider value={{open,query,setQuery,toggle:()=>{setOpen(value=>!value);setQuery('');}}}>{children}</SearchContext.Provider>;
}
export const useSidebarQuery=()=>useContext(SearchContext).query;

export function SearchToggle() {
 const {t}=useI18n(); const {open,toggle}=useContext(SearchContext);
 return <button type="button" className="circle-btn" id="btn-search" aria-label={t('searchChats')} aria-controls="sb-search" aria-expanded={open} onClick={toggle}><ShellIcon name="search"/></button>;
}

export function SearchBox() {
 const {t}=useI18n(); const {open,query,setQuery,toggle}=useContext(SearchContext);
 return <div className="sb-search" id="sb-search" hidden={!open}>{open&&<>
  <label className="sr-only" htmlFor="sb-q">{t('searchChats')}</label>
  <input autoFocus type="search" id="sb-q" autoComplete="off" dir={query?'auto':undefined} placeholder={t('searchChats')} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&query){event.stopPropagation();setQuery('');}else if(event.key==='Escape'){event.stopPropagation();toggle();document.getElementById('btn-search')?.focus();}}}/>
 </>}</div>;
}
