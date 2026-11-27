import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { randomUUID } from 'node:crypto';
import { commandList, jobCommandIn } from '../lib/composer-mentions.mjs';
import { sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #159, the job commands beside "/agent" (design-reference: CMDS, classifyWork): each belongs to the Agent a Member sees
// that was made from one ready-made role (lib/role-templates.mjs), and its line names that Agent. The Commands are the
// ones whose role has such an Agent, in the reference's order, then "/agent"; a role with no Agent the Member sees has
// none, so a hidden Agent's role lists nothing.
const commands = agents => commandList(agents).map(({ command, label, agent }) => [command, label, agent]);

test('a Company lists each role\'s command with the name of the Agent it was given, and one whose role has no Agent lists none', () => {
 // Lead was made by hand, not from a ready-made role, so it commands nothing.
 const lead = { id: 'l1', name: 'Lead' };
 const of = { meta: { id: 'a1', name: 'Reach', role: 'meta' }, numbers: { id: 'a2', name: 'Figures', role: 'numbers' }, hook: { id: 'a3', name: 'Critic', role: 'hook' }, writer: { id: 'a4', name: 'Writer', role: 'writer' } };
 // Four Companies, each with a different subset of the roles.
 assert.deepEqual(commands([lead, ...Object.values(of)]), [
  ['/campaign', 'plusCommandCampaign', 'Reach'],
  ['/report', 'plusCommandReport', 'Figures'],
  ['/review', 'plusCommandReview', 'Critic'],
  ['/article', 'plusCommandArticle', 'Writer'],
  ['/agent', 'plusCommandAgent', undefined],
 ]);
 assert.deepEqual(commands([lead, of.meta, of.hook]), [['/campaign', 'plusCommandCampaign', 'Reach'], ['/review', 'plusCommandReview', 'Critic'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([of.writer]), [['/article', 'plusCommandArticle', 'Writer'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([lead]), [['/agent', 'plusCommandAgent', undefined]], 'a Company with no Agent from a role lists only /agent');
 assert.deepEqual(commands([]), [['/agent', 'plusCommandAgent', undefined]]);
});

test('an Agent hidden from the Member is not in their list, so its role\'s command is not listed to them', () => {
 // The Agents a Member sees are what the server lists for them (hermes_agents_read); a hidden one never arrives here.
 const seen = [{ id: 'a1', name: 'Reach', role: 'meta' }];
 assert.deepEqual(commands(seen), [['/campaign', 'plusCommandCampaign', 'Reach'], ['/agent', 'plusCommandAgent', undefined]]);
 assert.deepEqual(commands([...seen, { id: 'a2', name: 'Critic', role: 'hook' }]).map(([command]) => command), ['/campaign', '/review', '/agent']);
});

test('two Agents made from one role: the first the Member\'s list draws answers, and neither adds a second command', () => {
 const list = commandList([{ id: 'a1', name: 'Reach', role: 'meta' }, { id: 'a2', name: 'Ads', role: 'meta' }]);
 assert.deepEqual(list.filter(({ command }) => command === '/campaign').map(({ agent }) => agent), ['Reach']);
 assert.equal(list.at(-1).command, '/agent');
});

// #358, #470, spec #831 (#844): a job command sent in the main Agent's Conversation becomes a Card given to the Agent of
// that role (lib/composer-mentions.mjs jobCommandIn, lib/lead-offer.mjs): the message is the main Agent's own turn, and
// its Run is asked to make one Card for that Agent with the Engine's own kanban_create, by the board name the Run's
// pinned brief gives it (pin_run_brief). No Handover is kept and no Run of the other Agent is started by gtmworks: the
// Engine's dispatcher starts it. Words that begin with no listed command of an Agent this person sees, or carry no job,
// are plain text and ask for no Card.
const company = '10000000-0000-0000-0000-000000000001';
const conversation = 'c9000000-0000-0000-0000-000000000001';
const lead = 'a9000000-0000-0000-0000-000000000001';
const reach = 'a9000000-0000-0000-0000-000000000002';
const faye = 'a9000000-0000-0000-0000-000000000003';
const hermes = { address: 'http://127.0.0.1:9', key: 'fake-engine-key' };
// The Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
engineRecord(company, hermes);
// Who the person sees and what each Agent was made from; the main Agent and the Agents of the four job roles.
const visible = [
 { id: lead, name: 'Lead', template: null, is_default: true },
 { id: reach, name: 'Reach', template: 'meta', is_default: false },
 { id: faye, name: 'Faye', template: null, is_default: false },
];
// The brief pin_run_brief pins for a Run of each Agent (supabase/tests/run_board_brief.sql proves the real one).
const reachBoard = 'ag-a9000000000000000000000000000002';
const briefs = {
 [lead]: { role: 'contributor', owner: 'Omar', main: true, self: 'co-rs', agents: [{ name: 'Faye', job: 'Writes.', board: 'ag-faye', role: null }, { name: 'Reach', job: 'Runs the Meta ads.', board: reachBoard, role: 'meta' }] },
 [faye]: { role: 'contributor', owner: 'Omar', main: false, self: 'ag-faye', agents: [{ name: 'Lead', job: 'General', board: 'co-rs', role: null }, { name: 'Reach', job: 'Runs the Meta ads.', board: reachBoard, role: 'meta' }] },
};
// A Conversation already there on `stored` (as the database keeps it), or a new chat of this Member opened with `chosen`.
// Every call the send makes is answered, and the ones that name an Agent are kept for the assertions.
function databases({ stored = null, chosen = null, agents = visible } = {}) {
 const calls = [];
 const query = () => {
  let columns = '';
  const chain = {
   select: (names) => { columns = names; return chain; },
   eq: (...args) => { calls.push(['read', ...args]); return chain; },
   in: () => chain,
   order: () => chain,
   maybeSingle: async () => { const found = columns === 'id,is_default' && agents.find(agent => agent.id === (stored || chosen)); return { data: found ? { id: found.id, instructions: null, is_default: found.is_default } : null, error: null }; },
   then: (resolve, reject) => Promise.resolve({ data: columns.includes('template') ? agents.map(({ id, name, template }) => ({ id, name, template })) : agents, error: null }).then(resolve, reject),
  };
  return chain;
 };
 const rpc = async (name, args) => {
  calls.push([name, args]);
  if (name === 'conversation_agent') return { data: stored, error: null };
  if (name === 'answer_question') return { data: 'none', error: null };
  // #764: the message is stored as its turn, and the one starter claims and starts it.
  if (name === 'queue_conversation_turn') { turns.push({ ...args, started: false }); return { data: { state: 'queued' }, error: null }; }
  const waiting = turns.find(turn => !turn.started);
  if (name === 'pin_run_brief') return { data: briefs[turns.find(turn => turn.message_key === args.message_key)?.agent] ?? null, error: null };
  if (name === 'queued_conversations') return { data: waiting ? [{ conversation }] : [], error: null };
  if (name === 'claim_conversation_turn') return { data: waiting ? [{ company, agent: waiting.agent, person: 'p', send_key: waiting.message_key, message: waiting.message, connection: 'f9000000-0000-0000-0000-000000000001', profile: 'writer', note: null, retry: false, has_files: false }] : [], error: null };
  if (['pin_run', 'pin_run_history', 'pin_run_model'].includes(name)) return { data: null, error: null };
  if (name === 'begin_turn_start') return { data: 1, error: null };
  if (name === 'record_conversation_turn') { const turn = turns.find(each => each.message_key === args.message_key); turn.started = true; return { data: true, error: null }; }
  return { data: null, error: { message: `unexpected ${name}` } };
 };
 const turns = [];
 const db = { rpc, from: (table) => { calls.push(['from', table]); return query(); } };
 // The starter's own reads: the claimed turn's Agent, and the turn once started.
 const read = { select: () => read, eq: () => read, maybeSingle: async () => ({ data: { instructions: null, started_at: 'now', failed_at: null }, error: null }) };
 return { db, service: { rpc, from: () => read }, calls };
}
const runsNamed = (calls, name) => calls.filter(call => call[0] === name).map(call => call[1]);
const asksForCard = /This message is the job command/;

test('a job command in the main Agent\'s Conversation is its own turn, whose Run is asked to make one Card for the Agent of its role, and no Handover is kept', async () => {
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: lead });
 const send = message => withEngineContract(fake.engineFor,()=>sendMessage(db, service, {company,conversation,sendKey: randomUUID(),message}));
 assert.deepEqual(await send('/campaign Launch the December ads'), { conversation });
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn').map(({ agent, message }) => [agent, message]), [[lead, '/campaign Launch the December ads']], 'the person\'s message is the main Agent\'s turn');
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign Launch the December ads']);
 const [run] = fake.runs;
 assert.ok(run.instructions.includes(`This message is the job command /campaign for Reach: make one card for Reach with kanban_create, its assignee ${reachBoard}, for this job: Launch the December ads\n`), run.instructions);
 assert.doesNotMatch(run.instructions, /hand_to_agent|gtmworks-tool/, 'no tool of gtmworks\'s own is described for it');
 assert.deepEqual(run.tools, [], 'and none is offered');
 assert.deepEqual(calls.filter(([name]) => /handover|hand_to_agent/.test(name)), [], 'no Handover is asked of the database');
});

test('a job command typed in another Agent\'s Conversation runs there once, as typed, and asks for no Card for the command', async () => {
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: faye });
 const send = message => withEngineContract(fake.engineFor,()=>sendMessage(db, service, {company,conversation,sendKey: randomUUID(),message}));
 assert.deepEqual(await send('/campaign Launch the December ads'), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign Launch the December ads']);
 assert.doesNotMatch(fake.runs[0].instructions, asksForCard, 'only the main Agent takes a job command');
 assert.match(fake.runs[0].instructions, new RegExp(`kanban_create[^.]*\\(yours is ag-faye\\)`), 'it may still give a job as a Card of its own accord');
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn').map(({ agent, message }) => [agent, message]), [[faye, '/campaign Launch the December ads']]);
});

test('a command with no job after it, or one no Agent of the Company was made from, asks for no Card', async () => {
 // A bare command names no job, and /report's role has no Agent here: both go to the main Agent as typed.
 const fake = fakeEngine(); const { db, service } = databases({ stored: lead });
 const send = message => withEngineContract(fake.engineFor,()=>sendMessage(db, service, {company,conversation,sendKey: randomUUID(),message}));
 assert.deepEqual(await send('/campaign '), { conversation });
 assert.deepEqual(await send('/report last week by channel'), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign ', '/report last week by channel']);
 for (const run of fake.runs) assert.doesNotMatch(run.instructions, asksForCard, run.input);
});

test('a job command typed in a new chat where it is not listed goes to the chat\'s Agent, as typed', async () => {
 // No Agent was made from numbers in this Company, so /report is not one of its Commands; the message still runs, as
 // typed, on the Agent the new chat was opened with.
 const fake = fakeEngine(); const { db, service, calls } = databases({ chosen: lead });
 const sent = await withEngineContract(fake.engineFor,()=>sendMessage(db, service, {company,conversation,sendKey: randomUUID(),agent: lead,message: '/report last week by channel'}));
 assert.deepEqual(sent, { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/report last week by channel']);
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn').map(({ agent, message }) => [agent, message]), [[lead, '/report last week by channel']]);
});

test('a message that begins with a listed command names the job after it and the Agent of its role', () => {
 const seen = [{ name: 'Lead' }, { name: 'Reach', role: 'meta' }, { name: 'Sage', role: 'writer' }];
 assert.deepEqual(jobCommandIn('/campaign Launch the December ads', seen), { command: '/campaign', role: 'meta', agent: 'Reach', goal: 'Launch the December ads' });
 assert.deepEqual(jobCommandIn('  /article  Arabic SEO guide \n', seen), { command: '/article', role: 'writer', agent: 'Sage', goal: 'Arabic SEO guide' });
 assert.equal(jobCommandIn('/campaign', seen), null, 'a command with no job after it hands nothing over');
 assert.equal(jobCommandIn('/campaigner Launch', seen), null, 'only a whole command word counts');
 assert.equal(jobCommandIn('/report last week', seen), null, 'a role with no Agent the person sees is not listed, so not handed over');
 assert.equal(jobCommandIn('/agent Make me an Agent', seen), null, 'and /agent stays a request to the main Agent');
});

