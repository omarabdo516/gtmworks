'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import type { BoardCard } from './board';
import '@/app/new-card.css';

// New card (spec #831, #836; design-reference-card: ncOpen, ncSave, ncAsgHTML, ncSyncAsg, popHTML 'nc-asg'): one small
// form over the board, a title, a description, an Assignee and a publishing date. The Card is made on the Company's
// Engine: given to an Agent it starts at once (the lightning symbol says so), given to a Member it waits for them and no
// Agent picks it up, and given to nobody it waits. The menu offers "Assign to me" first, then the Agents the reader sees
// and the Members, then "No one yet". One request key for the dialog's life, so a double press or a retried request is
// one Card. Escape, Cancel and Close make nothing; the keyboard goes back where it was when the dialog closes.
export type MadeBoard={made:string,cards?:BoardCard[],main?:{id:string,name:string}|null};
type Choices={me:string,agents:{id:string,name:string}[],people:{id:string,name:string}[]};
const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};
const Initial=({name,size}:{name:string,size:number})=><span className="me__av lg-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;
const NoOne=({size}:{size:number})=><span className="cw-noone" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true"/>;

export default function NewCard({company,onClose,onMade}:{company:string,onClose:()=>void,onMade:(answer:MadeBoard)=>void}) {
 const {t}=useI18n();
 const box=useRef<HTMLDialogElement>(null); const titleField=useRef<HTMLInputElement>(null); const pick=useRef<HTMLButtonElement>(null); const menu=useRef<HTMLDivElement>(null);
 const menuId=useId();
 const [key]=useState(()=>crypto.randomUUID());
 const [choices,setChoices]=useState<Choices|null>(null);
 const [title,setTitle]=useState(''); const [description,setDescription]=useState(''); const [assignee,setAssignee]=useState(''); const [publishOn,setPublishOn]=useState('');
 const [missing,setMissing]=useState(false); const [failed,setFailed]=useState(''); const [saving,setSaving]=useState(false); const [open,setOpen]=useState(false);
 useLayoutEffect(()=>{ const dialog=box.current; if(dialog&&!dialog.open) dialog.showModal(); titleField.current?.focus(); },[]);
 useEffect(()=>{
  let live=true;
  void fetch(`/api/board/cards?company=${encodeURIComponent(company)}`,{cache:'no-store'})
   .then(async response=>response.ok?await response.json() as Choices:null,()=>null).then(found=>{ if(live&&found) setChoices(found); });
  return ()=>{ live=false; };
 },[company]);
 useEffect(()=>{
  if(!open) return;
  menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  const outside=(event:PointerEvent)=>{ if(!menu.current?.contains(event.target as Node)&&!pick.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const agentOf=(value:string)=>value.startsWith('agent:')?choices?.agents.find(agent=>agent.id===value.slice(6)):undefined;
 const personOf=(value:string)=>value.startsWith('member:')?choices?.people.find(person=>person.id===value.slice(7)):undefined;
 const nameOf=(value:string)=>agentOf(value)?.name??personOf(value)?.name??'';
 const faceOf=(value:string,size:number)=>{ const agent=agentOf(value); const person=personOf(value);
  return agent?<AgentFace agent={agent.id} size={size}/>:person?<Initial name={person.name} size={size}/>:<NoOne size={size}/>; };
 const shown=nameOf(assignee)||t('ncNoOneYet');
 const starting=agentOf(assignee);
 const choose=(value:string)=>{ setAssignee(value); setOpen(false); pick.current?.focus(); };
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); pick.current?.focus(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 const item=(value:string,label:ReactNode,lead:ReactNode,checkable=true)=><button key={checkable?value||'none':'me'} type="button" className="menu__item" role="menuitemradio"
  aria-checked={checkable&&assignee===value} onClick={()=>choose(value)}>{lead}<span className="menu__t">{label}</span>{checkable&&assignee===value&&<ShellIcon name="check"/>}</button>;
 const close=()=>box.current?.close();
 async function save() {
  if(saving) return;
  if(!title.trim()) { setMissing(true); titleField.current?.focus(); return; }
  setSaving(true); setFailed('');
  let answer:Response|null=null;
  try { answer=await fetch('/api/board/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,key,title,description,assignee,publishOn})}); } catch { answer=null; }
  const body=await answer?.json().catch(()=>null) as (MadeBoard&{error?:string})|null;
  if(answer?.ok&&body?.made) { onMade(body); close(); return; }
  setSaving(false);
  setFailed(body?.error==='cardAssigneeInvalid'?t('ncAssigneeGone'):t('ncFailed'));
 }
 return <dialog ref={box} className="gw modal modal--sm modal--fit nc-dlg" aria-labelledby="nc-title" onClose={onClose}>
  <div className="modal__inner">
   <header className="modal__head"><div className="modal__titles"><h2 className="modal__title" id="nc-title">{t('newCard')}</h2></div>
    <button type="button" className="circle-btn" data-close aria-label={t('close')} title={t('close')} onClick={close}><ShellIcon name="x"/></button></header>
   <div className="modal__body"><div className="nc-form">
    <div className="nc-field"><label className="sr-only" htmlFor="nc-t">{t('title')}</label>
     <input ref={titleField} type="text" className="set-input nc-title" id="nc-t" dir="auto" autoComplete="off" aria-required="true" aria-describedby="nc-t-err" aria-invalid={missing||undefined}
      placeholder={t('title')} value={title} maxLength={500}
      onChange={event=>{ setTitle(event.target.value); if(event.target.value.trim()) setMissing(false); }}
      onKeyDown={event=>{ if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }}
      onBlur={event=>{ if(!event.target.value.trim()&&!(event.relatedTarget as HTMLElement|null)?.closest('[data-close]')) setMissing(true); }}/>
     <span className="set-err" id="nc-t-err" hidden={!missing}>{t('ncTitleMissing')}</span></div>
    <div className="nc-field"><label className="sr-only" htmlFor="nc-d">{t('ncDescription')}</label>
     <textarea className="set-input nc-desc" id="nc-d" dir="auto" placeholder={t('ncDescription')} value={description} maxLength={20000} onChange={event=>setDescription(event.target.value)}/></div>
    <div className="nc-row">
     <button ref={pick} type="button" className="nc-pick" id="nc-asg" aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined}
      aria-label={t('ncAssigneeIs',shown)} title={t('ncAssignee')} onClick={()=>setOpen(!open)}>{faceOf(assignee,20)}<span className="od-truncate"><bdi>{shown}</bdi></span><ShellIcon name="chevronDown"/></button>
     {starting&&<span className="sym sym--ok" id="nc-bolt" role="img" aria-label={t('ncStartsAtOnce',starting.name)} title={t('ncStartsAtOnce',starting.name)}><ShellIcon name="bolt"/></span>}
     <span className="od-fill"/>
     <label className="sr-only" htmlFor="nc-date">{t('publishingDate')}</label>
     <input type="date" className="set-input nc-date" id="nc-date" title={t('publishingDate')} value={publishOn} onChange={event=>setPublishOn(event.target.value)}/>
     {open&&<div ref={menu} className="menu nc-menu" id={menuId} role="menu" aria-label={t('ncAssignee')} onKeyDown={keys}>
      {choices&&item(`member:${choices.me}`,t('assignToMe'),<Initial name={choices.people.find(person=>person.id===choices.me)?.name??''} size={22}/>,false)}
      {choices&&<div className="menu__sep" role="separator"/>}
      {!!choices?.agents.length&&<div className="menu__label" role="presentation">{t('ncAgents')}</div>}
      {choices?.agents.map(agent=>item(`agent:${agent.id}`,<bdi>{agent.name}</bdi>,<AgentFace agent={agent.id} size={22}/>))}
      {!!choices?.people.length&&<div className="menu__label" role="presentation">{t('ncPeople')}</div>}
      {choices?.people.map(person=>item(`member:${person.id}`,<><bdi>{person.name}</bdi>{person.id===choices.me&&<> <span className="menu__d" style={{display:'inline'}}>{t('ncYou')}</span></>}</>,<Initial name={person.name} size={22}/>))}
      <div className="menu__sep" role="separator"/>
      {item('',t('ncNoOneYet'),<NoOne size={22}/>)}
     </div>}
    </div>
    {failed&&<p className="set-err" role="alert">{failed}</p>}
   </div></div>
   <footer className="modal__foot modal__foot--end">
    <button type="button" className="btn btn--secondary" data-close onClick={close}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" disabled={saving} onClick={()=>void save()}>{t('ncAdd')}</button>
   </footer>
  </div>
 </dialog>;
}
