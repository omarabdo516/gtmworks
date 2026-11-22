'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { AppTile } from '@/components/app-tile';
import { markOf as letterOf } from '@/lib/app-mark.mjs';
import { entryId } from '@/lib/provider-entry.mjs';
import { SettingsIcon } from './settings-icons';
import { InfoTip } from './settings-info';
import { toast } from './toast';
import type { CompanySignIns, SubscriptionAccount, SubscriptionState } from '@/lib/company-sign-in.mjs';
import { keyAccount, nameKey, nameLimit } from '@/lib/provider-names.mjs';

// The Company's Providers (#617, spec #611; GLOSSARY: Provider): one list of the ways its Engine reaches models, a
// subscription the Company signed in to or an API key it holds, each with its brand's own mark, and the selected one's
// details beside it on a desktop, or on its own page with one Back on a phone. Nothing here carries a secret: a
// subscription is a state the server read from the Company's own Engine (#384, ADR 0018), a key is a yes or no
// (lib/provider-keys.mjs), and a key the Owner types goes straight to the route that hands it to the Engine, then leaves
// the page. Every change goes through the routes that check the Owner again. Each subscription account is a Provider of
// its own (#618), so a second ChatGPT or Claude account is a second row and never replaces the first, and the Owner
// names each Provider in its details; the name is the Company's (lib/provider-names.mjs). Ordering and switching one
// off are #619.

type SubscriptionProvider='openai-codex'|'anthropic';
type KeyRow={provider:string,label:string,set:boolean};
export type Named={agent:string|null,name:string|null};
export type ProviderKeysData={keys:KeyRow[]|null,waiting:Named[]|null,leftover:Named[]|null,unknown:Named[]|null};
type ProvidersSubscriptions={available:boolean,signIns:CompanySignIns['signIns'],accounts?:SubscriptionAccount[]|null,noEngine:boolean};
// Each Provider's models with the Owner's switch, by the Provider's id (lib/provider-models.mjs); null when unread.
export type ProviderModelsData=Record<string,{model:string,enabled:boolean}[]>;

// Each subscription shows its product's mark, the reference's ChatGPT and Claude (#424).
const subscriptionLogo:Record<SubscriptionProvider,string>={'openai-codex':'openai',anthropic:'claude'};
const subscriptionName:Record<SubscriptionProvider,string>={'openai-codex':'signInChatGPT',anthropic:'signInClaude'};
const stateText:Record<SubscriptionState,string>={connected:'signInConnected',mainAgentOnly:'signInMainAgentOnly',someAgentsOnly:'signInSomeAgentsOnly',notConnected:'signInNotConnected'};
const subscriptions:SubscriptionProvider[]=['openai-codex','anthropic'];
// `account` is the Engine's id of a subscription account, or `key` for a key: what the Provider's name is kept by.
// `own` is its kind's own name, which it reads under until the Owner names it. A subscription the Engine lists no account
// for (an older sign-in left on an Agent's profile, or a list the Engine did not answer) is one row for its provider.
type Entry={id:string,kind:'subscription'|'key',provider:string,account:string|null,name:string,own:string,state:SubscriptionState|'set',exhausted:boolean};
// The list keeps the Engine's own order: a signed-in subscription before a key (agent/credential_pool.py
// _normalize_pool_priorities, v0.23.0), so the first row is the one the Agents use first, and accounts of one kind in
// the order the Engine lists them. A second account of one kind reads as its kind's name and its place: ChatGPT 2.
function entriesOf(t:(key:string)=>string,signIns:CompanySignIns['signIns'],accounts:SubscriptionAccount[]|null|undefined,keys:KeyRow[]|null,names:Record<string,string>):Entry[] {
 const signed=subscriptions.flatMap((provider):Entry[]=>{
  if(!signIns||signIns[provider].state==='notConnected') return [];
  const own=(accounts??[]).filter(row=>row.provider===provider);
  if(signIns[provider].state!=='connected'||!own.length) return [{id:entryId('subscription',provider),kind:'subscription' as const,provider,account:null,name:t(subscriptionName[provider]),own:t(subscriptionName[provider]),state:signIns[provider].state,exhausted:false}];
  return own.map((row,at)=>{ const kind=at?`${t(subscriptionName[provider])} ${at+1}`:t(subscriptionName[provider]);
   return {id:`sub-${provider}-${row.account}`,kind:'subscription' as const,provider,account:row.account,name:names[nameKey(provider,row.account)]??kind,own:kind,state:'connected' as const,exhausted:row.exhausted}; });
 });
 const held=(keys??[]).filter(row=>row.set).map(row=>({id:entryId('key',row.provider),kind:'key' as const,provider:row.provider,account:keyAccount,name:names[nameKey(row.provider,keyAccount)]??row.label,own:row.label,state:'set' as const,exhausted:false}));
 return [...signed,...held];
}
const tileOf=(entry:{kind:Entry['kind'],provider:string,name:string}):{key:string,mark:string}=>({key:entry.kind==='subscription'?subscriptionLogo[entry.provider as SubscriptionProvider]:entry.provider,mark:entry.kind==='subscription'?'':letterOf(entry.name)});
const partial=(state:Entry['state'])=>state==='mainAgentOnly'||state==='someAgentsOnly';

