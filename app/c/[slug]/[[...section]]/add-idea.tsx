'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import type { AddIdeaAction } from './work';

// The Ideas column's own form (#188; design-reference: renderBoard's .add-idea): one line for the idea, the Company's
// Agents the reader sees with the main Agent first, and Add and Cancel. It sits above the Cards in the column and closes
// back onto the column's "+".
export default function AddIdea({company,slug,stage,agents,preferred,addIdea,onClose}:{company:string,slug:string,stage:number,agents:{id:string,name:string}[],preferred?:string,addIdea:AddIdeaAction,onClose:()=>void}) {
 const {t}=useI18n(); const router=useRouter();
 // The request key belongs to the idea's words and Agent (#452): the same unchanged idea retried, or Add pressed twice,
 // is one Card, while an idea the person edits is a new one, since the server refuses a key reused with another idea.
 const [key,setKey]=useState(()=>crypto.randomUUID());
 const [title,setTitle]=useState('');
 const [agent,setAgent]=useState(preferred&&agents.some(choice=>choice.id===preferred)?preferred:agents[0]?.id||'');
 const [error,setError]=useState(false);
 const [failed,setFailed]=useState(false);
 const [pending,setPending]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 // A form that has closed has no say over the one open in its place: the parent unmounts it when the person cancels, so
 // its late answer is ignored rather than closing the new form and sending the board to a Card it never asked for.
 const mounted=useRef(true);
 useEffect(()=>()=>{ mounted.current=false; },[]);
 // Opening moves the focus into the Idea field, as the reference does.
 useEffect(()=>{ input.current?.focus({preventScroll:true}); },[]);
 const close=()=>onClose();
 const send=()=>{
  if(pending) return;
  const idea=title.trim();
  if(!idea) { setError(true); input.current?.focus({preventScroll:true}); return; }
  if(!agent) return;
  setPending(true); setFailed(false);
  const form=new FormData();
  form.set('key',key); form.set('company',company); form.set('slug',slug); form.set('stage',String(stage));
  form.set('title',idea); form.set('agent',agent);
  // A form that could not be sent says so under the Idea it kept, and Add works again; one that was added closes back onto
  // the column's "+" and the board comes back on its Card (#188).
  const failure=()=>{ if(!mounted.current) return; setPending(false); setFailed(true); };
  void addIdea(form).then(result=>{
   if(!mounted.current) return;
   if(!('card' in result)) return failure();
   close(); router.replace(`/c/${slug}/work/board?show=${result.card}&idea=1`,{scroll:false});
  },failure);
 };
 return <form className="add-idea" id="add-idea" onSubmit={event=>{ event.preventDefault(); send(); }}
  onKeyDown={event=>{ if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
  <label htmlFor="idea-title">{t('ideaLabel')}</label>
  <input ref={input} id="idea-title" type="text" autoComplete="off" dir={title?'auto':undefined} placeholder={t('ideaPlaceholder')} aria-describedby="idea-err"
   aria-invalid={error||undefined} value={title} onChange={event=>{ setTitle(event.target.value); setKey(crypto.randomUUID()); setFailed(false); if(event.target.value.trim()) setError(false); }}
   onKeyDown={event=>{ if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}/>
  <span className="add-idea__err" id="idea-err" hidden={!error}>{t('ideaNeedsText')}</span>
  {failed&&<span className="add-idea__err" role="alert">{t('ideaFailed')}</span>}
  <label htmlFor="idea-agent">{t('cardAgent')}</label>
  <select id="idea-agent" value={agent} onChange={event=>{ setAgent(event.target.value); setKey(crypto.randomUUID()); setFailed(false); }} disabled={!agents.length}>{agents.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
  <div className="add-idea__row">
   <button type="submit" className="btn btn--primary btn--sm" disabled={!agents.length||pending}>{t('ideaAdd')}</button>
   <button type="button" className="btn btn--secondary btn--sm" onClick={close}>{t('cancel')}</button>
  </div>
 </form>;
}
