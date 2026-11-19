'use client';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';
import type { CompanySignIns, SubscriptionState } from '@/lib/company-sign-in.mjs';

// Arrow keys move between the choices of one radio group (WAI-ARIA radio pattern); the choice is made with Enter or Space.
function arrows(event:KeyboardEvent<HTMLElement>) {
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
 const items=[...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
 const at=items.indexOf(document.activeElement as HTMLElement); if(at<0) return;
 event.preventDefault();
 const forward=event.key==='ArrowDown'||(event.key==='ArrowLeft')===(document.documentElement.dir==='rtl');
 items[(at+(forward?1:-1)+items.length)%items.length].focus();
}

const levels=[1,2,3] as const;
// The Company's Agent level (ADR 0014). The Owner chooses it; the server checks the Owner again (/api/agent-level,
// set_agent_level) and the worker then changes the tools of the Company's profile in the agent engine.
export function AgentLevel({company,level,owner}:{company:string,level:number,owner:boolean}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 const choose=(next:number)=>startTransition(async()=>{
  try {
   const response=await fetch('/api/agent-level',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,level:next})});
   if(!response.ok) { setError(((await response.json()) as {error?:string}).error||'agentLevelInvalid'); return; }
   setError(''); router.refresh();
  } catch { setError('agentLevelInvalid'); }
 });
 const row=(item:number)=>{ const on=item===level; const text=<span className="panel-row__text"><span className="panel-row__t">{t(`agentLevel${item}`)}</span><span className="panel-row__d">{t(`agentLevel${item}D`)}</span></span>;
  return owner?<button key={item} type="button" className="panel-row" role="radio" id={`ag-level-${item}`} aria-checked={on} tabIndex={on?0:-1} disabled={pending} onClick={()=>{ if(!on) choose(item); }}>{text}{on&&<span className="panel-row__meta"><SettingsIcon name="check"/></span>}</button>
   :<div key={item} className="panel-row" id={`ag-level-${item}`} aria-current={on?'true':undefined}>{text}{on&&<span className="panel-row__meta"><SettingsIcon name="check"/></span>}</div>; };
 return <section className="dp-sec" aria-labelledby="co-h-level"><h4 className="dp-label" id="co-h-level"><span>{t('agentLevelTitle')}</span></h4>
  {owner?<div className="panel-card" role="radiogroup" aria-labelledby="co-h-level" onKeyDown={arrows}>{levels.map(row)}</div>:<div className="panel-card">{levels.map(row)}</div>}
  <p className="set-hint">{t('agentLevelHint')}{!owner&&<> {t('agentLevelOwnerOnly')}</>}</p>
  {error&&<p className="set-err" role="alert">{t(error)}</p>}
 </section>;
}

