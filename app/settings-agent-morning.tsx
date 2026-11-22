'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { clockLabel, scheduleLabel } from '@/lib/routine-schedule.mjs';
import { morningDefault, morningTimes, zoneCities } from '@/lib/morning-schedule.mjs';
import { seedDraft, setDraftValue, useDraftValue } from './settings-draft';

// Good morning on the main Agent's page (#182; design-reference/app.js checkinSetHTML 3018-3028, the set-checkin handler
// 3369-3371 and the checkinTime input 3623-3633). The switch and the time are two keys of the page's draft
// (`morning.on`, `morning.time`) and are saved with the bar, which sends them as one `morning` part with the browser's
// zone. The time select is disabled while the switch is off in the draft. The
// zone is the job's own, or the browser's until the message is first switched on. Since #615 it is one row inside the
// page's How it works group, with its switch and time side by side; a Contributor and a Viewer read one row too.
export type MorningProps={made:boolean,on:boolean,time:string|null,expr:string|null,display:string|null,timezone:string|null,quietYesterday:boolean};

const never=()=>()=>{};
const readZone=()=>{ try { return Intl.DateTimeFormat().resolvedOptions().timeZone||null; } catch { return null; } };
const clockParts=/^(\d{1,2}):(\d{2})$/;
// The zone's city, as the reference's "Cairo time": the last part of its IANA name, named by the catalogue when it holds it.
function cityOf(zone:string,t:(key:string,...values:unknown[])=>string) {
 const city=zone.split('/').at(-1)?.replaceAll('_',' ')||zone;
 return zoneCities.includes(city)?t(`zoneCity${city}`):city;
}

export function AgentMorning({agent,editable,morning}:{agent:string,editable:boolean,morning:MorningProps|null}) {
 const {t}=useI18n();
 const savedOn=morning?.on===true?'on':'off';
 // The job's daily time, else its own cron expression, else "keep" for a schedule that is neither (an interval set in a
 // chat), which a save leaves as it is; the reference's 9:00 before any job is made.
 const savedTime=morning?.time??morning?.expr??(morning?.made?'keep':morningDefault);
 const on=useDraftValue(agent,'morning.on',savedOn)==='on';
 const time=useDraftValue(agent,'morning.time',savedTime);
 // The browser's zone; the server draws none, so the first frame is the same on both.
 const browserZone=useSyncExternalStore(never,readZone,()=>null);
 // The draft starts from what the Engine holds, once for this Agent; a read that changed while nothing is unsaved wins.
 useEffect(()=>{ if(editable&&morning) seedDraft(agent,{'morning.on':savedOn,'morning.time':savedTime}); },[agent,editable,morning,savedOn,savedTime]);
 const label=(value:string)=>{ const parts=clockParts.exec(value); return parts?clockLabel(t,Number(parts[1]),Number(parts[2])):scheduleLabel(t,{expr:value==='keep'?null:value,display:morning?.display??null}); };
 // One row in every Role's view (#615): the name once, its one short line, then the time and the switch facing it. The
 // line says what the message is; the morning after a quiet day it says instead why none came. The group (How it works)
 // carries the heading; this row is Good morning's only mention on the page.
 if(!editable) {
  const value=!morning?'—':morning.on?(morning.time?t('settingsCheckinEvery',label(morning.time)):scheduleLabel(t,{expr:morning.expr,display:morning.display})):t('settingsCheckinOff');
  return <ul className="panel-card" id="set-checkin"><li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsGoodMorning')}</span>
   <span className="panel-row__d ro-val" id="set-ck-val">{value}</span></span></li></ul>;
 }
 // The job's own time first among the reference's, when it is another one (changed in a chat with the Agent).
 const choices=morningTimes.includes(savedTime)?morningTimes:[savedTime,...morningTimes];
 const zone=morning?.timezone??browserZone;
 return <ul className="panel-card" id="set-checkin">
  <li className="panel-row ck-row"><span className="panel-row__text"><span className="panel-row__t" id="set-ck-t">{t('settingsGoodMorning')}</span>
   <span className="panel-row__d" id="set-ck-hint">{morning?.quietYesterday?`${t('settingsCheckinHint')} ${t('settingsCheckinQuiet')}`:t('settingsCheckinD')}</span></span>
   <span className="ck-controls">
    <span className="ck-zone" id="set-ck-zone">{zone?t('settingsCheckinZone',cityOf(zone,t)):''}</span>
    <select className="set-input ck-time num" id="set-ck-time" value={time} disabled={!on} aria-label={t('settingsCheckinTime')} aria-describedby="set-ck-zone"
     onChange={event=>setDraftValue('morning.time',event.target.value)}>
     {choices.map(choice=><option key={choice} value={choice}>{label(choice)}</option>)}
    </select>
    <button type="button" className="switch" role="switch" id="set-ck-on" aria-checked={on} aria-labelledby="set-ck-t"
     onClick={()=>setDraftValue('morning.on',on?'off':'on')}/>
   </span></li>
 </ul>;
}
