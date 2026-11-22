'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { leave } from '@/lib/motion';
import { AppsList, AppDetail, connectedCount, type AppsPlace } from './settings-apps-client';
import { readApps, useCompanyApps, useHeldApps, useSignedIn } from './company-apps-read';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import './sheet.css';
import './settings.css';
import './apps.css';
import { AppsContext, useAppsCompany, useAppsReader, useAppsSheet, type Apps, type OpenApps } from './apps-sheet-open';

// Connect apps (#201; design-reference: openApps, renderApps, renderAppsBtn, the open-apps, apps-close, app-open and
// apps-back cases, closeDlg): the apps Settings, Apps holds, drawn by the same components in a sheet docked at the
// inline end over whatever page is open. The sidebar's button and the account menu open it; one app's page opens inside
// it with no change of address. Every Member reads it; only the Owner gets the buttons.
type Sheet={phase:'closed'}|{phase:'open'|'closing',view:string|null,opener:HTMLElement|null,agent?:string};
// The Company and how to open its sheet, the same object for the whole visit: the provider wraps the whole page, and a
// new value arriving while a part of the page still streams in would make React draw that part again in the browser
// beside its hidden streamed copy (#172), a Conversation's transcript among them. The apps reach the count through
// their store (app/company-apps-read.ts).

// sheetOut in sheet.css.
const leaveMs=190;

// The apps are read by the browser after the page is drawn (app/company-apps-read.ts), again each time the sheet opens,
// and after an app is connected or disconnected; the last good read stays shown meanwhile.
export function AppsSheetProvider({company,person,owner,rtl,children}:{company:string,person:string,owner:boolean,rtl:boolean,children:ReactNode}) {
 const {language}=useI18n(); const text:Record<string,string>=language==='ar'?ar:en;
 useSignedIn(person);
 const items=useCompanyApps({company,person,language});
 const [sheet,setSheet]=useState<Sheet>({phase:'closed'});
 const box=useRef<HTMLDialogElement>(null); const stopLeaving=useRef(()=>{});
 // Where the keyboard goes once the sheet has drawn the view it moved to; after back, the app's button keeps it.
 const focusNext=useRef<string|null>(null); const kept=useRef<string|null>(null);
 const open=(opener:HTMLElement|null,app?:string,agent?:string)=>{ void readApps({company,person,language}); focusNext.current=app?'apps-back':'apps-q'; kept.current=null; setSheet({phase:'open',view:app??null,opener,agent}); };
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
  open:key=>{ focusNext.current='apps-back'; kept.current=null; setSheet(now=>now.phase==='open'?{...now,view:key,agent:undefined}:now); },
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
 const opening=useRef(open); useLayoutEffect(()=>{ opening.current=open; });
 const value=useMemo<Apps>(()=>({company,person,open:(opener,app,agent)=>opening.current(opener,app,agent)}),[company,person]);
 return <AppsContext.Provider value={value}>
  {children}
  {/* Drawn only while open or leaving, so a page with the sheet closed holds no dialog. It sits beside the frame, as the
   reference's dialog#apps does, so it carries the shell's tokens (.gw) itself. */}
  {sheet.phase!=='closed'&&<div className="gw" style={{display:'contents'}}><dialog ref={box} className={`sheet apps-sheet${sheet.phase==='closing'?' is-closing':''}`} id="apps" aria-labelledby="apps-title"
   onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
   <div className="apps-inner">{item
    ?<AppDetail key={item.key} place={place} company={company} owner={owner} rtl={rtl} item={item} text={text} failed={false} agent={sheet.agent}/>
    :<AppsList place={place} owner={owner} items={items} text={text}/>}</div>
  </dialog></div>}
 </AppsContext.Provider>;
}

// "N connected", once the apps are read; left out when the Engine could not be read.
export function AppsCount({company,className}:{company:string,className:string}) {
 return <Count company={company} className={className}/>;
}
function Count({company,className}:{company:string,className:string}) {
 const {language}=useI18n(); const items=useHeldApps(useAppsReader(company));
 if(!items) return null;
 return <span className={className}>{connectedCount(items)} {(language==='ar'?ar:en).connected}</span>;
}

// What opens the sheet, for the account menu; null where the Shell drew no sheet.
// Connect apps at the foot of the sidebar (design-reference: #btn-apps, renderAppsBtn).
export function AppsButton() {
 const open=useAppsSheet(); const company=useAppsCompany(); const {t}=useI18n();
 return <button type="button" className="sb-item sb-apps" id="btn-apps" aria-haspopup="dialog" onClick={event=>open?.(event.currentTarget)}>
  <ShellIcon name="plug"/><span className="od-fill">{t('shellConnectApps')}</span>{company&&<AppsCount company={company} className="sb-apps__n num"/>}</button>;
}
