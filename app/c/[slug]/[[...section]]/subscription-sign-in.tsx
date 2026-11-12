'use client';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { SignInState } from '@/lib/hermes-sign-in.mjs';

// The company's own model subscriptions, signed in through Hermes in the company's Hermes home (#3). Shown to the Owner
// and the Agency only; the route refuses anyone else. While a sign-in waits for the person, the state is checked again
// every few seconds, so the panel says Connected once they finish. A Claude sign-in asks for the code Claude shows the
// person after they approve; it is pasted here and sent once. A provider the install's Engine cannot connect for the
// company (ADR 0012) says so and offers no Connect.
const providers=[['openai-codex','subscriptionChatGPT'],['anthropic','subscriptionClaude']] as const;
const endpoint='/api/subscription-sign-in';
export default function SubscriptionSignIn({company}:{company:string}) {
 const {t}=useI18n(); const [states,setStates]=useState<Record<string,SignInState>|null>(null); const [error,setError]=useState(''); const [pending,setPending]=useState(false);
 const load=useCallback(()=>fetch(`${endpoint}?company=${company}`,{cache:'no-store'}).then(async response=>({ok:response.ok,body:await response.json()})).then(({ok,body})=>{
  if(!ok) { setError(body.error); return; }
  setError(''); setStates(body.providers);
 }).catch(()=>setError('subscriptionFailed')),[company]);
 useEffect(()=>{ void load(); },[load]);
 const waiting=!!states&&Object.values(states).some(state=>state.state==='pending');
 useEffect(()=>{ if(!waiting) return; const timer=setInterval(()=>{ void load(); },3000); return ()=>clearInterval(timer); },[waiting,load]);
 async function act(provider:string,intent:'connect'|'disconnect'|'complete',authorizationCode?:string) {
  setPending(true); setError('');
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,provider,intent,authorizationCode})});
   const body=await response.json();
   if(!response.ok) { setError(body.error); if(intent==='complete') void load(); return; }
   const state={...body}; delete state.provider; setStates(previous=>({...previous,[provider]:state as SignInState}));
  } catch { setError('subscriptionFailed'); }
  finally { setPending(false); }
 }
 // The pasted code is read from the form when it is sent and kept nowhere else.
 function complete(provider:string,event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form=event.currentTarget;
  const code=String(new FormData(form).get('authorizationCode')||''); form.reset();
  void act(provider,'complete',code);
 }
 return <section className="panel agents-panel" aria-label={t('subscriptionTitle')}>
  <h2>{t('subscriptionTitle')}</h2><p>{t('subscriptionHelp')}</p>
  {error&&<p role="alert">{t(error)}</p>}
  {states&&providers.map(([provider,name])=>{ const state=states[provider]||{state:'failed'}; return <div className="detail-row" key={provider}>
   <div className="agent-row-main"><strong>{t(name)}</strong><p role="status">{t(`subscriptionState_${state.state}`)}</p>
    {state.state==='pending'&&<>{state.code&&<p>{t('subscriptionCode')} <code dir="ltr">{state.code}</code></p>}<p>{t('subscriptionLink')} <a className="link" href={state.link} target="_blank" rel="noopener noreferrer" dir="ltr">{state.link}</a></p>
     {state.needsCode&&<form className="agent-webhook-form" onSubmit={event=>complete(provider,event)}><p>{t('subscriptionPasteHelp')}</p>
      <label>{t('subscriptionPasteCode')}<input className="field" name="authorizationCode" dir="ltr" autoComplete="off" spellCheck={false} maxLength={512} required/></label>
      <button className="button" disabled={pending}>{t('subscriptionSubmitCode')}</button></form>}</>}
    <div className="flex flex-wrap gap-2">{state.state==='connected'||state.state==='pending'
     ?<button className="button" disabled={pending} onClick={()=>act(provider,'disconnect')}>{t('subscriptionDisconnect',t(name))}</button>
     :state.state!=='unavailable'&&<button className="button" disabled={pending} onClick={()=>act(provider,'connect')}>{t('subscriptionConnect',t(name))}</button>}</div>
   </div>
  </div>; })}
 </section>;
}
