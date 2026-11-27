// The Marketing board's six columns, in the approved design's order (design-reference/app.js COLS; ADR 0013).
// «مستنيك» (Waiting on you) comes first: rightmost in Arabic, leftmost in English.
export const boardColumns = ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];

// The board of spec #831: a Card is a task on the Company's Engine's Kanban board, and the screen groups the Engine's
// statuses into five columns, here and nowhere else, so Omar may redraw them in one place (ADR 0033: no Live column).
// An archived Card, or a status this table does not name, is on no column.
export const cardColumns = ['waiting', 'ideas', 'planned', 'progress', 'done'];
const columnStatuses = { waiting: ['blocked', 'review'], ideas: ['triage'], planned: ['todo', 'scheduled', 'ready'], progress: ['running'], done: ['done'] };
/** @param {string} status @returns {string|null} */
export const columnOfStatus = status => cardColumns.find(column => columnStatuses[column].includes(status)) ?? null;
// The Engine's dispatcher stops a Card after this many failed Runs in a row (hermes_cli/kanban_db_dispatch.py
// DEFAULT_FAILURE_LIMIT) and blocks it: that block is no question for a person to answer.
const failureLimit = 2;
/**
 * The one symbol a Card shows beside its title (design-reference-card: stateKey), from what the board read says of it:
 * working now, a question, a review, stopped after failures, stopped, or waiting for `count` other Cards; null for none.
 * A Card is stopped while it is parked where the dispatcher never starts it (`scheduled`): a person's Stop holds it there
 * (#838), as an Agent's kanban_schedule does, until someone lets it go on.
 * @param {{status:string, failures:number, parents:number}} card
 */
export function cardSymbol({ status, failures, parents }) {
 if (status === 'running') return { kind: 'working' };
 if (status === 'scheduled') return { kind: 'stopped' };
 if (status === 'blocked') return { kind: failures >= failureLimit ? 'failed' : 'question' };
 if (status === 'review') return { kind: 'review' };
 if (status === 'todo' && parents > 0) return { kind: 'waits', count: parents };
 return null;
}
/**
 * The board's Cards column by column: "Waiting on you" newest first (ADR 0013), every other column in the Engine's own
 * order (its dispatch order, and Done newest finished first).
 * @template {{column:string, createdAt:number|null}} C @param {C[]} cards @returns {C[]}
 */
export function orderCards(cards) {
 return cardColumns.flatMap(column => {
  const list = cards.filter(card => card.column === column);
  return column === 'waiting' ? list.map((card, at) => ({ card, at })).sort((a, b) => (b.card.createdAt ?? 0) - (a.card.createdAt ?? 0) || a.at - b.at).map(({ card }) => card) : list;
 });
}

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
 * (`#hand-<id>`, `#permission-<id>`), a channel's request, question or handed step in its channel (#165, #149), at the
 * card's own place (`#permission-<id>`, `#question-<id>`, `#hand-<id>`), or a channel mention in its channel at the
 * message it names (#200). Null for a row of no chat.
 * @param {string} slug @param {{kind:string, id:number, conversation_id:string|null, channel_id?:string|null, channel_message_id?:number|null}} item
 */
export function chatPlace(slug, item) {
 if (item.kind === 'channel_permission') return item.channel_id ? `/c/${slug}/channels/${item.channel_id}#permission-${item.id}` : null;
 if (item.kind === 'channel_question' || item.kind === 'channel_hand')
  return item.channel_id ? `/c/${slug}/channels/${item.channel_id}#${item.kind === 'channel_hand' ? 'hand' : 'question'}-${item.id}` : null;
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

// A Card's saved place inside its column (#174): the smaller number is nearer the column's top, and two Cards that share
// a place keep the older one (its id) first.
const byPlace = (a, b) => Number(a.board_order ?? 0) - Number(b.board_order ?? 0) || a.id - b.id;
// "Waiting on you" is one list per person, newest first (ADR 0013): its Cards keep that order, and no place of their own.
const newestFirst = (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id;

/**
 * The order one column's Cards are drawn in: "Waiting on you" newest first (ADR 0013), every other column by each Card's
 * saved place (#174), the older Card first on a tie.
 * @template {{id:number, board_order?:number|null, created_at?:string|null}} C
 * @param {C[]} cards the Cards of one column @param {string} column @returns {number[]}
 */
export function orderColumn(cards, column) {
 return [...cards].sort(column === 'waiting' ? newestFirst : byPlace).map(card => card.id);
}

/**
 * Where a Card lands when Shift with Arrow Up or Arrow Down moves it one place down its own column: the id of the Card it
 * lands above, null at the column's end, or undefined when it does not move (the top Card going up, the last going down).
 * @param {number[]} ids the column's Cards in their drawn order @param {number} id @param {string} key
 */
export function placeByOne(ids, id, key) {
 const at = ids.indexOf(id);
 if (at < 0) return undefined;
 if (key === 'ArrowUp') return at > 0 ? ids[at - 1] : undefined;
 if (key === 'ArrowDown') return at < ids.length - 1 ? ids[at + 2] ?? null : undefined;
 return undefined;
}

/**
 * A column's order once a Card is placed above `before` (null: at the column's end), in the same column or another.
 * @param {number[]} ids the column's Cards in their drawn order, the moved Card included when it is already there
 * @param {number} id @param {number|null} before
 */
export function placeOrder(ids, id, before) {
 const rest = ids.filter(other => other !== id);
 const at = before == null ? rest.length : rest.indexOf(before);
 rest.splice(at < 0 ? rest.length : at, 0, id);
 return rest;
}

/**
 * Whether a drop would move the Card at all: a drop on the Card's own place changes nothing (design-reference: dragEnd).
 * @param {number[]} ids @param {number} id @param {number|null} before
 */
export function placeChanges(ids, id, before) {
 return placeOrder(ids, id, before).join() !== ids.join();
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

// Whether a point lies in a box's edge bands, where a drag scrolls the box by itself: within share (dnd-kit's default
// 20%) of its width from its left or right edge, or of its height from its top or bottom, or past an edge. A band counts
// only on an axis the box can scroll.
export function inEdgeBand(box, point, scrolls = { x: true, y: true }, share = 0.2) {
 const x = box.width * share, y = box.height * share;
 return (scrolls.x && (point.x <= box.left + x || point.x >= box.right - x)) || (scrolls.y && (point.y <= box.top + y || point.y >= box.bottom - y));
}

// The axes a box scrolls by itself, from how much room it has on each: the one it has more room on, both when each has
// the same room, none when it has none. dnd-kit can pair a box with a measurement taken for another box for an instant
// (#247); a box that merely spills a pixel on the other axis must not be handed that axis then (#249): the board runs
// sideways, and a finger in its spill scrolled it until this counted only the room it really has.
export function scrollAxes(room) {
 const x = Math.max(0, room.x), y = Math.max(0, room.y);
 if (x === y) return { x: x > 0, y: x > 0 };
 return { x: x > y, y: y > x };
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
