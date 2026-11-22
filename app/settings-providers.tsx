'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { AppTile } from '@/components/app-tile';
import { SettingsIcon } from './settings-icons';
import { toast } from './toast';
import type { CompanySignIns, SubscriptionState } from '@/lib/company-sign-in.mjs';

// The Company's Providers (#617, spec #611; GLOSSARY: Provider): one list of the ways its Engine reaches models, a
// subscription the Company signed in to or an API key it holds, each with its brand's own mark, and the selected one's
// details beside it on a desktop, or on its own page with one Back on a phone. Nothing here carries a secret: a
// subscription is a state the server read from the Company's own Engine (#384, ADR 0018), a key is a yes or no
// (lib/provider-keys.mjs), and a key the Owner types goes straight to the route that hands it to the Engine, then leaves
// the page. Every change goes through the routes that check the Owner again. Adding a second account of one kind,
// naming, ordering and switching one off are #618 and #619; until then the Owner connects what is not connected yet
// from the list's last row.

type SubscriptionProvider='openai-codex'|'anthropic';
type KeyRow={provider:string,label:string,set:boolean};
export type Named={agent:string|null,name:string|null};
export type ProviderKeysData={keys:KeyRow[]|null,waiting:Named[]|null,leftover:Named[]|null,unknown:Named[]|null};
type ProvidersSubscriptions={available:boolean,signIns:CompanySignIns['signIns'],noEngine:boolean};

// Each subscription shows its product's mark, the reference's ChatGPT and Claude (#424).
const subscriptionLogo:Record<SubscriptionProvider,string>={'openai-codex':'openai',anthropic:'claude'};
const subscriptionName:Record<SubscriptionProvider,string>={'openai-codex':'signInChatGPT',anthropic:'signInClaude'};
const stateText:Record<SubscriptionState,string>={connected:'signInConnected',mainAgentOnly:'signInMainAgentOnly',someAgentsOnly:'signInSomeAgentsOnly',notConnected:'signInNotConnected'};
const subscriptions:SubscriptionProvider[]=['openai-codex','anthropic'];
type Entry={id:string,kind:'subscription'|'key',provider:string,name:string,state:SubscriptionState|'set'};
// The list keeps the Engine's own order: a signed-in subscription before a key (agent/credential_pool.py
// _normalize_pool_priorities, v0.23.0), so the first row is the one the Agents use first.
function entriesOf(t:(key:string)=>string,signIns:CompanySignIns['signIns'],keys:KeyRow[]|null):Entry[] {
 const signed=subscriptions.filter(provider=>signIns&&signIns[provider].state!=='notConnected')
  .map(provider=>({id:`sub-${provider}`,kind:'subscription' as const,provider,name:t(subscriptionName[provider]),state:signIns![provider].state}));
 const held=(keys??[]).filter(row=>row.set).map(row=>({id:`key-${row.provider}`,kind:'key' as const,provider:row.provider,name:row.label,state:'set' as const}));
 return [...signed,...held];
}
const markOf=(entry:{kind:Entry['kind'],provider:string,name:string}):{key:string,mark:string}=>({key:entry.kind==='subscription'?subscriptionLogo[entry.provider as SubscriptionProvider]:entry.provider,mark:entry.kind==='subscription'?'':Array.from(entry.name.trim())[0]?.toUpperCase()||'·'});
const partial=(state:Entry['state'])=>state==='mainAgentOnly'||state==='someAgentsOnly';

