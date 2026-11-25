import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// #714, ADR 0020: an Agent may publish and pay on its Screen when a Member asks, so the reference's note that any
// "Publish" or payment on the Screen stops and is handed over, and that the Agent never presses it on its own, is drawn
// nowhere. No catalogue, in either language, holds it.
const terms={en:[/never presses/i,/payment on the screen stops/i],ar:[/مبيدوسش عليه لوحده/,/أي «انشر» أو دفع على الشاشة/]};
const said=(language,text)=>terms[language].some(term=>term.test(text));

test('the terms find the reference\'s own line in both languages',()=>{
 const reference=readFileSync('design-reference/app.js','utf8');
 const note=reference.split('\n').find(line=>line.includes('class="vw-note"'));
 assert.ok(note,'the reference draws the note');
 const pairs=[...note.matchAll(/lng\('([^']*)', '([^']*)'\)/g)];
 assert.equal(pairs.length,2);
 for(const [,ar,en] of pairs) assert.ok(said('ar',ar)&&said('en',en),en);
});

test('neither catalogue holds the line that an Agent never presses Publish or pays',()=>{
 const found=readdirSync('lib/messages').filter(name=>/\.(en|ar)\.json$|^(en|ar)\.json$/.test(name)).flatMap(name=>{
  const language=/(^|\.)ar\.json$/.test(name)?'ar':'en';
  const catalogue=JSON.parse(readFileSync(`lib/messages/${name}`,'utf8'));
  return Object.entries(catalogue).flatMap(([key,value])=>typeof value==='string'&&said(language,value)?[`${name}: ${key}: ${value}`]:[]);
 });
 assert.deepEqual(found,[]);
});
