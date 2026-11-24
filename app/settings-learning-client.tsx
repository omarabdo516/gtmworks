'use client';
import { useState, useTransition, type KeyboardEvent } from 'react';
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
// Arrow keys move the choice as the reference's other segmented controls do: forward is left in Arabic and right in
// English, the first and last choice stop the arrow, and a group with no choice selected gives its first one the Tab stop
// so the keyboard can reach it. Moving selects, as the effort control does (#179).
function arrowChoice(event:KeyboardEvent<HTMLButtonElement>,rtl:boolean) {
 if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return null;
 event.preventDefault();
 return (event.key==='ArrowLeft')===rtl?1:-1;
}

// The Company's mode: "Learns on its own" or "Asks first", each a card of the approved reference (cr-kind). Reading
// Roles see the same cards with no choice, and a mixed Company reads as mixed in the hint beside them.
export function CompanyLearningMode({company,mode,canChange}:{company:string,mode:'auto'|'ask'|'mixed'|null,canChange:boolean}) {
 const {t,language}=useI18n(); const rtl=language==='ar'; const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const choose=(next:'auto'|'ask')=>{ if(!canChange||pending||mode===next) return; setFailed(false);
  startTransition(async()=>{ if(await send('/api/agent-settings','POST',{company,mode:next})) router.refresh(); else setFailed(true); }); };
 const chosen=mode==='auto'||mode==='ask'?mode:null;
 // The arrow key selects the choice it reaches, the Tab stop's when no choice is marked; a reader with no choice moves the
 // focus alone.
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const direction=arrowChoice(event,rtl); if(direction===null) return;
  const next=chosen===null?index:Math.max(0,Math.min(modeLabels.length-1,index+direction));
  choose(modeLabels[next]);
  document.getElementById(`ln-co-${modeLabels[next]}`)?.focus();
 };
 return <>
  <div className="cr-kinds" role="radiogroup" aria-labelledby="ln-h-co">{modeLabels.map((key,index)=>{
   const on=mode===key;
   return <button type="button" key={key} className="cr-kind" role="radio" id={`ln-co-${key}`} aria-checked={on} tabIndex={on||(chosen===null&&index===0)?0:-1} aria-disabled={canChange?undefined:true} onClick={()=>choose(key)} onKeyDown={event=>move(event,index)}>
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
 const {t,language}=useI18n(); const rtl=language==='ar'; const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const choose=(next:'auto'|'ask'|'follow')=>{ if(pending||(next==='follow'?follows:!follows&&mode===next)) return; setFailed(false);
  startTransition(async()=>{ if(await send('/api/agent-settings','POST',{company,agent,mode:next})) router.refresh(); else setFailed(true); }); };
 const choices=follows===null?modeLabels:[...modeLabels,'follow'] as const;
 const chosen=follows===true?'follow':!follows&&(mode==='auto'||mode==='ask')?mode:null;
 const idOf=(choice:'auto'|'ask'|'follow')=>choice==='follow'?`ln-${agent}-follow`:`ln-${agent}-${choice}`;
 // The arrow key selects the choice it reaches, as the effort control does; with no choice marked the first has the Tab
 // stop and the arrow selects it. While a choice is being sent the group says it is busy (aria-disabled) and the arrow
 // waits; it is not disabled, since a disabled button drops the focus the arrow just gave it (#588).
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const direction=arrowChoice(event,rtl); if(direction===null||pending) return;
  const next=chosen===null?index:Math.max(0,Math.min(choices.length-1,index+direction));
  choose(choices[next]);
  document.getElementById(idOf(choices[next]))?.focus();
 };
 return <>
  <div className="segmented segmented--field ln-seg" role="radiogroup" aria-labelledby={labelId}>{choices.map((choice,index)=>
   <button type="button" key={choice} role="radio" id={idOf(choice)} aria-checked={chosen===choice} tabIndex={chosen===choice||(chosen===null&&index===0)?0:-1} aria-disabled={pending||undefined}
    onClick={()=>choose(choice)} onKeyDown={event=>move(event,index)}>{t(choice==='follow'?'settingsLearnFollowCompany':modeName[choice])}</button>)}
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