export function CompanyProviders({company,companyName,owner,subscriptions:subs,keys}:{company:string,companyName:string,owner:boolean,subscriptions:ProvidersSubscriptions,keys:ProviderKeysData|null}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 const entries=entriesOf(t,subs.signIns,keys?.keys??null);
 // What the Owner can still connect: a subscription not signed in, a provider with no key.
 const unsigned=subs.signIns?subscriptions.filter(provider=>subs.signIns![provider].state==='notConnected'):[];
 const unkeyed=(keys?.keys??[]).filter(row=>!row.set);
 const ids=[...entries.map(entry=>entry.id),...(owner?['add']:[])];
 // The person's choice: none until a row is chosen. A desktop shows the first row's details meanwhile; a phone shows the
 // list. A chosen row a change took away (a disconnect) leaves the choice empty again.
 const [chosen,setChosen]=useState<string|null>(null);
 const selected=chosen&&ids.includes(chosen)?chosen:null;
 const shown=selected??ids[0]??null;
 const list=useRef<HTMLUListElement>(null);
 // Where the focus goes once a choice is drawn: a row that opens a page of its own (a phone, where the list gives way)
 // gives it to that page's name, and Back gives it to the row again. On a desktop both stay in view and the focus stays
 // where it was. Each request is a new object, so the same move asked twice is done twice.
 const [focus,setFocus]=useState<{to:'detail'|'row',id:string}|null>(null);
 useEffect(()=>{
  if(!focus) return;
  if(focus.to==='row') { document.getElementById(`pv-row-${focus.id}`)?.focus(); return; }
  if(list.current&&getComputedStyle(list.current).display==='none') document.getElementById(`pv-d-${focus.id}-name`)?.focus();
 },[focus]);
 // A Provider the Owner just connected from the last row opens in its place, with the focus as if its row were chosen,
 // so the sign-in or key that finished is seen where it now lives.
 const listed=entries.map(entry=>entry.id).join(' ');
 const [seen,setSeen]=useState(listed);
 if(seen!==listed) {
  setSeen(listed);
  const added=entries.find(entry=>!seen.split(' ').includes(entry.id));
  if(added&&shown==='add') { setChosen(added.id); setFocus({to:'detail',id:added.id}); }
 }
 const open=(id:string)=>{ setChosen(id); setFocus({to:'detail',id}); };
 const back=()=>{ if(selected) setFocus({to:'row',id:selected}); setChosen(null); };
 const status=(entry:Entry)=>entry.kind==='key'?t('providersKeySaved'):partial(entry.state)?t('providersPartly'):t('signInConnected');
 const backButton=<button type="button" className="link-btn sov-back pv-back" onClick={back}><SettingsIcon name="back" rtl={rtl}/><span>{t('providers')}</span></button>;
 const notes=owner?[...(keys?.waiting??[]).map(item=>['settingsModelsKeyWaiting',item.name||t('settingsModelsAnAgent')]),
  ...(keys?.leftover??[]).map(item=>['settingsModelsKeyLeftover',item.name||t('settingsModelsAnAgent')])]:[];
 if(subs.noEngine) return <section className="dp-sec" aria-labelledby="md-h-pv" id="md-providers"><h4 className="dp-label" id="md-h-pv"><span>{t('providers')}</span></h4>
  <p className="ro-note sov-warn" role="note" id="sub-no-engine"><SettingsIcon name="shield"/><span>{t('noEngine')}</span></p></section>;
 return <section className="dp-sec" aria-labelledby="md-h-pv" id="md-providers"><h4 className="dp-label" id="md-h-pv"><span>{t('providers')}</span></h4>
  <div className="pv-split" data-open={selected?'':undefined}>
   <ul className="panel-card pv-list" ref={list} aria-labelledby="md-h-pv">
    {entries.map(entry=><li key={entry.id}><button type="button" className="panel-row pv-row" id={`pv-row-${entry.id}`} aria-current={entry.id===shown?'true':undefined} aria-controls={`pv-d-${entry.id}`} onClick={()=>open(entry.id)}>
     <AppTile app={markOf(entry)}/>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{entry.name}</bdi></span>
      <span className="panel-row__d"><span>{t(entry.kind==='key'?'providersKey':'providersSubscription')}</span><span aria-hidden="true"> · </span><span className={`pv-dot${partial(entry.state)?' pv-dot--part':''}`} aria-hidden="true"/><span>{status(entry)}</span></span></span>
     <span className="panel-row__icon sov-chev pv-chev"><SettingsIcon name="forward" rtl={rtl}/></span>
    </button></li>)}
    {!entries.length&&subs.signIns&&keys?.keys&&<li><p className="panel-empty" id="pv-none">{t('providersNone')}</p></li>}
    {owner&&<li><button type="button" className="panel-row pv-row" id="pv-row-add" aria-current={shown==='add'?'true':undefined} aria-controls="pv-d-add" onClick={()=>open('add')}>
     <span className="panel-row__icon"><SettingsIcon name="plus"/></span><span className="panel-row__text"><span className="panel-row__t">{t('providersAdd')}</span></span>
     <span className="panel-row__icon sov-chev pv-chev"><SettingsIcon name="forward" rtl={rtl}/></span>
    </button></li>}
   </ul>
   <div className="pv-details">
    {entries.map(entry=><div className="pv-detail" key={entry.id} id={`pv-d-${entry.id}`} role="region" aria-labelledby={`pv-d-${entry.id}-name`} hidden={entry.id!==shown}>
     {backButton}
     <header className="pv-head"><AppTile app={markOf(entry)} size="lg" label={entry.name}/>
      <span className="pv-head__t"><h5 className="pv-name" id={`pv-d-${entry.id}-name`} tabIndex={-1}><bdi>{entry.name}</bdi></h5>
       <span className="pv-type">{t(entry.kind==='key'?'providersKey':'providersSubscription')}</span></span></header>
     {entry.kind==='subscription'
      ?<SubscriptionDetail company={company} companyName={companyName} owner={owner} provider={entry.provider as SubscriptionProvider} name={entry.name} state={entry.state as SubscriptionState} keyed={(keys?.keys??[]).some(row=>row.set&&row.provider==='anthropic')}/>
      :<KeyDetail company={company} owner={owner} row={{provider:entry.provider,label:entry.name,set:true}}/>}
    </div>)}
    {owner&&<div className="pv-detail" id="pv-d-add" role="region" aria-labelledby="pv-d-add-name" hidden={shown!=='add'}>
     {backButton}
     <header className="pv-head"><span className="pv-head__t"><h5 className="pv-name" id="pv-d-add-name" tabIndex={-1}>{t('providersAdd')}</h5></span></header>
     <h6 className="pv-group">{t('providersSubscriptions')}</h6>
     {subs.available&&subs.signIns?(unsigned.length?<div className="panel-card">{unsigned.map(provider=><div className="sub-row" key={provider} id={`sub-${provider}`}>
      <SubscriptionActions company={company} companyName={companyName} owner={owner} provider={provider} name={t(subscriptionName[provider])} state="notConnected" row/>
     </div>)}</div>:<div className="panel-card"><p className="panel-empty">{t('providersAllSigned')}</p></div>)
      :<div className="panel-card"><p className="panel-empty">{t(subs.signIns===null&&subs.available?'signInUnknown':'signInNoProfile')}</p></div>}
     <p className="set-hint">{t('signInWhat')} {t('signInOneAccount')}</p>
     <h6 className="pv-group">{t('providersKeys')}</h6>
     {keys?.keys?<div className="panel-card md-keys">{unkeyed.map(row=><div className="md-key" key={row.provider} id={`mdl-key-row-${row.provider}`}>
      <KeyActions company={company} owner={owner} row={row} rowed/>
     </div>)}</div>:<div className="panel-card"><p className="panel-empty">{t(keys?'settingsModelsKeyUnread':'settingsModelsKeyNoEngine')}</p></div>}
     <p className="set-hint">{t('settingsModelsKeyWhat')} {t('settingsModelsProviderKeysHint')}</p>
    </div>}
   </div>
  </div>
  {/* A read that failed is said under the list for every Role, so no Provider reads as absent when it is only unread. */}
  {!subs.signIns&&<p className="set-hint" id="pv-no-profile">{t(subs.available?'signInUnknown':'signInNoProfile')}</p>}
  {!keys?.keys&&<p className="set-hint" id="pv-keys-unread">{t(keys?'settingsModelsKeyUnread':'settingsModelsKeyNoEngine')}</p>}
  {notes.length>0&&<ul className="set-hint md-waiting">{notes.map(([label,name],at)=><li key={`${label}-${at}`}>{t(label)} <bdi>{name}</bdi></li>)}</ul>}
  {!owner&&<p className="set-hint">{t('providersOwnerOnly')}</p>}
 </section>;
}

