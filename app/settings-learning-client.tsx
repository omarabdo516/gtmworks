'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';

// The Learning section's controls (#28): the Owner's two mode choices for the Company or one Agent, and an Owner's or a
// Manager's "Forget this" and "Bring it back" on a rule. Each sends one request to a route that checks the Role again
// (/api/agent-settings, /api/agent-rules) and then reads the page again, so what is drawn is what the server holds.
async function send(path:string,method:'POST'|'PUT',body:object) {
 try {
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.ok;
 } catch { return false; }
}
const modeLabels=['auto','ask'] as const;
const modeName={auto:'settingsLearnOnItsOwn',ask:'settingsLearnAsks'} as const;
const modeWords={auto:'settingsLearnAutoD',ask:'settingsLearnAskD'} as const;

// The Company's mode: "Learns on its own" or "Asks first", each a card of the approved reference (cr-kind). Reading
// Roles see the same cards with no choice, and a mixed Company reads as mixed in the hint beside them.
export function CompanyLearningMode({company,mode,canChange}:{company:string,mode:'auto'|'ask'|'mixed'|null,canChange:boolean}) {
 const {t}=useI18n(); const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const choose=(next:'auto'|'ask')=>{ if(!canChange||pending||mode===next) return; setFailed(false);
  startTransition(async()=>{ if(await send('/api/agent-settings','POST',{company,mode:next})) router.refresh(); else setFailed(true); }); };
 return <>
  <div className="cr-kinds" role="radiogroup" aria-labelledby="ln-h-co">{modeLabels.map(key=>{
   const on=mode===key;
   return <button type="button" key={key} className="cr-kind" role="radio" id={`ln-co-${key}`} aria-checked={on} tabIndex={on?0:-1} aria-disabled={canChange?undefined:true} onClick={()=>choose(key)}>
    <span className="cr-kind__t">{t(modeName[key])}</span><span className="cr-kind__d">{t(modeWords[key])}</span>
    {on&&<span className="cr-kind__check" aria-hidden="true"><SettingsIcon name="check"/></span>}
   </button>;})}</div>
  {failed&&<p className="set-err" role="alert">{t('settingsLearnModeFailed')}</p>}
 </>;
}

// One Agent's mode, as its own profile reads: the reference's segmented control, or a word alone for a reader below
// Owner. An Agent on another Agent's shared profile has no switch, since a write there would change both. "Follow the
// company" is there for an Agent that chose its own mode, and gives it back to the Company's (#28).
export function AgentLearningMode({company,agent,labelId,mode,follows}:{company:string,agent:string,labelId:string,mode:'auto'|'ask'|'mixed'|null,follows:boolean|null}) {
 const {t}=useI18n(); const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const choose=(next:'auto'|'ask'|'follow')=>{ if(pending||(next==='follow'?follows:!follows&&mode===next)) return; setFailed(false);
  startTransition(async()=>{ if(await send('/api/agent-settings','POST',{company,agent,mode:next})) router.refresh(); else setFailed(true); }); };
 return <>
  <div className="segmented segmented--field ln-seg" role="radiogroup" aria-labelledby={labelId}>{modeLabels.map(key=>
   <button type="button" key={key} role="radio" id={`ln-${agent}-${key}`} aria-checked={!follows&&mode===key} tabIndex={!follows&&mode===key?0:-1} disabled={pending} onClick={()=>choose(key)}>{t(modeName[key])}</button>)}
   {follows!==null&&<button type="button" role="radio" id={`ln-${agent}-follow`} aria-checked={follows} tabIndex={follows?0:-1} disabled={pending} onClick={()=>choose('follow')}>{t('settingsLearnFollowCompany')}</button>}
  </div>
  {failed&&<p className="set-err" role="alert">{t('settingsLearnModeFailed')}</p>}
 </>;
}

// "Forget this" on a rule, and "Bring it back" on one that was forgotten (reference: ln-forget, ln-unforget). The
// server checks the Role again (remove_agent_rule, restore_agent_rule); the focus moves to the next rule's control, or
// to the list's heading when none is left.
export function RuleActions({company,rule,body,removed}:{company:string,rule:string,body:string,removed:boolean}) {
 const {t}=useI18n(); const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const act=(button:HTMLButtonElement)=>startTransition(async()=>{
  setFailed(false);
  if(!await send('/api/agent-rules',removed?'PUT':'POST',{company,rule})) { setFailed(true); return; }
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.ln-rule-act')]; const at=buttons.indexOf(button);
  (buttons[at+1]||buttons[at-1]||document.getElementById('ln-h-rec'))?.focus();
  router.refresh();
 });
 const name=body.length>40?`${body.slice(0,40)}…`:body;
 return <span className="ln-acts">{failed&&<span className="set-err" role="alert">{t(removed?'settingsLearnBringBackFailed':'settingsLearnForgetFailed')}</span>}
  <button type="button" className="link-btn ln-rule-act" disabled={pending} aria-label={t(removed?'settingsLearnBringBackLabel':'settingsLearnForgetLabel',name)} onClick={event=>act(event.currentTarget)}>{t(removed?'settingsLearnBringBack':'settingsLearnForget')}</button></span>;
}
