import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #287, #338: the database decides who may send (supabase/tests/conversation_roles.sql) and pins the company agent's
// profile. The run layer stores a Contributor's message as its turn (#764) and its one starter sends it to the install's
// Hermes on that profile, and a Viewer the database refuses stores nothing and never reaches the engine.
const hermes = { address: 'http://127.0.0.1:9', key: 'fake-engine-key' };
const owners = 'f9000000-0000-0000-0000-000000000001';
const agent = 'a9000000-0000-0000-0000-000000000001';
// The person's and the service's calls: the send stores the turn, the starter claims it, pins its run and records it.
function databases({ refused = false, listed = null } = {}) {
  const queued = []; const recorded = []; const turn = { started_at: null, failed_at: null, model_refused: false };
  const rpc = async (/** @type {string} */ name, /** @type {any} */ given) => {
    if (name === 'conversation_agent') return refused ? { data: null, error: { code: '42501' } } : { data: null, error: null };
    if (name === 'queue_conversation_turn') { if (!given.open_only) queued.push(given); return { data: { state: 'queued' }, error: null }; }
    if (name === 'queued_conversations') return { data: queued.length && !turn.started_at ? [{ conversation: 'c' }] : [], error: null };
    if (name === 'claim_conversation_turn') return { data: queued.length && !turn.started_at ? [{ company: 'co', agent: queued[0].agent, person: 'p', send_key: 'k', message: queued[0].message, connection: owners, profile: 'writer', note: null, retry: false, has_files: false }] : [], error: null };
    if (name === 'conversation_handover_agents') return { data: [], error: null };
    if (['pin_run', 'pin_run_history', 'pin_run_model', 'pin_lead_brief'].includes(name)) return { data: null, error: null };
    if (name === 'begin_turn_start') return { data: 1, error: null };
    if (name === 'record_conversation_turn') { recorded.push(given); turn.started_at = 'now'; return { data: true, error: null }; }
    return { data: null, error: { message: `unexpected ${name}` } };
  };
  const agents = { wanted: /** @type {string|null} */(null), table: '', select: () => agents, eq: (/** @type {string} */ column, /** @type {string} */ value) => { if (column === 'id') agents.wanted = value; return agents; },
    then: (/** @type {any} */ ok, /** @type {any} */ no) => Promise.resolve({ data: listed ?? [], error: null }).then(ok, no),
    maybeSingle: async () => ({ data: agents.table === 'conversation_queued_turns' ? turn : listed ? listed.find(each => each.id === agents.wanted) ?? null : { id: agent, instructions: null }, error: null }) };
  const from = (/** @type {string} */ table) => { agents.table = table; agents.wanted = null; return agents; };
  return { db: { rpc, from }, service: { rpc, from }, queued, recorded };
}

test('a Contributor\'s message goes to the agent\'s pinned profile, and a refused Viewer reaches no engine', async () => {
  const fake = fakeEngine();
  const contributor = databases();
  assert.deepEqual(await sendMessage(contributor.db, contributor.service, { company: 'co', conversation: 'c', sendKey: 'k', agent, message: 'Draft the teaser', hermes, engineFor: fake.engineFor }), { conversation: 'c' });
  assert.equal(contributor.queued.length, 1, 'the message is stored as its turn');
  assert.equal(fake.connections.length, 1);
  assert.deepEqual(fake.connections[0], { ...hermes, profile: 'writer' });
  const viewer = databases({ refused: true });
  assert.deepEqual(await sendMessage(viewer.db, viewer.service, { company: 'co', conversation: 'c', sendKey: 'k', agent, message: 'Draft the teaser', hermes, engineFor: fake.engineFor }), { code: '42501' });
  assert.equal(viewer.queued.length, 0, 'nothing is stored for the Viewer');
  assert.equal(fake.runs.length, 1, 'the engine was called once, for the Contributor only');
  assert.equal(fake.connections.length, 1, 'no Connection was opened for the Viewer');
});

// #171: a message sent after an Agent is picked in the empty chat starts the Conversation with that Agent. The composer
// sends the picked Agent's id, and the send stores that Agent's turn and starts its run.
test('a first message after an Agent is picked starts the Conversation with the picked Agent', async () => {
  const main = 'a9000000-0000-0000-0000-000000000001', picked = 'a9000000-0000-0000-0000-000000000002';
  const { db, service, queued, recorded } = databases({ listed: [{ id: main, name: 'Lead', is_default: true }, { id: picked, name: 'Meta Ads', is_default: false }] });
  const fake = fakeEngine();
  assert.deepEqual(await sendMessage(db, service, { company: 'co', conversation: 'c', sendKey: 'k', agent: picked, message: 'Plan the week', hermes, engineFor: fake.engineFor }), { conversation: 'c' });
  assert.deepEqual(queued.map(turn => turn.agent), [picked], 'the picked Agent is the one the Conversation starts with');
  assert.equal(recorded.length, 1);
  assert.equal(fake.runs.length, 1);
});
