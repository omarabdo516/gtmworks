import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoutineSentence } from '../lib/routine-sentence.mjs';
import { cronOf, scheduleLabel } from '../lib/routine-schedule.mjs';
import { i18n } from '../lib/i18n.mjs';

// One sentence for a Routine (#205): the reference's own example sentences (design-reference/app.js: RT_EXAMPLES,
// routineExample, the form's placeholder) and their English forms, each read into a name and the cron expression the
// Engine is given.
const read=sentence=>{ const found=readRoutineSentence(sentence); return found&&{name:found.name,cron:found.form&&cronOf(found.form)}; };

test('the reference\'s Egyptian Arabic sentences read into a name and a schedule', () => {
 assert.deepEqual(read('ابعتلي ملخص الإعلانات كل يوم 9 الصبح'),{name:'ملخص الإعلانات',cron:'0 9 * * *'});
 assert.deepEqual(read('ابعتلي ترتيب المقالات كل اتنين 11 الصبح'),{name:'ترتيب المقالات',cron:'0 11 * * 1'});
 assert.deepEqual(read('ابعتلي مقارنة Meta وGoogle كل خميس 4 العصر'),{name:'مقارنة Meta وGoogle',cron:'0 16 * * 4'});
 assert.deepEqual(read('ابعتلي الإعلانات اللي محتاجة مراجعة كل يوم 2 الضهر'),{name:'الإعلانات اللي محتاجة مراجعة',cron:'0 14 * * *'});
 assert.deepEqual(read('ابعتلي ملخص اللي عملته كل خميس 4 العصر'),{name:'ملخص اللي عملته',cron:'0 16 * * 4'});
 assert.deepEqual(read('ملخص الليدز كل يوم 8 الصبح'),{name:'ملخص الليدز',cron:'0 8 * * *'});
 assert.deepEqual(read('راجع الصرف كل ساعة'),{name:'الصرف',cron:'0 * * * *'});
 assert.deepEqual(read('ابعتلي التقرير كل شهر ١٠:٣٠ الصبح'),{name:'التقرير',cron:'30 10 1 * *'},'Arabic-Indic digits read as numbers');
 assert.deepEqual(read('ابعتلي الليدز كل يوم الساعة 8 بالليل'),{name:'الليدز',cron:'0 20 * * *'});
 assert.deepEqual(read('ابعتلي ملخص كل أسبوع 4'),{name:'ملخص',cron:'0 16 * * 4'},'every week with no day runs on Thursday, as the reference');
});

test('the same sentences in English read into the same schedules', () => {
 assert.deepEqual(read('leads summary every day at 8 in the morning'),{name:'Leads summary',cron:'0 8 * * *'});
 assert.deepEqual(read('Send me the ads summary every day at 9am'),{name:'Ads summary',cron:'0 9 * * *'});
 assert.deepEqual(read('Send me the article rankings every Monday at 11 AM'),{name:'Article rankings',cron:'0 11 * * 1'});
 assert.deepEqual(read('Send me a Meta vs Google comparison every Thursday at 4 in the afternoon'),{name:'Meta vs Google comparison',cron:'0 16 * * 4'});
 assert.deepEqual(read('Send me the ads that need review every day at 2'),{name:'Ads that need review',cron:'0 14 * * *'},'1 to 6 with no a.m. or p.m. is the afternoon, as the reference reads it');
 assert.deepEqual(read('Check spend every hour'),{name:'Spend',cron:'0 * * * *'});
 assert.deepEqual(read('Send me the report every month at 10:30am'),{name:'Report',cron:'30 10 1 * *'});
 assert.deepEqual(read('Post the weekly numbers on Fridays at 5pm'),{name:'Weekly numbers',cron:'0 17 * * 5'});
 assert.deepEqual(read('at 8pm every day send me the leads'),{name:'Leads',cron:'0 20 * * *'},'a time said first, with "at"');
 assert.deepEqual(read('Remind me to check the budget daily at noon'),{name:'Check the budget',cron:'0 12 * * *'});
});

