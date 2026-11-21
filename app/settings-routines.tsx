'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { cronOf, formOf, scheduleLabel, whenOf, type ScheduleForm } from '@/lib/routine-schedule.mjs';
import type { AgentRoutines, RoutineAction } from '@/lib/agent-routines.mjs';
import type { Routine } from '@/lib/engine.mjs';
import { Head } from './settings-overlay-parts';
import { SettingsIcon } from './settings-icons';
import { toast } from './toast';

type T=ReturnType<typeof useI18n>['t'];
// The zone the person's clock is in: a Routine made or rescheduled here runs at that wall time (the Engine reads a job's
// time in the zone it names). It is read in the browser only, so the server's first draw names none.
const browserZone=()=>{ try { return Intl.DateTimeFormat().resolvedOptions().timeZone||null; } catch { return null; } };

// Recurring tasks (#31; design-reference/app.js: sovRoutinesHTML, routineRowHTML). Every Routine of every Agent the
// reader sees, grouped by Agent, main Agent first, read from each Agent's own Engine profile. The Owner and the Managers
// switch one off or on, run one now, change when it runs, delete it, or add one; anyone else reads them, each marked On
// or Off. Every change goes through /api/agent-routines, which the database checks and logs.
export function RoutinesSection({company,state,agents,canManage,now}:{company:string,state:'found'|'noEngine'|'failed'|'invalid',agents:AgentRoutines[],canManage:boolean,now:string}) {
 const {t}=useI18n();
 const withAny=agents.filter(agent=>agent.routines?.length);
 const all=withAny.reduce((count,agent)=>count+(agent.routines?.length??0),0);
 const on=withAny.reduce((count,agent)=>count+(agent.routines?.filter(routine=>routine.on).length??0),0);
 const [adding,setAdding]=useState<string|null>(null);
 const sub=`${withAny.length?`${t('settingsRoutinesCount',on,all,withAny.length)} `:''}${t('settingsRoutinesSub')}`;
 const addable=agents.filter(agent=>agent.state==='found');
 // The head's Add a task is for an Agent that has no Routine yet, so no section of its own to add from.
 const extra=canManage&&addable.some(agent=>!agent.routines?.length)&&adding===null?<button type="button" className="link-btn" id="rt-add" onClick={()=>setAdding(addable.find(agent=>!agent.routines?.length)!.agent)}>{t('routineAdd')}</button>:undefined;
 const unread=agents.filter(agent=>agent.state!=='found');
 return <><Head title={t('settingsRoutines')} sub={sub} extra={extra}/>
  {state!=='found'?<div className="panel-card"><p className="panel-empty" role="status">{t('routineNoEngine')}</p></div>:<>
   {adding!==null&&<NewRoutine t={t} company={company} agents={addable} agent={adding} onClose={()=>setAdding(null)}/>}
   {withAny.map(agent=><section key={agent.agent} className="dp-sec" aria-labelledby={`rt-h-${agent.agent}`}>
    <h4 className="dp-label" id={`rt-h-${agent.agent}`}><span className="sov-ag-l"><CompanyAgentFace agent={{connection_id:agent.connection,name:agent.name}} size={20}/><bdi>{agent.name}</bdi> <span className="muted num">{agent.routines!.length}</span></span>
     {canManage&&adding===null&&<button type="button" className="link-btn" onClick={()=>setAdding(agent.agent)}>{t('routineAdd')}</button>}</h4>
    <ul className="panel-card">{agent.routines!.map(routine=><RoutineRow key={routine.id} t={t} company={company} agent={agent.agent} routine={routine} canManage={canManage} now={now}/>)}</ul>
   </section>)}
   {unread.map(agent=><section key={agent.agent} className="dp-sec" aria-labelledby={`rt-h-${agent.agent}`}>
    <h4 className="dp-label" id={`rt-h-${agent.agent}`}><span className="sov-ag-l"><CompanyAgentFace agent={{connection_id:agent.connection,name:agent.name}} size={20}/><bdi>{agent.name}</bdi></span></h4>
    <div className="panel-card"><p className="panel-empty">{t('routineUnread')}</p></div></section>)}
   {!withAny.length&&!unread.length&&adding===null&&<div className="panel-card"><p className="panel-empty">{t('settingsRoutinesEmpty')}</p></div>}
  </>}</>;
}

