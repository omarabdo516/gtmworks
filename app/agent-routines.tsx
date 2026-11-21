'use client';
// An Agent's Routines in its details' Activity tab (#205; design-reference/app.js: activityHTML's routines section,
// routineRowHTML, saveRoutine, the add-routine, cancel-routine, save-routine and routine-example cases). The rows are the
// cron jobs of this Agent's own Engine profile, read from GET /api/agent-routines after the section is drawn, so no page
// waits on the Engine; each is #31's row (app/settings-routines.tsx), and switching one or running it now does what it
// does in Settings, through the same route, checked and logged by the database.
//
// "Add" opens one line: the person writes one sentence, which lib/routine-sentence.mjs reads into a name and a
// schedule, and the Routine is made on. A sentence that does not say fully when asks for a time first, and nothing is
// made until one is given: each run is a paid Run (Omar, 2026-11-18). With no Routine the section says how to make one in
// the chat, and "Try writing" puts the general example there.
import { use, useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { readRoutineSentence } from '@/lib/routine-sentence.mjs';
import { cronOf, type ScheduleForm } from '@/lib/routine-schedule.mjs';
import type { Routine } from '@/lib/engine.mjs';
import { toast } from '@/app/toast';
import { RoutineRow, SchedulePicker, browserZone, send, warnUnlogged } from '@/app/settings-routines';
import { DetailsChat, onShowRoutines, takeShowRoutines } from '@/app/details-routines';

type Sentence=NonNullable<ReturnType<typeof readRoutineSentence>>;
const flashFor=1500;

export function AgentRoutines({company,agent,name,canManage,canWrite}:{company:string,agent:string,name:string,canManage:boolean,canWrite:boolean}) {
 const {t}=useI18n(); const {suggest}=use(DetailsChat);
 // Until the read lands the section is its heading alone; a failed read says the list can't be read.
 const [routines,setRoutines]=useState<Routine[]|null|undefined>();
 const [reads,setReads]=useState(0);
 const [now,setNow]=useState(()=>new Date().toISOString());
 useEffect(()=>{
  let live=true;
  void fetch(`/api/agent-routines?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}`,{cache:'no-store'})
   // The body is read whatever the answer, so a refusal's request ends too and the page goes idle.
   .then(async response=>{ const body=await response.json().catch(()=>null); return response.ok&&Array.isArray(body?.routines)?body.routines as Routine[]:null; }).catch(()=>null)
   .then(found=>{ if(live) { setRoutines(found); setNow(new Date().toISOString()); } });
  return ()=>{ live=false; };
 },[company,agent,reads]);
 const readAgain=useCallback(()=>setReads(count=>count+1),[]);

 const [adding,setAdding]=useState(false);
 const [text,setText]=useState(''); const [empty,setEmpty]=useState(false); const [failed,setFailed]=useState<string|null>(null);
 // A sentence read without a full "when": the time question stands in the list until a time is given or it is cancelled.
 const [asking,setAsking]=useState<{sentence:string,read:Sentence}|null>(null);
 const [pending,startTransition]=useTransition();
 const [flash,setFlash]=useState<string|null>(null);
 useEffect(()=>{ if(!flash) return; const timer=setTimeout(()=>setFlash(null),flashFor); return ()=>clearTimeout(timer); },[flash]);
 const addButton=useRef<HTMLButtonElement>(null); const section=useRef<HTMLElement>(null);
 const focusAdd=()=>setTimeout(()=>addButton.current?.focus());
 const close=()=>{ setAdding(false); setAsking(null); setText(''); setEmpty(false); setFailed(null); focusAdd(); };
 const open=()=>{ if(adding) { close(); return; } setAdding(true); setTimeout(()=>document.getElementById('dp-rt-new')?.focus()); };

 // One create at a time: a second Enter or Add while one is on its way makes nothing (each run is a paid Run). The
 // mark is a ref, set at once, so two presses in the same moment cannot both pass; a failed create clears it for a retry.
 const creating=useRef(false);
 const create=(sentence:string,read:Sentence,form:ScheduleForm)=>{
  const schedule=cronOf(form); if(!schedule||creating.current) return;
  creating.current=true;
  startTransition(async()=>{
  setFailed(null);
  const {error,unlogged,routine}=await send(company,agent,'create',{name:read.name??t('agentRoutineNewName'),prompt:read.prompt,schedule,timezone:read.zone??browserZone()});
  creating.current=false;
  if(error) { setFailed(error); return; }
  if(routine) setFlash(routine.id);
  toast(t('agentRoutineIsOn',sentence));
  warnUnlogged(t,unlogged);
  close(); readAgain();
  });
 };
 const save=()=>{
  if(creating.current) return;
  const sentence=text.trim();
  if(!sentence) { setEmpty(true); document.getElementById('dp-rt-new')?.focus(); return; }
  const read=readRoutineSentence(sentence); if(!read) return;
  if(read.form) create(sentence,read,read.form);
  else setAsking({sentence,read});
 };
 const keys=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); save(); }
  // Escape closes the field, not the panel around it.
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); close(); }
 };

 // "See it in details": the list is read again (the Routine was made in the chat after it was read), and once that read
 // is drawn, the section in view and the focus on the newest row's switch. A section still on its first read takes the
 // ask when that read lands.
 useEffect(()=>onShowRoutines(readAgain),[readAgain]);
 useEffect(()=>{
  if(routines===undefined||!takeShowRoutines()) return;
  const timer=setTimeout(()=>{
   section.current?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   const rows=section.current?.querySelectorAll<HTMLElement>('.rt-row');
   const last=rows?.[rows.length-1];
   (last?.querySelector<HTMLElement>('.switch')??last)?.focus({preventScroll:true});
  });
  return ()=>clearTimeout(timer);
 },[routines]);

 const count=routines?.length??0;
 const example=t('routineExample');
 const form=adding&&<li className="panel-form rt-add">
  <label className="sr-only" htmlFor="dp-rt-new">{t('agentRoutineNew')}</label>
  <input id="dp-rt-new" type="text" dir="auto" autoComplete="off" maxLength={4000} placeholder={t('agentRoutineHint')} value={text} readOnly={pending||!!asking}
   aria-invalid={empty} aria-describedby="dp-rt-err" onChange={event=>{ setText(event.target.value); if(empty) setEmpty(false); }} onKeyDown={keys}/>
  <span className="panel-form__err" id="dp-rt-err" hidden={!empty}>{t('agentRoutineEmpty')}</span>
  {asking?<SchedulePicker t={t} idPrefix="dp-rt-n" initial={asking.read.draft} busy={pending} submitLabel={t('agentRoutineSave')} className="rt-asked"
    onCancel={()=>{ setAsking(null); setTimeout(()=>document.getElementById('dp-rt-new')?.focus()); }} onSubmit={chosen=>create(asking.sentence,asking.read,chosen)}>
    <p className="rt-ask" role="status">{t('agentRoutineAskTime')}</p></SchedulePicker>
   :<div className="panel-form__row"><button type="button" className="btn btn--primary btn--sm" disabled={pending} onClick={save}>{t('agentRoutineSave')}</button>
    <button type="button" className="btn btn--secondary btn--sm" onClick={close}>{t('routineCancel')}</button></div>}
  {failed&&<span className="set-err" role="alert">{t(failed)}</span>}
 </li>;
 return <section ref={section} className="dp-sec" id="dp-routines" aria-labelledby="dp-rt-h">
  <h3 className="dp-label" id="dp-rt-h"><span>{t('agentRoutines')}{count>0&&<> <span className="muted num">{count}</span></>}</span>
   {canManage&&routines&&<button ref={addButton} type="button" className="link-btn" aria-expanded={adding} onClick={open}>{t('agentRoutineAdd')}</button>}</h3>
  {routines===null?<div className="panel-card"><p className="panel-empty">{t('agentRoutineUnread')}</p></div>
   :routines&&<>
    {(count>0||form)&&<ul className="panel-card">{routines.map(routine=><RoutineRow key={routine.id} t={t} company={company} agent={agent} routine={routine} canManage={canManage} now={now} onChanged={readAgain} idPrefix="dp-rt" flash={flash===routine.id}/>)}{form}</ul>}
    {!count&&<div className="panel-card"><div className="rt-empty">
     <p className="panel-empty"><bdi>{t('agentRoutinesNone',name)}</bdi></p>
     {canWrite&&suggest&&<button type="button" className="rt-try" onClick={()=>suggest(example)}><span className="rt-try__l">{t('agentRoutineTry')}</span><span className="rt-try__t"><bdi>{example}</bdi></span></button>}
    </div></div>}
   </>}
 </section>;
}
