'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { AppTile } from '@/components/app-tile';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { SettingsIcon } from './settings-icons';
import { toast } from './toast';
import { appsChanged } from './company-apps-read';
import type { AppAgent, AppCategory, CompanyApp } from '@/lib/app-catalogue.mjs';

// Settings, Apps (#30; design-reference: appsHeadHTML, appsListHTML, appCardHTML, appDetailHTML, the app-agent and
// app-pick cases). The server reads each Agent's state of each app from the Engine (lib/company-app-items.ts); here the
// list is searched and filtered, and the Owner turns an app on or off for each Agent, follows its sign-in and
// disconnects it through /api/company-apps, which checks the Owner again. The same list and page are drawn in
// Settings, one address per view, and in the Connect apps sheet (app/apps-sheet.tsx, #201), where they change in place.
export type AppItem=CompanyApp&{use:string,can:string,words:string};
export type AppsPlace={kind:'address',slug:string}|{kind:'sheet',open:(key:string)=>void,back:(from:string)=>void,close:()=>void};
type Text=Record<string,string>;
// The reference's count of connected apps: every app in the Connected group, a sign-in needing attention included.
export const connectedCount=(items:AppItem[])=>items.filter(item=>item.state!=='off').length;
const sayer=(text:Text)=>(key:string,...values:string[])=>values.reduce((line,value,index)=>line.replace(`{${index}}`,()=>value),text[key]??'');
// Search reads Arabic as the reference does (arNorm): the hamza forms of alef as alef, alef maksura as ya, ta marbuta as
// ha, and no diacritics.
const fold=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[ً-ٕ]/g,'').replace(/[ةى]/g,letter=>String.fromCharCode(letter.charCodeAt(0)===0x629?0x647:0x64A));
const order:AppCategory[]=['ads','content','communication','analytics','sales','more'];
// A line naming the app or an Agent keeps each name in its own direction.
const named=(line:string,...names:string[])=>line.split(/(\{\d\})/).map((part,index)=>{ const at=/^\{(\d)\}$/.exec(part); return at?<bdi key={index}>{names[Number(at[1])]}</bdi>:part; });
type Say=(key:string,...values:string[])=>string;
// Faces stand for the Agents named beside them, so they are left to the eye (design-reference: faceStack, face).
const faces=(agents:AppAgent[])=><span className="fstack" aria-hidden="true">{agents.map(agent=><CompanyAgentFace key={agent.id} agent={{connection_id:agent.connection,name:agent.name}} size={18}/>)}</span>;
const face=(agent:AppAgent)=><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:agent.connection,name:agent.name}} size={28}/></span>;

// One step between the list and an app's page: a link in Settings, a button in the sheet, with the same id, class and
// label. `stay` keeps the person on the app's page while a sign-in is followed or a request is on its way: the control
// is marked unavailable, and in Settings it has no address, so no click of any kind leaves.
type Step={open:string}|{back:string};
function To({place,step,stay=false,...props}:{place:AppsPlace,step:Step,stay?:boolean,className:string,id:string,'aria-label'?:string,children:ReactNode}) {
 if(place.kind==='address') return stay?<a {...props} role="link" tabIndex={0} aria-disabled="true"/>
  :<Link {...props} href={overlayHref(place.slug,'apps','open' in step?{app:step.open}:{})} replace={'back' in step||undefined}/>;
 return <button type="button" {...props} aria-disabled={stay||undefined} onClick={()=>{ if(stay) return; if('open' in step) place.open(step.open); else place.back(step.back); }}/>;
}
function Close({place}:{place:AppsPlace}) {
 const {t}=useI18n();
 return place.kind==='sheet'?<button type="button" className="circle-btn" id="apps-close" aria-label={t('sheetClose')} onClick={place.close}><ShellIcon name="x"/></button>:null;
}
// The sheet's title names the dialog; Settings' is the overlay's page heading.
const titled=(place:AppsPlace)=>place.kind==='sheet'?{className:'sheet__title',id:'apps-title'}:{className:'sheet__title sov-h',id:'sov-h'};

function State({app,say}:{app:CompanyApp,say:Say}) {
 if(app.state==='connected') return <span className="app__state"><SettingsIcon name="check"/><span>{say('stateConnected')}</span>{faces(app.agents.filter(agent=>agent.state==='connected'))}</span>;
 return <span className={`app__state ${app.state==='attention'?'app__state--warn':'app__state--off'}`}>{say(app.state==='attention'?'stateAttention':'stateOff')}</span>;
}

