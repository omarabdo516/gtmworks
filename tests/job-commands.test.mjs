import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandList, jobCommandIn } from '../lib/composer-mentions.mjs';
import { answerQuestion, decidePermission, sendMessage } from '../lib/conversation-runs.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
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

// #358: a job command sent in the main Agent's Conversation hands its job to the Agent of that role in the same chat
// (lib/composer-mentions.mjs jobCommandIn, lib/conversation-runs.mjs): the command is gtmworks's own, so no Engine Run of
// the Lead's is started for it, and the target Agent's Run answers the person. Words that begin with no listed command
// of an Agent this person sees, or carry no job, are plain text and run on the Conversation's Agent as typed (item 4).
const company = '10000000-0000-0000-0000-000000000001';
const conversation = 'c9000000-0000-0000-0000-000000000001';
const lead = 'a9000000-0000-0000-0000-000000000001';
const reach = 'a9000000-0000-0000-0000-000000000002';
const faye = 'a9000000-0000-0000-0000-000000000003';
const hermes = { address: 'http://127.0.0.1:9', key: 'fake-engine-key' };
// Who the person sees and what each Agent was made from; the main Agent and the Agents of the four job roles.
const visible = [
 { id: lead, name: 'Lead', template: null, is_default: true },
 { id: reach, name: 'Reach', template: 'meta', is_default: false },
 { id: faye, name: 'Faye', template: null, is_default: false },
];
// A Conversation already there on `stored` (as the database keeps it), or a new chat of this Member opened with `chosen`.
// Every call the send makes is answered, and the ones that name an Agent are kept for the assertions.
function databases({ stored = null, chosen = null, agents = visible, handed = true } = {}) {
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
  if (name === 'pin_lead_brief') return { data: null, error: null };
  if (name === 'command_handover') return { data: handed, error: null };
  // #764: the message is stored as its turn, and the one starter claims and starts it.
  if (name === 'queue_conversation_turn') { turns.push({ ...args, started: false }); return { data: { state: 'queued' }, error: null }; }
  const waiting = turns.find(turn => !turn.started);
  if (name === 'queued_conversations') return { data: waiting ? [{ conversation }] : [], error: null };
  if (name === 'claim_conversation_turn') return { data: waiting ? [{ company, agent: waiting.agent, person: 'p', send_key: waiting.message_key, message: waiting.message, connection: 'f9000000-0000-0000-0000-000000000001', profile: 'writer', note: null, retry: false, has_files: false }] : [], error: null };
  if (name === 'conversation_handover_agents') return { data: [], error: null };
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

test('a job command in the main Agent\'s Conversation is handed to the Agent of its role, and the Lead starts no Run', async () => {
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: lead });
 const send = message => sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message, hermes, engineFor: fake.engineFor });
 assert.deepEqual(await send('/campaign Launch the December ads'), { conversation });
 assert.deepEqual(runsNamed(calls, 'command_handover'), [{ conversation, c: company, agent: lead, message_key: runsNamed(calls, 'command_handover')[0].message_key, message: '/campaign Launch the December ads', role: 'meta', goal: 'Launch the December ads' }]);
 assert.deepEqual(fake.runs, [], 'no Run of the Lead\'s: the command hands the job over itself');
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn'), [], 'and no turn is stored for the Lead');
 assert.deepEqual(runsNamed(calls, 'record_conversation_turn'), [], 'the database keeps the person\'s message with the handover');
});

test('a job command typed in another Agent\'s Conversation runs there once, as typed, and no handoff starts', async () => {
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: faye });
 const send = message => sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message, hermes, engineFor: fake.engineFor });
 assert.deepEqual(await send('/campaign Launch the December ads'), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign Launch the December ads']);
 assert.equal(fake.runs.length, 1, 'one Run per message, and no Run for the Agent the command names elsewhere');
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn').map(({ agent, message }) => [agent, message]), [[faye, '/campaign Launch the December ads']]);
 assert.deepEqual(runsNamed(calls, 'command_handover'), [], 'a command is handed over only in the main Agent\'s Conversation');
});

