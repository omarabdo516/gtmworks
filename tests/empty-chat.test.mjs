import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerNames } from '../lib/company-owners.mjs';
import { emptyChatFacts } from '../lib/empty-chat.mjs';

// A database that answers each table with one fixed result, as a Supabase query resolves it.
const refused = { data: null, error: { message: 'permission denied' } };
const fake = answers => ({ from: table => {
 const query = { select: () => query, eq: () => query, is: () => query, then: (ok, no) => Promise.resolve(answers[table] ?? { data: [], error: null }).then(ok, no) };
 return query;
} });
const owners = { data: [{ people: { name: 'Sara' } }, { people: { name: 'Omar' } }, { people: null }], error: null };
const reader = { company: 'co-1', agent: 'ag-2', me: 'omar', alone: false, asks: false };

test('the active Owners are named in order, and a refused read is an error, never an empty list', async () => {
 assert.deepEqual(await ownerNames(fake({ members: owners }), 'co-1'), ['Omar', 'Sara']);
 await assert.rejects(ownerNames(fake({ members: refused }), 'co-1'), { message: 'permission denied' });
});

test('a Member reads the main Agent\'s empty chat with the Owners named, and a refused Owners read fails it', async () => {
 const facts = { ...reader, me: 'youssef', main: true, fresh: false, owner: false };
 assert.deepEqual(await emptyChatFacts(fake({ members: owners }), facts), { state: 'main', reader: 'member', owners: ['Omar', 'Sara'] });
 await assert.rejects(emptyChatFacts(fake({ members: refused }), facts), { message: 'permission denied' });
 assert.deepEqual(await emptyChatFacts(fake({ members: refused }), { ...facts, me: 'omar', owner: true }), { state: 'main', reader: 'owner', owners: [] }, 'an Owner reads no Owners');
});

test('an Agent the reader has not written to is new, one they have is known, and a refused count fails the chat', async () => {
 const facts = { ...reader, main: false, fresh: false, owner: true };
 const team = { members: { data: [{ person_id: 'omar', role: 'owner' }, { person_id: 'sara', role: 'contributor' }], error: null }, member_agent_access: { data: [{ person_id: 'sara' }], error: null } };
 assert.deepEqual(await emptyChatFacts(fake({ ...team, conversations: { count: 0, error: null } }), facts), { state: 'new', works: 'team', owners: [] });
 assert.deepEqual(await emptyChatFacts(fake({ ...team, member_agent_access: { data: [], error: null }, conversations: { count: 0, error: null } }), facts), { state: 'new', works: 'you', owners: [] });
 assert.deepEqual(await emptyChatFacts(fake({ ...team, conversations: { count: 2, error: null } }), facts), { state: 'known', owners: [] });
 await assert.rejects(emptyChatFacts(fake({ ...team, conversations: { count: null, error: { message: 'count refused' } } }), facts), { message: 'count refused' });
});

test('whether only the Owner sees a new Agent is read, never guessed: a refused Members or access read fails the chat', async () => {
 const facts = { ...reader, main: false, fresh: false, owner: true };
 const counted = { conversations: { count: 0, error: null } };
 await assert.rejects(emptyChatFacts(fake({ ...counted, members: refused }), facts), { message: 'permission denied' });
 await assert.rejects(emptyChatFacts(fake({ ...counted, members: { data: [], error: null }, member_agent_access: refused }), facts), { message: 'permission denied' });
});