async function send(company:string,agent:string,action:RoutineAction,fields:Record<string,unknown>={}) {
 const response=await fetch('/api/agent-routines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,action,...fields})}).catch(()=>null);
 if(!response) return 'routineFailed';
 if(response.ok) return null;
 const body=await response.json().catch(()=>null) as {error?:string}|null;
 return body?.error==='routineBusy'?'routineBusy':'routineFailed';
}

function RoutineRow({t,company,agent,routine,canManage,now}:{t:T,company:string,agent:string,routine:Routine,canManage:boolean,now:string}) {
 const {locale}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition();
 const [running,setRunning]=useState(false);
 const [failed,setFailed]=useState<string|null>(null);
 const [editing,setEditing]=useState(false);
 const title=routine.name||routine.prompt;
 const id=`rt-${routine.id}`;
 const at=new Date(now);
 const act=(action:RoutineAction,fields:Record<string,unknown>={},done?:()=>void)=>startTransition(async()=>{
  setFailed(null);
  if(action==='run') setRunning(true);
  const error=await send(company,agent,action,fields);
  setRunning(false);
  if(error) { setFailed(error); return; }
  done?.();
  router.refresh();
 });
 const next=!routine.on?t('routinePausedNext'):routine.nextRunAt?t('routineNext',whenOf(t,locale,routine.nextRunAt,routine.timezone,at)):'';
 const last=routine.lastRunAt?t(routine.lastStatus==='failed'?'routineLastFailed':'routineLast',whenOf(t,locale,routine.lastRunAt,routine.timezone,at)):'';
 return <li className="panel-row rt-row" data-rt={routine.id}><span className="panel-row__icon"><SettingsIcon name="repeat"/></span>
  <span className="panel-row__text"><span className="panel-row__t" id={id}><bdi>{title}</bdi></span>
   <span className="panel-row__d"><bdi>{scheduleLabel(t,routine.schedule)}</bdi>{last&&` ${last}`}</span>
   <span className="rt-meta"><span className={`rt-next${routine.on?'':' is-off'}`}>{next}</span>
    {running?<span className="rt-running shimmer" role="status">{t('routineRunning')}</span>
     :canManage&&routine.on&&<button type="button" className="link-btn rt-run" disabled={pending} aria-label={t('routineRunLabel',title)} onClick={()=>act('run',{routine:routine.id},()=>toast(t('routineStarted',title)))}>{t('routineRunNow')}</button>}
    {canManage&&!editing&&<button type="button" className="link-btn rt-change" disabled={pending} aria-label={t('routineChangeLabel',title)} onClick={()=>setEditing(true)}>{t('routineChange')}</button>}</span>
   {failed&&<span className="set-err" role="alert">{t(failed)}</span>}
   {editing&&<SchedulePicker t={t} idPrefix={`rt-e-${routine.id}`} initial={formOf(routine.schedule.expr)} busy={pending} submitLabel={t('routineSave')}
    onCancel={()=>setEditing(false)} onSubmit={form=>act('change',{routine:routine.id,schedule:cronOf(form),timezone:routine.timezone},()=>{ setEditing(false); toast(t('routineSaved')); })}
    onDelete={()=>act('delete',{routine:routine.id},()=>toast(t('routineDeleted',title)))} deleteLabel={t('routineDeleteLabel',title)}/>}
  </span>
  {canManage?<button type="button" className="switch" role="switch" aria-checked={routine.on} aria-labelledby={id} disabled={pending} onClick={()=>act(routine.on?'pause':'resume',{routine:routine.id})}/>
   :<span className="panel-row__meta">{routine.on?t('routineOn'):t('routineOff')}</span>}
 </li>;
}

// When a Routine runs: every day, every week on one day, or every hour. A new Routine runs on the person's own clock;
// a changed one keeps the zone it runs in, so the time the form shows (read in that zone) is the time it keeps.
function SchedulePicker({t,idPrefix,initial,busy,submitLabel,onSubmit,onCancel,onDelete,deleteLabel,children,check}:{t:T,idPrefix:string,initial:ScheduleForm|null,busy:boolean,submitLabel:string,onSubmit:(form:ScheduleForm)=>void,onCancel:()=>void,onDelete?:()=>void,deleteLabel?:string,children?:React.ReactNode,check?:()=>boolean}) {
 const [kind,setKind]=useState<ScheduleForm['kind']>(initial?.kind??'daily');
 const [dow,setDow]=useState(initial?.kind==='weekly'?initial.dow:1);
 const [time,setTime]=useState(initial&&initial.kind!=='hourly'?`${String(initial.h).padStart(2,'0')}:${String(initial.m).padStart(2,'0')}`:'09:00');
 const submit=(event:React.FormEvent)=>{
  event.preventDefault();
  if(check&&!check()) return;
  const [h,m]=time.split(':').map(Number);
  onSubmit(kind==='hourly'?{kind}:kind==='weekly'?{kind,dow,h,m}:{kind,h,m});
 };
 return <form className="panel-form rt-form" onSubmit={submit}>
  {children}
  <div className="rt-when">
   <div className="rt-field"><label className="rt-field__l" htmlFor={`${idPrefix}-kind`}>{t('routineWhen')}</label>
    <select className="set-input" id={`${idPrefix}-kind`} value={kind} onChange={event=>setKind(event.target.value as ScheduleForm['kind'])}>
     <option value="daily">{t('routineDaily')}</option><option value="weekly">{t('routineWeekly')}</option><option value="hourly">{t('routineHourly')}</option></select></div>
   {kind==='weekly'&&<div className="rt-field"><label className="rt-field__l" htmlFor={`${idPrefix}-day`}>{t('routineDay')}</label>
    <select className="set-input" id={`${idPrefix}-day`} value={dow} onChange={event=>setDow(Number(event.target.value))}>
     {[0,1,2,3,4,5,6].map(day=><option key={day} value={day}>{t(`routineWeekday${day}`)}</option>)}</select></div>}
   {kind!=='hourly'&&<div className="rt-field"><label className="rt-field__l" htmlFor={`${idPrefix}-time`}>{t('routineTime')}</label>
    <input className="set-input" type="time" id={`${idPrefix}-time`} required value={time} onChange={event=>setTime(event.target.value)}/></div>}
  </div>
  <div className="panel-form__row panel-form__row--end">
   {onDelete&&<button type="button" className="btn btn--secondary btn--sm rt-delete" disabled={busy} aria-label={deleteLabel} onClick={onDelete}>{t('routineDelete')}</button>}
   <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={onCancel}>{t('routineCancel')}</button>
   <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>{submitLabel}</button></div>
 </form>;
}

// A new Routine, made in Settings on the chosen Agent's own profile: what to do in the person's words and when.
function NewRoutine({t,company,agents,agent,onClose}:{t:T,company:string,agents:AgentRoutines[],agent:string,onClose:()=>void}) {
 const router=useRouter();
 const [pending,startTransition]=useTransition();
 const [who,setWho]=useState(agent);
 const [what,setWhat]=useState('');
 const [empty,setEmpty]=useState(false);
 const [failed,setFailed]=useState<string|null>(null);
 useEffect(()=>{ document.getElementById('rt-new')?.focus(); },[]);
 const close=()=>{ onClose(); setTimeout(()=>document.getElementById('rt-add')?.focus()); };
 return <div className="panel-card rt-new"><SchedulePicker t={t} idPrefix="rt-n" initial={null} busy={pending} submitLabel={t('routineAddButton')} onCancel={close}
  check={()=>{ const ok=what.trim().length>0; setEmpty(!ok); if(!ok) document.getElementById('rt-new')?.focus(); return ok; }}
  onSubmit={form=>startTransition(async()=>{
   setFailed(null);
   const error=await send(company,who,'create',{prompt:what.trim(),schedule:cronOf(form),timezone:browserZone()});
   if(error) { setFailed(error); return; }
   toast(t('routineAdded',what.trim().length>40?`${what.trim().slice(0,40)}…`:what.trim()));
   close(); router.refresh();
  })}>
  {agents.length>1&&<div className="rt-field"><label className="rt-field__l" htmlFor="rt-n-agent">{t('routineAgent')}</label>
   <select className="set-input" id="rt-n-agent" value={who} onChange={event=>setWho(event.target.value)}>{agents.map(each=><option key={each.agent} value={each.agent}>{each.name}</option>)}</select></div>}
  <div className="rt-field"><label className="rt-field__l" htmlFor="rt-new">{t('routineWhat')}</label>
   <input className="set-input" id="rt-new" dir="auto" maxLength={4000} placeholder={t('routineWhatHint')} value={what} aria-invalid={empty} aria-describedby={empty?'rt-err':undefined}
    onChange={event=>{ setWhat(event.target.value); if(empty) setEmpty(false); }}/></div>
  {empty&&<span className="panel-form__err" id="rt-err">{t('routineWhatEmpty')}</span>}
  {failed&&<span className="set-err" role="alert">{t(failed)}</span>}
 </SchedulePicker></div>;
}
