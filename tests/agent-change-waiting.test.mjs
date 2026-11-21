import test from 'node:test';
import assert from 'node:assert/strict';
import { readWaitingChange, readWaitingAgents, countWaitingChanges, waitingChangeHref } from '../lib/agent-change-waiting.mjs';

// #178: what Settings reads of the waiting proposals, and where "Open the proposal" goes (design-reference:
// chgPendingFor and the handler sov-thread).
const change = (id, askedBy) => ({ id, conversation: `talk-${id}`, askedBy });

test('"Open the proposal" opens the Conversation that holds the card for its own person, and the Owner\'s item in Waiting on you otherwise', () => {
 assert.equal(waitingChangeHref('rs', change(3, 'omar'), { person: 'omar', owner: true }), '/c/rs/conversations/talk-3#change-3');
 assert.equal(waitingChangeHref('rs', change(5, 'sara'), { person: 'omar', owner: true }), '/c/rs/approvals#change-5');
 assert.equal(waitingChangeHref('rs', change(5, 'sara'), { person: 'sara', owner: false }), '/c/rs/conversations/talk-5#change-5');
 // Nobody else is ever given a proposal by the database, and would get no link to one.
 assert.equal(waitingChangeHref('rs', change(5, 'sara'), { person: 'mona', owner: false }), null);
});

// A stand-in for the reader's database client: what it was asked, and the answer of each read in turn.
const client = (...answers) => { const asked = []; let read = 0;
 const chain = new Proxy({}, { get: (_, name) => name === 'then' ? (resolve, reject) => Promise.resolve(answers[Math.min(read++, answers.length - 1)]).then(resolve, reject)
  : (...a) => (asked.push([name, ...a]), chain) });
 return { asked, from: (table) => (asked.push(['from', table]), chain) }; };
const filters = asked => asked.filter(([kind]) => kind !== 'select');

test('an Agent\'s page reads its oldest waiting or applying proposal, with the proposing Agent\'s name, and none without one', async () => {
 const db = client({ data: { id: 2, agent_id: 'ads', conversation_id: 'c-2', asked_by: 'sara', change: 'setting', setting: 'timezone', value: 'Africa/Cairo', by: { name: 'Ads' } }, error: null });
 assert.deepEqual(await readWaitingChange(db, 'co', 'ads'), { id: 2, agent: 'ads', conversation: 'c-2', askedBy: 'sara', change: 'setting', setting: 'timezone', value: 'Africa/Cairo', by: 'Ads' });
 assert.deepEqual(filters(db.asked), [['from', 'agent_change_proposals'], ['eq', 'company_id', 'co'], ['eq', 'agent_id', 'ads'], ['in', 'state', ['waiting', 'applying']],
  ['order', 'created_at'], ['order', 'id'], ['limit', 1], ['maybeSingle']]);
 assert.equal(await readWaitingChange(client({ data: null, error: null }), 'co', 'lead'), null);
 await assert.rejects(readWaitingChange(client({ data: null, error: new Error('refused') }), 'co', 'ads'), /refused/);
});

test('the Agents list marks every Agent with one, reading page after page past the API\'s row limit', async () => {
 const full = { data: [...Array(999).fill({ agent_id: 'ads' }), { agent_id: 'writer' }], error: null };
 const db = client(full, { data: [{ agent_id: 'analyst' }], error: null });
 assert.deepEqual([...await readWaitingAgents(db, 'co')].sort(), ['ads', 'analyst', 'writer']);
 assert.deepEqual(db.asked.filter(([kind]) => kind === 'range'), [['range', 0, 999], ['range', 1000, 1999]]);
 await assert.rejects(readWaitingAgents(client({ data: null, error: new Error('refused') }), 'co'), /refused/);
});

test('the number on Agents is the exact count of the waiting and applying proposals', async () => {
 const db = client({ count: 1001, error: null });
 assert.equal(await countWaitingChanges(db, 'co'), 1001);
 assert.deepEqual(filters(db.asked), [['from', 'agent_change_proposals'], ['eq', 'company_id', 'co'], ['in', 'state', ['waiting', 'applying']]]);
});
