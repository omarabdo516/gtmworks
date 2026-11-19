import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerChannelQuestion, driveChannelRuns, markChannelHandDone } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #149 on the fake engine: a channel Run's question is kept as the team's card and is not answered with nothing; any
// Member who may write claims it, the first claim is the one kept and delivered, and the same Run goes on to its reply.
// A handed step's "Done it" is kept once and starts the Agent's Run that picks up, as a Run of that channel. The
// database's own rules, per Role and for everyone outside the channel, are in supabase/tests/channel_question_hand_cards.sql.
const hermes = { address: 'http://hermes:8642', key: 'test-only-key' };
const company = '10000000-0000-0000-0000-000000000001';
const channel = '69000000-0000-0000-0000-000000000001';

/** The channel Run functions of one channel, as #149 keeps them, with the question's claim and the hand's press. */
function runDatabase() {
 const runs = [{ message: 7, ordinal: 1, agent: 'a-ads', agent_name: 'Ads', profile: 'ads', input: 'Omar: @Ads plan it', outcome: null, run_id: null }];
 /** @type {Map<number,{id:number,message:number,run:string,question:string,content:any,state:string,key:string|null,by:string|null,at:string|null}>} */
 const cards = new Map();
 const replies = [];
 const sent = [];
 let nextCard = 1;
 const row = () => runs.find(run => run.outcome === null && run.run_id === null) ?? null;
 const sending = run => [...cards.values()].filter(card => card.run === run && card.state === 'sending');
 const open = run => [...cards.values()].find(card => card.run === run && card.state === 'open');
 return {
  cards, replies, sent, runs,
  rpc: async (/** @type {string} */ name, /** @type {any} */ args) => {
   if (name === 'channel_runs_due') {
    return { data: runs.filter(run => run.outcome === null && (args.just_message == null || run.message === args.just_message))
      .map(run => ({ message: run.message, run: run.run_id, profile: run.profile, ordinal: run.ordinal })), error: null };
   }
   if (name === 'begin_channel_start') {
    const next = row(); if (!next) return { data: [], error: null };
    next.attempts = (next.attempts ?? 0) + 1;
    return { data: [{ attempt: next.attempts, company, profile: next.profile, session: `s-${next.message}`, input: next.input, instructions: null }], error: null };
   }
   if (name === 'pin_channel_run') return { data: { tools: null }, error: null };
   if (name === 'channel_handover_agents') return { data: [], error: null };
   if (name === 'answer_channel_start') { const next = row(); if (!next) return { data: false, error: null }; next.run_id = args.run; return { data: true, error: null }; }
   if (name === 'track_channel_question') {
    const kept = open(args.run);
    if (args.asking && !args.ended && !kept) {
     cards.set(nextCard, { id: nextCard, message: args.message, run: args.run, question: args.asking.id, content: { question: args.asking.text, choices: args.asking.choices, multiple: args.asking.multiple }, state: 'open', key: null, by: null, at: null });
     nextCard += 1;
    }
    if (args.ended) for (const card of cards.values()) if (card.run === args.run && card.state === 'open') card.state = 'closed';
    return { data: sending(args.run).map(card => ({ card: card.id, question: card.question, answer: card.content.answer })), error: null };
   }
   if (name === 'track_channel_permission') return { data: [], error: null };
   if (name === 'settle_channel_question') {
    const card = cards.get(args.card);
    if (!card) return { data: null, error: null };
    if (card.state === 'sending' || args.verdict === 'answered' && card.state === 'closed' && 'answer' in card.content) card.state = args.verdict;
    return { data: card.state, error: null };
   }
   if (name === 'channel_show_card') {
    const id = nextCard++; cards.set(id, { id, message: args.message, run: args.run, question: args.call, content: args.content, state: args.kind === 'hand' ? 'open' : 'shown', key: null, by: null, at: null });
    return { data: { state: 'shown', card: id }, error: null };
   }
   if (name === 'close_channel_run') {
    const target = runs.find(run => run.outcome === null && (args.run == null || run.run_id === args.run));
    if (!target) return { data: false, error: null };
    target.outcome = args.run_outcome;
    if (args.run_outcome === 'completed') replies.push({ message: target.message, body: args.reply });
    return { data: true, error: null };
   }
   return { data: null, error: { message: `unexpected ${name}` } };
  },
  // A Member's own session: the claim keeps the first answer and the press keeps the first "Done it".
  member: (person) => ({
   rpc: async (/** @type {string} */ name, /** @type {any} */ args) => {
    if (name === 'answer_channel_question') {
     const card = cards.get(args.card);
     if (!card) return { data: null, error: { code: 'P0002' } };
     if (card.key === args.answer_key) return { data: 'claimed', error: null };
     if (card.state !== 'open') return { data: card.state === 'closed' ? 'closed' : 'taken', error: null };
     card.state = 'sending'; card.key = args.answer_key; card.by = person;
     card.content = { ...card.content, answer: card.content.choices[args.choice] }; card.at = '2026-06-10T09:41:00Z';
     return { data: 'claimed', error: null };
    }
    if (name === 'mark_channel_hand_done') {
     const card = cards.get(args.card);
     if (!card) return { data: null, error: { code: 'P0002' } };
     if (card.state === 'done') return { data: { state: 'done', at: card.at, first: false }, error: null };
     card.state = 'done'; card.by = person; card.at = '2026-06-10T09:41:00Z';
     const told = 40 + runs.length;
     runs.push({ message: told, ordinal: 1, agent: 'a-ads', agent_name: 'Ads', profile: 'ads', input: 'Sara: Done it', outcome: null, run_id: null });
     return { data: { state: 'done', at: card.at, first: true, message: told }, error: null };
    }
    return { data: null, error: { message: `unexpected ${name}` } };
   },
  }),
 };
}

