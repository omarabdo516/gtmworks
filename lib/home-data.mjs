import { i18n } from './i18n.mjs';
import { boardColumns, columnOf } from './board-columns.mjs';
export const metricValue = (value, language = 'en') => value == null ? i18n(language).t('unavailable') : new Intl.NumberFormat(i18n(language).locale).format(value);

/**
 * The Card an Agent is working on now: the newest of its Cards in the board's In progress column, leaving out one whose
 * chat waits on a person (that one waits in "Waiting on you").
 * @param {{id:number, status?:string|null, assignee_agent?:string|null, created_at:string, wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}[]|null} cards
 * @param {string} agentId
 */
export function currentAgentCard(cards, agentId) {
 if (!cards) return null;
 return cards.filter(card => card.assignee_agent === agentId && columnOf(card) === 'progress')
  .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0] ?? null;
}

// The calendar day of one moment in one zone, as YYYY-MM-DD.
const dayIn = (zone, at) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/**
 * Home's charts over the last fourteen days, each day the Company's own (#779): Cairo, where the Company names no zone, so
 * work done at 00:30 in Cairo is on that Cairo day and not the UTC day before. They read Approvals and statuses, never
 * stages (#676). A delivery is an Approval that closed a review: the decision moved the Card out of review in the same
 * moment, so its move's log row has the Approval's time (an earlier approval step's Approval moved nothing). First-time
 * acceptance is the share of deliveries with no earlier send-back.
 * @param {{id:number, status?:string|null, created_at:string}[]|null} cards
 * @param {{id:number, card_id:number, action:string, created_at:string, details:Record<string, unknown>}[]|null} activity
 */
export function homeCharts(cards, activity, now = Date.now(), zone = 'Africa/Cairo') {
 const [y, m, d] = dayIn(zone, now).split('-').map(Number);
 const days=Array.from({length:14},(_,i)=>new Date(Date.UTC(y,m-1,d-(13-i))).toISOString().slice(0,10));
 const nowIso=new Date(now).toISOString();
 const inPeriod=value=>dayIn(zone,value)>=days[0] && new Date(value).toISOString()<=nowIso;
 // A move is logged by its status since the cutover (#684) and by its stage before it; the log keeps both.
 const moves=new Set(activity?.filter(a=>a.action==='card_changed' && (a.details?.field==='status' || a.details?.field==='stage_id')).map(a=>`${a.card_id} ${a.created_at}`));
 const delivered=activity ? activity.filter(a=>a.action==='approval_approved' && moves.has(`${a.card_id} ${a.created_at}`) && inPeriod(a.created_at)) : null;
 const firstTime=delivered?.filter(a=>!activity.some(previous=>previous.card_id===a.card_id && previous.action==='approval_rejected' && previous.id<a.id)).length;
 return {
  delivered:delivered ? days.map(day=>({label:day,value:delivered.filter(a=>dayIn(zone,a.created_at)===day).length})) : null,
  statuses:cards ? boardColumns.map(column=>({label:column,value:cards.filter(c=>columnOf({status:c.status})===column && inPeriod(c.created_at)).length})) : null,
  acceptance:delivered?.length ? Math.round(firstTime/delivered.length*100) : null,
 };
}
