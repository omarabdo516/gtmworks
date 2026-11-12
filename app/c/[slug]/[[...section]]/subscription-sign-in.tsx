'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { SignInState } from '@/lib/hermes-sign-in.mjs';

// The company's own model subscriptions, signed in through Hermes in the company's Hermes home (#3). Shown to the Owner
// and the Agency only; the route refuses anyone else. While a sign-in waits for the person, the state is checked again
// every few seconds, so the panel says Connected once they finish.
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
 async function act(provider:string,intent:'connect'|'disconnect') {
  setPending(true); setError('');
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,provider,intent})});
   const body=await response.json();
   if(!response.ok) { setError(body.error); return; }
   const state={...body}; delete state.provider; setStates(previous=>({...previous,[provider]:state as SignInState}));
  } catch { setError('subscriptionFailed'); }
  finally { setPending(false); }
 }
 return <section className="panel agents-panel" aria-label={t('subscriptionTitle')}>
  <h2>{t('subscriptionTitle')}</h2><p>{t('subscriptionHelp')}</p>
  {error&&<p role="alert">{t(error)}</p>}
  {states&&providers.map(([provider,name])=>{ const state=states[provider]||{state:'failed'}; return <div className="detail-row" key={provider}>
   <div className="agent-row-main"><strong>{t(name)}</strong><p role="status">{t(`subscriptionState_${state.state}`)}</p>
    {state.state==='pending'&&<>{state.code&&<p>{t('subscriptionCode')} <code dir="ltr">{state.code}</code></p>}<p>{t('subscriptionLink')} <a className="link" href={state.link} target="_blank" rel="noopener noreferrer" dir="ltr">{state.link}</a></p></>}
    <div className="flex flex-wrap gap-2">{state.state==='connected'||state.state==='pending'
     ?<button className="button" disabled={pending} onClick={()=>act(provider,'disconnect')}>{t('subscriptionDisconnect',t(name))}</button>
     :<button className="button" disabled={pending} onClick={()=>act(provider,'connect')}>{t('subscriptionConnect',t(name))}</button>}</div>
   </div>
  </div>; })}
 </section>;
}
