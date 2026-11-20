'use client';
// An app the Agent needs and does not have (#203; design-reference: connectHTML, waitLineHTML, the connect and
// connect-later cases, connectTool): the app's tile, "Connect {App}" and the Agent's own reason. The Owner sees Later and
// Connect: Connect is the same sign-in as Settings, Apps for this Agent only (app/app-sign-in.ts); while it is followed
// both buttons are off and the second reads Connecting…, and once it is done the card reads "{App} connected" with the
// toast. Later closes the card for good with the reference's line and gives the message field the focus. Anyone else
// sees the clock line saying who connects apps, and no button. Whether the app is connected is the Engine's, read
// whenever the card is drawn; the card approves, publishes and spends nothing.
import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { appByKey } from '@/lib/app-catalogue.mjs';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { toast } from '@/app/toast';
import type { ReplyCard } from '@/lib/conversations';
import type { SignInOutcome } from '@/app/app-sign-in';

type Connect=Extract<ReplyCard,{kind:'connect'}>;
// Whether this person is the Owner who connects apps, else who does; how a sign-in for the card's app is started (for
// the Conversation's Agent), and how Later is kept.
export type ConnectApps={owner:boolean,owners:string[],start:(app:string,signal:AbortSignal)=>Promise<SignInOutcome>,later:(card:number)=>Promise<{state:'postponed'}|{error:string}>};

export function ConnectCard({card,fresh,connect}:{card:Connect,fresh:boolean,connect?:ConnectApps}) {
 const {t,language}=useI18n();
 const [pressed,setState]=useState<'open'|'connected'|'postponed'>('open'); const [connecting,setConnecting]=useState(false); const [error,setError]=useState('');
 const busy=useRef(false); const root=useRef<HTMLDivElement>(null);
 // What a press here ended in, else the record's: a card connected from anywhere else reads connected when it is drawn again.
 const state=pressed==='open'?card.state:pressed;
 // A sign-in still followed when the card goes (the page left) is cancelled and its window closed.
 const stopping=useRef<AbortController|null>(null);
 useEffect(()=>()=>stopping.current?.abort(),[]);
 const app=appByKey(card.app)??{key:card.app,mark:'·'};
 const name=<bdi>{card.title}</bdi>;
 const said=(key:string)=>t(key,'{0}').split('{0}');
 const withName=(key:string)=>{ const [before,after]=said(key); return <>{before}{name}{after}</>; };
 const start=async()=>{
  if(busy.current||!connect) return;
  busy.current=true; setConnecting(true); setError('');
  const controller=new AbortController(); stopping.current=controller;
  const result=await connect.start(card.app,controller.signal);
  stopping.current=null;
  if(controller.signal.aborted) return;
  setConnecting(false); busy.current=false;
  if('state' in result) { if(result.state==='manual') { setConnecting(false); busy.current=false; return; } setState('connected'); toast(t('connectConnected',card.title)); }
  else setError(result.error);
 };
 const later=async()=>{
  if(busy.current||!connect) return;
  busy.current=true; setError('');
  const result=await connect.later(card.id);
  busy.current=false;
  if('state' in result) {
   setState('postponed');
   (root.current?.closest('.chat, dialog')??document).querySelector<HTMLTextAreaElement>('.composer__input')?.focus();
  } else setError('connectFailed');
 };
 const head=<div className="card__head"><AppTile app={app} size="lg"/>
  <div className="card__titles"><span className="card__title">{withName('connectTitle')}</span><span className="card__sub" dir="auto">{card.reason}</span></div></div>;
 const frame=(label:string,resolved:boolean,body:React.ReactNode)=><div ref={root} className={`reply-card reply-card--connect${resolved?' is-resolved':''}${fresh?' card-in':''}`} role="group" aria-label={label}>{head}{body}</div>;
 if(state==='connected') return frame(t('connectConnected',card.title),true,<div className="card__outcome"><ShellIcon name="check"/><span>{withName('connectConnected')}</span></div>);
 if(state==='postponed') return frame(t('connectPostponedLabel',card.title),true,<div className="card__outcome"><span>{t('connectPostponed')}</span></div>);
 if(!connect?.owner) {
  const owners=connect?.owners.length?new Intl.ListFormat(localeFor(language),{type:'conjunction'}).format(connect.owners):'';
  return frame(t('connectTitle',card.title),false,<div className="card__outcome"><ShellIcon name="clock"/><span>{owners?t('connectBy',owners):t('connectByOwner')}</span></div>);
 }
 return frame(t('connectTitle',card.title),false,<>
  <div className="card__actions">
   <button type="button" className="btn btn--secondary" disabled={connecting} onClick={()=>void later()}>{t('connectLater')}</button>
   <button type="button" className="btn btn--primary" disabled={connecting} onClick={()=>void start()}>{t(connecting?'connectConnecting':'connectDo')}</button>
  </div>
  {error&&<p className="connect__error" role="alert">{t(error)}</p>}
 </>);
}
