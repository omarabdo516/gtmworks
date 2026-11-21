'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { clockLabel, scheduleLabel } from '@/lib/routine-schedule.mjs';
import { morningDefault, morningTimes } from '@/lib/morning-schedule.mjs';
import { seedDraft, setDraftValue, useDraftValue } from './settings-draft';

// Good morning on the main Agent's page (#182; design-reference/app.js checkinSetHTML 3018-3028, the set-checkin handler
// 3369-3371 and the checkinTime input 3623-3633). The switch and the time are two keys of the page's draft
// (`morning.on`, `morning.time`) and are saved with the bar, which sends them as one `morning` part with the browser's
// zone. The time select is disabled while the switch is off in the draft. Below Agent level 3 the switch cannot be
// turned on, and one line says why and where the Owner changes it (the only text here the reference does not have). The
// zone is the job's own, or the browser's until the message is first switched on. A Contributor and a Viewer read one row.
export type MorningProps={on:boolean,time:string|null,expr:string|null,display:string|null,timezone:string|null,allowed:boolean,quietYesterday:boolean};

const never=()=>()=>{};
const readZone=()=>{ try { return Intl.DateTimeFormat().resolvedOptions().timeZone||null; } catch { return null; } };
const clockParts=/^(\d{1,2}):(\d{2})$/;
// The zone's city, as the reference's "Cairo time": the last part of its IANA name, in Arabic for the region's own cities.
const arabicCities:Record<string,string>={Cairo:'القاهرة',Riyadh:'الرياض',Dubai:'دبي',Kuwait:'الكويت',Qatar:'قطر',Bahrain:'البحرين',Amman:'عمّان',Beirut:'بيروت',Baghdad:'بغداد',Muscat:'مسقط',Casablanca:'الدار البيضاء',Tunis:'تونس',Algiers:'الجزائر',Tripoli:'طرابلس',Khartoum:'الخرطوم',Jerusalem:'القدس',Damascus:'دمشق',Aden:'عدن',London:'لندن',Paris:'باريس',Berlin:'برلين',Istanbul:'إسطنبول'};
function cityOf(zone:string,language:string) {
 const city=zone.split('/').at(-1)?.replaceAll('_',' ')||zone;
 return language==='ar'?arabicCities[city]??city:city;
}

export function AgentMorning({agent,editable,morning}:{agent:string,editable:boolean,morning:MorningProps|null}) {
 const {t,language}=useI18n();
 const savedOn=morning?.on===true?'on':'off';
 const savedTime=morning?.time??morning?.expr??morningDefault;
 const on=useDraftValue(agent,'morning.on',savedOn)==='on';
 const time=useDraftValue(agent,'morning.time',savedTime);
 // The browser's zone; the server draws none, so the first frame is the same on both.
 const browserZone=useSyncExternalStore(never,readZone,()=>null);
 // The draft starts from what the Engine holds, once for this Agent; a read that changed while nothing is unsaved wins.
 useEffect(()=>{ if(editable&&morning) seedDraft(agent,{'morning.on':savedOn,'morning.time':savedTime}); },[agent,editable,morning,savedOn,savedTime]);
 const label=(value:string)=>{ const parts=clockParts.exec(value); return parts?clockLabel(t,Number(parts[1]),Number(parts[2])):scheduleLabel(t,{expr:value,display:morning?.display??null}); };
 if(!editable) {
  const value=!morning?'—':morning.on&&morning.allowed?(morning.time?t('settingsCheckinEvery',label(morning.time)):scheduleLabel(t,{expr:morning.expr,display:morning.display})):t('settingsCheckinOff');
  return <section className="dp-sec" id="set-checkin" aria-labelledby="set-h-ck"><h4 className="dp-label" id="set-h-ck"><span>{t('settingsGoodMorning')}</span></h4>
   <ul className="panel-card"><li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsCheckinRO')}</span>
    <span className="panel-row__d ro-val" id="set-ck-val">{value}</span></span></li></ul></section>;
 }
 const allowed=morning?.allowed===true;
 // The job's own time first among the reference's, when it is another one (changed in a chat with the Agent).
 const choices=morningTimes.includes(savedTime)?morningTimes:[savedTime,...morningTimes];
 const zone=morning?.timezone??browserZone;
 // A switch that is off cannot be turned on below level 3; one left on may still be switched off.
 const locked=!allowed&&!on;
 return <section className="dp-sec" id="set-checkin" aria-labelledby="set-h-ck"><h4 className="dp-label" id="set-h-ck"><span>{t('settingsGoodMorning')}</span></h4>
  <ul className="panel-card">
   <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t" id="set-ck-t">{t('settingsCheckin')}</span><span className="panel-row__d">{t('settingsCheckinD')}</span></span>
    <button type="button" className="switch" role="switch" id="set-ck-on" aria-checked={on} aria-labelledby="set-ck-t" aria-disabled={locked||undefined} aria-describedby={allowed?undefined:'set-ck-level'}
     onClick={()=>{ if(!locked) setDraftValue('morning.on',on?'off':'on'); }}/></li>
   <li className="panel-row"><span className="panel-row__text"><label className="panel-row__t" htmlFor="set-ck-time">{t('settingsCheckinTime')}</label>
    <span className="panel-row__d" id="set-ck-zone">{zone?t('settingsCheckinZone',cityOf(zone,language)):' '}</span></span>
    <select className="set-input ck-time num" id="set-ck-time" value={time} disabled={!on} onChange={event=>setDraftValue('morning.time',event.target.value)}>
     {choices.map(choice=><option key={choice} value={choice}>{label(choice)}</option>)}
    </select></li>
  </ul>
  {!allowed&&<p className="set-hint ck-hint" id="set-ck-level">{t('settingsCheckinLevel')}</p>}
  <p className="set-hint ck-hint" id="set-ck-hint">{t('settingsCheckinHint')}{morning?.quietYesterday&&<> {t('settingsCheckinQuiet')}</>}</p>
 </section>;
}