export function CompanyProviders({company,companyName,owner,subscriptions:subs,keys,models=null,names={}}:{company:string,companyName:string,owner:boolean,subscriptions:ProvidersSubscriptions,keys:ProviderKeysData|null,models?:ProviderModelsData|null,names?:Record<string,string>}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 const entries=entriesOf(t,subs.signIns,subs.accounts,keys?.keys??null,names);
 // What the Owner can connect: either subscription, a second account of one already connected included, and a provider
 // with no key.
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
 const status=(entry:Entry)=>entry.kind==='key'?t('providersKeySaved'):partial(entry.state)?t('providersPartly'):entry.exhausted?t('providersExhausted'):t('signInConnected');
 const backButton=<button type="button" className="link-btn sov-back pv-back" onClick={back}><SettingsIcon name="back" rtl={rtl}/><span>{t('providers')}</span></button>;
 const notes=owner?[...(keys?.waiting??[]).map(item=>['settingsModelsKeyWaiting',item.name||t('settingsModelsAnAgent')]),
  ...(keys?.leftover??[]).map(item=>['settingsModelsKeyLeftover',item.name||t('settingsModelsAnAgent')])]:[];
 if(subs.noEngine) return <section className="dp-sec" aria-labelledby="md-h-pv" id="md-providers"><h4 className="dp-label" id="md-h-pv"><span>{t('providers')}</span></h4>
  <p className="ro-note sov-warn" role="note" id="sub-no-engine"><SettingsIcon name="shield"/><span>{t('noEngine')}</span></p></section>;
 return <section className="dp-sec" aria-labelledby="md-h-pv" id="md-providers"><h4 className="dp-label" id="md-h-pv"><span>{t('providers')}</span></h4>
  <div className="pv-split" data-open={selected?'':undefined}>
   <ul className="panel-card pv-list" ref={list} aria-labelledby="md-h-pv">
    {entries.map(entry=><li key={entry.id}><button type="button" className="panel-row pv-row" id={`pv-row-${entry.id}`} aria-current={entry.id===shown?'true':undefined} aria-controls={`pv-d-${entry.id}`} onClick={()=>open(entry.id)}>
     <AppTile app={tileOf(entry)}/>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{entry.name}</bdi></span>
      <span className="panel-row__d"><span>{t(entry.kind==='key'?'providersKey':'providersSubscription')}</span><span aria-hidden="true"> · </span><span className={`pv-dot${partial(entry.state)||entry.exhausted?' pv-dot--part':''}`} aria-hidden="true"/><span>{status(entry)}</span></span></span>
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
     <header className="pv-head"><AppTile app={tileOf(entry)} size="lg" label={entry.name}/>
      <span className="pv-head__t"><h5 className="pv-name" id={`pv-d-${entry.id}-name`} tabIndex={-1}><bdi>{entry.name}</bdi></h5>
       <span className="pv-type">{t(entry.kind==='key'?'providersKey':'providersSubscription')}</span></span></header>
     {entry.kind==='subscription'
      ?<SubscriptionDetail company={company} companyName={companyName} owner={owner} entry={entry} keyed={(keys?.keys??[]).some(row=>row.set&&row.provider==='anthropic')}/>
      :<KeyDetail company={company} owner={owner} entry={entry}/>}
     <ProviderModels company={company} owner={owner} entry={entryId(entry.kind,entry.provider)} panel={entry.id} name={entry.name} models={models?models[entryId(entry.kind,entry.provider)]??[]:null}/>
    </div>)}
    {owner&&<div className="pv-detail" id="pv-d-add" role="region" aria-labelledby="pv-d-add-name" hidden={shown!=='add'}>
     {backButton}
     <header className="pv-head"><span className="pv-head__t"><h5 className="pv-name" id="pv-d-add-name" tabIndex={-1}>{t('providersAdd')}</h5></span></header>
     <h6 className="pv-group">{t('providersSubscriptions')}<InfoTip about={t('providersSubscriptions')} id="pv-add-sub-info">{t('signInWhat')} {t('providersAnotherAccount')} {t('signInOneAccount')}</InfoTip></h6>
     {subs.available&&subs.signIns?<div className="panel-card">{subscriptions.map(provider=><div className="sub-row" key={provider} id={`add-sub-${provider}`}>
      <SubscriptionActions company={company} companyName={companyName} owner={owner} provider={provider} name={t(subscriptionName[provider])} state={subs.signIns![provider].state} row/>
     </div>)}</div>
      :<div className="panel-card"><p className="panel-empty">{t(subs.signIns===null&&subs.available?'signInUnknown':'signInNoProfile')}</p></div>}
     <h6 className="pv-group">{t('providersKeys')}<InfoTip about={t('providersKeys')} id="pv-add-key-info">{t('settingsModelsKeyWhat')} {t('settingsModelsProviderKeysHint')}</InfoTip></h6>
     {keys?.keys?<div className="panel-card md-keys">{unkeyed.map(row=><div className="md-key" key={row.provider} id={`mdl-key-row-${row.provider}`}>
      <KeyActions company={company} owner={owner} row={row} rowed/>
     </div>)}</div>:<div className="panel-card"><p className="panel-empty">{t(keys?'settingsModelsKeyUnread':'settingsModelsKeyNoEngine')}</p></div>}
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

function SubscriptionDetail({company,companyName,owner,entry,keyed}:{company:string,companyName:string,owner:boolean,entry:Entry,keyed:boolean}) {
 const {t}=useI18n();
 const provider=entry.provider as SubscriptionProvider; const state=entry.state as SubscriptionState;
 return <>
  <div className="panel-card">
   <NameFact company={company} owner={owner} entry={entry}/>
   <Fact label={t('providersConnection')}>{t('providersSubscription')}</Fact>
   <div className="sub-row" id={`sub-${entry.account?`${provider}-${entry.account}`:provider}`}><SubscriptionActions company={company} companyName={companyName} owner={owner} provider={provider} name={entry.name} state={state} account={entry.account}/></div>
  </div>
  {provider==='anthropic'&&state==='connected'&&keyed&&<p className="set-hint" id="sub-anthropic-order">{t('signInKeyFallback')}</p>}
  <Advanced id={`pv-d-${entry.id}`} provider={provider}><p className="set-hint">{t('signInWhat')} {t('signInHint')} {t('signInOneAccount')}</p></Advanced>
 </>;
}

function KeyDetail({company,owner,entry}:{company:string,owner:boolean,entry:Entry}) {
 const {t}=useI18n();
 const row={provider:entry.provider,label:entry.name,set:true};
 return <>
  <div className="panel-card md-keys">
   <NameFact company={company} owner={owner} entry={entry}/>
   <Fact label={t('providersConnection')}>{t('providersKey')}</Fact>
   <div className="md-key" id={`mdl-key-row-${row.provider}`}><KeyActions company={company} owner={owner} row={row}/></div>
  </div>
  <Advanced id={`pv-d-key-${row.provider}`} provider={row.provider}><p className="set-hint">{t('settingsModelsKeyWhat')} {t('settingsModelsProviderKeysHint')}</p></Advanced>
 </>;
}

// The models this Provider offers, each with its switch (#620): the Owner turns one off and the chat's "+" menu and every
// Agent's model choice stop offering it once no Provider of its kind has it on. Every other Role reads each switch.
// A switch shows its new state at once and goes back, with a line, when the change was not kept.
// `entry` is what the switches are kept by, the Provider's kind (lib/provider-entry.mjs): the pinned Engine lists models per
// provider, not per account, so two ChatGPT accounts share their kind's switches (#618). `panel` is the details' own id.
function ProviderModels({company,owner,entry,panel,name,models}:{company:string,owner:boolean,entry:string,panel:string,name:string,models:{model:string,enabled:boolean}[]|null}) {
 const {t}=useI18n(); const router=useRouter();
 const [shown,setShown]=useState<Record<string,boolean>>({}); const [busy,setBusy]=useState(''); const [error,setError]=useState('');
 const id=`pv-d-${panel}-models`;
 const turn=async(model:string,enabled:boolean)=>{
  if(busy) return;
  setBusy(model); setError(''); setShown(current=>({...current,[model]:enabled}));
  let ok=false; let code='';
  try {
   const response=await fetch('/api/provider-models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,entry,model,enabled})});
   ok=response.ok; if(!ok) code=String(((await response.json().catch(()=>null)) as {error?:unknown}|null)?.error||'');
  } catch { ok=false; }
  setBusy('');
  if(!ok) { setShown(current=>{ const next={...current}; delete next[model]; return next; }); setError(code==='providerModelNotAllowed'?'providersOwnerOnly':'providersModelError'); return; }
  toast(t(enabled?'providersModelOnSaved':'providersModelOffSaved',model));
  router.refresh();
 };
 return <>
  <h6 className="pv-group" id={`${id}-h`}>{t('providersModels')}</h6>
  {models===null?<div className="panel-card"><p className="panel-empty">{t('providersModelsUnread')}</p></div>
   :!models.length?<div className="panel-card"><p className="panel-empty">{t('providersModelsNone')}</p></div>
   :<ul className="panel-card" id={id} aria-labelledby={`${id}-h`}>{models.map(({model,enabled})=>{ const on=shown[model]??enabled; const title=`${id}-${model.replace(/[^A-Za-z0-9_-]/g,'_')}`;
    return <li className="panel-row" key={model}><span className="panel-row__text"><span className="panel-row__t" id={title}><bdi dir="ltr">{model}</bdi></span></span>
     {owner?<button type="button" className="switch" role="switch" aria-checked={on} aria-label={t('providersModelSwitch',model,name)} disabled={!!busy} onClick={()=>turn(model,!on)}/>
      :<span className="panel-row__meta">{t(on?'providersModelOn':'providersModelOff')}</span>}
    </li>; })}</ul>}
  {error&&<p className="set-err" role="alert">{t(error)}</p>}
  <p className="set-hint">{t('providersModelsHint')}</p>
 </>;
}

// What a refused name says: the route's codes (app/api/provider-names) and the field's own check.
const nameReason:Record<string,string>={providerNotAllowed:'providersNotAllowed',providerNameInvalid:'providersNameInvalid',providersNameInvalid:'providersNameInvalid'};
// The Provider's name: what the Owner named it, or its kind's own. The Owner changes it here; an empty name gives the
// kind's own back. Every other Member reads it.
function NameFact({company,owner,entry}:{company:string,owner:boolean,entry:Entry}) {
 const {t}=useI18n(); const router=useRouter();
 const [value,setValue]=useState(entry.name); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 // A name the server changed (a refresh after a save) is the field's new start.
 const [was,setWas]=useState(entry.name);
 if(was!==entry.name) { setWas(entry.name); setValue(entry.name); }
 if(!owner||!entry.account) return <Fact label={t('providersName')}><bdi>{entry.name}</bdi></Fact>;
 const id=`pv-name-${entry.id}`;
 const given=value.trim(); const unchanged=(given||entry.own)===entry.name;
 const save=async()=>{
  if(busy||unchanged) return;
  if(given.length>nameLimit) { setError('providersNameInvalid'); return; }
  setBusy(true); setError('');
  let answer:{ok:boolean,error:string};
  try {
   const response=await fetch('/api/provider-names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,provider:entry.provider,account:entry.account,name:given===entry.own?'':given})});
   const body=await response.json().catch(()=>null) as {error?:unknown}|null;
   answer={ok:response.ok,error:response.ok?'':String(body?.error||'')};
  } catch { answer={ok:false,error:''}; }
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'providersNameFailed'); return; }
  toast(t('providersNameSaved'));
  router.refresh();
 };
 return <form className="pv-rename" onSubmit={event=>{ event.preventDefault(); void save(); }}>
  <label className="set-label" htmlFor={id}>{t('providersName')}</label>
  <div className="pv-rename__row">
   <input className="set-input" id={id} type="text" maxLength={nameLimit} autoComplete="off" spellCheck={false} dir="auto" value={value} disabled={busy}
    placeholder={entry.own} aria-describedby={`${id}-hint`} onChange={event=>{ setValue(event.target.value); setError(''); }}/>
   <button type="submit" className="btn btn--secondary btn--sm" disabled={busy||unchanged}>{t('providersNameSave')}</button>
  </div>
  <p className="set-hint" id={`${id}-hint`}>{t('providersNameHint')}</p>
  {error&&<p className="set-err" role="alert">{t(nameReason[error]??'providersNameFailed')}</p>}
 </form>;
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
// be removed, or replaced by one every Agent uses. `row` draws it as a row of the list of what to connect, with its
// mark and only its sign-in: one already connected then adds another account beside it (#618). In a Provider's details
// the header shows the mark, and `account` is the one account its Disconnect removes, every other one staying.
function SubscriptionActions({company,companyName,owner,provider,name,state,row=false,account=null}:{company:string,companyName:string,owner:boolean,provider:SubscriptionProvider,name:string,state:SubscriptionState,row?:boolean,account?:string|null}) {
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
  const answer=await ask({company,provider,intent,...(intent==='cancel'&&started?{session:started.session}:{}),...(intent==='disconnect'&&account?{account}:{})});
  if(intent==='start') {
   if(answer.ok) setStarted({session:String(answer.body.session),code:String(answer.body.code),link:String(answer.body.link),interval:Number(answer.body.interval)||5});
   else setNote({key:String(answer.body.error||'signInFailed'),alert:true});
   return;
  }
  if(intent==='cancel') { setStarted(null); return; }
  if(!answer.ok) { setNote({key:String(answer.body.error||'signInFailed'),alert:true}); return; }
  router.refresh();
 });
 const another=row&&state==='connected';
 const disconnect=!row&&owner&&(state==='connected'||partial(state)); const connect=owner&&(row||state==='notConnected'||partial(state));
 const command=`gtmworks sign-in claude --company ${quoted(companyName)}`;
 return <>
  <div className="panel-row">{row&&<AppTile app={tileOf({kind:'subscription',provider,name})} label={name}/>}
   <span className="panel-row__text"><span className={row?'panel-row__t':'panel-row__d'}>{row?<bdi>{name}</bdi>:t('providersStatus')}</span>
    <span className={row?'panel-row__d':'panel-row__t'} id={`${row?'add-':''}sub-${account?`${provider}-${account}`:provider}-state`}>{t(stateText[state])}</span></span>
   {disconnect&&<button type="button" className="btn btn--secondary btn--sm" disabled={pending||!!started} aria-label={t('signInDisconnectLabel',name)} onClick={()=>act('disconnect')}>{t('signInDisconnect')}</button>}
   {connect&&provider==='openai-codex'&&!started&&<button type="button" className="btn btn--primary btn--sm" disabled={pending} aria-label={t(another?'providersConnectAnotherLabel':'signInConnectLabel',name)} onClick={()=>act('start')}>{t(another?'providersConnectAnother':'signInConnect')}</button>}
  </div>
  {owner&&started&&<div className="sub-step" role="group" aria-label={t(another?'providersConnectAnotherLabel':'signInConnectLabel',name)}>
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
  <div className="panel-row">{rowed&&<AppTile app={tileOf({kind:'key',provider:row.provider,name:row.label})} label={row.label}/>}
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
