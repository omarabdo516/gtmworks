'use client';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import type { CompanyCard } from '@/lib/company-card.mjs';
import type { BoardAnswer } from './card-window';
import './card-talk.css';

// Talking to the work on a Card (spec #831, #838; design-reference-card: cwCalloutHTML, cwComposerHTML, cwSideHTML's
// stop and start, sendNote, cwAnswer): the comment field under the tabs, the callout at the top of a Card stopped on a
// question with its answer box, or stopped after two failures with Continue, and Stop and Start at the end of the
// Assignee row. Each is one request to gtmworks (app/api/board/card/comments, app/api/board/card/run), which writes the
// person's name on the Engine and asks it to go on; the window then reads the Card again and the board takes the
// answer's read. A refusal leaves what was typed and says why in one line.

type Say=(key:string,...values:unknown[])=>string;
type Done=(answer:BoardAnswer)=>void;

async function post(path:string,body:object):Promise<{ok:boolean,body:(BoardAnswer&{error?:string})|null}> {
 try {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json().catch(()=>null)};
 } catch { return {ok:false,body:null}; }
}
const sends=(event:KeyboardEvent<HTMLTextAreaElement>,go:()=>void)=>{
 if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); go(); }
};

/** The comment field (cwComposerHTML). On a Card stopped on a question a comment is the answer, and the Agent goes on. */
export function CommentField({company,card,c,onDone}:{company:string,card:CompanyCard,c:Say,onDone:Done}) {
 const [text,setText]=useState(''); const [busy,setBusy]=useState(false); const [said,setSaid]=useState('');
 async function send() {
  if(!text.trim()||busy) return;
  setBusy(true); setSaid('');
  const answer=card.symbol?.kind==='question';
  const sent=await post('/api/board/card/comments',{company,card:card.id,body:text,answer});
  setBusy(false);
  if(sent.ok) { setText(''); if(sent.body) onDone(sent.body); return; }
  setSaid(c(sent.body?.error==='cardNotAsking'?'cwNotAsking':'cwCommentFailed'));
  if(sent.body?.error==='cardNotAsking') onDone({});
 }
 return <>
  <div className="composer note-composer" data-composer="note">
   <div className="composer__row">
    <label className="sr-only" htmlFor="ta-note">{c('cwWriteComment')}</label>
    <textarea className="composer__input" id="ta-note" rows={1} dir="auto" placeholder={c('cwCommentHint')} value={text} disabled={busy}
     onChange={event=>setText(event.target.value)} onKeyDown={event=>sends(event,()=>void send())}/>
    <button type="button" className="composer__send" aria-label={c('cwPost')} title={c('cwPostTip')} disabled={!text.trim()||busy} onClick={()=>void send()}><ShellIcon name="send"/></button>
   </div>
  </div>
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </>;
}

/** The callout at the top (cwCalloutHTML): the question with its answer box, or a Card stopped after two failures with
 * Continue. A Viewer reads the question and is offered nothing that writes. Null for any other Card. */
export function CardCallout({company,card,writer,c,sym,onDone}:{company:string,card:CompanyCard,writer:boolean,c:Say,sym:ReactNode,onDone:Done}) {
 const [answer,setAnswer]=useState(''); const [empty,setEmpty]=useState(false); const [busy,setBusy]=useState(false); const [said,setSaid]=useState('');
 const kind=card.archived?null:card.symbol?.kind;
 if(kind!=='question'&&kind!=='failed') return null;
 const face=card.agent?<span className="cw-call__face" title={card.agent.name}><AgentFace agent={card.agent.id} size={28}/></span>:null;
 const head=(body:ReactNode)=><div className="cw-call__head">{sym}{face}<div className="cw-call__body">{body}</div></div>;
 async function act(go:()=>Promise<{ok:boolean,body:(BoardAnswer&{error?:string})|null}>,refused:Record<string,string>,failed:string) {
  setBusy(true); setSaid('');
  const sent=await go();
  setBusy(false);
  if(sent.ok) { setAnswer(''); if(sent.body) onDone(sent.body); return; }
  const error=sent.body?.error??'';
  setSaid(c(refused[error]??failed));
  if(refused[error]) onDone({});
 }
 if(kind==='question') {
  const send=()=>{
   if(busy) return;
   if(!answer.trim()) { setEmpty(true); document.getElementById('cw-ans')?.focus(); return; }
   void act(()=>post('/api/board/card/comments',{company,card:card.id,body:answer,answer:true}),{cardNotAsking:'cwNotAsking'},'cwAnswerFailed');
  };
  return <section className="cw-call cw-call--wait" aria-label={c('cwQuestion')}>
   {head(<p className="cw-call__q" dir="auto">{card.question??''}</p>)}
   {writer&&<>
    <div className="cw-ans"><label className="sr-only" htmlFor="cw-ans">{c('cwYourAnswer')}</label>
     <textarea className="set-input set-textarea" id="cw-ans" rows={2} dir="auto" placeholder={c('cwYourAnswer')} value={answer} disabled={busy}
      aria-describedby="cw-ans-err" aria-invalid={empty||undefined} onChange={event=>{ setAnswer(event.target.value); if(event.target.value.trim()) setEmpty(false); }}
      onKeyDown={event=>sends(event,send)}/>
     <span className="set-err" id="cw-ans-err" hidden={!empty}>{c('cwAnswerEmpty')}</span></div>
    <div className="cw-call__acts"><button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={send}>{c('cwSendAnswer')}</button></div>
   </>}
   {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
  </section>;
 }
 return <section className="cw-call cw-call--wait" aria-label={c('cwFailedCall')}>
  {head(<p className="cw-call__q" dir="auto">{c('cwFailedWhy')}</p>)}
  {writer&&<div className="cw-call__acts"><button type="button" className="btn btn--primary btn--sm" disabled={busy}
   onClick={()=>void act(()=>post('/api/board/card/run',{company,card:card.id,action:'continue'}),{cardNotStopped:'cwNotStopped'},'cwContinueFailed')}>
   <ShellIcon name="play"/><span>{c('cwContinue')}</span></button></div>}
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </section>;
}

/** Stop for an Agent working the Card, and Start for a Card stopped by a person, at the end of the Assignee row
 * (cwSideHTML's ctl). Null for any other Card. */
export function RunControl({company,card,c,onDone,onSaid}:{company:string,card:CompanyCard,c:Say,onDone:Done,onSaid:(said:string)=>void}) {
 const [busy,setBusy]=useState(false);
 const kind=card.archived||!card.agent?null:card.symbol?.kind;
 if(kind!=='working'&&kind!=='stopped') return null;
 const action=kind==='working'?'stop':'continue';
 async function go() {
  setBusy(true); onSaid('');
  const sent=await post('/api/board/card/run',{company,card:card.id,action});
  setBusy(false);
  if(sent.ok) { if(sent.body) onDone(sent.body); return; }
  const error=sent.body?.error;
  onSaid(c(error==='cardNotRunning'?'cwNotRunning':error==='cardNotStopped'?'cwNotStopped':action==='stop'?'cwStopFailed':'cwContinueFailed'));
  if(error==='cardNotRunning'||error==='cardNotStopped') onDone({});
 }
 const name=card.agent?.name??'';
 return <button type="button" className="ib ib--sm cw-run-ctl" disabled={busy} onClick={()=>void go()}
  aria-label={c(action==='stop'?'cwStop':'cwStart',name)} title={c(action==='stop'?'cwStopTip':'cwStartTip')}>
  <ShellIcon name={action==='stop'?'stop':'play'}/></button>;
}
