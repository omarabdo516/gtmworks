import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The channel's record read as Next reads it: `@/` is the repo root and an import may omit `.ts`.
const root = pathToFileURL(`${process.cwd()}/`);
const file = url => existsSync(url) && statSync(url).isFile();
registerHooks({ resolve(specifier, context, next) {
 const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), root) : /^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:') ? new URL(specifier, context.parentURL) : null;
 if (base) for (const extension of ['', '.ts']) { const url = new URL(base.href + extension); if (file(url)) return { url: url.href, shortCircuit: true }; }
 return next(specifier, context);
}});
const { channelRecord } = await import('../lib/channels.ts');

// The channel's reads as the page makes them. `runs` are the channel's closed Runs, newest first; `open` are the Runs
// still open, and `states` is the one agent_states call. `states` rows carry more than the record may keep: the state is
// all a channel's reader gets. `notes` are the quiet lines the channel got, and `members` what channel_members answered.
function database({ agents, runs = [], open = [], states = [], messages = [], notes = [], cards = [], handovers = [], members = [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'viewer', invitation: null, email: null }] }) {
 const rows = select => String(select).includes('message_id') ? runs : select === 'agent_id' ? open : [];
 const chain = table => {
  const data = table === 'channels' ? { id: 'ch-1', company_id: 'co-1', kind: 'team', name: 'Launch week' }
   : table === 'channel_runs' ? rows(selectOf.get(table))
   : table === 'channel_messages' ? messages
   : table === 'channel_notes' ? notes
   : table === 'reply_cards' ? cards
   : [];
  const link = {
   select: () => link, eq: () => link, is: () => link, gte: () => link, in: () => link, order: () => link, limit: () => link,
   maybeSingle: async () => ({ data, error: null }),
   then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return link;
 };
 const selectOf = new Map();
 const rpc = async name => {
  if (name === 'channel_members') return { data: members, error: null };
  if (name === 'channel_agent_list') return { data: agents, error: null };
  if (name === 'conversation_can_write') return { data: false, error: null };
  if (name === 'can_manage_company') return { data: false, error: null };
  if (name === 'permission_choices') return { data: [], error: null };
  if (name === 'agent_states') return { data: states, error: null };
  if (name === 'channel_handovers') return { data: handovers, error: null };
  throw new Error(`unexpected ${name}`);
 };
 return {
  rpc,
  from: table => ({
   select(select) { selectOf.set(table, select); return chain(table); },
  }),
 };
}

const agent = (id, name) => ({ id, connection_id: `c-${id}`, name, speciality: 'Runs the ads.', main: false, here_only: false });

test('an Agent working in the channel, one waiting on the reader and one idle, each with only its state in the record', async () => {
 const record = await channelRecord(database({
  agents: [agent('a-1', 'Ads'), agent('a-2', 'SEO'), agent('a-3', 'Critic')],
  open: [{ agent_id: 'a-1' }],
  states: [
   { agent: 'a-1', running: false, waiting_mine: false, waiting_person: 'Sara Adel', waiting_title: 'Approve the launch post' },
   { agent: 'a-2', running: false, waiting_mine: true, waiting_person: 'Sara Adel', waiting_title: 'Approve the launch post' },
   { agent: 'a-3', running: false, waiting_mine: false, waiting_person: 'Sara Adel', waiting_title: 'Approve the launch post' },
  ],
 }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(record?.agents, [
  { id: 'a-1', connection_id: 'c-a-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'working' },
  { id: 'a-2', connection_id: 'c-a-2', name: 'SEO', speciality: 'Runs the ads.', main: false, only: false, state: 'waiting' },
  { id: 'a-3', connection_id: 'c-a-3', name: 'Critic', speciality: 'Runs the ads.', main: false, only: false, state: 'idle' },
 ]);
 assert.equal(record?.open, true);
 // Whom it works for and on what stays out of the Agents the channel's reader gets.
 const kept = JSON.stringify(record?.agents);
 assert.ok(!kept.includes('Sara Adel'), 'no person the Agent works for');
 assert.ok(!kept.includes('Approve the launch post'), 'no text of that work');
});

test('an Agent waiting on the reader stays waiting while it also has a Run open, and an idle Agent is working once a call starts, idle again when its reply is in', async () => {
 const states = [{ agent: 'a-1', running: false, waiting_mine: false }, { agent: 'a-2', running: false, waiting_mine: true }];
 const agents = [agent('a-1', 'Ads'), agent('a-2', 'SEO')];
 const called = await channelRecord(database({ agents, open: [{ agent_id: 'a-1' }, { agent_id: 'a-2' }], states }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(called?.agents.map(row => row.state), ['working', 'waiting']);
 const answered = await channelRecord(database({ agents, states }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(answered?.agents.map(row => row.state), ['idle', 'waiting']);
 assert.equal(answered?.open, false);
});

// #207: an invited person is a Member row with no person, and the email is only what the server sent: a Contributor's
// answer carries none, and the record keeps none.
test('an invited person is a Member row with no person, and the record keeps only the email the server sent', async () => {
 const invited = { person: null, name: 'Mona', role: 'viewer', invitation: 'i-1', email: null };
 const record = await channelRecord(database({ agents: [agent('a-1', 'Ads')], members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invited] }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(record?.members, [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invited]);
 assert.ok(!JSON.stringify(record?.members).includes('@'), 'no emailed person reaches a Contributor');
 // An invited person is nobody's person: they are named in no channel manager, and no message of theirs has a Role.
 assert.deepEqual(record?.managers, [{ name: 'Omar', role: 'owner' }]);
 const owner = await channelRecord(database({ agents: [], members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { ...invited, email: 'mona@example.test' }] }), 'p-1', 'co-1', 'ch-1');
 assert.equal(owner?.members[1].email, 'mona@example.test', 'the Owner reads the email the server sent');
});

// #207: a note is drawn where it was written: not a message, and never a Run.
test('a note is drawn in the order it was written, with no person and no Run', async () => {
 const at = (hour) => `2026-06-10T${String(hour).padStart(2, '0')}:00:00Z`;
 const record = await channelRecord(database({
  agents: [],
  messages: [
   { id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: 'Morning all', created_at: at(10) },
   { id: 1, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: 'Before the invite', created_at: at(8) },
  ],
  notes: [{ id: 7, kind: 'invite', invitee_name: 'Mona', actor_name: 'Omar', created_at: at(9) }],
 }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(record?.messages.map(message => message.author === 'note' ? `note:${message.name}` : message.body), ['Before the invite', 'note:Mona', 'Morning all']);
 assert.deepEqual(record?.messages[1], { id: -7, author: 'note', kind: 'invite', actor: 'Omar', name: 'Mona', at: at(9) });
 assert.equal(record?.open, false, 'a note starts no Run');
});

// #152: a message that called two Agents carries one turn per Agent, in the order they were named, the first still the
// message's `mention` and each Agent's own request drawn under its own turn.
test('a message that called two Agents carries both turns in the order named, each with its own state and requests', async () => {
 const at = '2026-06-10T10:00:00Z';
 const record = await channelRecord(database({
  agents: [agent('a-1', 'Ads'), agent('a-2', 'SEO')],
  open: [{ agent_id: 'a-2' }],
  runs: [
   { message_id: 2, ordinal: 2, agent_id: 'a-2', agent_name: 'SEO', outcome: null },
   { message_id: 2, ordinal: 1, agent_id: 'a-1', agent_name: 'Ads', outcome: 'completed' },
  ],
  messages: [{ id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: '@Ads @SEO two scripts', reply_to: null, created_at: at }],
 }), 'p-1', 'co-1', 'ch-1');
 const said = record?.messages[0];
 assert.equal(said?.author, 'person');
 const mentions = said?.author === 'person' ? said.mentions : undefined;
 assert.deepEqual(mentions?.map(mention => [mention.agent, mention.state]), [['Ads', 'answered'], ['SEO', 'open']], 'both named Agents, in the order named');
 assert.equal(said?.author === 'person' ? said.mention?.agent : null, 'Ads', 'the first Agent is still the message\'s one mention');
 assert.equal(record?.open, true, 'the second Agent is still working');
 assert.deepEqual(record?.agents.map(row => row.state), ['idle', 'working'], 'the Agent answering is working, the one that answered is idle');
});

test('a message that called two Agents draws each one\'s card under that Agent\'s own reply', async () => {
 const at = '2026-06-10T10:00:00Z';
 const card = (id, ordinal, title) => ({ id, run_id: `run-${ordinal}`, kind: 'draft', title, content: { line: 'Draft', rows: [] }, state: 'shown', answered_at: null, done_at: null, decided_at: null, created_at: at, channel_message_id: 2, channel_ordinal: ordinal });
 const record = await channelRecord(database({
  agents: [agent('a-1', 'Ads'), agent('a-2', 'SEO')],
  runs: [
   { message_id: 2, ordinal: 2, agent_id: 'a-2', agent_name: 'SEO', outcome: 'completed' },
   { message_id: 2, ordinal: 1, agent_id: 'a-1', agent_name: 'Ads', outcome: 'completed' },
  ],
  messages: [
   { id: 4, author: 'agent', person_id: null, agent_id: 'a-2', author_name: 'SEO', body: 'The section.', reply_to: 2, reply_ordinal: 2, created_at: at },
   { id: 3, author: 'agent', person_id: null, agent_id: 'a-1', author_name: 'Ads', body: 'Two scripts.', reply_to: 2, reply_ordinal: 1, created_at: at },
   { id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: '@Ads @SEO two scripts and a section', reply_to: null, reply_ordinal: null, created_at: at },
  ],
  cards: [card(21, 1, 'Scripts'), card(22, 2, 'Section')],
 }), 'p-1', 'co-1', 'ch-1');
 const replies = (record?.messages ?? []).filter(message => message.author === 'agent');
 assert.deepEqual(replies.map(reply => [reply.name, reply.author === 'agent' ? reply.cards?.map(shown => shown.title) : null]), [['Ads', ['Scripts']], ['SEO', ['Section']]]);
});

// #150: a handover in the channel reads as the reference draws it: Lead's reply, the quiet row with both faces and the
// job, the other Agent's answer marked "to Lead", then Lead's reply with what came of it. All of it comes from
// gtmworks's own record, and the details count every handover and draw the last four newest first.
const handover = (overrides = {}) => ({
 id: 7, message: 2, from_agent: 'a-1', from_name: 'Lead', from_connection: 'c-a-1', to_agent: 'a-2', to_name: 'Ads', to_connection: 'c-a-2',
 goal: 'Plan the Meta ads for the March intake', summary: 'Three ad sets, 30 days, EGP 9,000.', reply: 'Ads planned the March intake.',
 state: 'done', created_at: '2026-06-10T10:01:00Z', answered_at: '2026-06-10T10:03:00Z', closed_at: '2026-06-10T10:04:00Z', ...overrides,
});

test('a channel handover is drawn as the row, the other Agent\'s answer marked with the Agent that handed it over, then that Agent\'s reply', async () => {
 const record = await channelRecord(database({
  agents: [agent('a-1', 'Lead'), agent('a-2', 'Ads')],
  runs: [{ message_id: 2, ordinal: 1, agent_id: 'a-1', agent_name: 'Lead', outcome: 'completed' }],
  messages: [
   { id: 3, author: 'agent', person_id: null, agent_id: 'a-1', author_name: 'Lead', body: 'On it: I handed the job to Ads.', reply_to: 2, reply_ordinal: 1, created_at: '2026-06-10T10:00:30Z' },
   { id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: '@Lead plan the March ads', reply_to: null, reply_ordinal: null, created_at: '2026-06-10T10:00:00Z' },
  ],
  handovers: [handover()],
 }), 'p-1', 'co-1', 'ch-1');
 const drawn = (record?.messages ?? []).map(message => message.author === 'agent' ? `${message.name}: ${message.body}${message.to ? ` → ${message.to}` : ''}`
  : message.author === 'handoff' ? `handoff: ${message.from.name} → ${message.to.name}: ${message.goal}` : message.body);
 assert.deepEqual(drawn, [
  '@Lead plan the March ads',
  'Lead: On it: I handed the job to Ads.',
  'handoff: Lead → Ads: Plan the Meta ads for the March intake',
  'Ads: Three ad sets, 30 days, EGP 9,000. → Lead',
  'Lead: Ads planned the March intake.',
 ]);
 const row = record?.messages.find(message => message.author === 'handoff');
 assert.deepEqual(row, { id: 'handover-7', author: 'handoff', from: { name: 'Lead', face: 'c-a-1' }, to: { name: 'Ads', face: 'c-a-2' },
  goal: 'Plan the Meta ads for the March intake', at: '2026-06-10T10:01:00Z' });
 assert.deepEqual(record?.handoffs, [{ id: 7, from: { name: 'Lead', face: 'c-a-1' }, to: { name: 'Ads', face: 'c-a-2' },
  goal: 'Plan the Meta ads for the March intake', at: '2026-06-10T10:01:00Z' }]);
 assert.equal(record?.handover, false, 'a finished handover is not still moving');
});

test('a channel handover still moving keeps the channel asking, and a target that could not report draws no answer', async () => {
 const record = await channelRecord(database({
  agents: [agent('a-1', 'Lead'), agent('a-2', 'Ads')],
  messages: [{ id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: '@Lead plan the March ads', reply_to: null, reply_ordinal: null, created_at: '2026-06-10T10:00:00Z' }],
  handovers: [handover({ id: 8, state: 'target', summary: null, reply: null, answered_at: null, closed_at: null, created_at: '2026-06-10T10:01:00Z' })],
 }), 'p-1', 'co-1', 'ch-1');
 assert.equal(record?.handover, true);
 assert.deepEqual(record?.messages.map(message => message.author), ['person', 'handoff']);
 assert.equal(record?.handoffs.length, 1);
});

test('a channel with no handover draws none, and one whose handover belongs to a message not shown draws no row of it', async () => {
 const empty = await channelRecord(database({ agents: [agent('a-1', 'Lead')], messages: [{ id: 2, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: 'Morning all', reply_to: null, reply_ordinal: null, created_at: '2026-06-10T10:00:00Z' }] }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(empty?.handoffs, []);
 assert.equal(empty?.handover, false);
 assert.deepEqual(empty?.messages.map(message => message.author), ['person']);
 const elsewhere = await channelRecord(database({ agents: [agent('a-1', 'Lead')], messages: [{ id: 9, author: 'person', person_id: 'p-1', agent_id: null, author_name: 'Omar', body: 'Before the handover', reply_to: null, reply_ordinal: null, created_at: '2026-06-10T10:00:00Z' }], handovers: [handover()] }), 'p-1', 'co-1', 'ch-1');
 assert.deepEqual(elsewhere?.messages.map(message => message.author), ['person'], 'no row of a message that is not shown');
});
