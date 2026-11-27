import { cardColumns } from './board-columns.mjs';

// The list and the calendar (spec #831, #845): two more ways to read the board a Member reads (lib/company-board.mjs),
// never a read of their own. The list sorts and filters the board's Cards; the calendar places each on its publishing
// day. A filter is what the board's own answer says of a Card: its Assignee (an Agent, a Member, or nobody), its column
// (its status as the board groups it), its Project (the Engine's `tenant`) and the month of its publishing date.

/** @typedef {{id:string,title:string,column:string,agent:{id:string,name:string}|null,person?:{id:string,name:string}|null,project?:string|null,publishOn?:string|null}} ViewCard */
/** @typedef {{assignee?:string,column?:string,project?:string,month?:string}} ViewFilter */

/** Who a Card is given to, as a filter names it: `agent:<id>`, `member:<id>`, or `none`. @param {ViewCard} card */
const assigneeKey = card => card.agent ? `agent:${card.agent.id}` : card.person ? `member:${card.person.id}` : 'none';

/** The Assignees and Projects the Cards hold, each once and by name, for the filters' choices. @param {ViewCard[]} cards */
export function viewChoices(cards) {
 /** @type {Map<string,string>} */
 const assignees = new Map();
 for (const card of cards) { const who = card.agent ?? card.person; if (who) assignees.set(assigneeKey(card), who.name); }
 return {
  assignees: [...assignees].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
  projects: [...new Set(cards.flatMap(card => card.project ? [card.project] : []))].sort((a, b) => a.localeCompare(b)),
 };
}

/** The Cards every filter keeps; an empty filter keeps every Card. @template {ViewCard} C @param {C[]} cards @param {ViewFilter} filter */
export function filterCards(cards, { assignee = '', column = '', project = '', month = '' } = {}) {
 return cards.filter(card => (!assignee || assigneeKey(card) === assignee) && (!column || card.column === column)
  && (!project || card.project === project) && (!month || (card.publishOn ?? '').startsWith(`${month}-`)));
}

/**
 * The Cards in the order a list column sorts them, the board's own order on a tie: by title, by column in the board's
 * order, by Assignee's name, by Project or by publishing date. A Card with nothing in that column (no Assignee, no
 * Project, no date) sorts after every other, whichever way. `key` '' keeps the board's order.
 * @template {ViewCard} C @param {C[]} cards @param {{key:''|'title'|'column'|'assignee'|'project'|'publishOn',direction:'ascending'|'descending'}} sort
 * @returns {C[]}
 */
export function sortCards(cards, { key, direction }) {
 if (!key) return cards;
 /** @type {(card:ViewCard)=>string|number|null} */
 const value = {
  title: card => card.title,
  column: card => cardColumns.indexOf(card.column),
  assignee: card => (card.agent ?? card.person)?.name ?? null,
  project: card => card.project ?? null,
  publishOn: card => card.publishOn ?? null,
 }[key];
 const turn = direction === 'descending' ? -1 : 1;
 return cards.map((card, at) => ({ card, at, of: value(card) })).sort((a, b) => {
  if (a.of === null || b.of === null) return a.of === b.of ? a.at - b.at : a.of === null ? 1 : -1;
  const order = typeof a.of === 'number' && typeof b.of === 'number' ? a.of - b.of : String(a.of).localeCompare(String(b.of));
  return turn * order || a.at - b.at;
 }).map(({ card }) => card);
}

/**
 * One month of the calendar (`YYYY-MM`): the Cards on each of its days, by the day's number, and every Card with no
 * publishing date, which the calendar lists beside it.
 * @template {ViewCard} C @param {C[]} cards @param {string} month
 * @returns {{days:Map<number,C[]>,undated:C[]}}
 */
export function calendarMonth(cards, month) {
 /** @type {Map<number,C[]>} */
 const days = new Map();
 for (const card of filterCards(cards, { month })) {
  const day = Number(card.publishOn?.slice(8, 10));
  days.set(day, [...days.get(day) ?? [], card]);
 }
 return { days, undated: cards.filter(card => !card.publishOn) };
}
