'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { cardColumns, columnLabel, statusOfColumn } from '@/lib/board-columns.mjs';
import { tickTodo } from '@/lib/card-description.mjs';
import { changeCard, moveCard, type CardChange, type ChangeAnswer } from './card-move';
import { CardDescription } from './card-description';

// What a Member who may write changes in the Card window (spec #831, #837; design-reference-card: cwHeadHTML's status
// button and title, cwDescHTML, cwSideHTML's date and waits-for rows, popHTML 'status' and 'waits', cwSetCol,
// cwTitleSave). Each change is one request with one field (app/card-move.ts), and the Card is read again after it. A
// title or description is saved only over what the person started from: one changed meanwhile by someone else keeps their
// words, the person's own stay in the field, and the window says so. A Viewer gets none of these (app/card-window.tsx).
type Say=(key:string,...values:unknown[])=>string;
type Done=(answer:ChangeAnswer)=>void;
const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};

/** A small menu under its button: opens on press, Escape closes it back to the button without closing the Card. */
function useMenu() {
 const [open,setOpen]=useState(false); const buttonRef=useRef<HTMLButtonElement>(null); const menuRef=useRef<HTMLDivElement>(null); const id=useId();
 useEffect(()=>{
  if(!open) return;
  (menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]:not([aria-disabled="true"])')??menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])'))?.focus();
  const outside=(event:PointerEvent)=>{ if(!menuRef.current?.contains(event.target as Node)&&!buttonRef.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 const close=()=>{ setOpen(false); buttonRef.current?.focus(); };
 return {open,setOpen,buttonRef,menuRef,id,keys,close};
}

/** The status in the head, a button that opens the five columns; In progress and Waiting on you are the work's own. */
export function StatusMenu({company,card,column,lead,writer,onBoard}:{company:string,card:string,column:string,lead:ReactNode,writer:boolean,onBoard:Done}) {
 const {t}=useI18n(); const {open,setOpen,buttonRef,menuRef,id,keys,close}=useMenu();
 const name=(value:string)=>t(columnLabel(value,writer));
 async function choose(to:string) {
  close();
  if(to===column) return;
  await moveCard({company,card,from:column,to,t,columnName:name,onBoard});
 }
 return <span className="cw-menu">
  <button ref={buttonRef} type="button" className={`cw-status${column==='waiting'?' is-wait':''}`} id="cw-status" aria-haspopup="menu" aria-expanded={open}
   aria-controls={open?id:undefined} aria-label={t('cardStatusIs',name(column))} onClick={()=>setOpen(!open)}>{lead}<span>{name(column)}</span><ShellIcon name="chevronDown"/></button>
  {open&&<div ref={menuRef} className="menu cw-pop cw-pop--start" id={id} role="menu" aria-label={t('cardStatus')} onKeyDown={keys}>
   {cardColumns.map(value=>{ const own=!statusOfColumn(value,false)&&value!==column;
    return <button key={value} type="button" className="menu__item" role="menuitemradio" aria-checked={value===column} aria-disabled={own||undefined}
     title={own?t(value==='progress'?'cardMoveProgress':'cardMoveWaiting'):undefined} onClick={()=>{ if(!own) void choose(value); }}>
     <span className="menu__t">{name(value)}{own&&<span className="menu__d">{t(value==='progress'?'cardMoveProgress':'cardMoveWaiting')}</span>}</span>{value===column&&<ShellIcon name="check"/>}</button>; })}
  </div>}
 </span>;
}

/** The answer a refused save says, by the route's error. */
const saveRefusal=(c:Say,error?:string)=>error==='cardChanged'?c('cwChanged'):error==='cardInvalid'?c('cwTitleMissing'):c('cwSaveFailed');

/**
 * The title: for a Member who may write, a button that becomes a field with Save and Cancel (Enter saves, Escape
 * cancels); for anyone else, and before the Card's read, its text. The window keeps this one heading for every Card it
 * shows, so another Card opened in it starts on its own title with no field open.
 */
export function TitleEdit({company,card,title,editable,c,onSaved}:{company:string,card:string,title:string,editable:boolean,c:Say,onSaved:Done}) {
 const [open,setOpen]=useState<{card:string,from:string,value:string}|null>(null);
 const editing=open?.card===card&&editable?open:null;
 const setEditing=(next:{from:string,value:string}|null)=>setOpen(next&&{card,...next});
 const [said,setSaid]=useState(''); const [saving,setSaving]=useState(false);
 const field=useRef<HTMLInputElement>(null); const opener=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ if(editing&&document.activeElement!==field.current) { field.current?.focus(); field.current?.select(); } },[editing]);
 const leave=()=>{ setEditing(null); setSaid(''); requestAnimationFrame(()=>opener.current?.focus()); };
 async function save() {
  if(!editing||saving) return;
  if(!editing.value.trim()) { setSaid(c('cwTitleMissing')); field.current?.focus(); return; }
  if(editing.value.trim()===editing.from) { leave(); return; }
  setSaving(true); setSaid('');
  const answer=await changeCard(company,card,{title:editing.value,was:editing.from});
  setSaving(false);
  if(answer.ok) { onSaved(answer); leave(); return; }
  setSaid(saveRefusal(c,answer.error)); onSaved({});
 }
 if(!editing) return <h2 className="cw-title" id="cw-title" tabIndex={-1} dir="auto">{!editable?title:
  <button ref={opener} type="button" className="cw-title-btn" title={c('cwRename')} onClick={()=>setEditing({from:title,value:title})}>{title}</button>}</h2>;
 return <div className="cw-title-edit">
  <h2 className="sr-only" id="cw-title" tabIndex={-1}>{title}</h2>
  <label className="sr-only" htmlFor="cw-title-in">{c('cwTitleLabel')}</label>
  <input ref={field} type="text" className="set-input cw-title-in" id="cw-title-in" dir="auto" value={editing.value} maxLength={500} aria-describedby="cw-title-err" aria-invalid={!!said||undefined}
   onChange={event=>setEditing({...editing,value:event.target.value})}
   onKeyDown={event=>{ if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); void save(); } else if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); leave(); } }}/>
  <span className="set-err" id="cw-title-err" role="alert" hidden={!said}>{said}</span>
  <div className="cw-edit-row"><button type="button" className="btn btn--secondary btn--sm" onClick={leave}>{c('cwCancel')}</button>
   <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={()=>void save()}>{c('cwSave')}</button></div>
 </div>;
}

