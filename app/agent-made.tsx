'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor, type Language } from '@/lib/i18n.mjs';
import { dateFormatter, dayOf } from '@/lib/activity-log.mjs';
import { ShellIcon } from '@/components/shell-icon';
import type { Made } from '@/lib/agent-made';

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

const never=()=>()=>{};
// The server cannot know the reader's time zone, so it and the first browser render use UTC, hidden (shell.css); once
// hydrated the reader's own zone picks today or the day.
export const useZone=()=>useSyncExternalStore(never,()=>undefined,()=>'UTC' as string|undefined);
export function madeDay(at:string,language:Language,zone:string|undefined) {
 const thisYear=dayOf(new Date().toISOString(),zone).slice(0,4)===dayOf(at,zone).slice(0,4);
 return dateFormatter(localeFor(language),{day:'numeric',month:language==='ar'?'long':'short',...(thisYear?{}:{year:'numeric'}),timeZone:zone}).format(new Date(at));
}

// "Made on Jun 10 at the request of Omar", or today with the time (design-reference: bornText, bornHTML).
export function MadeLine({made,where}:{made:Made,where:'panel'|'sov'}) {
 const {t,language}=useI18n(); const zone=useZone();
 const today=dayOf(new Date().toISOString(),zone)===dayOf(made.at,zone);
 const when=today?dateFormatter(localeFor(language),{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(made.at)):madeDay(made.at,language,zone);
 const text=made.mine?t(today?'agentMadeTodayMine':'agentMadeOnMine',when):t(today?'agentMadeToday':'agentMadeOn',when,made.by||t('member'));
 return <p className={`born born--${where}`} data-utc={zone}><ShellIcon name="spark"/><span>{text}</span></p>;
}
