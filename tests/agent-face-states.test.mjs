import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentFaceStates, seeAgentFailure, wakeAgent } from '../lib/agent-face-states.ts';

// The database's answer to one call, as the signed-in reader (supabase/tests/agent_face_states.sql proves what it says).
const database = (/** @type {Record<string, {data:unknown, error:unknown}>} */ answers) => {
 /** @type {{name:string, args:unknown}[]} */
 const calls = [];
 return { calls, rpc: async (/** @type {string} */ name, /** @type {unknown} */ args) => { calls.push({ name, args }); return answers[name] ?? { data: null, error: { message: 'missing' } }; } };
};
const row = (/** @type {Record<string, unknown>} */ over) => ({ agent: 'a1', state: 'idle', working: false, waiting: false, failed_at: null, failed_conversation: null,
 failed_channel: null, failed_card: null, last_work_at: null, created_at: '2026-10-01T00:00:00Z', woken_at: null, ...over });

test('each Agent the reader sees carries its one state and where it failed; one the read left out is idle', async () => {
 const db = database({ agent_face_states: { error: null, data: [
  row({ agent: 'a1', state: 'stuck', failed_at: '2026-11-24T10:00:00Z', failed_channel: 'ch-1', last_work_at: '2026-11-24T09:58:00Z' }),
  row({ agent: 'a2', state: 'waiting', working: true, waiting: true }),
  row({ agent: 'a3', state: 'asleep' }),
 ] } });
 const faces = await agentFaceStates(/** @type {any} */ (db), 'co-1');
 assert.deepEqual(db.calls, [{ name: 'agent_face_states', args: { c: 'co-1' } }]);
 assert.equal(faces.available, true);
 assert.deepEqual(faces.of('a1'), { state: 'stuck', working: false, waiting: false, failedAt: '2026-11-24T10:00:00Z', failedIn: { channel: 'ch-1' },
  lastWorkAt: '2026-11-24T09:58:00Z', createdAt: '2026-10-01T00:00:00Z', wokenAt: null });
 assert.equal(faces.of('a2').state, 'waiting');
 assert.equal(faces.of('a2').working, true);
 assert.equal(faces.of('a3').state, 'asleep');
 assert.deepEqual(faces.states, { a1: 'stuck', a2: 'waiting', a3: 'asleep' }, 'what the sidebar\'s poll carries to the browser: the state alone');
 assert.deepEqual(faces.of('hidden'), { state: 'idle', working: false, waiting: false, failedAt: null, failedIn: null, lastWorkAt: null, createdAt: null, wokenAt: null });
});

test('a read that fails says so, and every face is idle rather than a guess', async () => {
 const faces = await agentFaceStates(/** @type {any} */ (database({ agent_face_states: { data: null, error: { message: 'down' } } })), 'co-1');
 assert.equal(faces.available, false);
 assert.equal(faces.of('a1').state, 'idle');
 assert.deepEqual(faces.states, {});
});

test('a failure in a Conversation or a channel names that place', async () => {
 const faces = await agentFaceStates(/** @type {any} */ (database({ agent_face_states: { error: null, data: [
  row({ agent: 'a1', state: 'stuck', failed_at: '2026-11-24T10:00:00Z', failed_conversation: 'cv-1' }),
  row({ agent: 'a2', state: 'stuck', failed_at: '2026-11-24T10:00:00Z', failed_channel: 'ch-1' }),
 ] } })), 'co-1');
 assert.deepEqual(faces.of('a1').failedIn, { conversation: 'cv-1' });
 assert.deepEqual(faces.of('a2').failedIn, { channel: 'ch-1' });
});

test('opening a place marks what failed there seen, for the reader, and says how many it cleared', async () => {
 const db = database({ see_agent_failure: { data: 1, error: null } });
 assert.equal(await seeAgentFailure(/** @type {any} */ (db), 'co-1', { channel: 'ch-1' }), 1);
 assert.equal(await seeAgentFailure(/** @type {any} */ (db), 'co-1', { card: 7 }), 1);
 assert.deepEqual(db.calls, [{ name: 'see_agent_failure', args: { c: 'co-1', channel: 'ch-1' } }, { name: 'see_agent_failure', args: { c: 'co-1', card: 7 } }]);
 assert.equal(await seeAgentFailure(/** @type {any} */ (database({})), 'co-1', { conversation: 'cv-1' }), null, 'a call that failed clears nothing it can name');
});

test('opening an Agent\'s chat wakes it for the reader', async () => {
 const db = database({ wake_agent: { data: true, error: null } });
 assert.equal(await wakeAgent(/** @type {any} */ (db), 'co-1', 'a1'), true);
 assert.deepEqual(db.calls, [{ name: 'wake_agent', args: { c: 'co-1', agent: 'a1' } }]);
 assert.equal(await wakeAgent(/** @type {any} */ (database({ wake_agent: { data: false, error: null } })), 'co-1', 'hidden'), false);
 assert.equal(await wakeAgent(/** @type {any} */ (database({})), 'co-1', 'a1'), false);
});