// A row of the details: its name facing its value.
const Fact=({label,id,children}:{label:string,id?:string,children:ReactNode})=><div className="panel-row pv-fact"><span className="panel-row__text"><span className="panel-row__d">{label}</span></span><span className="pv-fact__v" id={id}>{children}</span></div>;
// Advanced, closed until opened: what the Engine calls the Provider and how it is billed.
function Advanced({id,provider,children}:{id:string,provider:string,children?:ReactNode}) {
 const {t,language}=useI18n();
 return <details className="pv-adv" id={`${id}-adv`}><summary className="link-btn pv-adv__s"><SettingsIcon name="forward" rtl={language==='ar'}/><span>{t('providersAdvanced')}</span></summary>
  <div className="panel-card">
   <Fact label={t('providersEngineId')}><code className="pv-code" dir="ltr" translate="no">{provider}</code></Fact>
  </div>
  {children}
 </details>;
}

function SubscriptionDetail({company,companyName,owner,provider,name,state,keyed}:{company:string,companyName:string,owner:boolean,provider:SubscriptionProvider,name:string,state:SubscriptionState,keyed:boolean}) {
 const {t}=useI18n();
 return <>
  <div className="panel-card">
   <Fact label={t('providersName')}><bdi>{name}</bdi></Fact>
   <Fact label={t('providersConnection')}>{t('providersSubscription')}</Fact>
   <div className="sub-row" id={`sub-${provider}`}><SubscriptionActions company={company} companyName={companyName} owner={owner} provider={provider} name={name} state={state}/></div>
  </div>
  {provider==='anthropic'&&state==='connected'&&keyed&&<p className="set-hint" id="sub-anthropic-order">{t('signInKeyFallback')}</p>}
  <Advanced id={`pv-d-sub-${provider}`} provider={provider}><p className="set-hint">{t('signInWhat')} {t('signInHint')} {t('signInOneAccount')}</p></Advanced>
 </>;
}

