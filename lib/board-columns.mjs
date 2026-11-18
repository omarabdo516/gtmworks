// The Marketing board's six columns, in the approved design's order (design-reference/app.js COLS; ADR 0013).
// «مستنيك» (Waiting on you) comes first: rightmost in Arabic, leftmost in English.
export const boardColumns = ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];

// A board read of Cards: each Card with its chat's wait (#146), or null.
export const boardCardColumns = '*,wait:card_wait';

/**
 * The column a card shows in: "Waiting on you" while its chat waits on its person (#146; `wait`, read with the card as
 * `wait:card_wait`), else its stage's column. Its stage stays as it is.
 * @param {{stage_id:number, wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}} card
 * @param {{id:number, board_column?:string|null}[]} stages
 */
export function columnOf(card, stages) {
 return card.wait ? 'waiting' : stages.find(stage => stage.id === card.stage_id)?.board_column || 'ideas';
}

/**
 * The chat's wait a card under "Waiting on you" shows one reader (design-reference: kcardHTML's waiting branch,
 * cardMine), or null when the reader's own approval or the card's stage says what it waits for: a wait on the reader
 * comes first, then their approval, then a wait on another person. `mine` is a wait on the reader; a reader who cannot
 * write reads it as the team's.
 * @param {{wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}} card
 * @param {{me:string, writer:boolean, approval:boolean}} reader
 */
export function chatWait(card, { me, writer, approval }) {
 const wait = card.wait;
 if (!wait || approval && wait.person !== me) return null;
 return { ...wait, mine: wait.person === me, team: !writer };
}

/**
 * Whether a "Waiting on you" row is drawn as its Card: an approval, or a question, hand or permission request (#165)
 * naming both its chat and that chat's Card (waiting_list since #146). Every other row is drawn on its own.
 * @param {{kind:string, card_id:number|null, conversation_id:string|null}} item
 */
export const onCard = item => item.kind === 'approval' || ['question', 'hand', 'permission'].includes(item.kind) && item.card_id != null && item.conversation_id != null;

/**
 * Where a "Waiting on you" row of a chat opens: its Conversation, at the handed step's or the permission request's card
 * (`#hand-<id>`, `#permission-<id>`), a channel's request in its channel (#165), or a channel mention in its channel at
 * the message it names (#200). Null for a row of no chat.
 * @param {string} slug @param {{kind:string, id:number, conversation_id:string|null, channel_id?:string|null, channel_message_id?:number|null}} item
 */
export function chatPlace(slug, item) {
 if (item.kind === 'channel_permission') return item.channel_id ? `/c/${slug}/channels/${item.channel_id}#permission-${item.id}` : null;
 if (item.kind === 'channel_mention') return item.channel_id && item.channel_message_id != null ? `/c/${slug}/channels/${item.channel_id}#mention-${item.channel_message_id}` : null;
 if (!item.conversation_id) return null;
 return `/c/${slug}/conversations/${item.conversation_id}${item.kind === 'hand' || item.kind === 'permission' ? `#${item.kind}-${item.id}` : ''}`;
}

/**
 * How many things wait on the reader: each Card once, however many of its rows wait, and each other row. A question or a
 * hand counts once with its Card whether the board draws it as that Card or, its Card filtered out, as its own row.
 * @param {{kind:string, card_id:number|null, conversation_id:string|null}[]} items
 */
export function waitingCount(items) {
 return new Set(items.filter(onCard).map(item => item.card_id)).size + items.filter(item => !onCard(item)).length;
}

const columnKeys = { waiting: 'boardColWaiting', ideas: 'boardColIdeas', planned: 'boardColPlanned', progress: 'boardColProgress', live: 'boardColLive', done: 'boardColDone' };
/** @param {string} column @param {boolean} writer */
export function columnLabel(column, writer) {
 return column === 'waiting' && !writer ? 'boardColWaitingTeam' : columnKeys[column] || 'boardColIdeas';
}

/**
 * @param {{id:number}} card
 * @param {{card_id:number, title:string, done:boolean}[]} checklist
 */
export function progressOf(card, checklist) {
 const items = checklist.filter(item => item.card_id === card.id);
 return items.length ? { pct: Math.round(100 * items.filter(item => item.done).length / items.length), next: items.find(item => !item.done)?.title } : null;
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
 * decision leaves "Waiting on you" by the decision, one its chat holds there (`byChat`, #146) by the chat's answer or
 * step done, and the column fills by itself, never by a drop.
 * @param {string} from @param {string} to @param {boolean} [byChat]
 * @returns {''|'same'|'decide'|'chat'|'waiting'}
 */
export function blockReason(from, to, byChat = false) {
 if (from === to) return 'same';
 if (from === 'waiting') return byChat ? 'chat' : 'decide';
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

// Whether a point lies in a box's edge bands, where a drag scrolls the box by itself: within share (dnd-kit's default
// 20%) of its width from its left or right edge, or of its height from its top or bottom, or past an edge. A band counts
// only on an axis the box can scroll.
export function inEdgeBand(box, point, scrolls = { x: true, y: true }, share = 0.2) {
 const x = box.width * share, y = box.height * share;
 return (scrolls.x && (point.x <= box.left + x || point.x >= box.right - x)) || (scrolls.y && (point.y <= box.top + y || point.y >= box.bottom - y));
}

/**
 * The reader's approvals with every Card of an Agent hidden from them left out, and its "Waiting on you" item with it
 * (#190): the board holds no such Card, so no count may name one. `seen` is the Agents the reader sees.
 * @template {{id:number, agent_id?:string|null}} C @template {{kind:string, id:number}} I
 * @param {C[]} cards @param {I[]} items @param {Set<string>} seen
 */
export function visibleApprovals(cards, items, seen) {
 const hidden = new Set(cards.filter(card => card.agent_id && !seen.has(card.agent_id)).map(card => card.id));
 return { cards: cards.filter(card => !hidden.has(card.id)), items: items.filter(item => item.kind !== 'approval' || !hidden.has(item.id)) };
}
