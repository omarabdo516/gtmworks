/**
 * Sort the values displayed in the list, including company-specific stage order.
 * @template {{stage_id:number, next_actor:string|null, title:string, channel:string, go_live:string|null}} T
 * @param {T[]} cards
 * @param {string} field
 * @param {'ascending'|'descending'} direction
 * @param {{id:number, position:number}[]} stages
 * @param {{person_id:string, people:{name:string}|null}[]} members
 * @returns {T[]}
 */
export function sortWorkCards(cards, field, direction, stages, members) {
 const value = card => {
  if (field === 'stage_id') return stages.find(stage => stage.id === card.stage_id)?.position ?? Number.MAX_SAFE_INTEGER;
  if (field === 'next_actor') return members.find(member => member.person_id === card.next_actor)?.people?.name ?? '\uffff';
  return card[field] ?? '';
 };
 const sign = direction === 'ascending' ? 1 : -1;
 return [...cards].sort((a,b) => {
  const av=value(a), bv=value(b);
  const comparison=typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv),'ar');
  return sign * comparison || a.title.localeCompare(b.title,'ar');
 });
}
