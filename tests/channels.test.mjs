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
function database({ agents, runs = [], open = [], states = [], messages = [], notes = [], members = [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'viewer', invitation: null, email: null }] }) {
 const rows = select => String(select).includes('message_id') ? runs : select === 'agent_id' ? open : [];
 const chain = table => {
  const data = table === 'channels' ? { id: 'ch-1', company_id: 'co-1', kind: 'team', name: 'Launch week' }
   : table === 'channel_runs' ? rows(selectOf.get(table))
   : table === 'channel_messages' ? messages
   : table === 'channel_notes' ? notes
   : [];
  const link = {
   select: () => link, eq: () => link, is: () => link, gte: () => link, order: () => link, limit: () => link,
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
