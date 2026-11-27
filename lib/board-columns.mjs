// The board of spec #831: a Card is a task on the Company's Engine's Kanban board, and the screen groups the Engine's
// statuses into five columns, here and nowhere else, so Omar may redraw them in one place (ADR 0033: no Live column).
// An archived Card, or a status this table does not name, is on no column.
export const cardColumns = ['waiting', 'ideas', 'planned', 'progress', 'done'];
const columnStatuses = { waiting: ['blocked', 'review'], ideas: ['triage'], planned: ['todo', 'scheduled', 'ready'], progress: ['running'], done: ['done'] };
/** @param {string} status @returns {string|null} */
export const columnOfStatus = status => cardColumns.find(column => columnStatuses[column].includes(status)) ?? null;
// A person's move into a column (#837) asks the Engine for the status that column means: Ideas `triage`, Planned `ready`,
// or `todo` while a Card it waits for is open (where the Engine keeps a waiting Card, as `ready` is refused there), and
// Done `done`. In progress and Waiting on you are states of the work itself and have none: the Engine refuses `running`,
// and takes `blocked` or `review` only from a Card that is ready or running, which would leave it waiting on no question
// and no work to review.
/** @param {string} column @param {boolean} waits @returns {'triage'|'ready'|'todo'|'done'|null} */
export const statusOfColumn = (column, waits) => column === 'ideas' ? 'triage' : column === 'planned' ? (waits ? 'todo' : 'ready') : column === 'done' ? 'done' : null;
/**
 * Where Shift with Left or Right moves a Card on the Engine's board: the next column in the reading direction a person
 * moves a Card into, past In progress and Waiting on you; null at the end.
 * @param {string} column @param {string} key @param {boolean} rtl @returns {string|null}
 */
export function moveTarget(column, key, rtl) {
 if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
 const step = (key === 'ArrowLeft') === rtl ? 1 : -1;
 for (let at = cardColumns.indexOf(column) + step; at >= 0 && at < cardColumns.length; at += step) if (statusOfColumn(cardColumns[at], false)) return cardColumns[at];
 return null;
}
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

/**
 * Whom a Card of the Engine's board waits on (spec #831, #841), worked out from the board read and gtmworks's row beside
 * the Card, never kept: a review only on those who may decide it, every Administrator and Manager (`leads`); a Card
 * stopped on the Engine (`blocked`) on its Member Assignee, else the person who made it, else every Administrator and
 * Manager; a Card given to a Member on them until it is done. Null when it waits on no one. `members` holds the active
 * Members: a former Member is waited on by nobody, and the Card goes to the next in line.
 * @param {{status:string, person:string|null, maker:string|null}} card @param {Set<string>} members
 * @returns {{person:string}|{leads:true}|null}
 */
export function waitsOn({ status, person, maker }, members) {
 const member = person && members.has(person) ? person : null;
 if (status === 'review') return { leads: true };
 if (status === 'blocked') {
  const who = member ?? (maker && members.has(maker) ? maker : null);
  return who ? { person: who } : { leads: true };
 }
 return member && status !== 'done' && columnOfStatus(status) ? { person: member } : null;
}

/**
 * Whether what a Card waits on (waitsOn) is the reader: them by name, or the Administrators and Managers and they are one.
 * @param {{person:string}|{leads:true}|null} waits @param {{me:string, role:string|null|undefined}} reader
 */
export function waitsOnReader(waits, { me, role }) {
 if (!waits) return false;
 return 'person' in waits ? waits.person === me : role === 'owner' || role === 'manager';
}

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

const columnKeys = { waiting: 'boardColWaiting', ideas: 'boardColIdeas', planned: 'boardColPlanned', progress: 'boardColProgress', done: 'boardColDone' };
/** @param {string} column @param {boolean} writer */
export function columnLabel(column, writer) {
 return column === 'waiting' && !writer ? 'boardColWaitingTeam' : columnKeys[column] || 'boardColIdeas';
}

/**
 * A column's order once a Card is placed above `before` (null: at the column's end), in the same column or another.
 * @param {(string|number)[]} ids the column's Cards in their drawn order, the moved Card included when it is already there
 * @param {string|number} id @param {string|number|null} before
 */
export function placeOrder(ids, id, before) {
 const rest = ids.filter(other => other !== id);
 const at = before == null ? rest.length : rest.indexOf(before);
 rest.splice(at < 0 ? rest.length : at, 0, id);
 return rest;
}

/**
 * Whether a drop would move the Card at all: a drop on the Card's own place changes nothing (design-reference: dragEnd).
 * @param {(string|number)[]} ids @param {string|number} id @param {string|number|null} before
 */
export function placeChanges(ids, id, before) {
 return placeOrder(ids, id, before).join() !== ids.join();
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
