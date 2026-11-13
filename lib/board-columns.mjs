// The Marketing board's six columns, in the approved design's order (design-reference/app.js COLS; ADR 0013).
// «مستنيك» (Waiting on you) comes first: rightmost in Arabic, leftmost in English.
export const boardColumns = ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];

/**
 * The column a card shows in: its stage's column.
 * @param {{stage_id:number}} card
 * @param {{id:number, board_column?:string|null}[]} stages
 */
export function columnOf(card, stages) {
 return stages.find(stage => stage.id === card.stage_id)?.board_column || 'ideas';
}

/**
 * The column a keyboard move goes to: Shift+Arrow toward the reading direction's end is the next column.
 * Right-to-left, the next column sits to the left. Returns null at either end.
 * @param {string} column @param {string} key @param {boolean} rtl
 */
export function keyboardTarget(column, key, rtl) {
 if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
 const step = (key === 'ArrowLeft') === rtl ? 1 : -1;
 return boardColumns[boardColumns.indexOf(column) + step] ?? null;
}

/**
 * Why a drop on the board is refused before it reaches the server (the reference's blockReason): a card waiting for a
 * decision leaves "Waiting on you" by the decision, and the column fills by itself, never by a drop.
 * @param {string} from @param {string} to
 * @returns {''|'same'|'decide'|'waiting'}
 */
export function blockReason(from, to) {
 if (from === to) return 'same';
 if (from === 'waiting') return 'decide';
 if (to === 'waiting') return 'waiting';
 return '';
}

/**
 * The Agent a card belongs to: its first assignee that is an Agent identity, else its next actor when that is one.
 * @param {{id:number, next_actor:string|null}} card
 * @param {{card_id:number, person_id:string}[]} assignees
 * @param {Set<string>} agentIds
 */
export function cardAgent(card, assignees, agentIds) {
 const assigned = assignees.filter(a => a.card_id === card.id).map(a => a.person_id).find(id => agentIds.has(id));
 return assigned ?? (card.next_actor && agentIds.has(card.next_actor) ? card.next_actor : null);
}
