'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { AppTile } from '@/components/app-tile';
import { ShellIcon } from '@/components/shell-icon';
import { SettingsIcon } from './settings-icons';
import type { AppCategory, CompanyApp } from '@/lib/app-catalogue.mjs';

// Settings, Apps (#30; design-reference: appsHeadHTML, appsListHTML, appCardHTML, appDetailHTML). The server reads each
// app's state from the Engine (app/settings-apps.tsx); here the list is searched and filtered, and the Owner connects,
// follows and disconnects through /api/company-apps, which checks the Owner again.
export type AppItem=CompanyApp&{use:string,can:string,words:string};
type Text=Record<string,string>;
const sayer=(text:Text)=>(key:string,value?:string)=>value===undefined?text[key]??'':(text[key]??'').replace('{0}',()=>value);
// Search reads Arabic as the reference does (arNorm): the hamza forms of alef as alef, alef maksura as ya, ta marbuta as
// ha, and no diacritics.
const fold=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[ً-ٕ]/g,'').replace(/[ةى]/g,letter=>String.fromCharCode(letter.charCodeAt(0)===0x629?0x647:0x64A));
const order:AppCategory[]=['content','communication','analytics','sales'];
// A line naming the app keeps the name in its own direction.
const named=(line:string,name:string)=>{ const [before,after='']=line.split('{0}'); return <>{before}<bdi>{name}</bdi>{after}</>; };

function State({app,say}:{app:CompanyApp,say:(key:string,value?:string)=>string}) {
 if(app.state==='connected') return <span className="app__state"><SettingsIcon name="check"/><span>{say('stateConnected')}</span></span>;
 return <span className={`app__state ${app.state==='attention'?'app__state--warn':'app__state--off'}`}>{say(app.state==='attention'?'stateAttention':'stateOff')}</span>;
}

export function AppsList({slug,owner,items,text}:{slug:string,owner:boolean,items:AppItem[],text:Text}) {
 const say=sayer(text);
 const [query,setQuery]=useState(''); const [category,setCategory]=useState<AppCategory|'all'>('all');
 const search=useRef<HTMLInputElement>(null);
 const needle=fold(query.trim());
 const shown=items.filter(item=>(category==='all'||item.category===category)&&fold(item.words).includes(needle));
 const card=(item:AppItem)=>{
  const action=item.state==='connected'?'manage':item.state==='attention'?'reconnect':'connect';
  return <article key={item.key} className="app-card" aria-labelledby={`app-t-${item.key}`}>
   <div className="app__top"><AppTile app={item} size="lg"/><div className="app__titles"><h5 className="app__name" id={`app-t-${item.key}`}><bdi>{item.name}</bdi></h5><span className="app__cat">{say(`category.${item.category}`)}</span></div></div>
   <p className="app__use od-clamp-2">{item.use}</p>
   <div className="app__foot"><State app={item} say={say}/>
    {owner&&<Link className="btn btn--secondary btn--sm" id={`app-btn-${item.key}`} href={overlayHref(slug,'apps',{app:item.key})} aria-label={say(`${action}Label`,item.name)}>{say(action)}</Link>}</div>
  </article>;
 };
 const group=(title:string,list:AppItem[],id:string)=>list.length>0&&<section className="apps-sec" aria-labelledby={id}><h4 className="apps-sec__h" id={id}>{title} <span className="num muted">{list.length}</span></h4><div className="apps-grid">{list.map(card)}</div></section>;
 return <>
  <header className="apps-head">
   <div className="sheet__top"><h3 className="sheet__title sov-h" id="sov-h" tabIndex={-1}>{say('title')}</h3>
    <span className="badge apps-count"><SettingsIcon name="check"/><span className="num">{items.filter(item=>item.state!=='off').length}</span> {say('connected')}</span></div>
   <p className="apps-sub">{say(owner?'subOwner':'subOther')}</p>
   <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{say('search')}</span><input ref={search} id="apps-q" type="search" autoComplete="off" placeholder={say('searchHint')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="tpl-cats" role="group" aria-label={say('categories')}>{(['all',...order.filter(kind=>items.some(item=>item.category===kind))] as const).map(kind=>
    <button key={kind} type="button" className="chip" id={`apps-cat-${kind}`} aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{say(`category.${kind}`)}<span className="chip__n num">{items.filter(item=>kind==='all'||item.category===kind).length}</span></button>)}</div>
  </header>
  <div className="apps-body" id="apps-body" aria-live="polite">{shown.length?<>{group(say('groupOn'),shown.filter(item=>item.state!=='off'),'apps-h-on')}{group(say('groupOff'),shown.filter(item=>item.state==='off'),'apps-h-off')}</>
   :<div className="tpl-empty"><b>{needle?say('noMatch',query.trim()):say('noneHere')}</b><span>{say('emptyHint')}</span>
    {needle&&<div className="tpl-empty__acts"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>{setQuery('');search.current?.focus();}}>{say('clear')}</button></div>}</div>}</div>
 </>;
}

async function ask(body:Record<string,string>) {
 try {
  const response=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json().catch(()=>({})) as Record<string,unknown>};
 } catch { return {ok:false,body:{}}; }
}
// A sign-in Hermes keeps for fifteen minutes is followed at most that long.
const pollEvery=2000, pollFor=15*60*1000;

