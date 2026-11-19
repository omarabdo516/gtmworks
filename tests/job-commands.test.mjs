import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandList } from '../lib/composer-mentions.mjs';
import { sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

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

// A sent message is only ever its text: nothing in the send path reads a "/" command, so one typed where it is not
// listed, or in another Agent's Conversation, starts that Conversation's own Run with the words as typed (item 4).
const company = '10000000-0000-0000-0000-000000000001';
const conversation = 'c9000000-0000-0000-0000-000000000001';
const lead = 'a9000000-0000-0000-0000-000000000001';
const hermes = { address: 'http://127.0.0.1:9', key: 'fake-engine-key' };
// A Conversation already there, on Lead (no ready-made role), as the database keeps it; a new chat of this Member is
// given Lead too. Every call the send makes is answered, and the ones that name an Agent are kept for the assertions.
function databases(stored) {
 const calls = [];
 const path = () => { const chain = { select: () => chain, eq: (...args) => { calls.push(['read', ...args]); return chain; }, in: () => chain, maybeSingle: async () => ({ data: null, error: null }) }; return chain; };
 const agentsChain = () => { const result = { data: [{ id: lead, name: 'Lead', is_default: true }], error: null };
  const chain = { eq: (...args) => { calls.push(['read', ...args]); return chain; }, maybeSingle: async () => ({ data: { id: lead, instructions: null }, error: null }), then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  return { select: () => chain };
 };
 const rpc = async (name, args) => {
  calls.push([name, args]);
  if (name === 'conversation_agent') return { data: stored, error: null };
  if (name === 'answer_question') return { data: 'none', error: null };
  if (name === 'reserve_conversation_turn') return { data: { state: 'reserved', connection: 'f9000000-0000-0000-0000-000000000001', profile: 'writer', note: null }, error: null };
  if (['pin_run', 'pin_run_history', 'pin_run_model'].includes(name)) return { data: null, error: null };
  if (name === 'begin_start') return { data: 1, error: null };
  if (name === 'send_conversation_message') return { data: true, error: null };
  return { data: null, error: { message: `unexpected ${name}` } };
 };
 const db = { rpc, from: (table) => { calls.push(['from', table]); return table === 'hermes_agents' ? agentsChain() : path(); } };
 return { db, service: { rpc }, calls };
}
const runsNamed = (calls, name) => calls.filter(call => call[0] === name).map(call => call[1]);

test('a job command in an Agent\'s own Conversation runs there once, as typed, and no handoff starts', async () => {
 const fake = fakeEngine(); const { db, service, calls } = databases(lead);
 const send = message => sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message, hermes, engineFor: fake.engineFor });
 assert.deepEqual(await send('/campaign Launch the December ads'), { conversation });
 assert.deepEqual(await send('/report last week by channel'), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign Launch the December ads', '/report last week by channel']);
 assert.equal(fake.runs.length, 2, 'one Run per message, and no Run for the Agent the command would name elsewhere');
 assert.deepEqual(runsNamed(calls, 'send_conversation_message').map(({ agent, message }) => [agent, message]), [[lead, '/campaign Launch the December ads'], [lead, '/report last week by channel']]);
 assert.deepEqual(runsNamed(calls, 'reserve_conversation_turn').map(({ agent }) => agent), [lead, lead], 'the Conversation\'s own Agent only');
 // The only Agents read are the Conversation's own: nothing looks up the Agent from a role.
 assert.deepEqual(calls.filter(call => call[0] === 'read' && call[1] === 'id').map(([, , value]) => value), [lead, lead]);
 assert.deepEqual(fake.runs.map(run => run.conversation), [conversation, conversation]);
 assert.deepEqual(fake.connections.map(connection => connection.profile), ['writer', 'writer'], 'each message on the Agent\'s pinned profile');
});

test('a job command typed in a new chat where it is not listed goes to the chat\'s Agent, as typed', async () => {
 // No Agent was made from numbers in this Company, so /report is not one of its Commands; the message still runs, as
 // typed, on the Agent the new chat was opened with.
 const fake = fakeEngine(); const { db, service, calls } = databases(null);
 const sent = await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), agent: lead, message: '/report last week by channel', hermes, engineFor: fake.engineFor });
 assert.deepEqual(sent, { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/report last week by channel']);
 assert.deepEqual(runsNamed(calls, 'send_conversation_message').map(({ agent, message }) => [agent, message]), [[lead, '/report last week by channel']]);
});
