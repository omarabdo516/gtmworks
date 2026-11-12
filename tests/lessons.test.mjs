import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The database (supabase/tests/skill_lessons.sql) decides what is stored and who may decide; these guard the pieces around it.
const route = readFileSync('app/api/v1/companies/[slug]/[...path]/route.ts', 'utf8');
const block = route.slice(route.indexOf("path[0]==='skills' && path[2]==='lessons'"), route.indexOf('// A run key reaches its one card'));

test('a lesson is proposed only from a run, takes its card from the key and never writes a skill', () => {
 assert.match(block, /path\[0\]==='skills' && path\[2\]==='lessons' && request\.method==='POST'/);
 assert.match(block, /if \(!runCard\) return refuse\(\)/);
 assert.match(block, /rpc\('propose_skill_lesson'/);
 assert.match(block, /k:agent\.key_id/);
 assert.doesNotMatch(block, /payload\.card|payload\.company|skill_versions|skill_lessons['"]\)/, 'the card and company come from the key, and rows are written by the database function');
 assert.doesNotMatch(route, /decide_skill_lesson/, 'an agent route has no way to decide');
});

test('deciding on a lesson is a person action that calls the database function and nothing else', () => {
 const actions = readFileSync('app/c/[slug]/[[...section]]/skill-actions.ts', 'utf8');
 const decide = actions.slice(actions.indexOf('export const decideSkillLesson'));
 assert.match(decide, /rpc\('decide_skill_lesson'/);
 assert.match(decide, /approve:form\.get\('intent'\)==='approve'/);
 assert.doesNotMatch(decide, /skill_versions|skill_lessons'\)/);
});

test('the Inbox lessons strings exist in both languages and stay out of the browser bundle', () => {
 const en = JSON.parse(readFileSync('lib/messages/lessons.en.json', 'utf8')), ar = JSON.parse(readFileSync('lib/messages/lessons.ar.json', 'utf8'));
 const page = readFileSync('app/c/[slug]/[[...section]]/lessons.tsx', 'utf8');
 const used = [...page.matchAll(/\bs\('([A-Za-z]+)'/g)].map(match => match[1]);
 assert.ok(used.length >= 8);
 for (const key of used) assert.ok(en[key] && ar[key], `${key} in both languages`);
 assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
 const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
 for (const file of [...walk('app'), ...walk('lib'), ...walk('components')].filter(file => /\.(tsx?|mjs)$/.test(file))) {
  if (/^['"]use client['"]/.test(readFileSync(file, 'utf8'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /messages\/lessons\./, `${file} must not bundle the server-only strings`);
 }
});

test('the Inbox shows lessons only to people who manage the company, and every control is 44px tall on a phone', () => {
 const pageSource = readFileSync('app/c/[slug]/[[...section]]/page.tsx', 'utf8');
 assert.match(pageSource, /section==='approvals'&&manage\?await db\.from\('skill_lessons'\)/);
 assert.match(pageSource, /\.eq\('status','pending'\)/);
 const lessons = readFileSync('app/c/[slug]/[[...section]]/lessons.tsx', 'utf8');
 assert.match(lessons, /className="panel agents-panel section-title skills-controls"/);
 const phone = readFileSync('app/globals.css', 'utf8').split('@media(max-width:767px) {')[1].split('@media(prefers-reduced-motion')[0];
 assert.match(phone, /\.skills-controls button,\.skills-controls input\[type=file\] \{ min-height:44px; \}/);
});
