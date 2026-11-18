'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { toast } from '@/app/toast';
import type { MemoryNote } from '@/lib/engine.mjs';

// One Agent's memory (#350; design-reference: memoryHTML, memNoteHTML): the notes its own Engine profile holds, or the
// empty state, and what the Company keeps apart from them. It is drawn in the Agent's details panel and, later, in
// Settings, so it takes the notes and the flags rather than reading them itself. An Owner and a Manager edit a note in
// place (#191, canEdit); the Owner alone forgets one (canForget), which hides at once and is removed from the Engine when
// the six-second toast ends or the page is left, unless Undo restores it. The server checks each Role again
// (/api/agent-memory, check_memory_edit and check_memory_forget) and writes one log row with no note text. No "Add" is
// drawn for anyone: the Engine has no route that adds a note, so a person adds one by telling the Agent in its chat.
export type AgentMemoryProps={company:string,agent:{id:string,name:string},notes:MemoryNote[],main:boolean,canReset:boolean,canEdit:boolean,canForget:boolean};
// The reference's toast with an action stays six seconds (design-reference/app.js: toast); the removal happens then.
const forgetDelay=6000;
// The action's accessible name carries the note's first line, as the reference's does (design-reference: memNoteHTML).
const short=(text:string)=>text.length>40?`${text.slice(0,40)}…`:text;
export function AgentMemory({company,agent,notes,main,canReset,canEdit,canForget}:AgentMemoryProps) {
 const {t}=useI18n(); const router=useRouter();
 const [asking,setAsking]=useState(false); const [pending,setPending]=useState(false); const [failed,setFailed]=useState(false);
 const [editing,setEditing]=useState<string|null>(null); const [draft,setDraft]=useState(''); const [editError,setEditError]=useState<'empty'|'tooLong'|'stale'|'failed'|null>(null); const [saving,setSaving]=useState(false);
 const [hidden,setHidden]=useState<string[]>([]); const [forgetError,setForgetError]=useState(false);
 // Where the focus goes after the next draw: back to a note's Edit, or to a note's Forget this (the heading when none).
 const focusAfter=useRef<{edit?:string,forget?:string|'heading'}|null>(null);
 const resetButton=useRef<HTMLButtonElement>(null); const cancelButton=useRef<HTMLButtonElement>(null); const asked=useRef(false);
 const heading=useRef<HTMLHeadingElement>(null); const editor=useRef<HTMLTextAreaElement>(null);
 const editButtons=useRef(new Map<string,HTMLButtonElement>()); const forgetButtons=useRef(new Map<string,HTMLButtonElement>());
 // The note waiting on its toast, and the clock that removes it from the Engine when the toast ends.
 const forgetting=useRef<{note:MemoryNote,timer:number}|null>(null);
 // The question takes the focus, on Cancel (the harmless answer); closing it gives it back to "Reset memory".
 useEffect(()=>{
  if(asking) cancelButton.current?.focus();
  else if(asked.current) resetButton.current?.focus();
  asked.current=asking;
 },[asking]);
 // "Edit" turns the note into a field with the cursor at its end (design-reference: mem-edit).
 useEffect(()=>{
  if(editing&&editor.current) { editor.current.focus(); editor.current.setSelectionRange(editor.current.value.length,editor.current.value.length); }
 },[editing]);
 // After a save or Cancel the focus goes back to the note's "Edit"; after a forget to the next note's "Forget this",
 // or to the heading when none is left (the search field of #192 when it is built). The request is read once the
 // changed list is drawn.
 useEffect(()=>{
  const request=focusAfter.current; if(!request) return;
  focusAfter.current=null;
  if(request.edit) editButtons.current.get(request.edit)?.focus();
  else if(request.forget==='heading') heading.current?.focus();
  else if(request.forget) forgetButtons.current.get(request.forget)?.focus();
 },[editing,hidden,notes]);
 const ask=()=>{ setFailed(false); setAsking(true); };
 const keep=()=>{ setAsking(false); };
 const reset=async()=>{
  if(pending) return;
  setPending(true); setFailed(false);
  try {
   const response=await fetch('/api/agent-memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id}),cache:'no-store'});
   if(!response.ok) { setFailed(true); setPending(false); return; }
   setAsking(false); setPending(false); router.refresh();
  } catch { setFailed(true); setPending(false); }
 };
 const openEdit=(note:MemoryNote)=>{ setEditError(null); setDraft(note.text); setEditing(note.id); };
 const closeEdit=(note:MemoryNote)=>{ setEditing(null); setEditError(null); focusAfter.current={edit:note.id}; };
 const save=async(note:MemoryNote)=>{
  if(saving) return;
  // An empty note is refused here, before the Engine, with the reference's line (a removal is "Forget this").
  if(!draft.trim()) { setEditError('empty'); editor.current?.focus(); return; }
  setSaving(true); setEditError(null);
  try {
   const response=await fetch('/api/agent-memory',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id,note:note.id,text:draft}),cache:'no-store'});
   if(response.ok) { setEditing(null); setSaving(false); focusAfter.current={edit:note.id}; toast(t('memoryUpdated')); router.refresh(); return; }
   const body=await response.json().catch(()=>null) as {error?:string}|null;
   setEditError(body?.error==='agentMemoryStale'?'stale':body?.error==='agentMemoryRefused'?'tooLong':'failed');
   setSaving(false); editor.current?.focus();
  } catch { setEditError('failed'); setSaving(false); editor.current?.focus(); }
 };
 const reveal=(id:string)=>setHidden(shown=>shown.filter(each=>each!==id));
 const removeNote=async(note:MemoryNote,keepalive=false)=>{
  try {
   const response=await fetch('/api/agent-memory',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id,note:note.id}),cache:'no-store',keepalive});
   if(!response.ok) { reveal(note.id); setForgetError(true); return; }
   router.refresh();
  } catch { reveal(note.id); setForgetError(true); }
 };
 const removeLatest=useRef(removeNote);
 useEffect(()=>{ removeLatest.current=removeNote; });
 // Leaving the page removes a note whose toast never ended; a hidden note stays hidden on the way out.
 useEffect(()=>{
  const leave=()=>{
   const waiting=forgetting.current; if(!waiting) return;
   forgetting.current=null; window.clearTimeout(waiting.timer); void removeLatest.current(waiting.note,true);
  };
  window.addEventListener('pagehide',leave);
  return ()=>window.removeEventListener('pagehide',leave);
 },[]);
 const forget=(note:MemoryNote)=>{
  // A second forget while a toast is up removes the first note at once, as its toast gives way to the new one.
  const earlier=forgetting.current;
  if(earlier) { forgetting.current=null; window.clearTimeout(earlier.timer); void removeLatest.current(earlier.note); }
  const shown=notes.filter(each=>!hidden.includes(each.id));
  const at=shown.findIndex(each=>each.id===note.id);
  const next=shown[at+1]??shown[at-1]??null;
  setHidden(ids=>[...ids,note.id]); setForgetError(false); focusAfter.current={forget:next?.id??'heading'};
  const timer=window.setTimeout(()=>{ forgetting.current=null; void removeLatest.current(note); },forgetDelay);
  forgetting.current={note,timer};
  toast(t('memoryForgot',agent.name),{action:{label:t('memoryUndo'),run:()=>undo()}});
 };
 const undo=()=>{
  const waiting=forgetting.current; if(!waiting) return;
  forgetting.current=null; window.clearTimeout(waiting.timer);
  reveal(waiting.note.id); focusAfter.current={forget:waiting.note.id};
  toast(t('memoryRestored'));
 };
 const visible=notes.filter(note=>!hidden.includes(note.id));
 const errorLine=editError==='empty'?t('memoryNoteEmpty'):editError==='tooLong'?t('memoryTooLong'):editError==='stale'?t('memoryStale'):editError==='failed'?t('memoryEditFailed'):null;
 return <section className="dp-sec" aria-labelledby="mem-h">
  <h3 className="dp-label" id="mem-h" ref={heading} tabIndex={-1}><span>{t('memoryHeading',agent.name)} <span className="muted num">{visible.length}</span></span>
   {canReset&&!asking&&<button ref={resetButton} type="button" className="link-btn" aria-expanded={false} onClick={ask}>{t('memoryReset')}</button>}</h3>
  <p className="mem-intro">{t('memoryIntro')}</p>
  <p className="mem-know"><ShellIcon name="book"/><span>{t('memoryKnow',agent.name)}</span></p>
  {main&&<p className="mem-main">{t('memoryMain',agent.name)}</p>}
  {asking&&<div className="panel-card mem-confirm">
   <p className="panel-empty">{t('memoryResetAsk',agent.name)}</p>
   <div className="panel-form__row panel-form__row--end">
    <button ref={cancelButton} type="button" className="btn btn--secondary" disabled={pending} onClick={keep}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" aria-busy={pending} disabled={pending} onClick={reset}>{t('memoryReset')}</button>
   </div></div>}
  {failed&&<p className="set-err" role="alert">{t('memoryResetFailed')}</p>}
  {forgetError&&<p className="set-err" role="alert">{t('memoryForgetFailed')}</p>}
  {visible.length
   ?<ul className="panel-card">{visible.map(note=><li key={note.id} className="panel-row mem-note" data-mem-row={note.id}>
    {editing===note.id
     ?<div className="panel-form">
      <label className="set-label" htmlFor={`mem-edit-${note.id}`}>{t('memoryEditNote')}</label>
      <textarea className="set-input set-textarea" id={`mem-edit-${note.id}`} ref={editor} rows={3} value={draft} aria-describedby={`mem-edit-err-${note.id}`} aria-invalid={!!editError} onChange={event=>setDraft(event.target.value)}/>
      {errorLine&&<span className="panel-form__err" id={`mem-edit-err-${note.id}`} role="alert">{errorLine}</span>}
      <div className="panel-form__row panel-form__row--end">
       <button type="button" className="btn btn--secondary btn--sm" disabled={saving} onClick={()=>closeEdit(note)}>{t('cancel')}</button>
       <button type="button" className="btn btn--primary btn--sm" aria-busy={saving} disabled={saving} onClick={()=>save(note)}>{t('memorySave')}</button>
      </div></div>
     :<>
      <span className="mem-note__t" dir="auto">{note.text}</span>
      {(canEdit||canForget)&&<span className="mem-note__meta"><span className="mem-note__acts">
       {canEdit&&<button type="button" className="link-btn" ref={button=>{ if(button) editButtons.current.set(note.id,button); else editButtons.current.delete(note.id); }} aria-label={`${t('memoryEdit')}: ${short(note.text)}`} onClick={()=>openEdit(note)}>{t('memoryEdit')}</button>}
       {canForget&&<button type="button" className="link-btn" ref={button=>{ if(button) forgetButtons.current.set(note.id,button); else forgetButtons.current.delete(note.id); }} aria-label={`${t('memoryForget')}: ${short(note.text)}`} onClick={()=>forget(note)}>{t('memoryForget')}</button>}
      </span></span>}
     </>}
   </li>)}</ul>
   :<div className="panel-card"><p className="panel-empty">{t('memoryEmpty',agent.name)}</p></div>}
 </section>;
}
