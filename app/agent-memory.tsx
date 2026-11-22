'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';
import { afterDrawn, toast, toastTime } from '@/app/toast';
import { InfoTip } from '@/app/settings-info';
import type { MemoryNote } from '@/lib/engine.mjs';

// One Agent's memory (#350; design-reference: memoryHTML, memNoteHTML): the notes its own Engine profile holds, or the
// empty state, and what the Company keeps apart from them. It is drawn in the Agent's details panel and in Settings, so
// it takes the notes and the flags rather than reading them itself. An Owner and a Manager edit a note in place (#191,
// canEdit); the Owner alone forgets one (canForget), which hides at once and is removed from the Engine when
// the six-second toast ends or the page is left, unless Undo restores it. The server checks each Role again
// (/api/agent-memory, hold_agent_change) and writes one log row with no note text, even when it is late (#370). No "Add" is
// drawn for anyone: the Engine has no route that adds a note, so a person adds one by telling the Agent in its chat.
// The search (#192) narrows the notes as a person types, in the browser, while the heading keeps the whole count; a
// search that finds nothing offers "Clear search", and Escape in a filled field does the same. The intro's second line
// and the way to Company knowledge (knowledgeHref, from lib/settings-overlay.mjs) follow what the person may do.
export type AgentMemoryProps={company:string,agent:{id:string,name:string},notes:MemoryNote[],main:boolean,canReset:boolean,canEdit:boolean,canForget:boolean,knowledgeHref?:string};
// The reference's toast with an action stays six seconds (design-reference/app.js: toast); the removal happens then, on
// the toast's own clock, which runs from the frame it is drawn in (#561), so Undo never shows after the note is gone.
// The action's accessible name carries the note's first line, as the reference's does (design-reference: memNoteHTML).
const short=(text:string)=>text.length>40?`${text.slice(0,40)}…`:text;
export function AgentMemory({company,agent,notes,main,canReset,canEdit,canForget,knowledgeHref,introAsHelp=false}:AgentMemoryProps&{introAsHelp?:boolean}) {
 const {t}=useI18n(); const router=useRouter();
 const [asking,setAsking]=useState(false); const [pending,setPending]=useState(false); const [failed,setFailed]=useState(false);
 const [editing,setEditing]=useState<string|null>(null); const [draft,setDraft]=useState(''); const [editError,setEditError]=useState<'empty'|'tooLong'|'stale'|'failed'|null>(null); const [saving,setSaving]=useState(false);
 const [hidden,setHidden]=useState<string[]>([]); const [forgetError,setForgetError]=useState(false);
 const [query,setQuery]=useState('');
 // Where the focus goes after the next draw: back to a note's Edit — by its id, or by its place in the notes when the
 // Engine gives it a new one (a note's id is a digest of its text, so a saved note comes back under another) — or to a
 // note's Forget this (the search when none), or to the search field when a saved note no longer matches the query.
 type FocusAfter={edit?:string,editAt?:{at:number,text:string},forget?:string|'search',search?:true};
 const focusAfter=useRef<FocusAfter|null>(null);
 const resetButton=useRef<HTMLButtonElement>(null); const cancelButton=useRef<HTMLButtonElement>(null); const asked=useRef(false);
 const editor=useRef<HTMLTextAreaElement>(null); const search=useRef<HTMLInputElement>(null);
 const editButtons=useRef(new Map<string,HTMLButtonElement>()); const forgetButtons=useRef(new Map<string,HTMLButtonElement>());
 // The note waiting on its toast, the Agent and Company it was forgotten for, and the clock that removes it from the
 // Engine when the toast ends. The target is kept with the note, so a panel that stays mounted while another Agent is
 // drawn removes the note from the Agent it was forgotten for, never from the Agent showing now.
 type ForgetTarget={company:string,agent:string};
 const forgetting=useRef<{note:MemoryNote,target:ForgetTarget,stop:()=>void}|null>(null);
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
 // or to the search field when none is left (design-reference: forgetMemory). The request is read once the changed
 // list is drawn.
 useEffect(()=>{
  const request=focusAfter.current; if(!request) return;
  // A saved note may come back under a new id, so the row is found by its place and the text the Engine now holds: the
  // request waits until the changed list is drawn.
  if(request.editAt) {
   const note=notes[request.editAt.at];
   if(note?.text!==request.editAt.text) return;
   focusAfter.current=null;
   editButtons.current.get(note.id)?.focus();
   return;
  }
  focusAfter.current=null;
  if(request.search) search.current?.focus();
  else if(request.edit) editButtons.current.get(request.edit)?.focus();
  else if(request.forget==='search') search.current?.focus();
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
  // The text is saved as the reference saves it, trimmed; an empty note is refused here, before the Engine, with the
  // reference's line (a removal is "Forget this").
  const text=draft.trim();
  if(!text) { setEditError('empty'); editor.current?.focus(); return; }
  setSaving(true); setEditError(null);
  try {
   const response=await fetch('/api/agent-memory',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id,note:note.id,text}),cache:'no-store'});
   if(response.ok) {
    // The note's place is its place in all the notes, not in the ones the query keeps, so a search that keeps one of
    // several still finds the row it saved. A saved note the query no longer matches is not drawn: the search field,
    // where the person can widen the query, takes the focus instead.
    const at=notes.findIndex(each=>each.id===note.id);
    setEditing(null); setSaving(false);
    focusAfter.current=found&&!text.toLowerCase().includes(found.toLowerCase())?{search:true}:at<0?null:{editAt:{at,text}};
    toast(t('memoryUpdated')); router.refresh(); return;
   }
   const body=await response.json().catch(()=>null) as {error?:string}|null;
   setEditError(body?.error==='agentMemoryStale'?'stale':body?.error==='agentMemoryRefused'?'tooLong':'failed');
   setSaving(false); editor.current?.focus();
  } catch { setEditError('failed'); setSaving(false); editor.current?.focus(); }
 };
 const reveal=(id:string)=>setHidden(shown=>shown.filter(each=>each!==id));
 const removeNote=async(target:ForgetTarget,note:MemoryNote,keepalive=false)=>{
  try {
   const response=await fetch('/api/agent-memory',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({company:target.company,agent:target.agent,note:note.id}),cache:'no-store',keepalive});
   if(!response.ok) { reveal(note.id); setForgetError(true); return; }
   router.refresh();
  } catch { reveal(note.id); setForgetError(true); }
 };
 const removeLatest=useRef(removeNote);
 useEffect(()=>{ removeLatest.current=removeNote; });
 // Leaving the page, or the memory being drawn away (another tab, another Agent), removes a note whose toast never
 // ended at once, so no clock outlives the view it was started in; a hidden note stays hidden on the way out.
 useEffect(()=>{
  const leave=()=>{
   const waiting=forgetting.current; if(!waiting) return;
   forgetting.current=null; waiting.stop(); void removeLatest.current(waiting.target,waiting.note,true);
  };
  window.addEventListener('pagehide',leave);
  return ()=>{ window.removeEventListener('pagehide',leave); leave(); };
 },[]);
 const forget=(note:MemoryNote)=>{
  // A second forget while a toast is up removes the first note at once, as its toast gives way to the new one.
  const earlier=forgetting.current;
  if(earlier) { forgetting.current=null; earlier.stop(); void removeLatest.current(earlier.target,earlier.note); }
  const target={company,agent:agent.id};
  const at=matched.findIndex(each=>each.id===note.id);
  const next=matched[at+1]??matched[at-1]??null;
  setHidden(ids=>[...ids,note.id]); setForgetError(false); focusAfter.current={forget:next?.id??'search'};
  const stop=afterDrawn(toastTime.action,()=>{ forgetting.current=null; void removeLatest.current(target,note); });
  forgetting.current={note,target,stop};
  toast(t('memoryForgot',agent.name),{action:{label:t('memoryUndo'),run:()=>undo()}});
 };
 const undo=()=>{
  const waiting=forgetting.current; if(!waiting) return;
  forgetting.current=null; waiting.stop();
  reveal(waiting.note.id); focusAfter.current={forget:waiting.note.id};
  toast(t('memoryRestored'));
 };
 const visible=notes.filter(note=>!hidden.includes(note.id));
 // The search is the person's text, compared without case to each note's own; a query of spaces filters nothing.
 const found=query.trim();
 const matched=found?visible.filter(note=>note.text.toLowerCase().includes(found.toLowerCase())):visible;
 const clearSearch=()=>{ setQuery(''); search.current?.focus(); };
 const errorLine=editError==='empty'?t('memoryNoteEmpty'):editError==='tooLong'?t('memoryTooLong'):editError==='stale'?t('memoryStale'):editError==='failed'?t('memoryEditFailed'):null;
 const intro=`${t('memoryIntro')} ${t('memoryIntroAgent',agent.name)}${(canEdit&&canForget)?` ${t('memoryIntroEdit')}`:''}`;
 return <section className="dp-sec" aria-labelledby="mem-h">
  <h3 className="dp-label"><span><span id="mem-h">{t('memoryHeading',agent.name)} <span className="muted num">{visible.length}</span></span>{introAsHelp&&<InfoTip about={t('memoryHeading',agent.name)} id="mem-intro">{intro}</InfoTip>}</span>
   {canReset&&!asking&&<button ref={resetButton} type="button" className="link-btn" aria-expanded={false} onClick={ask}>{t('memoryReset')}</button>}</h3>
  {/* In Settings the introduction is the heading's optional help (#614); the details panel keeps it as a line. */}
  {!introAsHelp&&<p className="mem-intro">{intro}</p>}
  <p className="mem-know"><ShellIcon name="book"/><span>{t('memoryKnow',agent.name)}</span>
   {knowledgeHref&&<Link className="link-btn" href={knowledgeHref}>{t('memoryOpenKnowledge')}</Link>}</p>
  {main&&<p className="mem-main">{t('memoryMain',agent.name)}</p>}
  <div className="mem-search"><label className="sr-only" htmlFor="mem-q">{t('memorySearch')}</label>
   <input type="search" id="mem-q" ref={search} autoComplete="off" placeholder={t('memorySearch')} value={query} onChange={event=>setQuery(event.target.value)}
    onKeyDown={event=>{ if(event.key==='Escape'&&query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}/></div>
  {asking&&<div className="panel-card mem-confirm">
   <p className="panel-empty">{t('memoryResetAsk',agent.name)}</p>
   <div className="panel-form__row panel-form__row--end">
    <button ref={cancelButton} type="button" className="btn btn--secondary" disabled={pending} onClick={keep}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" aria-busy={pending} disabled={pending} onClick={reset}>{t('memoryReset')}</button>
   </div></div>}
  {failed&&<p className="set-err" role="alert">{t('memoryResetFailed')}</p>}
  {forgetError&&<p className="set-err" role="alert">{t('memoryForgetFailed')}</p>}
  <div className="mem-list" aria-live="polite">
   {found&&!matched.length
    ?<div className="panel-card"><div className="mem-empty"><p className="panel-empty">{t('memoryNoMatch',agent.name,found)}</p>
     <button type="button" className="link-btn" onClick={clearSearch}>{t('memoryClearSearch')}</button></div></div>
    :matched.length
    ?<ul className="panel-card">{matched.map(note=><li key={note.id} className="panel-row mem-note" data-mem-row={note.id}>
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
  </div>
 </section>;
}
