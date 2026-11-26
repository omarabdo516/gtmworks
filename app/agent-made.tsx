'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor, type Language } from '@/lib/i18n.mjs';
import { dateFormatter, dayOf } from '@/lib/activity-log.mjs';
import { ShellIcon } from '@/components/shell-icon';
import Link from '@/lib/link';
import type { Made } from '@/lib/agent-made';
import { dismissToast, toast } from './toast';

// Opening an Agent Lead made at your request takes its "new" mark away (#13). It is asked once the page has mounted,
// never while the page is rendered on the server or prefetched; the sidebar is then drawn again without the mark.
export function OpenedMark({company,agent}:{company:string,agent:string}) {
 const router=useRouter();
 useEffect(()=>{
  void fetch('/api/agent-opened',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent}),cache:'no-store'})
   .then(response=>response.ok?response.json():null).then(result=>{if(result?.opened) router.refresh();}).catch(()=>{});
 },[company,agent,router]);
 return null;
}

// A made Agent is told once to the Owner who asked for it, the first time it appears in their Conversation (#169): the
// page asks, and only the first answer raises it. "Open {Agent}" goes to its chat and takes the toast away; the toast
// itself waits six seconds, as the reference's action toast does. A reload asks again and is answered false.
export function AgentMadeToast({company,slug,agent}:{company:string,slug:string,agent:{id:string,name:string}}) {
 const {t}=useI18n(); const router=useRouter();
 useEffect(()=>{
  // The server marks the record as shown when it answers true, so that answer is the only toast this Agent raises: it is
  // raised even if this effect was cleaned up meanwhile, as React's development double effect cleans it between two asks
  // (the first answer would otherwise be dropped after the record was already marked).
  void fetch('/api/agent-toast',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id}),cache:'no-store'})
   .then(response=>response.ok?response.json() as Promise<{shown?:boolean}>:null)
   .then(result=>{ if(result?.shown===true) toast(t('agentMadeToast',agent.name),{action:{label:t('agentMadeOpen',agent.name),run:()=>{ dismissToast(); router.push(`/c/${slug}/chat/${agent.id}`); }}}); })
   .catch(()=>{});
 },[company,slug,agent.id,agent.name,t,router]);
 return null;
}

const never=()=>()=>{};
// The server cannot know the reader's time zone, so it and the first browser render use UTC, hidden (globals.css); once
// hydrated the reader's own zone picks today or the day.
export const useZone=()=>useSyncExternalStore(never,()=>undefined,()=>'UTC' as string|undefined);
// A time in the reader's own zone, the one way every screen draws it (#719): in UTC and hidden on the server and the first
// browser render (globals.css), then in the reader's zone once the page hydrates, so it hydrates without a text mismatch
// outside UTC (#520, #586). `orDay` gives the time today and the day another day, as a card says when it was answered;
// `hour` is 2-digit as in a chat, numeric where the reference draws it so (the morning card's "2:40 AM").
export function ReaderTime({at,className,orDay=false,hour='2-digit'}:{at:string,className?:string,orDay?:boolean,hour?:'2-digit'|'numeric'}) {
 const {language}=useI18n(); const zone=useZone();
 const text=orDay&&dayOf(new Date().toISOString(),zone)!==dayOf(at,zone)?madeDay(at,language,zone)
  :new Date(at).toLocaleTimeString(localeFor(language),{hour,minute:'2-digit',timeZone:zone});
 return <time className={className} dateTime={at} data-utc={zone}>{text}</time>;
}
export function madeDay(at:string,language:Language,zone:string|undefined) {
 const thisYear=dayOf(new Date().toISOString(),zone).slice(0,4)===dayOf(at,zone).slice(0,4);
 return dateFormatter(localeFor(language),{day:'numeric',month:language==='ar'?'long':'short',...(thisYear?{}:{year:'numeric'}),timeZone:zone}).format(new Date(at));
}

// "Made on Jun 10 at the request of Omar", or today with the time, and "See the ask" for the person who asked, except in
// the Agent's empty chat (design-reference: bornText, bornHTML).
// When a person said or allowed something, as a rule's row reads it (#18) and a standing permission's (#166): today or
// yesterday with the time, else the day. Drawn in the reader's own zone once mounted, in UTC on the server.
export function useSaidWhen(at:string) {
 const {t,language}=useI18n(); const zone=useZone();
 const day=dayOf(at,zone); const today=dayOf(new Date().toISOString(),zone);
 const yesterday=new Date(new Date(`${today}T00:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
 const time=dateFormatter(localeFor(language),{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(at));
 return {zone,when:day===today?`${t('logToday')} · ${time}`:day===yesterday?`${t('logYesterday')} · ${time}`:madeDay(at,language,zone)};
}
export function MadeLine({made,where}:{made:Made,where:'panel'|'sov'|'empty'}) {
 const {t,language}=useI18n(); const zone=useZone();
 const today=dayOf(new Date().toISOString(),zone)===dayOf(made.at,zone);
 const when=today?dateFormatter(localeFor(language),{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(made.at)):madeDay(made.at,language,zone);
 const text=made.mine?t(today?'agentMadeTodayMine':'agentMadeOnMine',when):t(today?'agentMadeToday':'agentMadeOn',when,made.by||t('member'));
 return <p className={`born born--${where}`} data-utc={zone}><ShellIcon name="spark"/><span>{text}</span>{made.ask&&where!=='empty'&&<Link className="link-btn born__link" href={made.ask}>{t('agentMadeSeeAsk')}</Link>}</p>;
}
