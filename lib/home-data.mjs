import { i18n } from './i18n.mjs';
import { boardColumns, columnOf } from './board-columns.mjs';
export const metricValue = (value, language = 'en') => value == null ? i18n(language).t('unavailable') : new Intl.NumberFormat(i18n(language).locale).format(value);

/**
 * The Card an Agent is working on now: the newest of its Cards in the board's In progress column, leaving out one whose
 * chat waits on a person (that one waits in "Waiting on you").
 * @param {{id:number, status?:string|null, agent_id?:string|null, created_at:string, wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}[]|null} cards
 * @param {string} agentId
 */
export function currentAgentCard(cards, agentId) {
 if (!cards) return null;
 return cards.filter(card => card.agent_id === agentId && columnOf(card) === 'progress')
  .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0] ?? null;
}

/**
 * Home's charts (#676: Approvals and statuses, never stages). A delivery is an Approval that closed a review: the
 * decision moved the Card out of review in the same moment, so its move's log row has the Approval's time (an earlier
 * approval step's Approval moved nothing). First-time acceptance is the share of deliveries with no earlier send-back.
 * @param {{id:number, status?:string|null, created_at:string}[]|null} cards
 * @param {{id:number, card_id:number, action:string, created_at:string, details:Record<string, unknown>}[]|null} activity
 */
export function homeCharts(cards, activity, now = Date.now()) {
 const end=new Date(now); end.setUTCHours(0,0,0,0);
 const days=Array.from({length:14},(_,i)=>new Date(end.getTime()-(13-i)*86400000).toISOString().slice(0,10));
 const inPeriod=value=>value>=days[0] && value<=new Date(now).toISOString();
 const moves=new Set(activity?.filter(a=>a.action==='card_changed' && a.details?.field==='stage_id').map(a=>`${a.card_id} ${a.created_at}`));
 const delivered=activity ? activity.filter(a=>a.action==='approval_approved' && moves.has(`${a.card_id} ${a.created_at}`) && inPeriod(a.created_at)) : null;
 const firstTime=delivered?.filter(a=>!activity.some(previous=>previous.card_id===a.card_id && previous.action==='approval_rejected' && previous.id<a.id)).length;
 return {
  delivered:delivered ? days.map(day=>({label:day,value:delivered.filter(a=>a.created_at.startsWith(day)).length})) : null,
  statuses:cards ? boardColumns.map(column=>({label:column,value:cards.filter(c=>columnOf({status:c.status})===column && inPeriod(c.created_at)).length})) : null,
  acceptance:delivered?.length ? Math.round(firstTime/delivered.length*100) : null,
 };
}
