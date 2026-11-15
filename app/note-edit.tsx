'use client';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { PageIcon } from '@/app/c/[slug]/log/icons';
import { noteEditWindow } from '@/lib/activity-log.mjs';
import { editNote } from './note-actions';

export type EditableNote={id:number,body:string,created_at:string,edited_at:string|null,author_id:string|null};
// One clock for every open note, ticking each second while one is shown. Before hydration it reads the time the page
// was drawn, so the server and the browser draw the same countdown.
let tick=0; let timer:ReturnType<typeof setInterval>|undefined; const listeners=new Set<()=>void>();
function subscribe(listener:()=>void) {
 listeners.add(listener);
 if(!timer) { tick=Date.now(); timer=setInterval(()=>{ tick=Date.now(); listeners.forEach(notify=>notify()); },1000); }
 return ()=>{ listeners.delete(listener); if(!listeners.size) { clearInterval(timer); timer=undefined; } };
}
const useNow=(drawnAt:number)=>useSyncExternalStore(subscribe,()=>tick||drawnAt,()=>drawnAt);
const clock=(ms:number)=>{ const s=Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };

type Notice=Awaited<ReturnType<typeof editNote>>|'noteTimeUp'|'noteLockedNow';

// A Member's note where the log shows it, on its Card or in the Activity log (design-reference: entryHTML, saveNoteEdit):
// its text, then when it was written with "Edited" once it changed; for its writer, in its first five minutes, Edit and
// the time left, and after them "Locked" for everyone. Editing swaps the text for a field with Cancel and Save.
export function NoteText({note,me,canWrite,company,slug,drawnAt,surface,meta,children}:{note:EditableNote,me:string,canWrite:boolean,company:string,slug:string,drawnAt:number,surface:'card'|'log',meta:ReactNode,children?:ReactNode}) {
 const {t}=useI18n();
 const now=useNow(drawnAt);
 // Edit waits for the page to be live: a press before then would do nothing.
 const live=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 const left=Date.parse(note.created_at)+noteEditWindow-now;
 const mine=!!note.author_id&&note.author_id===me&&canWrite;
 const [editing,setEditing]=useState(false); const [draft,setDraft]=useState(''); const [empty,setEmpty]=useState(false);
 const [notice,setNotice]=useState<Notice|''>(''); const [saving,startSaving]=useTransition();
 const field=useRef<HTMLTextAreaElement>(null); const editButton=useRef<HTMLButtonElement>(null); const focus=useRef<'field'|'edit'|null>(null);
 if(editing&&left<=0) { setEditing(false); setNotice('noteTimeUp'); }
 useEffect(()=>{
  if(focus.current==='field'&&field.current) { field.current.focus(); field.current.setSelectionRange(field.current.value.length,field.current.value.length); }
  if(focus.current==='edit') editButton.current?.focus();
  focus.current=null;
 });
 const ids=`note-${surface}-${note.id}`;
 const start=()=>{
  if(left<=0) { setNotice('noteLockedNow'); return; }
  setDraft(note.body); setEmpty(false); setNotice(''); setEditing(true); focus.current='field';
 };
 const stop=(next:Notice|'')=>{ setEditing(false); setNotice(next); focus.current='edit'; };
 const save=()=>{
  if(left<=0) { stop('noteLockedBeforeSave'); return; }
  if(!draft.trim()) { setEmpty(true); field.current?.focus(); return; }
  startSaving(async()=>{
   const result=await editNote({company,slug,note:note.id,body:draft});
   if(result==='noteEmpty') { setEmpty(true); field.current?.focus(); return; }
   // A save that failed keeps the field and its text, to try again.
   if(result==='couldNotSaveTheChangeCheckPermissionsAnd') { setNotice(result); return; }
   stop(result);
  });
 };
 const [before,after]=t('noteLeft','\u0000').split('\u0000');
 const remaining=<span className="lg-left">{before}<span className="num">{clock(left)}</span>{after}</span>;
 const dot=<span className="lg-dot" aria-hidden="true">·</span>;
 return <>
  {editing?<div className="lg-edit">
   <label className="sr-only" htmlFor={`${ids}-text`}>{t('noteEditLabel')}</label>
   <textarea ref={field} className="set-input set-textarea lg-edit__t" id={`${ids}-text`} rows={3} dir="auto" value={draft} disabled={saving}
    aria-invalid={empty||undefined} aria-describedby={`${ids}-error`} onChange={event=>{setDraft(event.target.value); setEmpty(false);}}/>
   <span className="set-err" id={`${ids}-error`} hidden={!empty}>{t('noteEmpty')}</span>
   <div className="lg-edit__row">{remaining}<span className="od-fill"/>
    <button type="button" className="btn btn--secondary btn--sm" onClick={()=>stop('')} disabled={saving}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>{t('save')}</button>
   </div>
  </div>:<p className={surface==='log'?'lg-note':'comment-body'} dir="auto">{note.body}</p>}
  {children}
  <p className="lg-meta">{meta}
   {note.edited_at&&<>{dot}<span className="lg-edited"><PageIcon name="pencil"/>{t('noteEdited')}</span></>}
   {!editing&&left>0&&mine&&<>{dot}<button ref={editButton} type="button" className="link-btn" disabled={!live} onClick={start}><PageIcon name="pencil"/>{t('noteEdit')}</button>{remaining}</>}
   {left<=0&&<>{dot}<span className="lg-lock" title={t('noteLockedTitle')}><PageIcon name="lock"/>{t('noteLocked')}</span></>}
   <span className="lg-status" role="status">{notice&&t(notice)}</span>
  </p>
 </>;
}