/**
 * The description: read drawn with its to-do items ticked in place, an Edit button beside it (or "Add a description"),
 * and in edit, its Markdown in a field with Cancel and Done. A tick shows at once and is sent as that line alone.
 */
export function DescriptionEdit({company,card,body,ui,c,onSaved}:{company:string,card:string,body:string,ui:'rtl'|'ltr',c:Say,onSaved:Done}) {
 const [editing,setEditing]=useState<{from:string,value:string}|null>(null);
 const [said,setSaid]=useState(''); const [saving,setSaving]=useState(false);
 // A tick shows at once, over the description it was made on, until the Card's own read says something new.
 const [ticked,setTicked]=useState<{on:string,body:string}|null>(null);
 if(ticked&&ticked.on!==body) setTicked(null);
 const field=useRef<HTMLTextAreaElement>(null); const pen=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ if(editing&&document.activeElement!==field.current) field.current?.focus(); },[editing]);
 const leave=()=>{ setEditing(null); setSaid(''); requestAnimationFrame(()=>pen.current?.focus()); };
 async function save() {
  if(!editing||saving) return;
  if(editing.value===editing.from) { leave(); return; }
  setSaving(true); setSaid('');
  const answer=await changeCard(company,card,{description:editing.value,was:editing.from});
  setSaving(false);
  if(answer.ok) { onSaved(answer); leave(); return; }
  setSaid(saveRefusal(c,answer.error)); onSaved({});
 }
 async function tick(index:number,text:string,done:boolean) {
  const next=tickTodo(ticked?.body??body,index,text,done); if(next===null) return;
  setTicked({on:body,body:next}); setSaid('');
  const answer=await changeCard(company,card,{tick:{index,text,done}} as CardChange);
  if(answer.ok) { onSaved(answer); return; }
  setTicked(null); setSaid(saveRefusal(c,answer.error)); onSaved({});
 }
 const h=<h3 className="sr-only" id="cw-h-desc">{c('cwDescription')}</h3>;
 if(editing) return <section className="cw-sec cw-desc-sec is-edit" aria-labelledby="cw-h-desc">{h}
  <label className="sr-only" htmlFor="cw-desc-in">{c('cwDescription')}</label>
  <textarea ref={field} className="set-input set-textarea cw-desc-in" id="cw-desc-in" dir="auto" rows={8} value={editing.value} maxLength={20000} aria-describedby="cw-desc-err cw-desc-hint"
   onChange={event=>setEditing({...editing,value:event.target.value})}
   onKeyDown={event=>{ if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); leave(); } else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)) { event.preventDefault(); void save(); } }}/>
  <p className="cw-said" id="cw-desc-hint">{c('cwDescriptionHint')}</p>
  <span className="set-err" id="cw-desc-err" role="alert" hidden={!said}>{said}</span>
  <div className="cw-edit-row"><button type="button" className="btn btn--secondary btn--sm" onClick={leave}>{c('cwCancel')}</button>
   <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={()=>void save()}>{c('cwDone')}</button></div>
 </section>;
 const shown=ticked?.body??body;
 const start=()=>{ setSaid(''); setEditing({from:body,value:body}); };
 return <section className={`cw-sec cw-desc-sec${shown.trim()?'':' is-empty'}`} aria-labelledby="cw-h-desc">{h}
  {shown.trim()?<div className="cw-desc-row"><div className="de-host"><CardDescription body={shown} ui={ui} c={c} onTick={(index,text,done)=>void tick(index,text,done)}/></div>
   <button ref={pen} type="button" className="ib ib--sm cw-pen" aria-label={c('cwEditDescription')} title={c('cwEdit')} onClick={start}><ShellIcon name="pencil"/></button></div>
   :<button ref={pen} type="button" className="cw-empty cw-empty--btn" onClick={start}>{c('cwAddDescription')}</button>}
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </section>;
}

