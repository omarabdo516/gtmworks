'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { leave } from '@/lib/motion';
import { AppsList, AppDetail, connectedCount, type AppItem, type AppsPlace } from './settings-apps-client';
import { readApps, useCompanyApps } from './company-apps-read';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import './sheet.css';
import './settings.css';
import './apps.css';

// Connect apps (#201; design-reference: openApps, renderApps, renderAppsBtn, the open-apps, apps-close, app-open and
// apps-back cases, closeDlg): the apps Settings, Apps holds, drawn by the same components in a sheet docked at the
// inline end over whatever page is open. The sidebar's button and the account menu open it; one app's page opens inside
// it with no change of address. Every Member reads it; only the Owner gets the buttons.
type Sheet={phase:'closed'}|{phase:'open'|'closing',view:string|null,opener:HTMLElement|null};
// The apps as last read: undefined until the first read lands, null when the Engine could not be read.
type Apps={items:AppItem[]|null|undefined,open:(opener:HTMLElement|null)=>void};
const AppsContext=createContext<Apps|null>(null);

// sheetOut in sheet.css.
const leaveMs=190;

// The apps are read by the browser after the page is drawn (app/company-apps-read.ts), again each time the sheet opens,
// and after an app is connected or disconnected; the last good read stays shown meanwhile.
export function AppsSheetProvider({company,owner,rtl,children}:{company:string,owner:boolean,rtl:boolean,children:ReactNode}) {
 const {language}=useI18n(); const text:Record<string,string>=language==='ar'?ar:en;
 const items=useCompanyApps(company,language);
 const [sheet,setSheet]=useState<Sheet>({phase:'closed'});
 const box=useRef<HTMLDialogElement>(null); const stopLeaving=useRef(()=>{});
 // Where the keyboard goes once the sheet has drawn the view it moved to; after back, the app's button keeps it.
 const focusNext=useRef<string|null>(null); const kept=useRef<string|null>(null);
 const open=(opener:HTMLElement|null)=>{ void readApps(company,language); focusNext.current='apps-q'; kept.current=null; setSheet({phase:'open',view:null,opener}); };
 const close=()=>{
  const dialog=box.current; if(!dialog?.open||sheet.phase!=='open') return;
  stopLeaving.current=leave(leaveMs,()=>setSheet(now=>now.phase==='open'?{...now,phase:'closing'}:now),()=>dialog.close());
 };
 // However it closed, the keyboard goes back to what opened it, or to the sidebar's button when that is gone or hidden.
 const closed=()=>{
  stopLeaving.current();
  const opener=sheet.phase==='closed'?null:sheet.opener;
  setSheet({phase:'closed'});
  (opener?.isConnected&&opener.offsetParent?opener:document.getElementById('btn-apps'))?.focus();
 };
 const place:AppsPlace={kind:'sheet',close,
  open:key=>{ focusNext.current='apps-back'; kept.current=null; setSheet(now=>now.phase==='open'?{...now,view:key}:now); },
  back:from=>{ focusNext.current=kept.current=`app-btn-${from}`; setSheet(now=>now.phase==='open'?{...now,view:null}:now); }};
 useLayoutEffect(()=>{ if(sheet.phase==='open'&&box.current&&!box.current.open) box.current.showModal(); },[sheet.phase]);
 useLayoutEffect(()=>{
  const id=focusNext.current;
  if(id) { focusNext.current=null; (document.getElementById(id)??document.getElementById('apps-q'))?.focus(); }
 });
 // A refresh after a disconnect moves the app to the other group, which draws its button anew.
 useLayoutEffect(()=>{ if(kept.current&&box.current?.open&&!box.current.contains(document.activeElement)) document.getElementById(kept.current)?.focus(); },[items]);
 useEffect(()=>()=>stopLeaving.current(),[]);
 const item=sheet.phase!=='closed'&&sheet.view?items?.find(entry=>entry.key===sheet.view):undefined;
 return <AppsContext.Provider value={{items,open}}>
  {children}
  {/* Drawn only while open or leaving, so a page with the sheet closed holds no dialog. It sits beside the frame, as the
   reference's dialog#apps does, so it carries the shell's tokens (.gw) itself. */}
  {sheet.phase!=='closed'&&<div className="gw" style={{display:'contents'}}><dialog ref={box} className={`sheet apps-sheet${sheet.phase==='closing'?' is-closing':''}`} id="apps" aria-labelledby="apps-title"
   onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
   <div className="apps-inner">{item
    ?<AppDetail key={item.key} place={place} company={company} owner={owner} rtl={rtl} item={item} text={text} failed={false}/>
    :<AppsList place={place} owner={owner} items={items} text={text}/>}</div>
  </dialog></div>}
 </AppsContext.Provider>;
}

// "N connected", once the apps are read; left out when the Engine could not be read.
export function AppsCount({className}:{className:string}) {
 const apps=useContext(AppsContext); const {language}=useI18n();
 if(!apps?.items) return null;
 return <span className={className}>{connectedCount(apps.items)} {(language==='ar'?ar:en).connected}</span>;
}

// What opens the sheet, for the account menu; null where the Shell drew no sheet.
export const useAppsSheet=()=>useContext(AppsContext)?.open??null;

// Connect apps at the foot of the sidebar (design-reference: #btn-apps, renderAppsBtn).
export function AppsButton() {
 const open=useAppsSheet(); const {t}=useI18n();
 return <button type="button" className="sb-item sb-apps" id="btn-apps" aria-haspopup="dialog" onClick={event=>open?.(event.currentTarget)}>
  <ShellIcon name="plug"/><span className="od-fill">{t('shellConnectApps')}</span><AppsCount className="sb-apps__n num"/></button>;
}