// `items` are the apps the Engine offers: null when it cannot be read, undefined while the sheet is still reading them.
export function AppsList({place,owner,items:read,text}:{place:AppsPlace,owner:boolean,items:AppItem[]|null|undefined,text:Text}) {
 const say=sayer(text); const items=read??[];
 const [query,setQuery]=useState(''); const [category,setCategory]=useState<AppCategory|'all'>('all');
 const search=useRef<HTMLInputElement>(null);
 const needle=fold(query.trim());
 const shown=items.filter(item=>(category==='all'||item.category===category)&&fold(item.words).includes(needle));
 const card=(item:AppItem)=>{
  const action=item.state==='connected'||item.source==='custom'?'manage':item.state==='attention'?'reconnect':'connect';
  return <article key={item.key} className="app-card" aria-labelledby={`app-t-${item.key}`}>
   <div className="app__top"><AppTile app={item} size="lg"/><div className="app__titles"><h5 className="app__name" id={`app-t-${item.key}`}><bdi>{item.name}</bdi></h5><span className="app__cat">{say(`category.${item.category}`)}</span></div></div>
   <p className="app__use od-clamp-2">{item.use}</p>
   {item.care&&<p className="app__care">{say(item.care==='money'?'careMoney':'careCustomers')}</p>}
   <div className="app__foot"><State app={item} say={say}/>
    {owner&&<To place={place} step={{open:item.key}} className="btn btn--secondary btn--sm" id={`app-btn-${item.key}`} aria-label={say(`${action}Label`,item.name)}>{say(action)}</To>}</div>
  </article>;
 };
 const group=(title:string,list:AppItem[],id:string)=>list.length>0&&<section className="apps-sec" aria-labelledby={id}><h4 className="apps-sec__h" id={id}>{title} <span className="num muted">{list.length}</span></h4><div className="apps-grid">{list.map(card)}</div></section>;
 return <>
  <header className="apps-head">
   <div className="sheet__top"><h3 {...titled(place)} tabIndex={-1}>{say('title')}</h3>
    {read!==undefined&&<span className="badge apps-count"><SettingsIcon name="check"/><span className="num">{connectedCount(items)}</span> {say('connected')}</span>}<Close place={place}/></div>
   <p className="apps-sub">{say(owner?'subOwner':'subOther')}</p>
   <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{say('search')}</span><input ref={search} id="apps-q" type="search" autoComplete="off" placeholder={say('searchHint')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
   {read!==undefined&&<div className="tpl-cats" role="group" aria-label={say('categories')}>{(['all',...order.filter(kind=>items.some(item=>item.category===kind))] as const).map(kind=>
    <button key={kind} type="button" className="chip" id={`apps-cat-${kind}`} aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{say(`category.${kind}`)}<span className="chip__n num">{items.filter(item=>kind==='all'||item.category===kind).length}</span></button>)}</div>}
  </header>
  <div className="apps-body" id="apps-body" aria-live="polite">{read===undefined?null
   :read===null?<div className="panel-card"><p className="panel-empty">{say('unreadable')}</p></div>
   :!read.length?<div className="panel-card"><p className="panel-empty">{say('noneOffered')}</p></div>
   :shown.length?<>{group(say('groupOn'),shown.filter(item=>item.state!=='off'),'apps-h-on')}{group(say('groupOff'),shown.filter(item=>item.state==='off'),'apps-h-off')}</>
   :<div className="tpl-empty"><b>{needle?say('noMatch',query.trim()):say('noneHere')}</b><span>{say('emptyHint')}</span>
    {needle&&<div className="tpl-empty__acts"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>{setQuery('');search.current?.focus();}}>{say('clear')}</button></div>}</div>}</div>
 </>;
}