/** The publishing date: the row's own date field (design-reference-card: cwSideHTML's dateRaw row), cleared to none. */
export function DateRow({company,card,publishOn,c,label,onSaved}:{company:string,card:string,publishOn:string|null,c:Say,label:string,onSaved:Done}) {
 const [said,setSaid]=useState(''); const [value,setValue]=useState<{on:string|null,value:string}|null>(null);
 if(value&&value.on!==publishOn) setValue(null);
 async function save(next:string) {
  setValue({on:publishOn,value:next}); setSaid('');
  const answer=await changeCard(company,card,{publishOn:next});
  if(answer.ok) { onSaved(answer); return; }
  setValue(null); setSaid(c('cwSaveFailed'));
 }
 return <>
  <div className="cwp"><span className="cwp__ic" title={label} aria-hidden="true"><ShellIcon name="calendar"/></span><label className="sr-only" htmlFor="cw-date">{label}</label>
   <input type="date" className="set-input cw-input" id="cw-date" value={value?.value??publishOn??''} title={label} onChange={event=>void save(event.target.value)}/></div>
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </>;
}

export type WaitChoice={id:string,title:string,column:string};
/** The Cards this one waits for: each chip with its remove button, and the add button that opens the Cards it may wait for. */
export function WaitsFor({company,card,chips,choices,c,onSaved}:{company:string,card:string,chips:{id:string|null,title:string|null,node:ReactNode}[],choices:WaitChoice[],c:Say,onSaved:Done}) {
 const {t}=useI18n(); const {open,setOpen,buttonRef,menuRef,id,keys}=useMenu(); const [said,setSaid]=useState('');
 async function send(change:CardChange) {
  setOpen(false); setSaid('');
  const answer=await changeCard(company,card,change);
  if(answer.ok) { onSaved(answer); return; }
  setSaid(answer.error==='cardWaitRefused'?t('cardWaitRefused'):c('cwSaveFailed')); onSaved({});
 }
 const add=<span className="cw-menu">
  <button ref={buttonRef} type="button" className={chips.length?'ib ib--sm':'cwp__b is-empty'} id="cw-waits" aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined}
   aria-label={c('cwWaitFor')} title={c('cwWaitsFor')} onClick={()=>setOpen(!open)}>
   {chips.length?<ShellIcon name="plus"/>:<><span className="cwp__ic"><ShellIcon name="hourglass"/></span><span className="cwp__add">{c('cwAdd')}</span></>}</button>
  {open&&<div ref={menuRef} className="menu cw-pop" id={id} role="menu" aria-label={c('cwWaitFor')} onKeyDown={keys}>
   {choices.length?choices.map(other=><button key={other.id} type="button" className="menu__item" role="menuitem" onClick={()=>void send({waitFor:other.id})}>
    <span className="menu__t"><bdi dir="auto">{other.title}</bdi><span className="menu__d">{t(columnLabel(other.column,true))}</span></span></button>)
    :<p className="menu__label">{c('cwNoWaitChoice')}</p>}
  </div>}
 </span>;
 return <>
  {chips.length?<div className="cwp cwp--chips"><span className="cwp__ic" title={c('cwWaitsFor')} aria-hidden="true"><ShellIcon name="hourglass"/></span><span className="sr-only">{c('cwWaitsFor')}:</span>
   <ul className="cw-chips">{chips.map((chip,index)=><li key={chip.id??`hidden-${index}`} className="cw-chip">{chip.node}
    {chip.id&&<button type="button" className="cw-chip__x" aria-label={c('cwStopWaiting',chip.title??'')} title={c('cwRemove')} onClick={()=>void send({stopWaitingFor:chip.id!})}><ShellIcon name="x"/></button>}</li>)}</ul>{add}</div>
   :<div className="cwp">{add}</div>}
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </>;
}
