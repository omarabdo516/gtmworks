// A Routine's schedule as Settings writes and reads it (#31; design-reference/app.js: schedUI, clockLabel, whenLabel,
// routineRowHTML). The Engine takes a five-field cron expression (cron/jobs.py parse_schedule) and reads it in the zone
// the job names, so Settings writes one of three shapes, every day, every week on one day, or every hour, with the
// person's own zone, and reads those three back into words, with a fourth, the first of every month, which a Routine
// written as one sentence in an Agent's details may be (#205). Any other schedule, one an Agent made in chat, keeps the
// Engine's own short description. Every word comes from the message catalogues.

/** @typedef {{kind:'daily',h:number,m:number}|{kind:'weekly',dow:number,h:number,m:number}|{kind:'monthly',h:number,m:number}|{kind:'hourly'}} ScheduleForm */

const inRange=(value,low,high)=>Number.isInteger(value)&&value>=low&&value<=high;

// The cron expression for one form, or null for a form that is not one of the three.
/** @param {any} form @returns {string|null} */
export function cronOf(form) {
 if(form?.kind==='hourly') return '0 * * * *';
 if(!inRange(form?.h,0,23)||!inRange(form?.m,0,59)) return null;
 if(form.kind==='daily') return `${form.m} ${form.h} * * *`;
 if(form.kind==='monthly') return `${form.m} ${form.h} 1 * *`;
 if(form.kind==='weekly'&&inRange(form.dow,0,6)) return `${form.m} ${form.h} * * ${form.dow}`;
 return null;
}

// The form one cron expression is, or null when it is none of the three.
/** @param {unknown} expr @returns {ScheduleForm|null} */
export function formOf(expr) {
 if(typeof expr!=='string') return null;
 if(expr.trim()==='0 * * * *') return {kind:'hourly'};
 const monthly=/^(\d{1,2}) (\d{1,2}) 1 \* \*$/.exec(expr.trim());
 if(monthly) { const m=Number(monthly[1]), h=Number(monthly[2]); return inRange(h,0,23)&&inRange(m,0,59)?{kind:'monthly',h,m}:null; }
 const match=/^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7])$/.exec(expr.trim());
 if(!match) return null;
 const m=Number(match[1]), h=Number(match[2]);
 if(!inRange(h,0,23)||!inRange(m,0,59)) return null;
 return match[3]==='*'?{kind:'daily',h,m}:{kind:'weekly',dow:Number(match[3])%7,h,m};
}

// The reference's clock: 9:00 AM in English, 9:00 الصبح in Arabic (clockLabel), from the catalogue's five parts of the day.
/** @param {(key:string,...values:unknown[])=>string} t @param {number} h @param {number} m */
function clockOf(t,h,m) {
 const part=h<5?0:h<12?1:h<15?2:h<18?3:4;
 return t('routineClock',String(h%12||12),String(m).padStart(2,'0'),t(`routineDayPart${part}`));
}

// The schedule in words (schedUI): the three shapes Settings writes, else the Engine's own description, else none.
/** @param {(key:string,...values:unknown[])=>string} t @param {{expr:string|null,display:string|null}} schedule */
export function scheduleLabel(t,schedule) {
 const form=formOf(schedule.expr);
 if(form?.kind==='hourly') return t('routineEveryHour');
 if(form?.kind==='daily') return t('routineEveryDay',clockOf(t,form.h,form.m));
 if(form?.kind==='monthly') return t('routineEveryMonth',clockOf(t,form.h,form.m));
 if(form?.kind==='weekly') return t('routineEveryWeek',t(`routineEvery${form.dow}`),clockOf(t,form.h,form.m));
 return schedule.display||schedule.expr||'';
}

// The wall clock of one moment in one zone (UTC when none is named, as the Engine reads a job with none).
/** @param {Date} date @param {string|null} zone */
function wall(date,zone) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone||'UTC',hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',weekday:'short'})
  .formatToParts(date).map(part=>[part.type,part.value]));
 return {y:Number(parts.year),mo:Number(parts.month),d:Number(parts.day),h:Number(parts.hour)%24,m:Number(parts.minute),dow:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)};
}

// When a Routine runs next or ran last (whenLabel): today, tomorrow, a weekday within the week, else a short date, with
// the clock, all read in the Routine's own zone so "9:00" is the time the person set.
/** @param {(key:string,...values:unknown[])=>string} t @param {string} locale @param {string} iso @param {string|null} zone @param {Date} [now] */
export function whenOf(t,locale,iso,zone,now=new Date()) {
 const at=new Date(iso);
 if(Number.isNaN(at.getTime())) return '';
 const there=wall(at,zone), today=wall(now,zone);
 const clock=clockOf(t,there.h,there.m);
 const days=Math.round((Date.UTC(there.y,there.mo-1,there.d)-Date.UTC(today.y,today.mo-1,today.d))/864e5);
 if(days===0) return t('routineToday',clock);
 if(days===1) return t('routineTomorrow',clock);
 if(days===-1) return t('routineYesterday',clock);
 if(days>1&&days<7) return t('routineOnDay',t(`routineWeekday${there.dow}`),clock);
 const date=new Intl.DateTimeFormat(locale,{timeZone:zone||'UTC',weekday:'short',month:'short',day:'numeric'}).format(at);
 return t('routineOnDay',date,clock);
}

// How many days from today one moment is, both read in one zone (UTC when none is named): -1 is yesterday (#182).
/** @param {string} iso @param {string|null} zone @param {Date} [now] */
export function dayOffset(iso,zone,now=new Date()) {
 const at=new Date(iso);
 if(Number.isNaN(at.getTime())) return null;
 const there=wall(at,zone), today=wall(now,zone);
 return Math.round((Date.UTC(there.y,there.mo-1,there.d)-Date.UTC(today.y,today.mo-1,today.d))/864e5);
}

// The reference's clock for one time of day (clockLabel): 9:00 AM, 9:00 الصبح.
/** @param {(key:string,...values:unknown[])=>string} t @param {number} h @param {number} m */
export const clockLabel=(t,h,m)=>clockOf(t,h,m);
