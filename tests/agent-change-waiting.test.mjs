import test from 'node:test';
import assert from 'node:assert/strict';
import { readWaitingChanges, countWaitingChanges, waitingChangeFor, waitingChangeHref } from '../lib/agent-change-waiting.mjs';

// #178: which waiting proposal Settings shows for an Agent, and where "Open the proposal" goes (design-reference:
// chgPendingFor and the handler sov-thread).
const change = (id, agent, askedBy) => ({ id, agent, conversation: `talk-${id}`, askedBy, change: 'model', setting: null, value: 'openai/gpt-5', by: 'Lead' });

test('an Agent shows its oldest waiting proposal, and an Agent with none shows none', () => {
 const changes = [change(3, 'ads', 'owner'), change(5, 'ads', 'manager'), change(4, 'writer', 'owner')];
 assert.equal(waitingChangeFor(changes, 'ads')?.id, 3);
 assert.equal(waitingChangeFor(changes, 'writer')?.id, 4);
 assert.equal(waitingChangeFor(changes, 'analyst'), null);
});

test('"Open the proposal" opens the Conversation that holds the card for its own person, and the Owner\'s item in Waiting on you otherwise', () => {
 assert.equal(waitingChangeHref('rs', change(3, 'ads', 'omar'), { person: 'omar', owner: true }), '/c/rs/conversations/talk-3#change-3');
 assert.equal(waitingChangeHref('rs', change(5, 'ads', 'sara'), { person: 'omar', owner: true }), '/c/rs/approvals#change-5');
 assert.equal(waitingChangeHref('rs', change(5, 'ads', 'sara'), { person: 'sara', owner: false }), '/c/rs/conversations/talk-5#change-5');
 // Nobody else is ever given a proposal by the database, and would get no link to one.
 assert.equal(waitingChangeHref('rs', change(5, 'ads', 'sara'), { person: 'mona', owner: false }), null);
});

// A stand-in for the reader's database client: what it was asked, and the rows it answers.
const client = (answer) => { const asked = []; const chain = { select: (...a) => (asked.push(['select', ...a]), chain), eq: (...a) => (asked.push(['eq', ...a]), chain), in: (...a) => (asked.push(['in', ...a]), chain), order: (...a) => (asked.push(['order', ...a]), chain), then: (resolve, reject) => Promise.resolve(answer).then(resolve, reject) };
 return { asked, from: (table) => (asked.push(['from', table]), chain) }; };

test('Settings reads the waiting and applying proposals of the Company as the reader, oldest first, with the proposing Agent\'s name', async () => {
 const db = client({ data: [{ id: 2, agent_id: 'ads', conversation_id: 'c-2', asked_by: 'sara', change: 'setting', setting: 'timezone', value: 'Africa/Cairo', created_at: 'x', by: { name: 'Ads' } }], error: null });
 assert.deepEqual(await readWaitingChanges(db, 'co'), [{ id: 2, agent: 'ads', conversation: 'c-2', askedBy: 'sara', change: 'setting', setting: 'timezone', value: 'Africa/Cairo', by: 'Ads' }]);
 assert.deepEqual(db.asked.filter(([kind]) => kind !== 'select'), [['from', 'agent_change_proposals'], ['eq', 'company_id', 'co'], ['in', 'state', ['waiting', 'applying']], ['order', 'created_at'], ['order', 'id']]);
 const counted = client({ count: 2, error: null });
 assert.equal(await countWaitingChanges(counted, 'co'), 2);
 assert.deepEqual(counted.asked.filter(([kind]) => kind === 'in'), [['in', 'state', ['waiting', 'applying']]]);
 await assert.rejects(readWaitingChanges(client({ data: null, error: new Error('refused') }), 'co'), /refused/);
});
