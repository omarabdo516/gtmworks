import { i18n } from './i18n.mjs';
export const metricValue = (value, language = 'en') => value == null ? i18n(language).t('unavailable') : new Intl.NumberFormat(i18n(language).locale).format(value);

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