async function ask(body:Record<string,unknown>) {
 try {
  const response=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json().catch(()=>({})) as Record<string,unknown>};
 } catch { return {ok:false,body:{}}; }
}
async function askServer(body:Record<string,unknown>) {
 try {
  const response=await fetch('/api/company-servers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json().catch(()=>({})) as Record<string,unknown>};
 } catch { return {ok:false,body:{}}; }
}
// A sign-in Hermes keeps for fifteen minutes is followed at most that long.
const pollEvery=2000, pollFor=15*60*1000;

// The sign-ins the Owner asked for, one Agent at a time: the browser opens the vendor's window only at a click, so each
// Agent after the first waits for its own click. `following` is the Agent whose window is open; `done` those connected.
type Run={queue:string[],following:string|null,done:string[],one:boolean};
const idle:Run={queue:[],following:null,done:[],one:false};

export function AppDetail(props:{place:AppsPlace,company:string,owner:boolean,rtl:boolean,item:AppItem,text:Text,failed:boolean}) {
 // The card that adds a server is a form, not a connection: it has no Agent state yet. Each view keeps its own hooks.
 return props.item.source==='own'?<OwnTool place={props.place} company={props.company} owner={props.owner} rtl={props.rtl} item={props.item} text={props.text}/>:<CatalogueDetail {...props}/>;
}
function CatalogueDetail({place,company,owner,rtl,item,text,failed}:{place:AppsPlace,company:string,owner:boolean,rtl:boolean,item:AppItem,text:Text,failed:boolean}) {
 const say=sayer(text); const router=useRouter(); const {language}=useI18n();
 const [run,setRun]=useState<Run>(idle); const [asking,setAsking]=useState(false); const [error,setError]=useState(failed?'signInFailed':'');
 const [token,setToken]=useState(''); const [values,setValues]=useState<Record<string,string>>({});
 const own=item.agents.filter(agent=>agent.own);
 const [picks,setPicks]=useState<string[]>(()=>own.filter(agent=>agent.main).map(agent=>agent.id)); const [pickError,setPickError]=useState(false);
 const [pending,startTransition]=useTransition();
 const focusNext=useRef<string|null>(null);
 const state=item.state; const on=state!=='off'; const waiting=run.following!==null;
 // A server with no sign-in, or a token, is turned on at the click: no vendor window opens.
 const direct=item.auth==='none'||item.auth==='header';
 const custom=item.source==='custom';
 const nameOf=(id:string)=>item.agents.find(agent=>agent.id===id)?.name??'';
 const names=(ids:string[])=>ids.map(nameOf).join(say('namesSep'));
 // After a refresh draws the page again, the keyboard goes where the step left it.
 useEffect(()=>{ const id=focusNext.current; if(id&&document.getElementById(id)) { focusNext.current=null; document.getElementById(id)?.focus(); } });
 // Settings draws its apps on the server and reads them again with the page; the sidebar's count and the sheet read
 // them in the browser.
 const address=place.kind==='address';
 const refreshApps=()=>{ void appsChanged(company,language); if(address) router.refresh(); };
 // The vendor's window, and the sign-in being followed in it, for the page closing under it (the sheet closed, Settings
 // left): that sign-in is cancelled, its window closed, and the person told.
 const vendor=useRef<Window|null>(null);
 const followed=useRef<{company:string,agent:string,app:string,said:string}|null>(null);
 useEffect(()=>{ followed.current=run.following?{company,agent:run.following,app:item.key,said:say('signInCancelled',item.name)}:null; });
 useEffect(()=>()=>{
  const left=followed.current; if(!left) return;
  void fetch('/api/company-apps',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({company:left.company,agent:left.agent,app:left.app,action:'cancel'})}).catch(()=>{});
  vendor.current?.close();
  toast(left.said,{icon:'x'});
 },[]);
 // While the vendor's window is open the sign-in is followed until it connects, fails, or the page closes.
 useEffect(()=>{
  const agent=run.following;
  if(!agent) return;
  let stopped=false, timer:ReturnType<typeof setTimeout>|undefined; const until=Date.now()+pollFor;
  const poll=async()=>{
   const answer=await ask({company,agent,app:item.key,action:'poll'});
   if(stopped) return;
   const status=String(answer.body.status||'');
   if(answer.ok&&status==='waiting'&&Date.now()<until) { timer=setTimeout(poll,pollEvery); return; }
   if(!(answer.ok&&status==='connected')) {
    setError(answer.ok?'signInFailed':`error.${String(answer.body.error||'appsFailed')}`);
    // Agents already connected in this run stay so; the rest wait for another click.
    if(run.done.length) { setRun({...run,following:null}); refreshApps(); } else setRun(idle);
    return;
   }
   const done=[...run.done,agent]; const queue=run.queue.filter(id=>id!==agent);
   if(queue.length) { setRun({...run,queue,following:null,done}); focusNext.current='app-connect'; return; }
   setRun(idle);
   if(run.one) { toast(say('agentCanUse',nameOf(agent),item.name)); focusNext.current=`app-ag-${agent}`; }
   else { toast(say('connectedNames',item.name,names(done))); focusNext.current='apps-done'; }
   refreshApps();
  };
  timer=setTimeout(poll,pollEvery);
  return ()=>{ stopped=true; clearTimeout(timer); };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[run,company,item.key,router,language,address]);
 // Leaving with a queue part done reads the apps again, so the list behind this page shows those Agents connected.
 const leaving=useRef({done:0,refreshApps});
 useEffect(()=>{ leaving.current={done:run.done.length,refreshApps}; });
 useEffect(()=>()=>{ if(leaving.current.done) leaving.current.refreshApps(); },[]);
 // The vendor's window is opened at the click, before the answer, so the browser lets it open; it is pointed at the
 // vendor once gtmworks has the sign-in page, and never knows this page. A token or no-sign-in server turns on without a
 // window: its reach is the answer.
 const ready=()=>{
  if(item.auth==='header'&&!token.trim()) { setError('tokenNeeded'); return false; }
  const missing=(item.fields||[]).find(field=>field.required&&!values[field.name]?.trim());
  if(missing) { setError('envRequired'); return false; }
  return true;
 };
 const connect=(queue:string[],one:boolean,done:string[]=[])=>startTransition(async()=>{
  const agent=queue[0]; if(!agent||!ready()) return;
  setError('');
  const body={company,app:item.key,action:'connect',...(item.fields?.length?{fields:values}:{}),...(item.auth==='header'?{token}:{})};
  if(direct) {
   const doneNow:string[]=[];
   for(const id of queue) {
    const answer=await ask({...body,agent:id});
    if(!answer.ok) { setError(`error.${String(answer.body.error||'appsFailed')}`); if(doneNow.length) refreshApps(); return; }
    if(answer.body.status!=='connected') { setError('connectAttention'); if(doneNow.length) refreshApps(); return; }
    doneNow.push(id);
   }
   setToken(''); setRun(idle); refreshApps();
   if(one&&queue.length===1) { toast(say('agentCanUse',nameOf(agent),item.name)); focusNext.current=`app-ag-${agent}`; }
   else { toast(say('connectedNames',item.name,names([...done,...doneNow]))); focusNext.current='apps-done'; }
   return;
  }
  // A blocked window starts no sign-in, and the page stays where it is.
  const opened=window.open('about:blank','_blank');
  if(!opened) { setError('popupBlocked'); return; }
  const answer=await ask({...body,agent});
  if(!answer.ok) { opened.close(); setError(`error.${String(answer.body.error||'appsFailed')}`); setRun(done.length?{queue,following:null,done,one}:idle); return; }
  opened.opener=null; opened.location.href=String(answer.body.url); vendor.current=opened; setRun({queue,following:agent,done,one});
 });
 const cancel=()=>startTransition(async()=>{
  if(run.following) await ask({company,agent:run.following,app:item.key,action:'cancel'});
  setRun(idle); if(run.done.length) refreshApps();
 });
 const turnOff=(agent:AppAgent)=>startTransition(async()=>{
  setError('');
  const answer=await ask({company,agent:agent.id,app:item.key,action:'disconnect'});
  if(!answer.ok) { setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
  toast(say('agentCannotUse',agent.name,item.name),{icon:'x'});
  focusNext.current=`app-ag-${agent.id}`;
  refreshApps();
 });
 const disconnect=()=>startTransition(async()=>{
  const answer=await ask({company,app:item.key,action:'disconnect'});
  if(!answer.ok) { setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
  toast(say(custom?'removed':'disconnected',item.name),{icon:'x'});
  if(place.kind==='address') router.replace(overlayHref(place.slug,'apps')); else place.back(item.key);
  void appsChanged(company,language); if(address) router.refresh();
 });
 const busy=pending||waiting;
 // Connect on an app that is off signs in for every picked Agent, in the list's order; none picked is said first.
 const connectPicked=()=>{
  const queue=own.filter(agent=>picks.includes(agent.id)).map(agent=>agent.id);
  if(!queue.length) { setPickError(true); document.getElementById(`app-pick-${own[0]?.id}`)?.focus(); return; }
  connect(queue,false);
 };
 // The picks are fixed once a sign-in starts, so the Agents still waiting are the ones ticked.
 const pick=(id:string)=>{ if(busy||run.queue.length) return; const next=picks.includes(id)?picks.filter(other=>other!==id):[...picks,id]; setPicks(next); if(next.length) setPickError(false); };
 // The Agents that lose it on Disconnect: with the app on, at least one.
 const having=own.filter(agent=>agent.state==='connected'||agent.state==='attention');
 const sharedWith=(agent:AppAgent)=>(item.agents.find(other=>other.own&&other.connection===agent.connection)??item.agents.find(other=>other.main))?.name??'';
 const line=(agent:AppAgent)=>!agent.own?named(say('agentShares'),sharedWith(agent)):agent.state===null?say('agentUnread')
  :say(agent.state==='connected'?'agentOn':agent.state==='attention'?'stateAttention':'agentOff');
 const back=<To place={place} step={{back:item.key}} stay={busy} className="btn btn--secondary" id="app-cancel">{say(owner&&state==='off'?'cancel':'done')}</To>;
 const next=run.queue[0];
 return <>
  <header className="apps-head">
   <div className="sheet__top"><To place={place} step={{back:item.key}} stay={busy} className="circle-btn" id="apps-back" aria-label={say('back')}><SettingsIcon name="back" rtl={rtl}/></To>
    <h3 {...titled(place)} tabIndex={-1}>{on?<bdi>{item.name}</bdi>:named(say('connectTitle'),item.name)}</h3><Close place={place}/></div>
   <div className="sheet__meta"><span>{say(`category.${item.category}`)}</span><span aria-hidden="true">·</span><span>{say('allTools')}</span>
    {state==='connected'&&<span className="badge"><SettingsIcon name="check"/>{say('stateConnected')}</span>}
    {state==='attention'&&<span className="badge badge--warn">{say('stateAttention')}</span>}</div>
  </header>
  <div className="apps-body apps-detail">
   <div className="app-hero"><AppTile app={item} size="lg"/><p>{item.use}</p></div>
   {item.care&&<p className="ro-note sov-warn" role="note"><SettingsIcon name="shield"/><span>{say(item.care==='money'?'careMoney':'careCustomers')}</span></p>}
   {state==='attention'&&<p className="ro-note sov-warn" role="note"><SettingsIcon name="shield"/><span>{say('attentionNote')}</span></p>}
   <dl className="kv app-kv">
    <div className="kv__row"><dt>{say('can')}</dt><dd>{item.can}</dd></div>
    <div className="kv__row"><dt>{say('kindTitle')}</dt><dd>{say(item.auth==='header'?'kindHeader':item.auth==='oauth'?'kindOauth':'kindNone')}</dd></div>
    {item.auth==='oauth'&&<div className="kv__row"><dt>{say('signIn')}</dt><dd>{named(say('signInLine'),item.name)}</dd></div>}
   </dl>
   {owner&&item.auth==='header'&&<section className="apps-sec" aria-labelledby="app-token-h"><h4 className="apps-sec__h" id="app-token-h">{say('token')}</h4>
    <label className="panel-card set-field"><span>{say('tokenHint')}</span><input id="app-token" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)}/><span className="set-hint">{say('tokenNote')}</span></label></section>}
   {owner&&Boolean(item.fields?.length)&&<section className="apps-sec" aria-labelledby="app-env-h"><h4 className="apps-sec__h" id="app-env-h">{say('env')}</h4>
    <div className="panel-card">{item.fields!.map(field=><label key={field.name} className="set-field"><span>{field.prompt||field.name}{field.required&&<span aria-hidden="true"> *</span>}</span>
     <input id={`app-env-${field.name}`} type={/(SECRET|KEY|TOKEN)$/.test(field.name)?'password':'text'} autoComplete="off" value={values[field.name]??''} onChange={event=>setValues({...values,[field.name]:event.target.value})}/></label>)}</div></section>}
   {on?<section className="apps-sec" aria-labelledby="app-who-h"><h4 className="apps-sec__h" id="app-who-h">{say('whoUses')}</h4>
     <ul className="panel-card">{item.agents.map(agent=><li key={agent.id} className="panel-row">{face(agent)}
      <span className="panel-row__text"><span className="panel-row__t" id={`app-ag-t-${agent.id}`}><bdi>{agent.name}</bdi></span><span className="panel-row__d">{line(agent)}</span></span>
      {owner&&agent.own&&agent.state==='attention'&&<button type="button" className="btn btn--secondary btn--sm" id={`app-ag-re-${agent.id}`} aria-label={say('reconnectFor',agent.name)} aria-disabled={busy} onClick={()=>{ if(!busy) connect([agent.id],true); }}>{say('reconnect')}</button>}
      {owner&&agent.own&&agent.state!==null&&<button type="button" className="switch" role="switch" id={`app-ag-${agent.id}`} aria-checked={agent.state!=='off'} aria-labelledby={`app-ag-t-${agent.id}`} aria-disabled={busy}
       onClick={()=>{ if(busy) return; if(agent.state==='off') connect([agent.id],true); else turnOff(agent); }}/>}</li>)}</ul></section>
    :owner&&<section className="apps-sec" aria-labelledby="app-pick-h"><h4 className="apps-sec__h" id="app-pick-h">{say('whoGets')} <span className="num muted">{picks.length}</span></h4>
     <div className="panel-card" role="group" aria-labelledby="app-pick-h" aria-describedby="app-pick-err">{own.map(agent=>{ const picked=picks.includes(agent.id);
      return <button key={agent.id} type="button" className="panel-row tm-pick" role="checkbox" id={`app-pick-${agent.id}`} aria-checked={picked} aria-disabled={busy||run.queue.length>0||undefined} onClick={()=>pick(agent.id)}>
       {face(agent)}<span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span></span>
       <span className="tm-check" aria-hidden="true">{picked&&<ShellIcon name="check"/>}</span></button>; })}</div>
     <span className="set-err" id="app-pick-err" hidden={!pickError}>{say('pickOne')}</span></section>}
   {waiting&&<p className="set-hint" role="status">{named(say('waiting'),item.name)}</p>}
   {error&&<p className="set-err" role="alert">{say(error)}</p>}
   {owner&&on&&(asking?<div className="app-off" role="group" aria-labelledby="app-off-t"><p id="app-off-t">{named(say(custom?'removeAsk':having.length>1?'disconnectAskMany':'disconnectAsk'),item.name,names(having.map(agent=>agent.id)))}</p>
     <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" id="app-off-cancel" disabled={pending} onClick={()=>setAsking(false)}>{say('cancel')}</button>
      <button type="button" className="btn btn--primary btn--sm" id="app-off-go" disabled={pending} onClick={disconnect}>{say(custom?'remove':'disconnect')}</button></div></div>
    :<div><button type="button" className="link-btn" id="app-off" onClick={()=>setAsking(true)}>{say(custom?'remove':'disconnect')} <bdi>{item.name}</bdi></button></div>)}
  </div>
  <footer className="modal__foot modal__foot--end">
   {owner&&(state!=='connected'||waiting||next)?<>{waiting?<button type="button" className="btn btn--secondary" id="app-wait-cancel" disabled={pending} onClick={cancel}>{say('cancel')}</button>:back}
    <button type="button" className="btn btn--primary" id="app-connect" aria-disabled={busy} onClick={()=>{
     if(busy) return;
     if(next) connect(run.queue,run.one,run.done);
     else if(state==='off') connectPicked();
     else connect(own.filter(agent=>agent.state==='attention').map(agent=>agent.id),false);
    }}>{busy?say('connecting'):next?named(say('connectFor'),nameOf(next)):say(state==='attention'?'reconnect':'connect')}</button></>
   :<To place={place} step={{back:item.key}} stay={busy} className="btn btn--primary" id="apps-done">{say('done')}</To>}
  </footer>
 </>;
}

// The Owner's own server (#458): a name, an address, the sign-in kind and, for a token, the token itself. Test adds it to
// the chosen Agent's profile and reads back the tools the server lists (names only); Add turns it on, and an OAuth server
// then opens the vendor's window as every app does. The token is kept in this form until the answer and cleared at once;
// gtmworks never stores or returns it.
function OwnTool({place,company,owner,rtl,item,text}:{place:AppsPlace,company:string,owner:boolean,rtl:boolean,item:AppItem,text:Text}) {
 const say=sayer(text); const router=useRouter(); const {language}=useI18n();
 const own=item.agents.filter(agent=>agent.own);
 const [name,setName]=useState(''); const [address,setAddress]=useState('');
 const [kind,setKind]=useState<'oauth'|'header'|'none'>('oauth'); const [token,setToken]=useState('');
 const [picks,setPicks]=useState<string[]>(()=>own.filter(agent=>agent.main).map(agent=>agent.id)); const [queue,setQueue]=useState<string[]>([]);
 const [tools,setTools]=useState<string[]|null>(null); const [tested,setTested]=useState('');
 const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
 const [following,setFollowing]=useState<{key:string,agent:string}|null>(null);
 const nameOf=(id:string)=>item.agents.find(agent=>agent.id===id)?.name??'';
 const vendor=useRef<Window|null>(null); const left=useRef(following);
 const addressPage=place.kind==='address';
 const refreshApps=()=>{ void appsChanged(company,language); if(addressPage) router.refresh(); };
 useEffect(()=>{ left.current=following; });
 // Closing the page under an OAuth sign-in cancels it, as every app's page does.
 useEffect(()=>()=>{
  const gone=left.current; if(!gone) return;
  void fetch('/api/company-apps',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent:gone.agent,app:gone.key,action:'cancel'})}).catch(()=>{});
  vendor.current?.close();
 },[]);
 useEffect(()=>{
  const agent=following?.agent, key=following?.key;
  if(!agent||!key) return;
  let stopped=false, timer:ReturnType<typeof setTimeout>|undefined; const until=Date.now()+pollFor;
  const poll=async()=>{
   const answer=await ask({company,agent,app:key,action:'poll'});
   if(stopped) return;
   const status=String(answer.body.status||'');
   if(answer.ok&&status==='waiting'&&Date.now()<until) { timer=setTimeout(poll,pollEvery); return; }
   setFollowing(null);
   if(answer.ok&&status==='connected') {
    toast(say('ownAdded',name.trim()||key));
    // The Agent stays first until its sign-in is connected; only then does the queue move on, and the form finishes
    // only when every picked Agent has connected.
    const rest=queue.slice(1);
    if(rest.length) { setQueue(rest); setToken(''); return; }
    setQueue([]); refreshApps(); if(addressPage) router.replace(overlayHref(place.slug,'apps')); else place.back(item.key);
   } else setError('connectAttention');
  };
  timer=setTimeout(poll,pollEvery);
  return ()=>{ stopped=true; clearTimeout(timer); };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[following,company,queue]);
 const pick=(id:string)=>{ if(busy) return; setPicks(picks.includes(id)?picks.filter(other=>other!==id):[...picks,id]); };
 const submit=(action:'add'|'test')=>{
  if(busy) return;
  if(!name.trim()||!address.trim()) { setError('ownRequired'); return; }
  if(kind==='header'&&!token.trim()) { setError('tokenNeeded'); return; }
  if(!picks.length) { setError('pickOne'); return; }
  const popup=action==='add'&&kind==='oauth'?window.open('about:blank','_blank'):null;
  if(action==='add'&&kind==='oauth'&&!popup) { setError('popupBlocked'); return; }
  void (async()=>{
   setBusy(true); setError(''); setTools(null); setTested('');
   const targets=action==='test'||kind!=='oauth'?picks:(queue.length?queue:picks);
   if(action==='test') {
    let shown:{state?:unknown,tools?:unknown}|null=null;
    for(const agent of targets) {
     const answer=await askServer({company,agent,action,name,url:address,kind,token:kind==='header'?token:''});
     if(!answer.ok) { setBusy(false); setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
     if(!shown||(shown.state!=='connected'&&answer.body.state==='connected')) shown=answer.body;
    }
    setTools(Array.isArray(shown?.tools)?shown.tools as string[]:[]);
    setTested(String(shown?.state||'')); setToken(''); setBusy(false); return;
   }
   for(const agent of targets) {
    const answer=await askServer({company,agent,action,name,url:address,kind,token:kind==='header'?token:''});
    if(!answer.ok) { popup?.close(); setBusy(false); setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
    if(kind==='oauth') {
     const url=typeof answer.body.url==='string'?answer.body.url:null;
     if(!url) { popup?.close(); setBusy(false); setError(`error.${String(answer.body.error||'appsFailed')}`); return; }
     const key=String(answer.body.key||''); popup!.opener=null; popup!.location.href=url; vendor.current=popup; setToken('');
     setQueue(targets); setFollowing({key,agent}); setBusy(false); return;
    }
   }
   setQueue([]); setToken(''); setBusy(false);
   toast(say('ownAdded',name.trim())); refreshApps(); if(addressPage) router.replace(overlayHref(place.slug,'apps')); else place.back(item.key);
  })();
 };
 return <>
  <header className="apps-head">
   <div className="sheet__top"><To place={place} step={{back:item.key}} stay={busy} className="circle-btn" id="apps-back" aria-label={say('back')}><SettingsIcon name="back" rtl={rtl}/></To>
    <h3 {...titled(place)} tabIndex={-1}>{say('ownName')}</h3><Close place={place}/></div>
   <p className="apps-sub">{say('ownIntro')}</p>
  </header>
  <div className="apps-body apps-detail">
   <div className="panel-card own-form">
    <label className="set-field"><span>{say('name')}</span><input id="own-name" type="text" autoComplete="off" placeholder={say('nameHint')} aria-invalid={error==='ownRequired'&&!name.trim()||undefined} aria-describedby="own-err" value={name} onChange={event=>setName(event.target.value)}/></label>
    <label className="set-field"><span>{say('address')}</span><input id="own-url" type="url" inputMode="url" autoComplete="off" placeholder={say('addressHint')} aria-invalid={error==='ownRequired'&&!address.trim()||undefined} aria-describedby="own-err" value={address} onChange={event=>setAddress(event.target.value)}/></label>
    <label className="set-field"><span>{say('kind')}</span><select id="own-kind" value={kind} onChange={event=>setKind(event.target.value as 'oauth'|'header'|'none')}>
     <option value="oauth">{say('kindOauth')}</option><option value="header">{say('kindHeader')}</option><option value="none">{say('kindNone')}</option></select></label>
    {kind==='header'&&<label className="set-field"><span>{say('token')}</span><input id="own-token" type="password" autoComplete="off" aria-invalid={error==='tokenNeeded'||undefined} aria-describedby="own-token-hint own-err" value={token} onChange={event=>setToken(event.target.value)}/><span className="set-hint" id="own-token-hint">{say('tokenNote')}</span></label>}
   </div>
   {owner&&<section className="apps-sec" aria-labelledby="own-pick-h"><h4 className="apps-sec__h" id="own-pick-h">{say('whoGets')} <span className="num muted">{picks.length}</span></h4>
    <div className="panel-card" role="group" aria-labelledby="own-pick-h">{own.map(agent=>{ const picked=picks.includes(agent.id);
     return <button key={agent.id} type="button" className="panel-row tm-pick" role="checkbox" id={`own-pick-${agent.id}`} aria-checked={picked} aria-disabled={busy||undefined} onClick={()=>pick(agent.id)}>
      {face(agent)}<span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span></span>
      <span className="tm-check" aria-hidden="true">{picked&&<ShellIcon name="check"/>}</span></button>; })}</div></section>}
   {following&&<p className="set-hint" role="status">{say('waiting',name.trim())}</p>}
   {error&&<p className="set-err" role="alert" id="own-err">{say(error)}</p>}
   {tools&&<section className="apps-sec" aria-labelledby="own-tools-h"><h4 className="apps-sec__h" id="own-tools-h">{say('toolsListed')} <span className="num muted">{tools.length}</span></h4>
    <div className="panel-card">{tools.length?<ul className="own-tools">{tools.map(tool=><li key={tool}><code>{tool}</code></li>)}</ul>
     :<p className="panel-empty">{tested==='connected'?say('toolsNone'):say('toolsFailed')}</p>}</div></section>}
  </div>
  <footer className="modal__foot modal__foot--end">
   <button type="button" className="btn btn--secondary" id="own-test" aria-disabled={busy||following!==null||undefined} onClick={()=>{ if(!busy&&!following) submit('test'); }}>{busy?say('testing'):say('test')}</button>
   <button type="button" className="btn btn--primary" id="own-add" aria-disabled={busy||following!==null||undefined} onClick={()=>{ if(!busy&&!following) submit('add'); }}>{busy?say('adding'):queue.length?named(say('addFor'),nameOf(queue[0])):say('add')}</button>
  </footer>
 </>;
}
