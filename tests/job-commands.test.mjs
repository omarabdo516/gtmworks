import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandList, jobCommandIn } from '../lib/composer-mentions.mjs';

// #159, the job commands beside "/agent" (design-reference: CMDS, classifyWork): each belongs to the Agent a Member sees
// that was made from one ready-made role (lib/role-templates.mjs), and its line names that Agent. The Commands are the
// ones whose role has such an Agent, in the reference's order, then "/agent"; a role with no Agent the Member sees has
// none, so a hidden Agent's role lists nothing.
const commands = agents => commandList(agents).map(({ command, label, agent }) => [command, label, agent]);

test('a Company lists each role\'s command with the name of the Agent it was given, and one whose role has no Agent lists none', () => {
 // Lead was made by hand, not from a ready-made role, so it commands nothing.
 const lead = { id: 'l1', name: 'Lead' };
 const of = { meta: { id: 'a1', name: 'Reach', role: 'meta' }, numbers: { id: 'a2', name: 'Figures', role: 'numbers' }, hook: { id: 'a3', name: 'Critic', role: 'hook' }, writer: { id: 'a4', name: 'Writer', role: 'writer' } };
 // Four Companies, each with a different subset of the roles.
 assert.deepEqual(commands([lead, ...Object.values(of)]), [
  ['/campaign', 'plusCommandCampaign', 'Reach'],
  ['/report', 'plusCommandReport', 'Figures'],
  ['/review', 'plusCommandReview', 'Critic'],
  ['/article', 'plusCommandArticle', 'Writer'],
  ['/agent', 'plusCommandAgent', undefined],
 ]);
 assert.deepEqual(commands([lead, of.meta, of.hook]), [['/campaign', 'plusCommandCampaign', 'Reach'], ['/review', 'plusCommandReview', 'Critic'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([of.writer]), [['/article', 'plusCommandArticle', 'Writer'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([lead]), [['/agent', 'plusCommandAgent', undefined]], 'a Company with no Agent from a role lists only /agent');
 assert.deepEqual(commands([]), [['/agent', 'plusCommandAgent', undefined]]);
});

test('an Agent hidden from the Member is not in their list, so its role\'s command is not listed to them', () => {
 // The Agents a Member sees are what the server lists for them (hermes_agents_read); a hidden one never arrives here.
 const seen = [{ id: 'a1', name: 'Reach', role: 'meta' }];
 assert.deepEqual(commands(seen), [['/campaign', 'plusCommandCampaign', 'Reach'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([...seen, { id: 'a2', name: 'Critic', role: 'hook' }]).map(([command]) => command), ['/campaign', '/review', '/agent']);
});

test('two Agents made from one role: the first the Member\'s list draws answers, and neither adds a second command', () => {
 const list = commandList([{ id: 'a1', name: 'Reach', role: 'meta' }, { id: 'a2', name: 'Ads', role: 'meta' }]);
 assert.deepEqual(list.filter(({ command }) => command === '/campaign').map(({ agent }) => agent), ['Reach']);
 assert.equal(list.at(-1).command, '/agent');
});

test('a message that begins with a listed command names the job after it and the Agent of its role', () => {
 const seen = [{ name: 'Lead' }, { name: 'Reach', role: 'meta' }, { name: 'Sage', role: 'writer' }];
 assert.deepEqual(jobCommandIn('/campaign Launch the December ads', seen), { command: '/campaign', role: 'meta', agent: 'Reach', goal: 'Launch the December ads' });
 assert.deepEqual(jobCommandIn('  /article  Arabic SEO guide \n', seen), { command: '/article', role: 'writer', agent: 'Sage', goal: 'Arabic SEO guide' });
 assert.equal(jobCommandIn('/campaign', seen), null, 'a command with no job after it hands nothing over');
 assert.equal(jobCommandIn('/campaigner Launch', seen), null, 'only a whole command word counts');
 assert.equal(jobCommandIn('/report last week', seen), null, 'a role with no Agent the person sees is not listed, so not handed over');
 assert.equal(jobCommandIn('/agent Make me an Agent', seen), null, 'and /agent stays a request to the main Agent');
});