export function AppDetail({slug,company,owner,rtl,item,text,soon,failed}:{slug:string,company:string,owner:boolean,rtl:boolean,item:AppItem,text:Text,soon:string,failed:boolean}) {
 const say=sayer(text); const router=useRouter();
 const [waiting,setWaiting]=useState(false); const [asking,setAsking]=useState(false); const [error,setError]=useState(failed?'signInFailed':'');
 const [pending,startTransition]=useTransition();
 const list=overlayHref(slug,'apps');
 const state=item.state; const on=state!=='off';
 // While the vendor's window is open the sign-in is followed until it connects, fails, or the page closes.
 useEffect(()=>{
  if(!waiting) return;
  let stopped=false, timer:ReturnType<typeof setTimeout>|undefined; const until=Date.now()+pollFor;
  const poll=async()=>{
   const answer=await ask({company,app:item.key,action:'poll'});
   if(stopped) return;
   const status=String(answer.body.status||'');
   if(answer.ok&&status==='waiting'&&Date.now()<until) { timer=setTimeout(poll,pollEvery); return; }
   setWaiting(false);
   if(answer.ok&&status==='connected') router.refresh();
   else setError(answer.ok?'signInFailed':`error.${String(answer.body.error||'appsFailed')}`);
  };
  timer=setTimeout(poll,pollEvery);
  return ()=>{ stopped=true; clearTimeout(timer); };
 },[waiting,company,item.key,router]);
 // The vendor's window is opened at the click, before the answer, so the browser lets it open; it is pointed at the
 // vendor once gtmworks has the sign-in page, and never knows this page.
 const connect=()=>startTransition(async()=>{
  setError('');
  const opened=window.open('about:blank','_blank');
  const answer=await ask({company,app:item.key,action:'connect'});
  if(!answer.ok) { opened?.close(); setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
  if(opened) { opened.opener=null; opened.location.href=String(answer.body.url); setWaiting(true); }
  else window.location.assign(String(answer.body.url));
 });
 const cancel=()=>startTransition(async()=>{ await ask({company,app:item.key,action:'cancel'}); setWaiting(false); });
 const disconnect=()=>startTransition(async()=>{
  const answer=await ask({company,app:item.key,action:'disconnect'});
  if(!answer.ok) { setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
  router.replace(list);
  router.refresh();
 });
 const busy=pending||waiting;
 const back=<Link className="btn btn--secondary" id="app-cancel" href={list} replace>{say(owner&&state==='off'?'cancel':'done')}</Link>;
 return <>
  <header className="apps-head">
   <div className="sheet__top"><Link className="circle-btn" id="apps-back" href={list} replace aria-label={say('back')}><SettingsIcon name="back" rtl={rtl}/></Link>
    <h3 className="sheet__title sov-h" id="sov-h" tabIndex={-1}>{on?<bdi>{item.name}</bdi>:named(say('connectTitle'),item.name)}</h3></div>
   <div className="sheet__meta"><span>{say(`category.${item.category}`)}</span><span aria-hidden="true">·</span><span>{say('readOnly')}</span>
    {state==='connected'&&<span className="badge"><SettingsIcon name="check"/>{say('stateConnected')}</span>}
    {state==='attention'&&<span className="badge badge--warn">{say('stateAttention')}</span>}</div>
  </header>
  <div className="apps-body apps-detail">
   <div className="app-hero"><AppTile app={item} size="lg"/><p>{item.use}</p></div>
   {state==='attention'&&<p className="ro-note sov-warn" role="note"><SettingsIcon name="shield"/><span>{say('attentionNote')}</span></p>}
   <dl className="kv app-kv">
    <div className="kv__row"><dt>{say('can')}</dt><dd>{item.can}</dd></div>
    <div className="kv__row"><dt>{say('cant')}</dt><dd>{say('cantAll')}</dd></div>
    <div className="kv__row"><dt>{say('signIn')}</dt><dd>{named(say('signInLine'),item.name)}</dd></div>
   </dl>
   {/* Choosing which Agents use an app waits on the Engine (#30): drawn as the reference draws it, marked "Soon". */}
   <section className="apps-sec" aria-labelledby="app-who-h"><h4 className="apps-sec__h" id="app-who-h">{say(on?'whoUses':'whoGets')}</h4>
    <div className="panel-card sov-soon" aria-disabled="true" title={soon}><p className="panel-empty">{soon}</p></div>
    {on&&<p className="set-hint">{say('everyAgent')}</p>}</section>
   {waiting&&<p className="set-hint" role="status">{named(say('waiting'),item.name)}</p>}
   {error&&<p className="set-err" role="alert">{say(error)}</p>}
   {owner&&on&&(asking?<div className="app-off" role="group" aria-labelledby="app-off-t"><p id="app-off-t">{named(say('disconnectAsk'),item.name)}</p>
     <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" id="app-off-cancel" disabled={pending} onClick={()=>setAsking(false)}>{say('cancel')}</button>
      <button type="button" className="btn btn--primary btn--sm" id="app-off-go" disabled={pending} onClick={disconnect}>{say('disconnect')}</button></div></div>
    :<div><button type="button" className="link-btn" id="app-off" onClick={()=>setAsking(true)}>{say('disconnect')} <bdi>{item.name}</bdi></button></div>)}
  </div>
  <footer className="modal__foot modal__foot--end">
   {owner&&state!=='connected'?<>{waiting?<button type="button" className="btn btn--secondary" id="app-wait-cancel" disabled={pending} onClick={cancel}>{say('cancel')}</button>:back}
    <button type="button" className="btn btn--primary" id="app-connect" aria-disabled={busy} onClick={()=>{ if(!busy) connect(); }}>{busy?say('connecting'):say(state==='attention'?'reconnect':'connect')}</button></>
   :<Link className="btn btn--primary" id="apps-done" href={list} replace>{say('done')}</Link>}
  </footer>
 </>;
}
