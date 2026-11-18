import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #287, #338: the database decides who may send (supabase/tests/conversation_roles.sql) and pins the company agent's
// profile. The run layer sends a Contributor's message to the install's Hermes on that profile, and a Viewer the
// database refuses never reaches the engine.
const hermes = { address: 'http://127.0.0.1:9', key: 'fake-engine-key' };
const owners = 'f9000000-0000-0000-0000-000000000001';
const agent = 'a9000000-0000-0000-0000-000000000001';
function databases(refused) {
  const rpc = async name => {
    if (name === 'conversation_agent') return refused ? { data: null, error: { code: '42501' } } : { data: null, error: null };
    if (name === 'reserve_conversation_turn') return { data: { state: 'reserved', connection: owners, profile: 'writer', note: null }, error: null };
    if (['pin_run', 'pin_run_history', 'pin_run_model'].includes(name)) return { data: null, error: null };
    if (name === 'begin_start') return { data: 1, error: null };
    if (name === 'send_conversation_message') return { data: true, error: null };
    return { data: null, error: { message: `unexpected ${name}` } };
  };
  const chain = data => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data, error: null }) }; return c; };
  const db = { rpc, from: () => chain({ id: agent, instructions: null }) };
  const service = { rpc };
  return { db, service };
}
const send = ({ db, service }, engineFor) => sendMessage(db, service, { company: 'co', conversation: 'c', sendKey: 'k', agent, message: 'Draft the teaser', hermes, engineFor });

test('a Contributor\'s message goes to the agent\'s pinned profile, and a refused Viewer reaches no engine', async () => {
  const fake = fakeEngine();
  assert.deepEqual(await send(databases(false), fake.engineFor), { conversation: 'c' });
  assert.equal(fake.connections.length, 1);
  assert.deepEqual(fake.connections[0], { ...hermes, profile: 'writer' });
  assert.deepEqual(await send(databases(true), fake.engineFor), { code: '42501' });
  assert.equal(fake.runs.length, 1, 'the engine was called once, for the Contributor only');
  assert.equal(fake.connections.length, 1, 'no Connection was opened for the Viewer');
});
