import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOwnSkill } from '../lib/hermes.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #181: a Skill's current text comes from GET /api/skills/content for the Agent's own profile, as the pinned Engine
// serves it (hermes_cli/web_routers/skills.py 436-455). A Skill the profile does not have is absent, a refused key and
// an Engine that cannot be reached are states, never thrown.
const profile = 'ag-3a000000000000000000000000000011';
const content = '---\nname: weekly-recap\ndescription: Writes the Friday recap.\n---\n\nDo the thing.\n';

test('the Agent\'s own Skill is read with its text from its own profile only', async () => {
 const fake = await fakeHermes();
 try {
  fake.settings.profiles.set(profile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: {}, credentials: {} });
  fake.settings.skills.set(profile, new Map([['weekly-recap', content]]));
  const connection = { address: fake.address, managementAddress: fake.managementAddress, profile, key: fake.settings.key };
  const read = await readOwnSkill(connection, { name: 'weekly-recap' });
  assert.deepEqual(read, { state: 'found', content });
  const request = fake.settings.managementRequests.find(entry => entry.path.startsWith('/api/skills/content'));
  assert.equal(request.path, `/api/skills/content?profile=${profile}&name=weekly-recap`, 'the read names the Agent\'s own profile');
 } finally { await fake.close(); }
});

test('a Skill the profile does not have is absent, and an invalid name or a foreign profile never reaches the Engine', async () => {
 const fake = await fakeHermes();
 try {
  fake.settings.profiles.set(profile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: {}, credentials: {} });
  const connection = { address: fake.address, managementAddress: fake.managementAddress, profile, key: fake.settings.key };
  assert.deepEqual(await readOwnSkill(connection, { name: 'missing-skill' }), { state: 'absent', content: null });
  const before = fake.settings.managementRequests.length;
  assert.equal((await readOwnSkill(connection, { name: '../etc/passwd' })).state, 'failed');
  assert.equal((await readOwnSkill({ ...connection, profile: 'default' }, { name: 'weekly-recap' })).state, 'failed', 'only an Agent or Company profile is read here');
  assert.equal(fake.settings.managementRequests.length, before, 'a name the page cannot ask for never reaches the Engine');
 } finally { await fake.close(); }
});

test('a refused key is refused and an Engine that is not there is unreachable', async () => {
 const fake = await fakeHermes();
 try {
  fake.settings.profiles.set(profile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: {}, credentials: {} });
  fake.settings.managementStatus = 401;
  const connection = { address: fake.address, managementAddress: fake.managementAddress, profile, key: fake.settings.key };
  assert.deepEqual(await readOwnSkill(connection, { name: 'weekly-recap' }), { state: 'refused', content: null });
  assert.deepEqual(await readOwnSkill({ ...connection, managementAddress: 'http://127.0.0.1:9', key: 'k' }, { name: 'weekly-recap' }), { state: 'unreachable', content: null });
 } finally { await fake.close(); }
});
