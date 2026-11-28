'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { renameConversation } from '@/app/conversation-archive-actions';
import { toast } from '@/app/toast';

// Renaming one of the person's own Conversations (#881) from any place that lists it (the sidebar's row menu and the
// chat head's): its title is its session's title on the Engine, and the name typed is written there. The dialog is the
// one the archive confirmation draws (app/archive-confirm.tsx: the reference's native dialog, modal--sm), with the
// name's field in it; Enter saves, Escape, Cancel or a press outside leave the name as it was. A name the Engine does not
// take says why under the field and keeps the dialog open. `changed` runs with the new title once it is written, after
// the page's own server reads are asked again (the sidebar, All conversations).
export function useConversationRename(company:string,changed?:(id:string,title:string)=>void) {
 const [asking,setAsking]=useState<{id:string,title:string}|null>(null);
 const rename=(chat:{id:string,title:string})=>setAsking(chat);
 const dialog=asking?<RenameDialog key={asking.id} company={company} chat={asking} done={title=>{ const id=asking.id; setAsking(null); if(title!==null) changed?.(id,title); }}/>:null;
 return {rename,dialog};
}

function RenameDialog({company,chat,done}:{company:string,chat:{id:string,title:string},done:(title:string|null)=>void}) {
 const {t}=useI18n(); const router=useRouter();
 const box=useRef<HTMLDialogElement>(null); const pressed=useRef(false); const saved=useRef<string|null>(null);
 const [value,setValue]=useState(chat.title); const [said,setSaid]=useState(''); const [saving,setSaving]=useState(false);
 useLayoutEffect(()=>{ const dialog=box.current; if(dialog&&!dialog.open) dialog.showModal(); },[]);
 const save=async()=>{
  if(saving) return;
  const name=value.replace(/\s+/g,' ').trim();
  if(name===chat.title) { box.current?.close(); return; }
  setSaving(true); setSaid('');
  const answer=await renameConversation(company,chat.id,name).catch(()=>null);
  setSaving(false);
  if(answer?.state==='invalid') { setSaid(t('conversationRenameInvalid')); return; }
  if(answer?.state!=='done') { toast(t('conversationRenameRefused'),{icon:'x'}); return; }
  saved.current=answer.title; router.refresh(); toast(t('conversationRenamedToast'),{icon:'check'});
  box.current?.close();
 };
 return <dialog ref={box} className="gw modal modal--sm cf-dlg" aria-labelledby="rn-title"
  onMouseDown={event=>{ pressed.current=event.target===event.currentTarget; }}
  onMouseUp={event=>{ const onSurface=pressed.current&&event.target===event.currentTarget; pressed.current=false; if(onSurface) box.current?.close(); }}
  onClose={()=>done(saved.current)}>
  <form className="modal__inner" onSubmit={event=>{ event.preventDefault(); void save(); }}>
   <header className="modal__head"><div className="modal__titles"><h2 className="modal__title" id="rn-title">{t('conversationRenameTitle')}</h2></div></header>
   <div className="modal__body">
    <label className="set-label" htmlFor="rn-name">{t('conversationRenameLabel')}</label>
    <input type="text" className="set-input" id="rn-name" dir="auto" autoFocus maxLength={100} value={value} aria-describedby="rn-err" aria-invalid={!!said||undefined}
     onChange={event=>{ setValue(event.target.value); setSaid(''); }}/>
    <span className="set-err" id="rn-err" role="alert" hidden={!said}>{said}</span>
   </div>
   <footer className="modal__foot modal__foot--end">
    <button type="button" className="btn btn--secondary" onClick={()=>box.current?.close()}>{t('cancel')}</button>
    <button type="submit" className="btn btn--primary" disabled={saving||!value.trim()}>{t('conversationRenameSave')}</button></footer>
  </form>
 </dialog>;
}
