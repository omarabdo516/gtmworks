'use client';
// What an Agent's Run asks to be allowed to do before it does it (#163; design-reference: cardHTML's approval branch,
// OUTCOME, kvHTML, waitLineHTML, decide): the tile, the Engine's description as the title (its command when there is
// none), the command as a row, and "Don't allow", "Always allow" and "Allow once" as far as the Engine offers them and
// the person's role may send them. Someone who may not decide sees the reference's wait line instead. Decided: the
// outcome and its time. Closed: the Engine stopped waiting before an answer reached it. The Engine names no app, so the
// tile is the reference's plain one; its words keep their own direction, and the card follows the interface's, as the
// reference's approval card does. The reference's line under the title has no source in the Engine and is not drawn.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { madeDay, useZone } from '@/app/agent-made';
import { dayOf } from '@/lib/activity-log.mjs';
import type { PermissionChoice, ReplyCard } from '@/lib/conversations';

type PermissionRequest=Extract<ReplyCard,{kind:'permission'}>;
// What the card shows after a press: decided with the choice kept and its time (the first press's, from any tab), or
// closed; `first` says whether this press was the one kept. Else the refusal's message key.
export type PermissionOutcome={state:'decided',choice:PermissionChoice,at:string,first:boolean}|{state:'closed',first:boolean};
export type DecidePermission=(card:number,choice:PermissionChoice)=>Promise<PermissionOutcome|{error:string}>;
// design-reference: justCls. The decided card settles only on the page where it was decided, within this long.
const settling=900;
const labels:Record<PermissionChoice,string>={deny:'permissionDeny',always:'permissionAlways',once:'permissionOnce'};
const outcomes:Record<PermissionChoice,string>={once:'permissionAllowedOnce',always:'permissionAlwaysAllowed',deny:'permissionNotAllowed'};
const plainTile={key:'',mark:'·'};

export function PermissionCard({card,fresh,offered,decide}:{card:PermissionRequest,fresh:boolean,offered:PermissionChoice[],decide?:DecidePermission}) {
 const {t,language}=useI18n(); const zone=useZone();
 const [pressed,setPressed]=useState<PermissionOutcome|null>(null); const [error,setError]=useState(''); const [just,setJust]=useState(false);
 const busy=useRef(false);
 useEffect(()=>{
  if(!just) return;
  const timer=setTimeout(()=>setJust(false),settling);
  return ()=>clearTimeout(timer);
 },[just]);
 // The record has the last word once it has one; until then, what the press was answered.
 const shown=card.state==='decided'?{state:'decided' as const,choice:card.choice,at:card.at}:card.state==='closed'?{state:'closed' as const}:pressed;
 const press=async(choice:PermissionChoice)=>{
  if(busy.current||!decide) return;
  busy.current=true; setError('');
  const result=await decide(card.id,choice);
  if('state' in result) { setPressed(result); setJust(result.first&&result.state==='decided'); }
  else { setError(result.error==='conversationFailed'?'permissionFailed':result.error); busy.current=false; }
 };
 // Today its time, another day its day, as a handed step's card says when it was done.
 const when=(value:string)=>dayOf(new Date().toISOString(),zone)===dayOf(value,zone)
  ?new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit',timeZone:zone}):madeDay(value,language,zone);
 const title=card.description.trim()||card.command.trim();
 const command=card.description.trim()?card.command.trim():'';
 const line=(icon:'check'|'x'|'clock',words:ReactNode)=><div className="card__outcome"><ShellIcon name={icon}/><span>{words}</span></div>;
 return <div className={`reply-card reply-card--permission${shown?' is-resolved':''}${just?' is-just':''}${fresh?' card-in':''}`} role="group" aria-label={t('permissionLabel',card.title)}>
  <div className="card__head"><AppTile app={plainTile} size="lg"/>
   <div className="card__titles"><span className="card__title" dir="auto">{title}</span></div></div>
  {command&&<dl className="kv"><div className="kv__row"><dt>{t('permissionCommand')}</dt><dd dir="auto">{command}</dd></div></dl>}
  {shown?.state==='decided'?line(shown.choice==='deny'?'x':'check',<>{t(outcomes[shown.choice])} · <time dateTime={shown.at} data-utc={zone}>{when(shown.at)}</time></>)
   :shown?.state==='closed'?line('clock',t('permissionClosed'))
   :decide&&offered.length?<div className="card__actions">{offered.map(choice=>
    <button key={choice} type="button" className={`btn ${choice==='once'?'btn--primary':'btn--secondary'}`} onClick={()=>void press(choice)}>{t(labels[choice])}</button>)}</div>
   :line('clock',t('permissionWaitTeam'))}
  {error&&!shown&&<p className="permission__error" role="alert">{t(error)}</p>}
 </div>;
}
