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
// all a channel's reader gets.
function database({ agents, runs = [], open = [], states = [], messages = [] }) {
 const rows = select => String(select).includes('message_id') ? runs : select === 'agent_id' ? open : [];
 const chain = table => {
  const data = table === 'channels' ? { id: 'ch-1', company_id: 'co-1', kind: 'team', name: 'Launch week' }
   : table === 'channel_runs' ? rows(selectOf.get(table))
   : table === 'channel_messages' ? messages
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
  if (name === 'channel_members') return { data: [{ person: 'p-1', name: 'Omar', role: 'owner' }, { person: 'p-2', name: 'Sara Adel', role: 'viewer' }], error: null };
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
