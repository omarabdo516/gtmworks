'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { WorkAction } from './work';

// The Ideas column's own form (#188; design-reference: renderBoard's .add-idea): one line for the idea, the Company's
// Agents the reader sees with the main Agent first, and Add and Cancel. It sits above the Cards in the column and closes
// back onto the column's "+".
export default function AddIdea({company,slug,stage,agents,preferred,workAction,onClose}:{company:string,slug:string,stage:number,agents:{id:string,name:string}[],preferred?:string,workAction:WorkAction,onClose:()=>void}) {
 const {t}=useI18n();
 const [title,setTitle]=useState('');
 const [agent,setAgent]=useState(preferred&&agents.some(choice=>choice.id===preferred)?preferred:agents[0]?.id||'');
 const [error,setError]=useState(false);
 const [pending,setPending]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 // Opening moves the focus into the Idea field, as the reference does.
 useEffect(()=>{ input.current?.focus({preventScroll:true}); },[]);
 const close=()=>onClose();
 const send=()=>{
  if(pending) return;
  const idea=title.trim();
  if(!idea) { setError(true); input.current?.focus({preventScroll:true}); return; }
  if(!agent) return;
  setPending(true);
  const form=new FormData();
  form.set('op','idea'); form.set('company',company); form.set('slug',slug); form.set('stage',String(stage));
  form.set('title',idea); form.set('agent',agent);
  void workAction(form).catch(()=>setPending(false));
 };
 return <form className="add-idea" id="add-idea" onSubmit={event=>{ event.preventDefault(); send(); }}
  onKeyDown={event=>{ if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
  <label htmlFor="idea-title">{t('ideaLabel')}</label>
  <input ref={input} id="idea-title" type="text" autoComplete="off" dir="auto" placeholder={t('ideaPlaceholder')} aria-describedby="idea-err"
   aria-invalid={error||undefined} value={title} onChange={event=>{ setTitle(event.target.value); if(event.target.value.trim()) setError(false); }}
   onKeyDown={event=>{ if(event.key==='Enter') { event.preventDefault(); send(); } }}/>
  <span className="add-idea__err" id="idea-err" hidden={!error}>{t('ideaNeedsText')}</span>
  <label htmlFor="idea-agent">{t('cardAgent')}</label>
  <select id="idea-agent" value={agent} onChange={event=>setAgent(event.target.value)} disabled={!agents.length}>{agents.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
  <div className="add-idea__row">
   <button type="submit" className="btn btn--primary btn--sm" disabled={!agents.length||pending}>{t('add')}</button>
   <button type="button" className="btn btn--secondary btn--sm" onClick={close}>{t('cancel')}</button>
  </div>
 </form>;
}