type Provider='openai-codex'|'anthropic';
type Started={provider:Provider,session:string,code:string,link:string,interval:number};
async function ask(body:object):Promise<{ok:boolean,body:Record<string,unknown>}> {
 try {
  const response=await fetch('/api/company-sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json() as Record<string,unknown>};
 } catch { return {ok:false,body:{error:'signInFailed'}}; }
}

// The Company's connected AI subscriptions (#3; #384, ADR 0018; reference: sovModelsHTML, SUBS). A sign-in lives on the
// root profile of the Company's own Engine, which lends it to every Agent of the Company. This page only shows its
// state, and for the Owner starts ChatGPT's sign-in (a code and a link), follows it until it is connected, or
// disconnects. Claude signs in from the install's command line only.
const stateText:Record<SubscriptionState,string>={connected:'signInConnected',mainAgentOnly:'signInMainAgentOnly',someAgentsOnly:'signInSomeAgentsOnly',notConnected:'signInNotConnected'};
// The Company's name in the command as the shell reads it back exactly, with the characters a double quote would expand.
const quoted=(value:string)=>`"${value.replace(/[\\"$`]/g,char=>`\\${char}`)}"`;
export function CompanySubscriptions({company,companyName,owner,available,signIns}:{company:string,companyName:string,owner:boolean,available:boolean,signIns:CompanySignIns['signIns']}) {
 const {t}=useI18n(); const router=useRouter();
 const [started,setStarted]=useState<Started|null>(null);
 const [note,setNote]=useState<{provider:Provider,key:string,alert?:boolean}|null>(null);
 const [pending,startTransition]=useTransition();
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{ if(timer.current) clearTimeout(timer.current); },[]);
 // While a sign-in waits, Hermes is asked again at the interval it gave until the person finishes, it ends, or the
 // page closes.
 useEffect(()=>{
  if(!started) return;
  let stopped=false;
  const poll=async()=>{
   const answer=await ask({company,provider:started.provider,intent:'poll',session:started.session});
   if(stopped) return;
   const status=String(answer.body.status||'');
   if(answer.ok&&status==='pending') { timer.current=setTimeout(poll,started.interval*1000); return; }
   setStarted(null);
   setNote(answer.ok&&status==='approved'?{provider:started.provider,key:'signInDone'}:{provider:started.provider,key:answer.ok?'signInEnded':String(answer.body.error||'signInFailed'),alert:true});
   router.refresh();
  };
  timer.current=setTimeout(poll,started.interval*1000);
  return ()=>{ stopped=true; if(timer.current) clearTimeout(timer.current); };
 },[started,company,router]);
 const act=(provider:Provider,intent:'start'|'cancel'|'disconnect')=>startTransition(async()=>{
  setNote(null);
  const answer=await ask({company,provider,intent,...(intent==='cancel'&&started?{session:started.session}:{})});
  if(intent==='start') {
   if(answer.ok) setStarted({provider,session:String(answer.body.session),code:String(answer.body.code),link:String(answer.body.link),interval:Number(answer.body.interval)||5});
   else setNote({provider,key:String(answer.body.error||'signInFailed'),alert:true});
   return;
  }
  if(intent==='cancel') { setStarted(null); return; }
  if(!answer.ok) { setNote({provider,key:String(answer.body.error||'signInFailed'),alert:true}); return; }
  router.refresh();
 });
 const command=`gtmworks sign-in claude --company ${quoted(companyName)}`;
 const row=(provider:Provider,name:string)=>{
  const state=signIns?.[provider].state; const waiting=started?.provider===provider;
  // A sign-in that serves some agents only can be removed, or replaced by one every agent uses.
  const partial=state==='mainAgentOnly'||state==='someAgentsOnly';
  const disconnect=owner&&(state==='connected'||partial); const connect=owner&&(state==='notConnected'||partial);
  const label=name;
  return <div className="sub-row" key={provider} id={`sub-${provider}`}>
   <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="cpu"/></span>
    <span className="panel-row__text"><span className="panel-row__t"><bdi>{name}</bdi></span>
     <span className="panel-row__d" id={`sub-${provider}-state`}>{t(state?stateText[state]:'signInUnknown')}</span></span>
    {disconnect&&<button type="button" className="btn btn--secondary btn--sm" disabled={pending||waiting} aria-label={t('signInDisconnectLabel',label)} onClick={()=>act(provider,'disconnect')}>{t('signInDisconnect')}</button>}
    {connect&&provider==='openai-codex'&&!waiting&&<button type="button" className="btn btn--primary btn--sm" disabled={pending||!!started} aria-label={t('signInConnectLabel',label)} onClick={()=>act(provider,'start')}>{t('signInConnect')}</button>}
   </div>
   {owner&&waiting&&started&&<div className="sub-step" role="group" aria-label={t('signInConnectLabel',label)}>
    <p><a className="link-btn" href={started.link} target="_blank" rel="noopener noreferrer">{t('signInOpenLink')}</a> {t('signInEnterCode')}</p>
    <code className="sub-code" dir="ltr" translate="no">{started.code}</code>
    <p className="set-hint" role="status">{t('signInWaiting')}</p>
    <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" disabled={pending} onClick={()=>act(provider,'cancel')}>{t('cancel')}</button></div>
   </div>}
   {connect&&provider==='anthropic'&&<div className="sub-step">
    <p>{t('signInTerminalOnly')}</p><code className="sub-code sub-code--cmd" dir="ltr" translate="no">{command}</code><p className="set-hint">{t('signInTerminalWho')}</p></div>}
   {note?.provider===provider&&<p className={note.alert?'set-err':'set-hint'} role={note.alert?'alert':'status'}>{t(note.key)}</p>}
  </div>;
 };
 return <section className="dp-sec" aria-labelledby="md-h-sub" id="md-subscriptions"><h4 className="dp-label" id="md-h-sub"><span>{t('settingsModelsSubs')}</span></h4>
  {available?<div className="panel-card">{row('openai-codex',t('signInChatGPT'))}{row('anthropic',t('signInClaude'))}</div>
   :<div className="panel-card"><p className="panel-empty">{t('signInNoProfile')}</p></div>}
  <p className="set-hint">{t('signInHint')} {t('signInOneAccount')}</p>
 </section>;
}