test('a command with no job after it, or one no Agent of the Company was made from, is sent as plain text', async () => {
 // A bare command names no job to hand over, and /report's role has no Agent here: both go to the Lead as typed.
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: lead });
 const send = message => sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message, hermes, engineFor: fake.engineFor });
 assert.deepEqual(await send('/campaign '), { conversation });
 assert.deepEqual(await send('/report last week by channel'), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign ', '/report last week by channel']);
 assert.deepEqual(runsNamed(calls, 'command_handover'), []);
});

test('a job command handed over but refused by the database falls back to the Conversation\'s own Run, as typed', async () => {
 // The Agent the command names is hidden from this person, or has no profile: the command is no handover, and the
 // message is sent as typed rather than lost.
 const fake = fakeEngine(); const { db, service, calls } = databases({ stored: lead, handed: false });
 assert.deepEqual(await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message: '/campaign Launch the December ads', hermes, engineFor: fake.engineFor }), { conversation });
 assert.deepEqual(fake.runs.map(run => run.input), ['/campaign Launch the December ads']);
 assert.deepEqual(runsNamed(calls, 'queue_conversation_turn').map(({ agent }) => agent), [lead]);
});

test('a job command typed in a new chat where it is not listed goes to the chat\'s Agent, as typed', async () => {
 // No Agent was made from numbers in this Company, so /report is not one of its Commands; the message still runs, as
 // typed, on the Agent the new chat was opened with.
 const fake = fakeEngine(); const { db, service, calls } = databases({ chosen: lead });
 const sent = await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), agent: lead, message: '/report last week by channel', hermes, engineFor: fake.engineFor });
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

// The database's side of #358 as its functions keep it (supabase/tests/command_handovers.sql proves the real ones): the
// person's message with its handover row, the worker's two legs, and the target's words kept as the chat's answer.
function handedDatabases({ more = null } = {}) {
 const calls = [];
 const targetSession = 'd9000000-0000-0000-0000-000000000001';
 const targetProfile = 'ag-09000000000000000000000000000002';
 const kept = { message: null, handover: null, agentMessage: null, end: null };
 const query = () => {
  let columns = '';
  const chain = { select: (names) => { columns = names; return chain; }, eq: () => chain, in: () => chain, order: () => chain,
   maybeSingle: async () => ({ data: columns === 'id,is_default' ? { id: lead, instructions: null, is_default: true } : null, error: null }),
   then: (resolve, reject) => Promise.resolve({ data: columns.includes('template') ? visible.map(({ id, name, template }) => ({ id, name, template })) : visible, error: null }).then(resolve, reject) };
  return chain;
 };
 const rpc = async (name, args) => {
  calls.push([name, args]);
  const answered = more?.(name, args, kept);
  if (answered) return answered;
  if (name === 'conversation_agent') return { data: lead, error: null };
  if (name === 'answer_question') return { data: 'none', error: null };
  if (name === 'command_handover') {
   kept.message = { author: 'person', body: args.message, run_id: `command:${args.message_key}` };
   kept.handover = { id: 7, state: 'waiting', conversation: args.conversation, run_id: kept.message.run_id, from: args.agent, to: reach, goal: args.goal, target_run: null };
   return { data: true, error: null };
  }
  // A command's Agent that asks nothing keeps no card (#470): each read of its Run is tracked, and hands nothing back.
  if (name === 'track_handover_question' || name === 'track_handover_permission') return { data: [], error: null };
  // No Run Stop ended a handover on is left to stop (#478).
  if (name === 'stopped_runs_open') return { data: [], error: null };
  if (name === 'handover_runs_stopping') return { data: [], error: null };
  if (name === 'handovers_due') return { data: kept.handover && kept.handover.state !== 'done' ? [{ id: 7, state: kept.handover.state, conversation, run: kept.handover.state === 'target' ? kept.handover.target_run : null, profile: targetProfile, attempt: 0, company }] : [], error: null };
  // begin_handover's words for a command still say its Agent cannot ask (#358); the driver asks the database for the
  // command's job as it reads now (#470, command_handover_job), and the Run is asked that.
  if (name === 'begin_handover') return { data: [{ state: 'waiting', attempt: 1, company, profile: targetProfile, session: targetSession, input: `You cannot ask a question.\n\nThe job:\n${kept.handover.goal}`, instructions: 'Run the ads.', targets: null }], error: null };
  if (name === 'command_handover_job') return { data: `They read this chat: ask them.\n\nThe job:\n${kept.handover.goal}`, error: null };
  if (name === 'answer_handover') { kept.handover.target_run = args.run; kept.handover.state = 'target'; return { data: true, error: null }; }
  if (name === 'close_handover_target') {
   kept.end = { run: kept.handover.run_id, outcome: args.run_outcome };
   if (args.run_outcome === 'completed') kept.agentMessage = { author: 'agent', agent_id: reach, author_name: 'Reach', body: args.words, run: args.run };
   kept.handover.state = 'done';
   return { data: true, error: null };
  }
  return { data: null, error: { message: `unexpected ${name}` } };
 };
 // The starter's own reads of a turn for the Lead: its Agent's instructions, and when the turn was queued.
 const read = { select: () => read, eq: () => read, maybeSingle: async () => ({ data: { instructions: null, queued_at: null }, error: null }) };
 return { db: { rpc, from: () => query() }, service: { rpc, from: () => read }, calls, kept };
}

