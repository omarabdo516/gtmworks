import test from 'node:test';
import assert from 'node:assert/strict';

test('the Skills page strings exist in both languages and stay out of the browser bundle', async () => {
 const { readFileSync, readdirSync } = await import('node:fs');
 const en = JSON.parse(readFileSync('lib/messages/skills.en.json', 'utf8')), ar = JSON.parse(readFileSync('lib/messages/skills.ar.json', 'utf8'));
 const page = readFileSync('app/c/[slug]/[[...section]]/skills.tsx', 'utf8');
 for (const key of [...page.matchAll(/\bs\('([A-Za-z]+)'/g)].map(match => match[1]).concat(['skillProblemHeader', 'skillProblemShared', 'skillProblemNotOwn', 'skillProblemNotAllowed', 'skillProblemSecret'])) {
  assert.ok(en[key] && ar[key], `${key} in both languages`);
 }
 const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
 for (const file of [...walk('app'), ...walk('lib'), ...walk('components')].filter(file => /\.(tsx?|mjs)$/.test(file))) {
  const source = readFileSync(file, 'utf8');
  if (/^['"]use client['"]/.test(source)) assert.doesNotMatch(source, /messages\/skills\./, `${file} must not bundle the server-only strings`);
 }
});

test('every Skills control is at least 44px tall on a phone', async () => {
 const { readFileSync } = await import('node:fs');
 const page = readFileSync('app/c/[slug]/[[...section]]/skills.tsx', 'utf8');
 assert.equal(page.match(/className="panel agents-panel section-title"/g), null, 'each Skills panel carries skills-controls');
 assert.equal(page.match(/className="panel agents-panel section-title skills-controls"/g).length, 2);
 const phone = readFileSync('app/globals.css', 'utf8').split('@media(max-width:767px) {')[1].split('@media(prefers-reduced-motion')[0];
 assert.match(phone, /\.skills-controls button,\.skills-controls input\[type=file\] \{ min-height:44px; \}/);
});
