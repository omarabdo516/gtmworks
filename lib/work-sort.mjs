import { boardColumns } from './board-columns.mjs';

/**
 * Sort the Cards the List shows (#683): by status in the board's order, by assignee or Project name (a Card with none
 * last), or by any other field's own value; ties by title.
 * @template {{status:string, assignee_person?:string|null, assignee_agent?:string|null, project_id?:number|null, title:string, go_live:string|null}} T
 * @param {T[]} cards
 * @param {string} field
 * @param {'ascending'|'descending'} direction
 * @param {{person_id:string, people:{name:string}|null}[]} members
 * @param {{id:string, name:string}[]} [agents] the Agents an assignee may be (#677)
 * @param {{id:number, name:string}[]} [projects]
 * @returns {T[]}
 */
export function sortWorkCards(cards, field, direction, members, agents = [], projects = []) {
 const value = card => {
  if (field === 'status') { const at = boardColumns.indexOf(card.status); return at < 0 ? Number.MAX_SAFE_INTEGER : at; }
  if (field === 'assignee') return (card.assignee_person ? members.find(member => member.person_id === card.assignee_person)?.people?.name : agents.find(agent => agent.id === card.assignee_agent)?.name) ?? '￿';
  if (field === 'project') return projects.find(project => project.id === card.project_id)?.name ?? '￿';
  return card[field] ?? '';
 };
 const sign = direction === 'ascending' ? 1 : -1;
 return [...cards].sort((a,b) => {
  const av=value(a), bv=value(b);
  const comparison=typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv),'ar');
  return sign * comparison || a.title.localeCompare(b.title,'ar');
 });
}