test('on the fake engine a command sent to the Lead hands the job over, and the chat\'s reply comes from that Agent', async () => {
 // #358's check: the command is sent, the handover row is kept, and the answer the person reads is the target Agent's.
 // A long article keeps its whole reply in the chat, past the summary a #317 handover carries.
 const fake = fakeEngine(); fake.settings.reply = input => `Reach did it: ${input.split('\n').at(-1)}`.padEnd(9000,' .');
 const { db, service, kept } = handedDatabases(); const sendKey = randomUUID();
 assert.deepEqual(await sendMessage(db, service, { company, conversation, sendKey, message: '/campaign Launch the December ads', hermes, engineFor: fake.engineFor }), { conversation });
 assert.deepEqual(kept.message, { author: 'person', body: '/campaign Launch the December ads', run_id: `command:${sendKey}` });
 assert.deepEqual([kept.handover.from, kept.handover.to, kept.handover.goal], [lead, reach, 'Launch the December ads'], 'the handoff row: the Lead to the Agent of /campaign\'s role, with the job');
 assert.deepEqual(fake.runs, [], 'the Lead starts no Run: the command hands the job over itself');
 // The worker moves the handover: the target's job in a session of its own for this chat, then its reply kept as the
 // chat's message from it.
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.deepEqual(fake.runs.map(run => [run.conversation, run.input]), [[`d9000000-0000-0000-0000-000000000001`, 'They read this chat: ask them.\n\nThe job:\nLaunch the December ads']],
  'asked the job as the command hands it now: the person may be asked back (#470)');
 assert.deepEqual(kept.agentMessage, { author: 'agent', agent_id: reach, author_name: 'Reach', body: `Reach did it: Launch the December ads`.padEnd(9000,' .'), run: fake.runs[0].id }, 'the reply comes from that Agent, in this chat, whole');
 assert.deepEqual(kept.end, { run: `command:${sendKey}`, outcome: 'completed' }, 'and the person\'s own message stops waiting');
});

