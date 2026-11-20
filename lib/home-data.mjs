import { i18n } from './i18n.mjs';
import { columnOf } from './board-columns.mjs';
export const metricValue = (value, language = 'en') => value == null ? i18n(language).t('unavailable') : new Intl.NumberFormat(i18n(language).locale).format(value);

/**
 * The Card an Agent is working on now: the newest of its Cards in the board's In progress column, leaving out one whose
 * chat waits on a person (that one waits in "Waiting on you").
 * @param {{id:number, stage_id:number, agent_id?:string|null, created_at:string, wait?:{person:string, kind:'question'|'hand'|'permission', title:string}|null}[]|null} cards
 * @param {{id:number, board_column?:string|null}[]|null} stages
 * @param {string} agentId
 */
export function currentAgentCard(cards, stages, agentId) {
 if (!cards || !stages) return null;
 return cards.filter(card => card.agent_id === agentId && columnOf(card, stages) === 'progress')
  .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0] ?? null;
}

export function homeCharts(cards, stages, activity, now = Date.now()) {
 const end=new Date(now); end.setUTCHours(0,0,0,0);
 const days=Array.from({length:14},(_,i)=>new Date(end.getTime()-(13-i)*86400000).toISOString().slice(0,10));
 const inPeriod=value=>value>=days[0] && value<=new Date(now).toISOString();
 // A delivery is the audited transition out of review into the approved stage.
 const approved=stages?.find(stage=>stage.stage_key==='approved');
 const delivered=activity && approved ? activity.filter(a=>a.action==='card_changed' && a.details.field==='stage_id' && Number(a.details.new)===approved.id && inPeriod(a.created_at)) : null;
 const firstTime=delivered?.filter(a=>!activity.some(previous=>previous.card_id===a.card_id && previous.action==='approval_rejected' && previous.id<a.id)).length;
 return {
  delivered:delivered ? days.map(day=>({label:day,value:delivered.filter(a=>a.created_at.startsWith(day)).length})) : null,
  stages:cards && stages ? stages.map(stage=>({label:stage.name,value:cards.filter(c=>c.stage_id===stage.id && inPeriod(c.created_at)).length})) : null,
  acceptance:delivered?.length ? Math.round(firstTime/delivered.length*100) : null,
 };
}
