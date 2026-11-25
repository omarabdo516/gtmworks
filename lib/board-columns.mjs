// The Marketing board's six columns, in the approved design's order (design-reference/app.js COLS; ADR 0013).
// «مستنيك» (Waiting on you) comes first: rightmost in Arabic, leftmost in English.
export const boardColumns = ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];

// A board read of Cards: each Card with its chat's wait (#146), or null.
export const boardCardColumns = '*,wait:card_wait';

/**
 * The column a card shows in: "Waiting on you" while its chat waits on its person (#146; `wait`, read with the card as
 * `wait:card_wait`), else the column its status names (#676: a Card's status is its column). Its status stays as it is.
 * @param {{status?:string|null, wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}} card
 */
export function columnOf(card) {
 return card.wait ? 'waiting' : boardColumns.includes(card.status ?? '') ? /** @type {string} */ (card.status) : 'ideas';
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
 * The one state a Card shows beside its title (#678; design-reference-card: stateKey): a question, a hand or a permission
 * its chat waits on; a review (the Waiting column); an Agent at work on it now; or that it is assigned to the reader and
 * not yet Live or Done. '' when none applies. Waits, failures and the approved mark are the later tickets' (#681, #682).
 * @param {{status:string, wait?:{kind:string}|null, assignee_person?:string|null}} card
 * @param {{me:string, working?:boolean}} reader
 * @returns {'question'|'review'|'working'|'onyou'|''}
 */
export function cardSymbol(card, { me, working = false }) {
 if (card.wait) return 'question';
 if (card.status === 'waiting') return 'review';
 if (working) return 'working';
 // Waiting for other Cards (#682) that are not yet Live, Done or archived.
 if ((card.open_waits ?? 0) > 0) return 'waits';
 if (card.assignee_person === me && card.status !== 'live' && card.status !== 'done') return 'onyou';
 // Approved (#681): Planned on what an Owner or a Manager approved, while no later Version came in (one needs its own
 // Approval); a Card approved with no Version yet stays approved until its first one.
 if (card.status === 'planned' && card.approved_at && (card.approved_version ?? null) === (card.latest_version ?? null)) return 'approved';
 return '';
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
 * How many things wait on the reader: each Card once, however many of its rows wait, each other row, and each Card
 * assigned to them (#677) that is not already one of those. A question or a
 * hand counts once with its Card whether the board draws it as that Card or, its Card filtered out, as its own row.
 * @param {{kind:string, card_id:number|null, conversation_id:string|null}[]} items @param {{id:number}[]} [assigned]
 */
export function waitingCount(items, assigned = []) {
 const acted = new Set(items.filter(onCard).map(item => item.card_id));
 return acted.size + items.filter(item => !onCard(item)).length + assigned.filter(card => !acted.has(card.id)).length;
}

const mentionKinds = ['mention', 'channel_mention'];
/**
 * The reader's list under the bell (#677; design-reference-card: popHTML 'wl'): the Cards they can act on, each once
 * (`act`, the first of its rows), the Cards assigned to them that are not already among those (`assigned`, until Live or
 * Done), the requests waiting for their answer, and their mentions. waitingCount(items, assigned) is its number of rows.
 * @template {{kind:string, card_id:number|null, conversation_id:string|null}} I @template {{id:number}} C
 * @param {I[]} items @param {C[]} assigned
 */
export function bellRows(items, assigned) {
 const seen = new Set();
 const act = items.filter(item => onCard(item) && !seen.has(item.card_id) && seen.add(item.card_id));
 return {
  act,
  assigned: assigned.filter(card => !seen.has(card.id)),
  requests: items.filter(item => !onCard(item) && !mentionKinds.includes(item.kind)),
  mentions: items.filter(item => mentionKinds.includes(item.kind)),
 };
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
 * The reader's approvals with every Card whose assignee Agent (#677) is hidden from them left out, and its "Waiting on you" item with it
 * (#190): the board holds no such Card, so no count may name one. `seen` is the Agents the reader sees.
 * @template {{id:number, assignee_agent?:string|null}} C @template {{kind:string, id:number}} I
 * @param {C[]} cards @param {I[]} items @param {Set<string>} seen
 */
export function visibleApprovals(cards, items, seen) {
 const hidden = new Set(cards.filter(card => card.assignee_agent && !seen.has(card.assignee_agent)).map(card => card.id));
 return { cards: cards.filter(card => !hidden.has(card.id)), items: items.filter(item => item.kind !== 'approval' || !hidden.has(item.id)) };
}
