import { boardColumns, columnOf, progressOf } from './board-columns.mjs';

const states = [['waiting', facts => facts.waitingMine], ['working', facts => facts.running], ['idle', () => true]];
/** @param {{waitingMine:boolean, running:boolean}} facts */
export const agentStatus = facts => states.find(([, holds]) => holds(facts))[0];

/**
 * @param {{id:number, title:string, stage_id:number}[]} cards
 * @param {{id:number, name:string, board_column?:string|null}[]} stages
 * @param {{card_id:number, title:string, done:boolean}[]} checklist
 * @param {{kind:string, title:string, body:string, card_id:number|null}[]} waitingItems
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
 * @template {{id:number, created_at:string}} T @param {T[]} rows @param {string} since @param {number} [n]
 */
export function latestActivity(rows, since, n = 3) {
 return rows.filter(row => Date.parse(row.created_at) >= Date.parse(since))
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, n);
}

/** @param {string} agent */
export const agentLogFilter = agent => `and(actor_kind.eq.agent,actor_id.eq.${agent}),agent_id.eq.${agent}`;
