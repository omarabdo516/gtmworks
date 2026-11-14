'use client';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { dateFormatter, dayOf, daysBack, groupByDay } from '@/lib/activity-log.mjs';
import { workDate } from '@/lib/work-date.mjs';
import Link from '@/lib/link';

// The server cannot know the reader's time zone, so it and the first browser render both use UTC, hidden (log.css,
// globals.css); once hydrated the reader's own zone groups the days and draws the times.
const never=()=>()=>{};
const useZone=()=>useSyncExternalStore(never,()=>undefined,()=>'UTC' as string|undefined);

// The time of day in the reader's language and zone, from a formatter built once (lib/activity-log dateFormatter).
const timeOf=(value:string,language:string,zone:string|undefined)=>dateFormatter(language==='ar'?'ar-EG-u-nu-latn':'en-US-u-nu-latn',{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(value));

export function LogTime({value}:{value:string}) {
 const {language}=useI18n(); const zone=useZone();
 return <time className="lg-time num" dateTime={value} data-utc={zone}>{timeOf(value,language,zone)}</time>;
}

// Today, Yesterday, then the weekday and date (design-reference: dayName).
function useDayName() {
 const {t,language}=useI18n(); const zone=useZone();
 const today=dayOf(new Date().toISOString(),zone);
 return {zone,name:(day:string)=>{
  const back=daysBack(day,today);
  if(back===0) return t('logToday');
  if(back===1) return t('logYesterday');
  return workDate(`${day}T12:00:00Z`,language,{weekday:language==='ar'?'long':'short',day:'numeric',month:language==='ar'?'long':'short'});
 }};
}

// The log grouped by day, newest first (design-reference: logGroupsHTML).
export function LogDays({items}:{items:{id:number,at:string,node:ReactNode}[]}) {
 const {zone,name}=useDayName();
 return <>{groupByDay(items.map(item=>({...item,created_at:item.at})),zone).map(({day,items:rows})=><section className="lg-day" key={day} aria-label={name(day)}>
  <h3 className="lg-day__h" data-utc={zone}>{name(day)}</h3>
  <ol className="lg-list">{rows.map(row=><li key={row.id} className="lg-row" data-entry={row.id}>{row.node}</li>)}</ol>
 </section>)}</>;
}

// A short "when" for the Numbers page's agent feed: Today · 8:40 PM.
export function FeedWhen({value}:{value:string}) {
 const {zone,name}=useDayName(); const {language}=useI18n();
 const time=timeOf(value,language,zone);
 return <time className="feed__m" dateTime={value} data-utc={zone}>{name(dayOf(value,zone))} · {time}</time>;
}

type Option={value:string,label:string};
// Who and which Card (design-reference: lgp-tools). A choice reloads the page with the filter in its address, so a
// filtered log can be shared and the server reads only the matching rows.
export function LogFilters({slug,who,card,people,agents,cards,count}:{slug:string,who:string,card:string,people:Option[],agents:Option[],cards:Option[],count:number}) {
 const {t}=useI18n(); const router=useRouter();
 const go=(nextWho:string,nextCard:string)=>{
  const query=new URLSearchParams(); if(nextWho!=='all') query.set('who',nextWho); if(nextCard!=='all') query.set('card',nextCard);
  router.push(`/c/${slug}/log${query.size?`?${query}`:''}`);
 };
 const filtered=who!=='all'||card!=='all';
 // A choice made before the page finished loading still applies once it has. Only a field the reader changed counts:
 // one whose value differs from what the page was drawn with. A filter with no option of its own (an Agent or Card
 // no longer listed) draws the field on its first option, and that is not a choice, so the address keeps the filter.
 const whoField=useRef<HTMLSelectElement>(null), cardField=useRef<HTMLSelectElement>(null);
 useEffect(()=>{
  const chosen=(field:HTMLSelectElement|null,current:string)=>{
   if(!field) return current;
   const drawn=[...field.options].find(option=>option.defaultSelected)??field.options[0];
   return field.value!==drawn?.value?field.value:current;
  };
  const [nextWho,nextCard]=[chosen(whoField.current,who),chosen(cardField.current,card)];
  if(nextWho!==who||nextCard!==card) go(nextWho,nextCard);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return <div className="lgp-tools" role="group" aria-label={t('logFilters')}>
  <div className="lgp-field"><label htmlFor="lg-who">{t('logWho')}</label>
   <select ref={whoField} key={who} className="set-input" id="lg-who" defaultValue={who} onChange={event=>go(event.target.value,card)}>
    <option value="all">{t('logEveryone')}</option>
    {people.length>0&&<optgroup label={t('logPeople')}>{people.map(person=><option key={person.value} value={person.value}>{person.label}</option>)}</optgroup>}
    {agents.length>0&&<optgroup label={t('logAgents')}>{agents.map(agent=><option key={agent.value} value={agent.value}>{agent.label}</option>)}</optgroup>}
    <option value="s">{t('logSystem')}</option>
   </select></div>
  <div className="lgp-field"><label htmlFor="lg-card">{t('logCard')}</label>
   <select ref={cardField} key={card} className="set-input" id="lg-card" defaultValue={card} onChange={event=>go(who,event.target.value)}>
    <option value="all">{t('logAllCards')}</option>
    {cards.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
   </select></div>
  {filtered&&<Link className="link-btn lgp-clear" href={`/c/${slug}/log`}>{t('logShowAll')}</Link>}
  <span className="lgp-count num" aria-live="polite">{t(count===1?'logEntry':'logEntries',count)}</span>
 </div>;
}
