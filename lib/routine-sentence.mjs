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
const arabicClock=/(?:الساعة\s*|الساعه\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(الصبح|صباحاً|صباحا|ص|الضهر|الظهر|العصر|المغرب|المسا|مساءً|مساء|بالليل|الليل|م)?(?=\s|$|[.،,؟?])/;

const englishVerb=/^(?:please\s+)?(?:send\s+(?:me|us)|give\s+(?:me|us)|email\s+(?:me|us)|remind\s+(?:me|us)(?:\s+(?:to|about|of))?|tell\s+(?:me|us)(?:\s+about)?|make\s+(?:me|us)|write\s+(?:me|us)|prepare|send|make|write|check|review|run|post|share|draft|create|do)\s+/i;
const englishDayNames=Object.keys(englishDays).join('|');
// A named day is read before a word for how often ("the weekly numbers on Fridays" runs on Friday).
const englishOnDay=new RegExp(`\\b(?:every|each)\\s+(${englishDayNames})\\b|\\b(?:on\\s+)?(${englishDayNames})s\\b`,'i');
const englishEvery=/\b(?:every|each)\s+(day|hour|week|month|morning|evening|night)\b|\b(daily|hourly|weekly|monthly)\b/i;
const englishClock=/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s+(in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening|at\s+night|tonight))?(?=\s|$|[.,;!?])|\b(?:at\s+)(noon|midday|midnight)\b/i;

const clamp=(value,high)=>Math.min(high,Math.max(0,value));

/** @param {RegExpMatchArray} match */
function arabicHour(match) {
 let h=clamp(Number.parseInt(match[1],10),23); const m=match[2]?clamp(Number.parseInt(match[2],10),59):0;
 const part=match[3]||'';
 if(/الصبح|صباح|^ص$/.test(part)) { if(h===12) h=0; }
 else if(/الضهر|الظهر/.test(part)) { if(h<6) h+=12; }
 else if(part) { if(h<12) h+=12; }
 else if(h>=1&&h<=6) h+=12;
 return {h,m};
}

/** @param {RegExpMatchArray} match */
function englishHour(match) {
 if(match[5]) return {h:/midnight/i.test(match[5])?0:12,m:0};
 let h=clamp(Number.parseInt(match[1],10),23); const m=match[2]?clamp(Number.parseInt(match[2],10),59):0;
 const marker=(match[3]||'').replaceAll('.','').toLowerCase(); const part=(match[4]||'').toLowerCase();
 if(marker==='am'||/morning/.test(part)) { if(h===12) h=0; }
 else if(marker==='pm'||/afternoon|evening|night/.test(part)) { if(h<12) h+=12; }
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
 if(lower==='morning') return {kind:'daily',h:9,m:0};
 if(lower==='evening') return {kind:'daily'};
 if(lower==='night') return {kind:'daily'};
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
 const every=arabic?arabicEvery.exec(text):englishOnDay.exec(text)??englishEvery.exec(text);
 /** @type {ScheduleDraft|null} */
 let draft=null; let when='';
 if(every) {
  const word=every.slice(1).find(Boolean)||'';
  draft=draftOf(word,arabic);
  when=every[0];
 }
 // The time of day comes after the "every" (the reference's reader); in English it may also come first, said with "at"
 // or a.m./p.m., so a number that is part of the task ("the top 3 ads") is never read as a time.
 const after=every?text.slice(every.index+every[0].length):text;
 let clock=(arabic?arabicClock:englishClock).exec(after);
 let clockText=clock?.[0]??'';
 if(!arabic&&every&&!clock) {
  const before=text.slice(0,every.index);
  const said=/\b(?:at\s+\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|at\s+(?:noon|midday|midnight))\b/i.exec(before);
  if(said) { clock=englishClock.exec(said[0]); clockText=said[0]; }
 }
 if(!every&&!(clock&&(arabic||/\bat\b|[ap]\.?m|noon|midday|midnight/i.test(clockText)))) clock=null;
 if(clock&&draft?.kind!=='hourly') {
  const {h,m}=(arabic?arabicHour:englishHour)(clock);
  draft=draft?{...draft,h,m}:{kind:'daily',h,m};
 }
 // What to do: the sentence without its "when", as the person said it; the name, that without the verb that asks.
 let task=text;
 for(const part of [when,clock?clockText:'']) if(part) task=task.replace(part,' ');
 task=trimEnds(task.replace(/\s+/g,' ').replace(arabic?/\s(?:الساعة|الساعه)$/:/\s(?:at|on|in)$/i,''));
 let name=arabic
  ?trimEnds(task.replace(/^(?:من فضلك|لو سمحت)\s+/,'').replace(arabicVerb,'').replace(/^(?:لي|ب)\s+/,''))
  :trimEnds(task.replace(englishVerb,'').replace(/^(?:me|us)\s+/i,'').replace(/^(?:the|a|an)\s+/i,''));
 if(!arabic&&name) name=name[0].toUpperCase()+name.slice(1);
 // A time with no "every" is not yet a schedule: how often it runs is asked, with that time filled in.
 return {name:name?shorten(name):null,prompt:task||text,form:every&&draft?formOfDraft(draft):null,draft};
}

