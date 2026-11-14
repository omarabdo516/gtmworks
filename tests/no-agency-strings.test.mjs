import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Nobody outside a Company's Members enters it and the reviewer Role is gone (ADR 0012), so no interface string names
// an Agency or a reviewer. Arabic: the Agency stem is وكال (وكيل, an agent, is not); a reviewer is مراجع as a word,
// while مراجعة (a review) stays.
const catalogues={en:JSON.parse(readFileSync('lib/messages/en.json','utf8')),ar:JSON.parse(readFileSync('lib/messages/ar.json','utf8'))};
const forbidden={en:[/agenc/i,/\breviewers?\b/i],ar:[/وكال/u,/(?<!\p{L})(?:[وفبل])?(?:ال)?مراجع(?:ون|ين|و)?(?!\p{L})/u]};

function agencyTerms(language,messages) {
 return Object.entries(messages).flatMap(([key,value])=>forbidden[language].some(term=>term.test(key)||term.test(value))?[`${language}: ${key}: ${value}`]:[]);
}

test('the terms are found where they occur and nowhere else',()=>{
 assert.deepEqual(agencyTerms('en',{a:'Agency owner',b:'All agencies',c:'Current reviewer',d:'Reviewers',reviewer:'Role'}).length,5);
 assert.deepEqual(agencyTerms('en',{a:'Review decision',b:'Review',c:'Agent',d:'Awaiting review'}),[]);
 assert.deepEqual(agencyTerms('ar',{a:'مالك الوكالة',b:'وكالة',c:'مراجع',d:'المراجع الحالي',e:'المراجعون',f:'والمراجعين'}).length,6);
 assert.deepEqual(agencyTerms('ar',{a:'وكيل المحتوى',b:'الوكلاء',c:'المراجعة',d:'قرار المراجعة',e:'مراجعتها'}),[]);
});

test('no catalogue string mentions an Agency or a reviewer',()=>{
 assert.deepEqual([...agencyTerms('en',catalogues.en),...agencyTerms('ar',catalogues.ar)],[]);
});