const queued = () => { /** @type {Promise<void>[]} */ const work = []; return { later: (/** @type {()=>Promise<void>} */ deliver) => { work.push(deliver()); }, settle: () => Promise.all(work) }; };

test('a channel question is kept as the team card, not answered with nothing, and the first of two Members wins', async () => {
 const fake = fakeEngine();
 fake.settings.questions = () => [{ text: '  Which angle first?\n', choices: ['Graduates', 'Parents'] }];
 fake.settings.reply = (input, answers) => `Reply to ${input} (${answers.join(', ')})`;
 const db = runDatabase();
 const first = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: fake.engineFor });
 assert.deepEqual(first, { started: 1, closed: 0 }, 'the Run is asked and waits on its question');
 assert.deepEqual([...db.cards.values()].map(card => [card.content.question, card.content.choices, card.state]), [['Which angle first?', ['Graduates', 'Parents'], 'open']], 'the question is kept once, as the card keeps it');
 assert.deepEqual(fake.answers, [], 'nothing is answered with nothing, so no answer is never a yes');

 // Two Members pick at once, each with their own key: one claim is kept, the other is told it was taken.
 const work = queued();
 const answers = await Promise.all([
  answerChannelQuestion(db.member('p-3'), /** @type {any} */(db), { company, channel, card: 1, choice: 1, answerKey: 'a1000000-0000-0000-0000-000000000001', hermes, engineFor: fake.engineFor, later: work.later }),
  answerChannelQuestion(db.member('p-5'), /** @type {any} */(db), { company, channel, card: 1, choice: 0, answerKey: 'a1000000-0000-0000-0000-000000000002', hermes, engineFor: fake.engineFor, later: work.later }),
 ]);
 assert.deepEqual(answers.map(answer => answer.state).sort(), ['claimed', 'taken'], 'the first answer wins and a second, by anyone, changes nothing');
 await work.settle();
 assert.equal(fake.answers.length, 1, 'one answer reaches the Engine');
 assert.equal(fake.answers[0].text, db.cards.get(1)?.content.answer, 'and it is the one the record kept');
 assert.equal(db.cards.get(1)?.state, 'answered', 'the card reads answered for everyone');
 const closed = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: fake.engineFor });
 assert.deepEqual(closed, { started: 0, closed: 1 }, 'the same Run goes on to its reply');
 assert.deepEqual(db.replies.map(reply => reply.body), [`Reply to Omar: @Ads plan it (${db.cards.get(1)?.content.answer})`]);
});

test('a channel Run is offered the handed step, and "Done it" is kept once and starts the Agent\'s Run that picks up', async () => {
 const fake = fakeEngine();
 fake.settings.toolCalls = () => [{ id: 'call_hand', name: 'hand_over', arguments: { title: 'Publish the article', line: 'The draft is ready in WordPress', app: 'WordPress', rows: [] } }];
 const db = runDatabase();
 const driven = await driveChannelRuns(/** @type {any} */(db), { hermes, engineFor: fake.engineFor });
 assert.deepEqual(driven, { started: 1, closed: 1 });
 const hand = [...db.cards.values()].find(card => card.state === 'open');
 assert.ok(hand, 'the step is kept open for the team');
 assert.equal(hand.content.app, 'WordPress');

 const work = queued();
 const pressed = await markChannelHandDone(db.member('p-3'), /** @type {any} */(db), { company, channel, card: hand.id, hermes, engineFor: fake.engineFor, later: work.later });
 assert.equal(pressed.first, true);
 await work.settle();
 const second = await markChannelHandDone(db.member('p-5'), /** @type {any} */(db), { company, channel, card: hand.id, hermes, engineFor: fake.engineFor, later: work.later });
 assert.equal(second.first, false, 'a second press by another Member changes nothing');
 await work.settle();
 assert.equal(db.runs.length, 2, 'one Run of the channel picks the step up');
 assert.equal(fake.runs.length, 2, 'and it starts as soon as the press is kept');
 assert.equal(fake.runs.at(-1)?.key, `channel:${pressed.message}`, 'under the message the press wrote, as a Run of the channel');
 assert.equal(db.replies.at(-1)?.message, pressed.message, 'its reply lands under that message');
});
