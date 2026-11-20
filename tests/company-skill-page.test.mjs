import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, readProfileModels, readOwnSkill } from '../lib/hermes.mjs';
import { readCompanySkillPage } from '../lib/company-skill-page.mjs';
import { companyProfile } from '../lib/agent-levels.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #181: one learned Skill's page in Settings › Learning. Its text is read from GET /api/skills/content for that Agent's
// own Engine profile, beside the Agent's name and that profile's learning mode (#28). A Viewer has no Learning section,
// so the server refuses the page for them; a person who is not a member, or a Skill name that is not a Skill's, never
// reaches the Engine.
const fixture = JSON.parse(readFileSync(new URL('./engine-schema.json', import.meta.url), 'utf8'));
const company = '10000000-0000-0000-0000-000000000001';
const omar = '20000000-0000-0000-0000-000000000001';
const lead = '3a000000-0000-0000-0000-000000000011';
const writer = '3a000000-0000-0000-0000-000000000021';
const outsider = '3a000000-0000-0000-0000-000000000099';
const profile = companyProfile(company);
const content = '---\nname: weekly-recap\ndescription: Writes the Friday recap.\n---\n\nDo the thing.\n';
const agents = [{ agent: lead, name: 'Lead', profile, own: true }, { agent: writer, name: 'Writer', profile: `ag-${writer.replaceAll('-', '')}`, own: true }];

function database({ role = 'contributor', rows = agents, target = true } = {}) {
 const db = {
  rpc: async (name) => {
   if (name === 'company_engine_target') return { data: target ? [{ profile, profiles: [] }] : null, error: null };
   if (name === 'company_app_agents') return { data: rows, error: null };
   return { data: null, error: { message: `unexpected ${name}` } };
  },
  from: (table) => {
   if (table !== 'members') throw new Error(`unexpected ${table}`);
   const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
   return query;
  },
 };
 return db;
}

const drivers = (fake) => ({
 read: (connection, skill) => readOwnSkill({ ...connection, managementAddress: fake.managementAddress }, skill),
 config: (connection) => readConfig({ ...connection, managementAddress: fake.managementAddress }),
 saved: (connection) => readSavedConfig({ ...connection, managementAddress: fake.managementAddress }),
 schema: (connection) => readConfigSchema({ ...connection, managementAddress: fake.managementAddress }),
 defaults: (connection) => readConfigDefaults({ ...connection, managementAddress: fake.managementAddress }),
 profileModels: (connection, names) => readProfileModels({ ...connection, managementAddress: fake.managementAddress }, names),
});

async function engine(fake, config = {}) {
 fake.settings.configDefaults = fixture.defaults;
 fake.settings.configSchema = { fields: fixture.schema, category_order: [] };
 for (const row of agents) fake.settings.profiles.set(row.profile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: {}, credentials: {} });
 fake.settings.skills.set(profile, new Map([['weekly-recap', content]]));
 if (Object.keys(config).length) fake.settings.profiles.get(profile).config = config;
}

test('a Contributor reads the Skill\'s text from its Agent\'s own profile, with that Agent and its learning mode', async () => {
 const fake = await fakeHermes();
 try {
  await engine(fake, { memory: { write_approval: true }, skills: { write_approval: true } });
  const page = await readCompanySkillPage(database(), { company, agent: lead, name: 'weekly-recap', person: omar, hermes: { address: fake.address, key: fake.settings.key }, driver: drivers(fake) });
  assert.deepEqual(page, { state: 'found', agent: { id: lead, name: 'Lead', own: true }, skill: 'weekly-recap', mode: 'ask', content });
  const request = fake.settings.managementRequests.find(entry => entry.path.startsWith('/api/skills/content'));
  assert.equal(request.path, `/api/skills/content?profile=${profile}&name=weekly-recap`, 'the read names the Agent\'s own profile, never another');
 } finally { await fake.close(); }
});

test('a Viewer, a person who is not a member, and an Agent this person does not see have no page and reach no Engine', async () => {
 const fake = await fakeHermes();
 try {
  await engine(fake);
  const before = fake.settings.managementRequests.length;
  const request = { company, agent: lead, name: 'weekly-recap', person: omar, hermes: { address: fake.address, key: fake.settings.key }, driver: drivers(fake) };
  assert.equal(await readCompanySkillPage(database({ role: 'viewer' }), request), null, 'a Viewer has no Learning section');
  assert.equal(await readCompanySkillPage(database({ role: null }), request), null, 'a person outside the Company has no page');
  assert.equal(await readCompanySkillPage(database(), { ...request, agent: outsider }), null, 'an Agent the database does not list for the Company has no page');
  assert.equal(fake.settings.managementRequests.length, before, 'none of the refusals asked the Engine');
 } finally { await fake.close(); }
});

test('a Skill the profile does not have is absent, and a name that is not a Skill name never reaches the Engine', async () => {
 const fake = await fakeHermes();
 try {
  await engine(fake);
  const request = { company, agent: lead, name: 'gone-skill', person: omar, hermes: { address: fake.address, key: fake.settings.key }, driver: drivers(fake) };
  const page = await readCompanySkillPage(database(), request);
  assert.deepEqual(page, { state: 'absent', agent: { id: lead, name: 'Lead', own: true }, skill: 'gone-skill', mode: 'auto', content: null });
  const before = fake.settings.managementRequests.length;
  assert.equal(await readCompanySkillPage(database(), { ...request, name: '../SKILL.md' }), null);
  assert.equal(await readCompanySkillPage(database(), { ...request, name: 'hermes-agent' }), null, 'the Engine\'s essential skill has no page, and its name is never drawn');
  assert.equal(fake.settings.managementRequests.length, before);
 } finally { await fake.close(); }
});

test('an Engine that cannot be read leaves the page unread, and never as an empty Skill', async () => {
 const fake = await fakeHermes();
 try {
  await engine(fake);
  fake.settings.managementStatus = 401;
  const page = await readCompanySkillPage(database(), { company, agent: lead, name: 'weekly-recap', person: omar, hermes: { address: fake.address, key: fake.settings.key }, driver: drivers(fake) });
  assert.equal(page.state, 'refused');
  assert.equal(page.content, null);
  assert.equal(page.agent.name, 'Lead');
 } finally { await fake.close(); }
});
