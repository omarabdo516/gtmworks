'use client';
import { useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import type { WorkAction } from '@/app/c/[slug]/[[...section]]/work';

// The review of a Card (#681; design-reference-card: cwCalloutHTML's review, cwApprove, cwSendBack): Approve, or Send
// back with a reason, on the exact Version the review was asked on. The reason is required: it becomes a comment the
// team reads, so whoever works the Card next knows what to change.
export function ReviewDecision({slug,company,card,version,send}:{slug:string,company:string,card:number,version:number|null,send:WorkAction}) {
 const {t}=useI18n(); const id=useId();
 const [back,setBack]=useState(false); const [reason,setReason]=useState(''); const [missing,setMissing]=useState(false);
 const field=useRef<HTMLTextAreaElement>(null);
 const fields=<><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={card}/>
  <input type="hidden" name="version" value={version??''}/><input type="hidden" name="view" value="sheet"/></>;
 if(!back) return <form action={send} className="cw-call__acts">{fields}
  <button className="btn btn--primary btn--sm" name="op" value="approve"><ShellIcon name="check"/><span>{t('cwApprove')}</span></button>
  <button type="button" className="btn btn--secondary btn--sm" onClick={()=>{ setBack(true); requestAnimationFrame(()=>field.current?.focus()); }}><ShellIcon name="sendBack"/><span>{t('cwSendBack')}</span></button>
 </form>;
 return <form action={send} className="cw-back" onSubmit={event=>{ if(!reason.trim()) { event.preventDefault(); setMissing(true); field.current?.focus(); } }}>{fields}
  <input type="hidden" name="op" value="send-back"/>
  <div className="cw-ans"><label className="sr-only" htmlFor={`${id}-reason`}>{t('cwReasonLabel')}</label>
   <textarea ref={field} className="set-input set-textarea" id={`${id}-reason`} name="reason" rows={2} dir="auto" placeholder={t('cwSendBackReason')} value={reason}
    onChange={event=>{ setReason(event.target.value); if(event.target.value.trim()) setMissing(false); }} aria-describedby={`${id}-err`} aria-invalid={missing||undefined}
    onKeyDown={event=>{ if(event.key==='Escape') { event.stopPropagation(); setBack(false); setMissing(false); } }}/>
   <span className="set-err" id={`${id}-err`} hidden={!missing}>{t('cwReasonRequired')}</span></div>
  <div className="cw-call__acts"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>{ setBack(false); setMissing(false); }}>{t('cancel')}</button>
   <button className="btn btn--primary btn--sm"><ShellIcon name="sendBack"/><span>{t('cwSendBack')}</span></button></div>
 </form>;
}
