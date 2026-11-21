// One sentence a person writes for a Routine, split into what to do and when (#205; design-reference/app.js:
// parseRoutine, saveRoutine). The pinned Engine reads a schedule as a cron expression or a few English phrases and has no
// route that reads a free sentence, so gtmworks reads it here, in Egyptian Arabic as the reference's own reader does and
// in English: every day, every hour, every week (on a named day), every month, with a time of day. The schedule is one
// of the shapes Settings writes (lib/routine-schedule.mjs), so `cronOf` turns it into the expression the Engine takes.
//
// A sentence that does not say fully when gives no schedule: the reference turned it into every day at 9:00, but each
// run is a paid Run, so it asks for a time instead and nothing is saved until one is given (Omar, 2026-11-18). What the
// sentence did say (`draft`) fills the question in.

/** @typedef {import('./routine-schedule.mjs').ScheduleForm} ScheduleForm */
/** @typedef {{kind:'daily'|'weekly'|'monthly'|'hourly',dow?:number,h?:number,m?:number}} ScheduleDraft */

const arabicDigits='٠١٢٣٤٥٦٧٨٩';
const titleSize=48;

// The day a word names, Sunday 0 (cron's numbering).
const arabicDays={سبت:6,حد:0,أحد:0,احد:0,اتنين:1,إتنين:1,اثنين:1,تلات:2,ثلاثاء:2,أربع:3,اربع:3,أربعاء:3,اربعاء:3,خميس:4,جمعة:5,جمعه:5};
const englishDays={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
// The day a Routine "every week" runs on when the sentence names none, and its hour (the reference's weekly report).
const weekDay=4;

const arabicVerb=/^(?:ابعتلي|ابعتلنا|ابعت لي|ابعت|اعملّي|اعملي|اعمل لي|اعمل|جهّزلي|جهزلي|جهّز|جهز|حضّرلي|حضرلي|طلّعلي|طلعلي|شغّل|شغل|راجعلي|راجع|تابعلي|تابع|فكّرني|فكرني|ذكّرني|ذكرني|بلّغني|بلغني|قولي|اكتبلي|اكتب)\s+/;
const arabicEvery=/كل\s+(?:يوم\s+)?(يوم|ساعة|ساعه|أسبوع|اسبوع|شهر|سبت|حد|أحد|احد|اتنين|إتنين|اثنين|تلات|ثلاثاء|أربعاء|اربعاء|أربع|اربع|خميس|جمعة|جمعه)(?=\s|$|[.،,؟?])|(يومياً|يوميا|كل ساعة|أسبوعياً|اسبوعيا|شهرياً|شهريا)/;
// A time of day: a number, perhaps with minutes, perhaps marked as one ("الساعة", "at", a part of the day, a.m./p.m.).
// A number with no mark is read as a time only right after the "every" (the reference's «كل يوم 9»), so a number that is
// part of the task ("the top 3 ads", «3 إعلانات») is never a time.
const arabicClock=/(الساعة\s*|الساعه\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(الصبح|صباحاً|صباحا|ص|الضهر|الظهر|العصر|المغرب|المسا|مساءً|مساء|بالليل|الليل|م)?(?=\s|$|[.،,؟?])/g;

const englishVerb=/^(?:please\s+)?(?:send\s+(?:me|us)|give\s+(?:me|us)|email\s+(?:me|us)|remind\s+(?:me|us)(?:\s+(?:to|about|of))?|tell\s+(?:me|us)(?:\s+about)?|make\s+(?:me|us)|write\s+(?:me|us)|prepare|send|make|write|check|review|run|post|share|draft|create|do)\s+/i;
const englishDayNames=Object.keys(englishDays).join('|');
// A named day is read before a word for how often ("the weekly numbers on Fridays" and "every week on Monday" run on the
// day they name).
const englishOnDay=new RegExp(`\\b(?:every|each)\\s+(${englishDayNames})\\b|\\bon\\s+(${englishDayNames})s?\\b|\\b(${englishDayNames})s\\b`,'i');
const englishEvery=/\b(?:every|each)\s+(day|hour|week|month|morning|evening|night)\b|\b(daily|hourly|weekly|monthly)\b/i;
const englishClock=/\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s+(in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening|at\s+night|tonight))?(?=\s|$|[.,;!?])|\bat\s+(noon|midday|midnight)\b/gi;
// A day of the month other than the first, which no schedule here makes: the sentence then asks.
const englishMonthDay=/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i;
const arabicMonthDay=/يوم\s+(\d{1,2})(?=\s|$|[.،,؟?])/;

const inRange=(value,high)=>Number.isInteger(value)&&value>=0&&value<=high;

// The hour and minute a clock says, or null for one no day has (25:90 asks rather than becoming 23:59).
// `part` is the part of the day the "every" said (every morning, every evening).
/** @param {RegExpExecArray} match @param {string} part */
function arabicHour(match,part) {
 let h=Number.parseInt(match[2],10); const m=match[3]?Number.parseInt(match[3],10):0;
 if(!inRange(h,23)||!inRange(m,59)) return null;
 const said=match[4]||'';
 if(/الصبح|صباح|^ص$/.test(said)) { if(h===12) h=0; }
 else if(/الضهر|الظهر/.test(said)) { if(h<6) h+=12; }
 else if(said) { if(h<12) h+=12; }
 else if(h>=1&&h<=6&&part!=='morning') h+=12;
 return {h,m};
}

/** @param {RegExpExecArray} match @param {string} part */
function englishHour(match,part) {
 if(match[6]) return {h:/midnight/i.test(match[6])?0:12,m:0};
 let h=Number.parseInt(match[2],10); const m=match[3]?Number.parseInt(match[3],10):0;
 if(!inRange(h,23)||!inRange(m,59)) return null;
 const marker=(match[4]||'').replaceAll('.','').toLowerCase(); const said=(match[5]||'').toLowerCase()||part;
 if(marker==='am'||/morning/.test(said)) { if(h===12) h=0; }
 else if(marker==='pm'||/afternoon|evening|night/.test(said)) { if(h<12) h+=12; }
 else if(h>=1&&h<=6) h+=12;
 return {h,m};
}

/** @param {string} word @param {boolean} arabic @returns {ScheduleDraft} */
function draftOf(word,arabic) {
 if(arabic) {
  if(/^(يوم|يومياً|يوميا)$/.test(word)) return {kind:'daily'};
  if(/ساع/.test(word)) return {kind:'hourly'};
  if(/^(أسبوع|اسبوع|أسبوعياً|اسبوعيا)$/.test(word)) return {kind:'weekly',dow:weekDay};
  if(/^(شهر|شهرياً|شهريا)$/.test(word)) return {kind:'monthly'};
  return {kind:'weekly',dow:arabicDays[word]};
 }
 const lower=word.toLowerCase();
 if(lower==='day'||lower==='daily') return {kind:'daily'};
 if(lower==='morning'||lower==='evening'||lower==='night') return {kind:'daily'};
 if(lower==='hour'||lower==='hourly') return {kind:'hourly'};
 if(lower==='week'||lower==='weekly') return {kind:'weekly',dow:weekDay};
 if(lower==='month'||lower==='monthly') return {kind:'monthly'};
 return {kind:'weekly',dow:englishDays[lower]};
}

/** @param {ScheduleDraft} draft @returns {ScheduleForm|null} */
function formOfDraft(draft) {
 if(draft.kind==='hourly') return {kind:'hourly'};
 if(draft.h===undefined||draft.m===undefined) return null;
 if(draft.kind==='weekly') return draft.dow===undefined?null:{kind:'weekly',dow:draft.dow,h:draft.h,m:draft.m};
 return {kind:draft.kind,h:draft.h,m:draft.m};
}

const trimEnds=text=>text.replace(/^[\s،,.:;-]+|[\s،,.:;!؟?-]+$/g,'');
const shorten=text=>{ const points=Array.from(text); return points.length>titleSize?`${points.slice(0,titleSize-1).join('').trimEnd()}…`:text; };

/**
 * The name, the task and the schedule one sentence holds. `name` is null when the sentence names nothing to do (the
 * caller names it); `form` is null when it does not say fully when, and `draft` is what it did say.
 * @param {unknown} raw
 * @returns {{name:string|null,prompt:string,form:ScheduleForm|null,draft:ScheduleDraft|null}|null}
 */
export function readRoutineSentence(raw) {
 const sentence=String(raw??'').replace(/[٠-٩]/g,digit=>String(arabicDigits.indexOf(digit))).replace(/\s+/g,' ').trim();
 if(!sentence) return null;
 const text=sentence.replace(/@\S+\s*/g,'').trim();
 const arabic=/[\u0600-\u06ff]/.test(text);
 // How often: the phrases that say it. In English a named day ("on Monday") is read with "every week" around it.
 /** @type {RegExpExecArray[]} */
 const whens=[];
 /** @type {ScheduleDraft|null} */
 let draft=null; let part='';
 if(arabic) {
  const every=arabicEvery.exec(text);
  if(every) { whens.push(every); draft=draftOf(every.slice(1).find(Boolean)||'',true); }
 } else {
  const day=englishOnDay.exec(text); const every=englishEvery.exec(text);
  if(day) { whens.push(day); draft=draftOf(day.slice(1).find(Boolean)||'',false); if(every&&/^(?:every|each)\s+week$/i.test(every[0])) whens.push(every); }
  else if(every) { whens.push(every); draft=draftOf(every.slice(1).find(Boolean)||'',false); part=(every[1]||'').toLowerCase(); }
 }
 // The time of day: the first one marked as a time, else a bare number right after the "every".
 const right=(/** @type {RegExpExecArray} */ match)=>whens.some(when=>!text.slice(when.index+when[0].length,match.index).trim());
 const clocks=[...text.matchAll(arabic?arabicClock:englishClock)];
 const marked=(/** @type {RegExpExecArray} */ match)=>arabic?!!(match[1]||match[4]):!!(match[1]||match[4]||match[5]||match[6]);
 const clock=clocks.find(marked)??clocks.find(right)??null;
 const clockText=clock?clock[0]:'';
 if(clock&&draft?.kind!=='hourly') {
  const at=arabic?arabicHour(clock,part):englishHour(clock,part);
  if(at) draft=draft?{...draft,...at}:{kind:'daily',...at};
 }
 // A day of the month other than the first is no schedule made here: the sentence asks.
 const monthDay=draft?.kind==='monthly'?(arabic?arabicMonthDay:englishMonthDay).exec(text):null;
 if(monthDay&&Number(monthDay[1])!==1&&draft) draft={kind:'monthly'};
 // What to do: the sentence without its "when", as the person said it; the name, that without the verb that asks.
 let task=text;
 for(const said of [...whens.map(when=>when[0]),clockText]) if(said) task=task.replace(said,' ');
 task=trimEnds(task.replace(/\s+/g,' ').replace(arabic?/\s(?:الساعة|الساعه)$/:/\s(?:at|on|in)$/i,''));
 let name=arabic
  ?trimEnds(task.replace(/^(?:من فضلك|لو سمحت)\s+/,'').replace(arabicVerb,'').replace(/^(?:لي|ب)\s+/,''))
  :trimEnds(task.replace(englishVerb,'').replace(/^(?:me|us)\s+/i,'').replace(/^(?:the|a|an)\s+/i,''));
 if(!arabic&&name) name=name[0].toUpperCase()+name.slice(1);
 // A time with no "every" is not yet a schedule: how often it runs is asked, with that time filled in.
 return {name:name?shorten(name):null,prompt:task||text,form:whens.length&&draft?formOfDraft(draft):null,draft};
}

