/**
 * Sort the values displayed in the list, including company-specific stage order.
 * @template {{stage_id:number, assignee_person?:string|null, assignee_agent?:string|null, title:string, channel:string, go_live:string|null}} T
 * @param {T[]} cards
 * @param {string} field
 * @param {'ascending'|'descending'} direction
 * @param {{id:number, position:number}[]} stages
 * @param {{person_id:string, people:{name:string}|null}[]} members
 * @param {{id:string, name:string}[]} [agents] the Agents an assignee may be (#677)
 * @returns {T[]}
 */
export function sortWorkCards(cards, field, direction, stages, members, agents = []) {
 const value = card => {
  if (field === 'stage_id') return stages.find(stage => stage.id === card.stage_id)?.position ?? Number.MAX_SAFE_INTEGER;
  if (field === 'assignee') return (card.assignee_person ? members.find(member => member.person_id === card.assignee_person)?.people?.name : agents.find(agent => agent.id === card.assignee_agent)?.name) ?? '\uffff';
  return card[field] ?? '';
 };
 const sign = direction === 'ascending' ? 1 : -1;
 return [...cards].sort((a,b) => {
  const av=value(a), bv=value(b);
  const comparison=typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv),'ar');
  return sign * comparison || a.title.localeCompare(b.title,'ar');
 });
}
