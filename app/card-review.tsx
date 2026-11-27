'use client';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import type { CompanyCard } from '@/lib/company-card.mjs';
import type { BoardAnswer } from './card-window';
import './card-review.css';

// A review on a Card (spec #831, #839; design-reference-card: cwCalloutHTML's review, cwSendBack, verStHTML): the callout
// at the top of a Card that waits on a review, with what its Agent handed in, and Pass and Send back for an Administrator
// (the Owner Role) or a Manager; Send back opens the reason, which it needs. Each is one request to gtmworks
// (app/api/board/card/review), which writes the person's name on the Engine; the window then reads the Card again and
// the board takes the answer's read. A Card sent back says by whom and why until it waits on a review again, and a Card
// passed says by whom under its summary: an Agent or a person, by name. ADR 0033: no Approval panel and no Version, so
// the reference's version list and its "Approve" are not drawn; the tick reads Passed.

type Say=(key:string,...values:unknown[])=>string;
type Review=NonNullable<CompanyCard['review']>;

const nameOf=(by:Review['by'],c:Say)=>!by?'':'person' in by?by.person:by.agent?.name??c('cwAnAgent');
const Face=({by}:{by:Review['by']})=>!by?null:'person' in by
 ?<span className="me__av" style={{'--av':'28px'} as CSSProperties} aria-hidden="true">{Array.from(by.person.trim())[0]||'?'}</span>
 :by.agent?<AgentFace agent={by.agent.id} size={28}/>:null;

/** The callout of a Card that waits on a review, or the line saying who sent it back; null for any other Card. */
export function ReviewCallout({company,card,reviewer,ui,c,sym,label,onDone}:{company:string,card:CompanyCard,reviewer:boolean,ui:'rtl'|'ltr',c:Say,
 sym:(kind:'review'|'sentBack')=>ReactNode,label:string,onDone:(answer:BoardAnswer)=>void}) {
 const [open,setOpen]=useState(false); const [reason,setReason]=useState(''); const [empty,setEmpty]=useState(false);
 const [busy,setBusy]=useState(false); const [said,setSaid]=useState('');
 const review=card.archived?null:card.review;
 if(review?.state==='sentBack') return <section className="cw-call cw-review" aria-label={c('cwSentBackBy',nameOf(review.by,c))}>
  <div className="cw-call__head">{sym('sentBack')}<span className="cw-call__face" title={nameOf(review.by,c)}><Face by={review.by}/></span>
   <div className="cw-call__body"><p className="cw-review__by">{c('cwSentBackBy',nameOf(review.by,c))}</p>{review.text&&<p className="cw-call__q cw-review__why" dir="auto">{review.text}</p>}</div></div>
 </section>;
 if(card.symbol?.kind!=='review'||card.archived) return null;
 async function decide(action:'pass'|'sendBack') {
  if(busy) return;
  if(action==='sendBack'&&!reason.trim()) { setEmpty(true); document.getElementById('cw-reason')?.focus(); return; }
  setBusy(true); setSaid('');
  let sent:{ok:boolean,body:(BoardAnswer&{error?:string})|null};
  try {
   const response=await fetch('/api/board/card/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,card:card.id,action,...action==='sendBack'?{reason}:{}})});
   sent={ok:response.ok,body:await response.json().catch(()=>null)};
  } catch { sent={ok:false,body:null}; }
  setBusy(false);
  if(sent.ok) { setOpen(false); setReason(''); if(sent.body) onDone(sent.body); return; }
  const gone=sent.body?.error==='cardNotInReview';
  setSaid(c(gone?'cwNotInReview':action==='pass'?'cwPassFailed':'cwSendBackFailed'));
  if(gone) onDone({});
 }
 const back=<ShellIcon name={ui==='rtl'?'sendBack':'sendBackLtr'}/>;
 const cancel=()=>{ setOpen(false); setEmpty(false); requestAnimationFrame(()=>document.querySelector<HTMLElement>('.cw-sendback')?.focus()); };
 const by=review?.state==='requested'?review.by:card.agent?{agent:card.agent}:null;
 return <section className="cw-call cw-call--wait" aria-label={label}>
  <div className="cw-call__head">{sym('review')}{by&&<span className="cw-call__face" title={nameOf(by,c)}><Face by={by}/></span>}
   <div className="cw-call__body"><p className="cw-call__q" dir="auto">{review?.state==='requested'&&review.text||c('runReview')}</p></div></div>
  {reviewer&&(open?<>
   <div className="cw-ans"><label className="sr-only" htmlFor="cw-reason">{c('cwReason')}</label>
    <textarea className="set-input set-textarea" id="cw-reason" rows={2} dir="auto" placeholder={c('cwReasonHint')} value={reason} disabled={busy}
     aria-describedby="cw-reason-err" aria-invalid={empty||undefined} onChange={event=>{ setReason(event.target.value); if(event.target.value.trim()) setEmpty(false); }}
     onKeyDown={event=>{ if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }}/>
    <span className="set-err" id="cw-reason-err" hidden={!empty}>{c('cwReasonEmpty')}</span></div>
   <div className="cw-call__acts"><button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={cancel}>{c('cwCancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={()=>void decide('sendBack')}>{back}<span>{c('cwSendBack')}</span></button></div>
  </>:<div className="cw-call__acts">
   <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={()=>void decide('pass')}><ShellIcon name="check"/><span>{c('cwPass')}</span></button>
   <button type="button" className="btn btn--secondary btn--sm cw-sendback" disabled={busy} onClick={()=>{ setOpen(true); setSaid(''); requestAnimationFrame(()=>document.getElementById('cw-reason')?.focus()); }}>{back}<span>{c('cwSendBack')}</span></button>
  </div>)}
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </section>;
}

/** Who passed a done Card, under its summary; null for a Card no review passed. */
export function PassedLine({card,c,sym}:{card:CompanyCard,c:Say,sym:ReactNode}) {
 const review=card.review;
 if(review?.state!=='passed'||card.column!=='done') return null;
 return <p className="cw-review cw-review--passed">{sym}<span>{c('cwPassedBy',nameOf(review.by,c))}</span></p>;
}
