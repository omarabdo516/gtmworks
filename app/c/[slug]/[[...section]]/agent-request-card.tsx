'use client';
import { useRef, useState } from 'react';
import { RequestCard, useCardText } from '@/app/agent-card';
import { ShellIcon } from '@/components/shell-icon';
import type { WaitingItem } from '@/lib/approval-queue';
import { answerAgentRequest } from './skill-actions';

// design-reference: agentCardHTML for the Owner, approveRequest and refuseRequest.
export function OwnerRequestCard({slug,company,lead,item}:{slug:string,company:string,lead:string,item:WaitingItem}) {
 const {c,cb}=useCardText();
 const [refusing,setRefusing]=useState(false); const [missing,setMissing]=useState(false);
 const why=useRef<HTMLTextAreaElement>(null); const no=useRef<HTMLButtonElement>(null);
 const ids={why:`ac-why-${item.id}`,error:`ac-why-err-${item.id}`,hint:`ac-why-hint-${item.id}`};
 const request={id:item.id,name:item.title,job:item.body,apps:item.request?.apps??[],askedBy:item.asked_by,askedWith:item.request?.asked_with??'',state:'waiting' as const,owners:[]};
 if(!item.request) return <RequestCard slug={slug} request={request} owner unread answer={<>
  <div className="card__outcome" role="note"><ShellIcon name="clock"/><span>{c('requestUnread')}</span></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled>{c('requestNo')}</button><button type="button" className="btn btn--primary" disabled>{c('requestMake')}</button></div>
 </>}/>;
 const fields=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="request" value={item.id}/></>;
 const answer=refusing?<form action={answerAgentRequest} noValidate onSubmit={event=>{ if(why.current?.value.trim()) return; event.preventDefault(); setMissing(true); why.current?.focus(); }}>
  {fields}<input type="hidden" name="intent" value="no"/>
  <div className="pp-form"><div className="set-field"><label className="set-label" htmlFor={ids.why}>{c('requestWhyNot')}</label>
   <textarea ref={why} className="set-input set-textarea" id={ids.why} name="reason" rows={3} maxLength={1000} dir="auto" required autoFocus placeholder={c('requestWhyExample')}
    aria-describedby={`${ids.error} ${ids.hint}`} aria-invalid={missing||undefined} onInput={()=>setMissing(false)}/>
   <span className="set-err" id={ids.error} hidden={!missing}>{cb('requestWhyMissing',item.asked_by)}</span>
   <span className="set-hint" id={ids.hint}>{cb('requestWhyGoesTo',item.asked_by,lead)}</span></div></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" onClick={()=>{ setRefusing(false); setMissing(false); requestAnimationFrame(()=>no.current?.focus()); }}>{c('requestCancel')}</button>
   <button className="btn btn--primary">{c('requestSendNo')}</button></div>
 </form>:<form action={answerAgentRequest} className="card__actions">{fields}
  <button ref={no} type="button" className="btn btn--secondary" onClick={()=>setRefusing(true)}>{c('requestNo')}</button>
  <button className="btn btn--primary" name="intent" value="make">{c('requestMake')}</button>
 </form>;
 return <RequestCard slug={slug} request={request} owner answer={answer}/>;
}
