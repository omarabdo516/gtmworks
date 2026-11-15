// An Agent's details (#20, design-reference: renderDetailsPanel, agentStatus, tasksHTML, activityHTML, agentLogHTML).
// Pure rules: its state, its Cards in board order with the line under each, its latest activity and its log filter.
import { boardColumns, columnOf, progressOf } from './board-columns.mjs';

// The first state that holds wins: a Card of the Agent waiting on the reader, then a run still open, then idle.
const states = [['waiting', facts => facts.waitingMine], ['working', facts => facts.running], ['idle', () => true]];
/** @param {{waitingMine:boolean, running:boolean}} facts */
export const agentStatus = facts => states.find(([, holds]) => holds(facts))[0];

/**
 * The Agent's Cards in the board's column order, each with the line the reference draws under it: what waits on the
 * reader, the next checklist item and how far along a Card in progress is, or else its stage. A line is a catalogue key
 * with its values, or authored text.
 * @param {{id:number, title:string, stage_id:number}[]} cards
 * @param {{id:number, name:string, board_column?:string|null}[]} stages
 * @param {{card_id:number, title:string, done:boolean}[]} checklist
 * @param {{kind:string, title:string, body:string, card_id:number|null}[]} waitingItems the reader's own "Waiting on you"
 */
export function agentTasks(cards, stages, checklist, waitingItems) {
 return cards.map(card => {
  const column = columnOf(card, stages);
  const stage = stages.find(item => item.id === card.stage_id)?.name || '';
  const wait = waitingItems.find(item => item.card_id === card.id);
  const progress = column === 'progress' ? progressOf(card, checklist) : null;
  const line = wait?.kind === 'approval' && wait.body ? { key: 'boardWaitingYourOk', args: [wait.body] }
   : wait && wait.kind !== 'approval' ? { text: wait.title }
   : progress ? { text: `${progress.next || stage} · ${progress.pct}%` }
   : { text: stage };
  return { id: card.id, title: card.title, column, line, waiting: column === 'waiting' };
 }).sort((a, b) => boardColumns.indexOf(a.column) - boardColumns.indexOf(b.column));
}

/**
 * The newest rows since a moment, at most n of them, newest first.
 * @template {{id:number, created_at:string}} T @param {T[]} rows @param {string} since @param {number} [n]
 */
export function latestActivity(rows, since, n = 3) {
 return rows.filter(row => Date.parse(row.created_at) >= Date.parse(since))
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, n);
}

// The Agent's lines of the Company log, as the Activity log filters "who" by an Agent: what it did, and what was done
// to it (PostgREST `or` filter; lib/activity-log.mjs matchesFilters is the same rule in memory).
/** @param {string} agent */
export const agentLogFilter = agent => `and(actor_kind.eq.agent,actor_id.eq.${agent}),agent_id.eq.${agent}`;