// #470: the cards of a job command's Agent, as the database keeps them on the command's own Run in the chat
// (supabase/tests/command_handover_cards.sql proves the real track_handover_question and track_handover_permission):
// the question or request the Agent waits on is kept once, open, until its person answers it, and each answer is handed
// to the worker to deliver while the Run waits; a request never offers always (it is no standing allow of the chat's Agent).
function chatCards() {
 const cards = [];
 const claims = (kind, run) => cards.filter(card => card.kind === kind && card.run === run && card.state === 'sending' && !card.handed)
  .map(card => { card.handed = true; return kind === 'question' ? { card: card.id, question: card.call, answer: card.content.answer } : { card: card.id, permission: card.call, choice: card.content.choice }; });
 const keep = (kind, args, kept, content) => {
  if (kept.handover.state !== 'target' || kept.handover.target_run !== args.run) return { data: [], error: null };
  if (args.asking && !args.ended && !cards.some(card => card.call === args.asking.id)) cards.push({ id: cards.length + 1, kind, run: kept.handover.run_id, call: args.asking.id, content, state: 'open' });
  return { data: claims(kind, kept.handover.run_id), error: null };
 };
 const more = (name, args, kept) => {
  if (name === 'track_handover_question') return keep('question', args, kept, args.asking && { question: args.asking.text, choices: args.asking.choices });
  if (name === 'track_handover_permission') return keep('permission', args, kept, args.asking && { description: args.asking.description, command: args.asking.command, choices: args.asking.choices.filter(choice => choice !== 'always') });
  if (name === 'answer_question') {
   const card = cards.find(each => each.id === args.card && each.kind === 'question');
   if (!card || card.state !== 'open') return { data: card ? 'taken' : 'none', error: null };
   Object.assign(card, { state: 'sending', content: { ...card.content, answer: card.content.choices[args.choice] } });
   return { data: 'claimed', error: null };
  }
  if (name === 'decide_permission') {
   const card = cards.find(each => each.id === args.card && each.kind === 'permission');
   if (!card.content.choices.includes(args.choice)) return { data: null, error: { code: '22023' } };
   Object.assign(card, { state: 'sending', content: { ...card.content, choice: args.choice } });
   return { data: { state: 'decided', choice: args.choice, at: 'now', first: true }, error: null };
  }
  if (name === 'settle_question' || name === 'settle_permission') { cards.find(card => card.id === args.card).state = args.verdict; return { data: args.verdict, error: null }; }
  // No Run of the chat's own Agent is open: the command's Run is the handover's.
  if (name === 'open_conversation_runs') return { data: [], error: null };
  return null;
 };
 return { cards, more };
}

