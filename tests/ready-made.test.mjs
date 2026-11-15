import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roleTemplates } from '../lib/role-templates.mjs';
import { agentToolSpecs } from '../lib/agent-tools.mjs';

// The gallery (lib/ready-roles.ts) names each ready-made role from its own catalogue, keyed by the role's id. Every role
// needs its words in both languages, its English line is the job the Agent is then given (so the card promises what
// Lead makes), and no line names a role that does not exist.
const catalogue = language => JSON.parse(readFileSync(`lib/messages/ready-made.${language}.json`, 'utf8'));

test('every ready-made role has its name, line and category in both languages, and the English line is its job', () => {
 for (const language of ['en', 'ar']) {
  const text = catalogue(language);
  for (const [id, role] of Object.entries(roleTemplates)) {
   for (const key of [`role.${id}`, `line.${id}`, `category.${role.category}`]) assert.ok(text[key]?.trim(), `${language}: ${key}`);
  }
  const ids = new Set(Object.keys(roleTemplates));
  for (const key of Object.keys(text).filter(key => /^(role|line|hand|handAlone)\./.test(key))) assert.ok(ids.has(key.split('.')[1]), `${language}: ${key} names a ready-made role`);
 }
 const en = catalogue('en');
 for (const [id, role] of Object.entries(roleTemplates)) assert.equal(en[`line.${id}`], role.job, `${id}: the card's line is the job`);
});

test('the message a pick sends names the role as create_agent describes its template, so Lead can tell which one', () => {
 const described = /** @type {any} */(agentToolSpecs.find(tool => tool.name === 'create_agent')).parameters.properties.template.description.toLowerCase();
 const en = catalogue('en');
 for (const id of Object.keys(roleTemplates)) assert.ok(described.includes(`${id} (${en[`role.${id}`].toLowerCase()})`), `${id}: ${en[`role.${id}`]}`);
});
