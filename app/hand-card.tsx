'use client';
// A step no Agent may do, handed to the person (#139; design-reference: cardHTML's hand branch, handDone, hand-open):
// the badge, the tile of the app the step is done in, the title, the line and the rows. Open: "Open the draft" opens the
// address the Agent gave in a new tab that gets no handle on this page, and "Done it" records, once, that this person
// did the step. Done: the time and the Agent's closing note. gtmworks does not do the step and checks nothing outside.
// The card is laid out in its title's direction, and every text on it follows the card, as the reference sets `dir` once
// (a line that starts with a Latin name, "SEO سابه…", must not turn left to right); the reference's "Open the screen" and "Open the
// merge request" variants are not drawn (#21, #36). Its id is the address "Waiting on you" opens the Conversation at
// (#140), and a done card whose turn to the Agent could not start tells a person who may write to tell it in a message,
// until they write to it.
import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { knownApp } from '@/lib/app-catalogue.mjs';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { madeDay, useZone } from '@/app/agent-made';
import { dayOf } from '@/lib/activity-log.mjs';
import type { ReplyCard } from '@/lib/conversations';

type Hand=Extract<ReplyCard,{kind:'hand'}>;
// Marks the card done: the time the database kept (the first press's, from any tab) and whether this press was that
// first one, else the refusal's message key.
export type MarkHandDone=(card:number)=>Promise<{at:string,first:boolean}|{error:string}>;
// design-reference: justCls. The done card settles only on the page where it was pressed, within this long.
const settling=900;

// An app gtmworks does not know draws the reference's plain tile.
const handApp=(name:string)=>knownApp(name)??{key:'',mark:'·'};
// The direction of the title's first strong letter: the badge comes first on the card, so the frame cannot take it
// from its own text.
const rtl=(text:string)=>/^[^A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]*[֐-ࣿיִ-﷿ﹰ-﻿]/.test(text);

export function HandCard({card,fresh,done,team=false}:{card:Hand,fresh:boolean,done?:MarkHandDone,team?:boolean}) {
 const {t,language}=useI18n(); const zone=useZone();
 const [pressed,setPressed]=useState<string|null>(null); const [error,setError]=useState(''); const [just,setJust]=useState(false);
 const [sending,setSending]=useState(false); const busy=useRef(false);
 useEffect(()=>{
  if(!just) return;
  const timer=setTimeout(()=>setJust(false),settling);
  return ()=>clearTimeout(timer);
 },[just]);
 // The card reads done only once the database has kept the press, and settles only on the page whose press was first.
 const at=card.state==='done'?card.at:pressed;
 const press=async()=>{
  if(busy.current||!done) return;
  busy.current=true; setSending(true); setError('');
  const result=await done(card.id);
  if('at' in result) { setPressed(result.at); setJust(result.first); }
  else setError(result.error==='conversationFailed'?'handFailed':result.error);
  busy.current=false; setSending(false);
 };
 // Today its time, another day its day, as the made card says when an Agent was made.
 const when=(value:string)=>dayOf(new Date().toISOString(),zone)===dayOf(value,zone)
  ?new Date(value).toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit',timeZone:zone}):madeDay(value,language,zone);
 const time=(value:string)=><time dateTime={value} data-utc={zone}>{when(value)}</time>;
 // The time is its own element inside the sentence, so the sentence is split where the time goes.
 const [before,after]=t('handDoneAt','{0}').split('{0}');
 return <div id={`hand-${card.id}`} tabIndex={-1} className={`reply-card reply-card--hand${at?' is-resolved':''}${just?' is-just':''}${fresh?' card-in':''}`} role="group" aria-label={t('handLabel',card.title)} dir={rtl(card.title)?'rtl':'ltr'}>
  <div className="hcard__top"><span className="badge ck-badge"><ShellIcon name="hand"/>{t('handBadge')}</span></div>
  <div className="card__head"><AppTile app={handApp(card.app)} size="lg"/>
   <div className="card__titles"><span className="card__title">{card.title}</span><span className="card__sub">{card.line}</span></div></div>
  {card.rows.length>0&&<dl className="kv">{card.rows.map((row,index)=><div key={index} className="kv__row"><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
  {at?<div className="card__outcome"><ShellIcon name="check"/><span><bdi className="hand__at" dir={language==='ar'?'rtl':'ltr'}>{before}{time(at)}{after}</bdi>{card.note&&<> <span className="hand__note">{card.note}</span></>}</span></div>
   :!done&&team?<div className="card__outcome"><ShellIcon name="clock"/><span>{t('handWaitTeam')}</span></div>
   :<div className="card__actions">
    {card.url&&<a className="btn btn--secondary" href={card.url} target="_blank" rel="noopener noreferrer"><ShellIcon name="open"/><span>{t('handOpen')}</span></a>}
    <button type="button" className="btn btn--primary" disabled={!done||sending} onClick={()=>void press()}>{t('handDone')}</button>
   </div>}
  {error&&!at&&<p className="hand__error" role="alert">{t(error)}</p>}
  {card.state==='done'&&card.failed&&done&&<p className="hand__error" role="alert">{t('handPickupFailed')}</p>}
 </div>;
}