test('on the fake engine a /campaign handover\'s question is drawn in the chat, and the person\'s answer reaches that Run and closes it', async () => {
 // #470's first check: the target asks, its card is the command's Run's, the person picks a choice, and it is delivered.
 const fake = fakeEngine();
 fake.settings.questions = () => [{ text: 'Which audience first?', choices: ['Parents', 'Students'] }];
 fake.settings.reply = (input, answers) => `Reach launched it for ${answers[0]}.`;
 const { cards, more } = chatCards(); const { db, service, kept } = handedDatabases({ more }); const sendKey = randomUUID();
 await sendMessage(db, service, { company, conversation, sendKey, message: '/campaign Launch the December ads', hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.deepEqual(cards.map(({ kind, run, content, state }) => ({ kind, run, content, state })), [{ kind: 'question', run: `command:${sendKey}`, content: { question: 'Which audience first?', choices: ['Parents', 'Students'] }, state: 'open' }],
  'the question is drawn in the chat as the card of the command\'s Run, and waits for the person');
 assert.deepEqual(fake.answers, [], 'nobody answered it for them');
 assert.equal(kept.agentMessage, null, 'and the Agent waits on it');
 assert.deepEqual(await answerQuestion(db, service, { company, conversation, card: cards[0].id, choice: 0, answerKey: randomUUID(), hermes, engineFor: fake.engineFor }), { state: 'claimed' });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.deepEqual(fake.answers.map(({ run, text }) => [run, text]), [[fake.runs[0].id, 'Parents']], 'the person\'s answer reaches that Run');
 assert.equal(cards[0].state, 'answered', 'and closes the question');
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.equal(kept.agentMessage?.body, 'Reach launched it for Parents.', 'the Agent goes on with it and answers the person');
});

test('on the fake engine a /campaign handover\'s request to act shows its choices in the chat, and the choice is delivered', async () => {
 // #470's first check, its second half: once or deny (never always), and the person's yes reaches the Run.
 const fake = fakeEngine();
 fake.settings.permissions = () => [{ description: 'Publish the ad set', command: 'ads publish --set december' }];
 fake.settings.reply = (input, answers, choices) => `Published (${choices[0]}).`;
 const { cards, more } = chatCards(); const { db, service, kept } = handedDatabases({ more });
 await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message: '/campaign Launch the December ads', hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.deepEqual(cards.map(({ kind, content, state }) => ({ kind, content, state })), [{ kind: 'permission', content: { description: 'Publish the ad set', command: 'ads publish --set december', choices: ['once', 'deny'] }, state: 'open' }],
  'the request shows its choices in the chat, and nothing denied it');
 assert.deepEqual(fake.permits, []);
 const delivered = [];
 assert.equal((await decidePermission(db, service, { company, conversation, card: cards[0].id, choice: 'once', hermes, engineFor: fake.engineFor, later: work => { delivered.push(work()); } })).state, 'decided');
 await Promise.all(delivered);
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.deepEqual(fake.permits.map(({ run, choice }) => [run, choice]), [[fake.runs[0].id, 'once']], 'the choice is delivered to that Run');
 assert.equal(cards[0].state, 'decided');
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.equal(kept.agentMessage?.body, 'Published (once).');
});

test('on the fake engine Lead\'s next Run in the chat carries the command\'s job and what that Agent answered', async () => {
 // #470's second check: the brief pinned with Lead's next Run lists the chat's command jobs and their answers, as the
 // database builds it from the handover (pin_lead_brief's `commands`).
 const fake = fakeEngine(); fake.settings.reply = input => input.includes('The job:') ? 'Three ad sets, 30 days, EGP 9,000.' : 'Five it is.';
 const turns = [];
 const more = (name, args, kept) => {
  if (name === 'queue_conversation_turn') { turns.push({ ...args, started: false }); return { data: { state: 'queued' }, error: null }; }
  const waiting = turns.find(turn => !turn.started);
  if (name === 'queued_conversations') return { data: waiting ? [{ conversation }] : [], error: null };
  if (name === 'claim_conversation_turn') return { data: waiting ? [{ company, agent: lead, person: 'p', send_key: waiting.message_key, message: waiting.message, connection: 'f9000000-0000-0000-0000-000000000001', profile: 'co-10000000000000000000000000000001', note: null, retry: false, has_files: false }] : [], error: null };
  if (name === 'conversation_handover_agents') return { data: [], error: null };
  if (['pin_run', 'pin_run_history', 'pin_run_model'].includes(name)) return { data: null, error: null };
  if (name === 'pin_lead_brief') return { data: { role: 'owner', owner: 'Omar', agents: [{ name: 'Reach', job: 'Meta ads' }],
   commands: kept.handover?.state === 'done' ? [{ agent: 'Reach', job: kept.handover.goal, outcome: 'completed', answer: kept.agentMessage.body }] : [] }, error: null };
  if (name === 'begin_turn_start') return { data: 1, error: null };
  if (name === 'record_conversation_turn') { turns.find(turn => turn.message_key === args.message_key).started = true; return { data: true, error: null }; }
  return null;
 };
 const { db, service, kept } = handedDatabases({ more });
 await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message: '/campaign Launch the December ads', hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 await driveHandovers(service, { hermes, engineFor: fake.engineFor });
 assert.equal(kept.agentMessage.body, 'Three ad sets, 30 days, EGP 9,000.');
 assert.deepEqual(await sendMessage(db, service, { company, conversation, sendKey: randomUUID(), message: 'make it five ad sets', hermes, engineFor: fake.engineFor }), { conversation });
 const next = fake.runs.at(-1);
 assert.equal(next.input, 'make it five ad sets', 'the next message goes to Lead');
 assert.match(next.instructions, /The person gave Reach this job with a command:\nLaunch the December ads\nReach answered them:\nThree ad sets, 30 days, EGP 9,000\./,
  'its pinned instructions hold the job and the answer');
});
