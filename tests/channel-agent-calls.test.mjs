import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveChannelRuns } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #152 on the fake engine: a message that calls two Agents starts both Runs, the second only once the first has ended,
// and their replies stand in the order the Agents were named. The database's own calling rule, the order it keeps and a
// start driven twice are in supabase/tests/channel_agent_calls.sql; this is the run layer over it.
const hermes = { address: 'http://hermes:8642', key: 'test-only-key' };

/** A stand-in for the channel Run functions of one message, as #152 redefines them: one row per (message, Agent), the
 * second due only once the first closed, and a reply kept per place. */
function runDatabase(runs) {
 const replies = [];
 const row = message => runs.find(run => run.message === message && run.outcome === null && run.run_id === null)
  ?? null;
 return {
  replies,
  rpc: async (/** @type {string} */ name, /** @type {any} */ args) => {
   if (name === 'channel_runs_due') {
    const due = runs
     .filter(run => run.outcome === null)
     .filter(run => !runs.some(other => other.message === run.message && other.ordinal < run.ordinal && other.outcome === null))
     .filter(run => args.after == null || run.message > args.after)
     .sort((a, b) => a.message - b.message || a.ordinal - b.ordinal)
     .map(run => ({ message: run.message, run: run.run_id, profile: run.profile ?? 'default', ordinal: run.ordinal }));
    return { data: due, error: null };
   }
   if (name === 'begin_channel_start') {
    const next = row(args.message);
    if (!next) return { data: [], error: null };
    next.attempts = (next.attempts ?? 0) + 1;
    return { data: [{ attempt: next.attempts, company: '10000000-0000-0000-0000-000000000001', profile: next.profile ?? 'default',
     session: `s-${next.ordinal}`, input: `Sara: ${next.text ?? ''}`, instructions: null }], error: null };
   }
   if (name === 'pin_channel_run') return { data: { tools: null }, error: null };
   if (name === 'answer_channel_start') {
    if (args.run && runs.some(run => run.message === args.message && run.run_id === args.run && run.outcome === null))
     return { data: true, error: null };
    const target = row(args.message);
    if (!target) return { data: false, error: null };
    if (args.run) { target.run_id = args.run; return { data: true, error: null }; }
    if (args.attempt === 1 && target.attempts === 1) { target.outcome = 'failed'; return { data: true, error: null }; }
    return { data: false, error: null };
   }
   if (name === 'track_channel_permission') return { data: [], error: null };
   if (name === 'channel_show_card') return { data: { state: 'refused' }, error: null };
   if (name === 'close_channel_run') {
    const target = args.run === null || args.run === undefined
     ? runs.find(run => run.message === args.message && run.outcome === null)
     : runs.find(run => run.message === args.message && run.outcome === null && run.run_id === args.run);
    if (!target) return { data: false, error: null };
    target.outcome = args.run_outcome;
    if (args.run_outcome === 'completed') replies.push({ ordinal: target.ordinal, agent: target.agent_name, body: args.reply });
    return { data: true, error: null };
   }
   return { data: null, error: { message: `unexpected ${name}` } };
  },
 };
}

const called = text => [
 { message: 7, ordinal: 1, agent: 'a-ads', agent_name: 'Ads', text, outcome: null, run_id: null },
 { message: 7, ordinal: 2, agent: 'a-seo', agent_name: 'SEO', text, outcome: null, run_id: null },
];

test('two Agents named in one message answer one after the other, in the order they were named', async () => {
 const fake = fakeEngine();
 let replies = 0;
 fake.settings.reply = () => `Reply ${++replies}`;
 const runs = called('@Ads @SEO we need two scripts');
 const db = runDatabase(runs);
 // The first Run is held open on its first read: the second Agent must not start yet.
 fake.settings.pendingReads = 1;
 const first = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: fake.engineFor });
 assert.deepEqual(first, { started: 1, closed: 0 }, 'the first Agent is asked, and its answer is not in');
 assert.equal(runs[1].run_id, null, 'the second Agent waits for the first to end');
 assert.deepEqual(db.replies, [], 'and no reply is posted yet');
 // Once it answers, the second starts in the same pass and answers too.
 fake.settings.pendingReads = 0;
 const rest = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: fake.engineFor });
 assert.deepEqual(rest, { started: 1, closed: 2 }, 'the first ends, the second starts and ends');
 assert.deepEqual(db.replies.map(reply => [reply.ordinal, reply.agent, reply.body]), [
  [1, 'Ads', 'Reply 1'], [2, 'SEO', 'Reply 2'],
 ], 'one reply each, in the order the Agents were named');
 assert.deepEqual(fake.runs.map(run => run.key), ['channel:7', 'channel:7:2'], 'each Run has its own key');
 assert.deepEqual(runs.map(run => run.outcome), ['completed', 'completed']);
});

test('an Agent whose Run fails keeps its own failed line, and the other Agents of the message still answer', async () => {
 const fake = fakeEngine();
 let replies = 0;
 fake.settings.reply = () => `Reply ${++replies}`;
 const runs = called('@Ads @SEO write the scripts');
 const db = runDatabase(runs);
 // Every read of the first started Run says it failed, as the engine reports an Agent that could not answer.
 const engineFor = (/** @type {any} */ connection) => {
  const engine = fake.engineFor(connection);
  return { ...engine, read: async (/** @type {string} */ id) => id === fake.runs[0]?.id
   ? { state: 'failed', reply: null, session: null, usage: fake.settings.usage, toolCalls: [] }
   : engine.read(id) };
 };
 const driven = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: /** @type {any} */(engineFor) });
 assert.deepEqual(driven, { started: 2, closed: 2 }, 'both Runs are started and end');
 assert.deepEqual(runs.map(run => [run.agent_name, run.outcome]), [['Ads', 'failed'], ['SEO', 'completed']],
  'the first failed and the second answered anyway');
 assert.deepEqual(db.replies.map(reply => [reply.ordinal, reply.body]), [[2, 'Reply 1']],
  'the reply kept is the second Agent\'s, and its line says \"could not reply\" for the first (components/channel.test.tsx)');
});