function KeyDetail({company,owner,row}:{company:string,owner:boolean,row:KeyRow}) {
 const {t}=useI18n();
 return <>
  <div className="panel-card md-keys">
   <Fact label={t('providersName')}><bdi>{row.label}</bdi></Fact>
   <Fact label={t('providersConnection')}>{t('providersKey')}</Fact>
   <div className="md-key" id={`mdl-key-row-${row.provider}`}><KeyActions company={company} owner={owner} row={row}/></div>
  </div>
  <Advanced id={`pv-d-key-${row.provider}`} provider={row.provider}><p className="set-hint">{t('settingsModelsKeyWhat')} {t('settingsModelsProviderKeysHint')}</p></Advanced>
 </>;
}

type Started={session:string,code:string,link:string,interval:number};
async function ask(body:object):Promise<{ok:boolean,body:Record<string,unknown>}> {
 try {
  const response=await fetch('/api/company-sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json() as Record<string,unknown>};
 } catch { return {ok:false,body:{error:'signInFailed'}}; }
}
// The Company's name in the command as the shell reads it back exactly, with the characters a double quote would expand.
const quoted=(value:string)=>`"${value.replace(/[\\"$`]/g,char=>`\\${char}`)}"`;

// One subscription's state and, for the Owner, its sign-in (#3, #384): ChatGPT's starts here (a code and a link) and is
// followed until it is connected; Claude's is the install's command line only. A sign-in that serves some Agents only can
// be removed, or replaced by one every Agent uses. `row` draws it as a row of the list of what is not connected yet,
// with its mark; in a Provider's details the header shows the mark.
function SubscriptionActions({company,companyName,owner,provider,name,state,row=false}:{company:string,companyName:string,owner:boolean,provider:SubscriptionProvider,name:string,state:SubscriptionState,row?:boolean}) {
 const {t}=useI18n(); const router=useRouter();
 const [started,setStarted]=useState<Started|null>(null);
 const [note,setNote]=useState<{key:string,alert?:boolean}|null>(null);
 const [pending,startTransition]=useTransition();
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{ if(timer.current) clearTimeout(timer.current); },[]);
 // While a sign-in waits, Hermes is asked again at the interval it gave until the person finishes, it ends, or the page
 // closes. A finished one reads as a toast, since the Provider then moves out of this list into its own row.
 useEffect(()=>{
  if(!started) return;
  let stopped=false;
  const poll=async()=>{
   const answer=await ask({company,provider,intent:'poll',session:started.session});
   if(stopped) return;
   const status=String(answer.body.status||'');
   if(answer.ok&&status==='pending') { timer.current=setTimeout(poll,started.interval*1000); return; }
   setStarted(null);
   if(answer.ok&&status==='approved') toast(t('signInDone'));
   else setNote({key:answer.ok?'signInEnded':String(answer.body.error||'signInFailed'),alert:true});
   router.refresh();
  };
  timer.current=setTimeout(poll,started.interval*1000);
  return ()=>{ stopped=true; if(timer.current) clearTimeout(timer.current); };
 },[started,company,provider,router,t]);
 const act=(intent:'start'|'cancel'|'disconnect')=>startTransition(async()=>{
  setNote(null);
  const answer=await ask({company,provider,intent,...(intent==='cancel'&&started?{session:started.session}:{})});
  if(intent==='start') {
   if(answer.ok) setStarted({session:String(answer.body.session),code:String(answer.body.code),link:String(answer.body.link),interval:Number(answer.body.interval)||5});
   else setNote({key:String(answer.body.error||'signInFailed'),alert:true});
   return;
  }
  if(intent==='cancel') { setStarted(null); return; }
  if(!answer.ok) { setNote({key:String(answer.body.error||'signInFailed'),alert:true}); return; }
  router.refresh();
 });
 const disconnect=owner&&(state==='connected'||partial(state)); const connect=owner&&(state==='notConnected'||partial(state));
 const command=`gtmworks sign-in claude --company ${quoted(companyName)}`;
 return <>
  <div className="panel-row">{row&&<AppTile app={markOf({kind:'subscription',provider,name})} label={name}/>}
   <span className="panel-row__text"><span className={row?'panel-row__t':'panel-row__d'}>{row?<bdi>{name}</bdi>:t('providersStatus')}</span>
    <span className={row?'panel-row__d':'panel-row__t'} id={`sub-${provider}-state`}>{t(stateText[state])}</span></span>
   {disconnect&&<button type="button" className="btn btn--secondary btn--sm" disabled={pending||!!started} aria-label={t('signInDisconnectLabel',name)} onClick={()=>act('disconnect')}>{t('signInDisconnect')}</button>}
   {connect&&provider==='openai-codex'&&!started&&<button type="button" className="btn btn--primary btn--sm" disabled={pending} aria-label={t('signInConnectLabel',name)} onClick={()=>act('start')}>{t('signInConnect')}</button>}
  </div>
  {owner&&started&&<div className="sub-step" role="group" aria-label={t('signInConnectLabel',name)}>
   <p><a className="link-btn" href={started.link} target="_blank" rel="noopener noreferrer">{t('signInOpenLink')}</a> {t('signInEnterCode')}</p>
   <code className="sub-code" dir="ltr" translate="no">{started.code}</code>
   <p className="set-hint" role="status">{t('signInWaiting')}</p>
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" disabled={pending} onClick={()=>act('cancel')}>{t('cancel')}</button></div>
  </div>}
  {connect&&provider==='anthropic'&&<div className="sub-step">
   <p>{t('signInTerminalOnly')}</p><code className="sub-code sub-code--cmd" dir="ltr" translate="no">{command}</code><p className="set-hint">{t('signInTerminalWho')}</p></div>}
  {note&&<p className={note.alert?'set-err':'set-hint'} role={note.alert?'alert':'status'}>{t(note.key)}</p>}
 </>;
}