// Omar, 2026-11-18: each run is a paid Run, so a sentence that does not say when is asked a time; nothing defaults.
test('a sentence that does not say fully when gives no schedule, only what it did say', () => {
 assert.deepEqual(readRoutineSentence('ملخص الليدز'),{name:'ملخص الليدز',prompt:'ملخص الليدز',form:null,draft:null});
 assert.deepEqual(readRoutineSentence('Send me the leads every day'),{name:'Leads',prompt:'Send me the leads',form:null,draft:{kind:'daily'}});
 assert.deepEqual(readRoutineSentence('ابعتلي التقرير كل أسبوع')?.draft,{kind:'weekly',dow:4});
 assert.equal(readRoutineSentence('Send me a summary of the top 3 ads')?.form,null,'a number in the task is no time');
 assert.deepEqual(readRoutineSentence('summary at 9am'),{name:'Summary',prompt:'summary',form:null,draft:{kind:'daily',h:9,m:0}},'a time with no "every" asks how often');
 assert.equal(readRoutineSentence('   '),null);
});

test('the task the Engine is given is the sentence without its "when"', () => {
 assert.equal(readRoutineSentence('ابعتلي ملخص الإعلانات كل يوم 9 الصبح')?.prompt,'ابعتلي ملخص الإعلانات');
 assert.equal(readRoutineSentence('Send me the ads summary every day at 9am')?.prompt,'Send me the ads summary');
 assert.equal(readRoutineSentence('@Ads ابعتلي ملخص الإعلانات كل يوم 9 الصبح')?.prompt,'ابعتلي ملخص الإعلانات','a mention is not part of the task');
 assert.equal(Array.from(readRoutineSentence(`${'word '.repeat(30)}every day at 9am`)?.name??'').length,48,'a long name is cut at 48');
});

test('a monthly Routine reads back in words in both languages', () => {
 const en=i18n('en').t, ar=i18n('ar').t;
 assert.equal(scheduleLabel(en,{expr:'30 10 1 * *',display:null}),'1st of every month · 10:30 AM');
 assert.equal(scheduleLabel(ar,{expr:'30 10 1 * *',display:null}),'أول كل شهر 10:30 الصبح');
});

// Review of #517: a sentence is never given a time or a day it did not say.
test('a number in the task is no time, and a named day, a date of the month or an impossible clock is never replaced', () => {
 assert.deepEqual(read('Every day send me a summary of the top 3 ads'),{name:'Summary of the top 3 ads',cron:null},'no time said: it asks');
 assert.deepEqual(read('Every day send me the top 3 ads at 9am'),{name:'Top 3 ads',cron:'0 9 * * *'},'the marked time wins over the task\'s number');
 assert.equal(readRoutineSentence('Every day send me the top 3 ads at 9am')?.prompt,'send me the top 3 ads');
 assert.deepEqual(read('Send me a report every week on Monday at 9am'),{name:'Report',cron:'0 9 * * 1'});
 assert.equal(readRoutineSentence('Send me a report every week on Monday at 9am')?.prompt,'Send me a report');
 assert.deepEqual(read('Send me the report every month on the 15th at 9am'),{name:'Report on the 15th',cron:null},'only the first of the month is a schedule it makes: it asks, and the 15th stays in the task');
 assert.deepEqual(read('ابعتلي التقرير كل شهر يوم 15 الساعة 9 الصبح')?.cron,null);
 assert.deepEqual(read('Send me the report every morning'),{name:'Report',cron:null},'every morning says no hour');
 assert.deepEqual(read('Send me the report every morning at 8'),{name:'Report',cron:'0 8 * * *'});
 assert.deepEqual(read('Send me the report every evening at 7'),{name:'Report',cron:'0 19 * * *'});
 assert.deepEqual(read('Send me the report every day at 25:90'),{name:'Report',cron:null},'an impossible clock asks');
 assert.deepEqual(read('ابعتلي التقرير كل يوم 25 الصبح')?.cron,null);
 assert.deepEqual(read('ابعتلي ملخص كل يوم فيه 3 إعلانات'),{name:'ملخص فيه 3 إعلانات',cron:null},'an Arabic task number is no time either');
});
