'use client';
import { useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useCardText } from '@/app/agent-card';
import { ChangeCard } from '@/app/change-card';
import { ShellIcon } from '@/components/shell-icon';
import type { WaitingItem } from '@/lib/approval-queue';
import type { ChangeProposalView } from '@/lib/conversations';
import { answerAgentChange } from './skill-actions';

// While an answer is on its way every control of its form is held, so a second press sends nothing.
function Held({children}:{children:(sending:boolean)=>ReactNode}) { return children(useFormStatus().pending); }
const kinds=['model','instructions','toolset','setting'] as const;

// design-reference: chgHTML for the Owner, chg-approve, chg-reject-open and chg-reject. «Decline» opens the reason, which
// a Company of one person may leave empty and a team writes, so the agent and the person who asked know why. `back` is
// where a done answer returns: "Waiting on you", or the chat it was proposed in.
export function ChangeAnswer({slug,company,change,alone=false,back}:{slug:string,company:string,change:ChangeProposalView,alone?:boolean,back?:string}) {
 const {c}=useCardText();
 const [declining,setDeclining]=useState(false); const [missing,setMissing]=useState(false);
 const why=useRef<HTMLTextAreaElement>(null); const no=useRef<HTMLButtonElement>(null);
 const ids={why:`chg-why-${change.id}`,error:`chg-why-err-${change.id}`,hint:`chg-why-hint-${change.id}`};
 const fields=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="proposal" value={change.id}/>{back&&<input type="hidden" name="back" value={back}/>}</>;
 if(declining) return <form action={answerAgentChange} noValidate onSubmit={event=>{ if(alone||why.current?.value.trim()) return; event.preventDefault(); setMissing(true); why.current?.focus(); }}>
  {fields}<input type="hidden" name="intent" value="decline"/><Held>{sending=><>
  <div className="pp-form"><div className="set-field"><label className="set-label" htmlFor={ids.why}>{c(alone?'changeWhyLabelOptional':'changeWhyLabel')}</label>
   <textarea ref={why} className="set-input set-textarea" id={ids.why} name="reason" rows={3} maxLength={1000} dir="auto" required={!alone} autoFocus readOnly={sending} placeholder={c('changeWhyExample')}
    aria-describedby={`${ids.error} ${ids.hint}`} aria-invalid={missing||undefined} onInput={()=>setMissing(false)}/>
   <span className="set-err" id={ids.error} hidden={!missing}>{c('changeWhyMissing')}</span>
   <span className="set-hint" id={ids.hint}>{c('changeWhyHint')}</span></div></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled={sending} onClick={()=>{ setDeclining(false); setMissing(false); requestAnimationFrame(()=>no.current?.focus()); }}>{c('changeCancel')}</button>
   <button className="btn btn--primary" disabled={sending} aria-busy={sending||undefined}>{c('changeDecline')}</button></div>
 </>}</Held></form>;
 return <form action={answerAgentChange} className="card__actions">{fields}<Held>{sending=><>
  <button ref={no} type="button" className="btn btn--secondary" disabled={sending} onClick={()=>setDeclining(true)}>{c('changeDecline')}</button>
  <button className="btn btn--primary" name="intent" value="approve" disabled={sending} aria-busy={sending||undefined}>{c('changeApprove')}</button>
 </>}</Held></form>;
}

// One waiting proposal in "Waiting on you". One whose details could not be read is drawn from the list alone and cannot
// be answered, so the Owner never approves a change seen in part.
export function OwnerChangeCard({slug,company,item,alone}:{slug:string,company:string,item:WaitingItem,alone?:boolean}) {
 const {c}=useCardText();
 const change=kinds.find(kind=>kind===item.body)??'setting';
 const read=item.change;
 const view:ChangeProposalView=read?{id:item.id,change,setting:read.setting,value:read.value,reason:read.reason,agent:read.agent,by:read.by,state:'waiting',owners:[]}
  :{id:item.id,change,setting:null,value:null,reason:'',agent:{id:'',connection_id:`agent-change-${item.id}`,name:item.title},by:{id:item.asked_by===item.title?'':'-',connection_id:'',name:item.asked_by},state:'waiting',owners:[]};
 if(!read) return <ChangeCard change={view} owner unread answer={<>
  <div className="card__outcome" role="note"><ShellIcon name="clock"/><span>{c('changeUnread')}</span></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled>{c('changeDecline')}</button><button type="button" className="btn btn--primary" disabled>{c('changeApprove')}</button></div>
 </>}/>;
 return <ChangeCard change={view} owner answer={<ChangeAnswer slug={slug} company={company} change={view} alone={alone}/>}/>;
}