type Answer={ok:boolean,error:string};
async function send(body:object):Promise<Answer> {
 try {
  const response=await fetch('/api/provider-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const answer=await response.json().catch(()=>null) as {error?:unknown}|null;
  return {ok:response.ok,error:response.ok?'':String(answer?.error||'')};
 } catch { return {ok:false,error:''}; }
}
const keyReason=(code:string)=>code==='keyNotAllowed'?'settingsModelsKeyRefused':'settingsModelsKeyError';

// One provider's key (#124): whether it is set and, for the Owner, the one field that gives it and the control that
// removes it. The value is never drawn back: the field starts empty every time and is cleared after it is sent. `rowed`
// draws it as a row of the list of what is not connected yet, with the provider's mark.
function KeyActions({company,owner,row,rowed=false}:{company:string,owner:boolean,row:KeyRow,rowed?:boolean}) {
 const {t}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(false); const [value,setValue]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const act=async(intent:'set'|'remove')=>{
  if(busy) return;
  if(intent==='set'&&value.trim().length<8) { setError('settingInvalid'); return; }
  // The typed value leaves the field as it is sent, whatever the answer.
  const sent=value.trim(); setValue('');
  setBusy(true); setError('');
  const answer=await send({company,provider:row.provider,intent,...(intent==='set'?{value:sent}:{})});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'keyFailed'); return; }
  setOpen(false);
  toast(t(intent==='set'?'settingsModelsKeySaved':'settingsModelsKeyRemoved'));
  router.refresh();
 };
 const id=`mdl-key-${row.provider}`;
 return <>
  <div className="panel-row">{rowed&&<AppTile app={markOf({kind:'key',provider:row.provider,name:row.label})} label={row.label}/>}
   <span className="panel-row__text"><span className={rowed?'panel-row__t':'panel-row__d'}>{rowed?<bdi>{row.label}</bdi>:t('providersStatus')}</span>
    <span className={rowed?'panel-row__d':'panel-row__t'} id={`${id}-state`}>{t(row.set?'settingsModelsKeySet':'settingsModelsKeyUnset')}</span></span>
   {owner&&row.set&&<button type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={t('settingsModelsKeyRemoveLabel',row.label)} onClick={()=>act('remove')}>{t('settingsModelsKeyRemove')}</button>}
   {owner&&<button type="button" className="link-btn" aria-expanded={open} aria-controls={`${id}-form`} onClick={()=>{ setOpen(!open); setValue(''); setError(''); }}>{t(row.set?'settingsModelsKeyReplace':'settingsModelsKeyGive')}</button>}
  </div>
  {owner&&open&&<div className="sub-step" id={`${id}-form`}>
   <label className="set-label" htmlFor={`${id}-value`}>{t('settingsModelsKeyValue')}</label>
   <input className="set-input" id={`${id}-value`} type="password" dir="ltr" autoComplete="new-password" spellCheck={false} value={value} disabled={busy}
    onChange={event=>setValue(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter') act('set'); }}/>
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={()=>act('set')}>{t('settingsModelsKeySave')}</button></div>
  </div>}
  {error&&<p className="set-err" role="alert">{t(keyReason(error))}</p>}
 </>;
}
