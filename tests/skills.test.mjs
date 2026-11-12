import test from 'node:test';
import assert from 'node:assert/strict';
import { skillLibrary } from '../lib/skill-library.mjs';

// The database check (supabase/tests/skills.sql) decides what is stored; this guards that nothing in the library would fail it.
test('every library skill is a small SKILL.md with a valid name, a description and declared permissions', () => {
 assert.ok(skillLibrary.length >= 3);
 assert.equal(new Set(skillLibrary.map(entry => entry.name)).size, skillLibrary.length, 'names are unique');
 for (const entry of skillLibrary) {
  const header = entry.content.replaceAll('\r', '').match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(header, `${entry.name}: header`);
  const field = key => header.match(new RegExp(`(?:^|\\n)${key}:[ \\t]*([^\\n]*)`))?.[1].trim();
  assert.match(field('name'), /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(field('name'), entry.name);
  assert.ok(field('description'), `${entry.name}: description`);
  assert.ok(field('description').length <= 1024);
  assert.ok(field('permissions') !== undefined, `${entry.name}: permissions declared`);
  for (const permission of field('permissions').split(',').map(item => item.trim()).filter(Boolean)) assert.ok(['cards.read', 'cards.write', 'files.read', 'network'].includes(permission), permission);
  assert.doesNotMatch(header, /^\s*(install|preinstall|postinstall|setup|scripts|hooks)\s*:/im, `${entry.name}: no install hook`);
  assert.ok(Buffer.byteLength(entry.content) <= 20000);
 }
});

test('a library skill is installed from the stored catalogue, never from text sent with the request', async () => {
 const { readFileSync } = await import('node:fs');
 const actions = readFileSync('app/c/[slug]/[[...section]]/skill-actions.ts', 'utf8');
 assert.match(actions, /skillLibrary\.find\(entry=>entry\.name===String\(form\.get\('entry'\)\)\)\?\.content/);
 const route = readFileSync('app/api/v1/companies/[slug]/[...path]/route.ts', 'utf8');
 assert.doesNotMatch(route, /skill_versions['"]\)\.(insert|upsert|update)/);
 assert.match(route, /agent_load_skills/);
});

test('the Skills page strings exist in both languages and stay out of the browser bundle', async () => {
 const { readFileSync, readdirSync } = await import('node:fs');
 const en = JSON.parse(readFileSync('lib/messages/skills.en.json', 'utf8')), ar = JSON.parse(readFileSync('lib/messages/skills.ar.json', 'utf8'));
 const page = readFileSync('app/c/[slug]/[[...section]]/skills.tsx', 'utf8');
 for (const key of [...page.matchAll(/\bs\('([A-Za-z]+)'/g)].map(match => match[1]).concat(Object.values({ install_script: 'skillProblemInstallScript', too_large: 'skillProblemTooLarge', no_frontmatter: 'skillProblemNoFrontmatter', bad_name: 'skillProblemBadName', no_description: 'skillProblemNoDescription', no_permissions: 'skillProblemNoPermissions', unknown_permission: 'skillProblemUnknownPermission' }))) {
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
 assert.equal(page.match(/className="panel agents-panel section-title skills-controls"/g).length, 3);
 const phone = readFileSync('app/globals.css', 'utf8').split('@media(max-width:767px) {')[1].split('@media(prefers-reduced-motion')[0];
 assert.match(phone, /\.skills-controls button,\.skills-controls input\[type=file\] \{ min-height:44px; \}/);
});
