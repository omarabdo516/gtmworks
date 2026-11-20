'use client';
import './update-ready.css';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/paperclip/ui/dialog';
import { ShellIcon } from '@/components/shell-icon';
import { whatsNew, unseenEntries } from '@/lib/updates.mjs';
import { CopyCommand } from './settings-backup-copy';

type Entry=(typeof whatsNew)[number];
type Update={version:string,date:string,entries:Entry[]};
// Lines shown by title; the rest are counted (#442: "Plus N more").
const shownLines=5;
const updateCommand='gtmworks update';
// Kept in this browser for each person (#442, Decisions): the update they hid until a newer one, and the entries they saw.
export const hiddenKey=(person:string)=>`gtmworks.update.hidden:${person}`, seenKey=(person:string)=>`gtmworks.whatsNew.seen:${person}`;
const read=(key:string)=>{ try { return localStorage.getItem(key); } catch { return null; } };
const write=(key:string,value:string)=>{ try { localStorage.setItem(key,value); return true; } catch { return false; } };
const seenList=(person:string)=>{ try { const list=JSON.parse(read(seenKey(person))||'null'); return Array.isArray(list)?list as number[]:null; } catch { return null; } };
// A release is named by its tag; a main build by what it brings, so each newer merge with an entry is a newer version.
const keyOf=(update:Update)=>update.version==='main'?`main:${update.entries.map(item=>item.issue).join(',')}`:update.version;

function Lines({entries,limit=shownLines}:{entries:Entry[],limit?:number}) {
 const {t,language}=useI18n();
 const rest=entries.length-limit;
 return <ul className="upd-lines">
  {entries.slice(0,limit).map(item=><li key={item.issue}><b>{item[language].title}</b> {item[language].body}</li>)}
  {!entries.length&&<li>{t('updateReadyFixes')}</li>}
  {rest>0&&<li className="upd-more">{rest===1?t('updateReadyMoreOne'):t('updateReadyMore',rest)}</li>}
 </ul>;
}

function ago(date:string,locale:string) {
 const days=Math.round((Date.parse(date)-Date.now())/86400000);
 return new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(Math.min(0,days),'day');
}

// Update ready (#442; T3 Code's update notice): for a Company's Owner, a small item at the foot of the sidebar when a
// newer gtmworks exists on the install's channel. It opens the version, how long ago it came out, the lines it brings
// and the one command that installs it; the web app never updates the server itself (#442, Decided). After an update,
// What's new shows once what arrived. Anyone but an Owner sees neither; a failed check shows nothing.
export default function UpdateReady({company,person,owner}:{company:string,person:string,owner:boolean}) {
 const {t,locale}=useI18n();
 const [update,setUpdate]=useState<Update|null>(null);
 const [open,setOpen]=useState(false);
 const [arrived,setArrived]=useState<Entry[]>([]);
 useEffect(()=>{
  if(!owner) return;
  let live=true;
  fetch(`/api/update?company=${encodeURIComponent(company)}`,{cache:'no-store'}).then(response=>response.ok?response.json():null).then((body:{joined?:string,update?:Update|null}|null)=>{
   if(!live||!body) return;
   if(body.update&&read(hiddenKey(person))!==keyOf(body.update)) setUpdate(body.update);
   const fresh=unseenEntries(whatsNew,seenList(person),body.joined);
   // Shown once: only when the record of having seen it is kept, so a browser that keeps nothing is not shown it each time.
   if(write(seenKey(person),JSON.stringify(whatsNew.map(item=>item.issue)))&&fresh.length) setArrived(fresh);
  }).catch(()=>{});
  return ()=>{live=false;};
 },[company,person,owner]);
 if(!owner) return null;
 const hide=()=>{ if(update) write(hiddenKey(person),keyOf(update)); setOpen(false); setUpdate(null); };
 return <>
  {update&&<button type="button" className="sb-item sb-update" aria-haspopup="dialog" onClick={()=>setOpen(true)}>
   <ShellIcon name="download"/><span className="od-fill">{t('updateReady')}</span><span className="sb-update__dot" aria-hidden="true"/></button>}
  {update&&open&&<Dialog open onOpenChange={setOpen}>
   <DialogContent showCloseButton={false} className="gw modal modal--upd">
    <header className="modal__head">
     <div className="modal__titles"><DialogTitle className="modal__title">{t('updateReady')}</DialogTitle>
      <DialogDescription className="modal__sub">{t('updateReadyOut',update.version,ago(update.date,locale))}</DialogDescription></div>
     <button type="button" className="circle-btn" aria-label={t('close')} onClick={()=>setOpen(false)}><ShellIcon name="x"/></button>
    </header>
    <div className="upd-body">
     <Lines entries={update.entries}/>
     <p className="upd-run">{t('updateReadyRun')}</p>
     {/* The action row: the command and its copy button; an "Update now" button may join them (#443). */}
     <div className="upd-actions"><code className="upd-cmd" dir="ltr" translate="no">{updateCommand}</code><CopyCommand command={updateCommand}/></div>
     <p className="upd-hint">{t('signInTerminalWho')}</p>
    </div>
    <footer className="modal__foot upd-foot"><button type="button" className="btn btn--secondary" onClick={hide}>{t('updateReadyHide')}</button></footer>
   </DialogContent>
  </Dialog>}
  {arrived.length>0&&<Dialog open onOpenChange={next=>{ if(!next) setArrived([]); }}>
   <DialogContent showCloseButton={false} className="gw modal modal--upd">
    <header className="modal__head">
     <div className="modal__titles"><DialogTitle className="modal__title">{t('whatsNew')}</DialogTitle>
      <DialogDescription className="modal__sub">{t('whatsNewSub')}</DialogDescription></div>
    </header>
    {/* Every entry that arrived: it is recorded as seen, so none is left to a later visit. */}
    <div className="upd-body"><Lines entries={arrived} limit={arrived.length}/></div>
    <footer className="modal__foot upd-foot"><button type="button" className="btn btn--primary" onClick={()=>setArrived([])}>{t('whatsNewDone')}</button></footer>
   </DialogContent>
  </Dialog>}
 </>;
}
