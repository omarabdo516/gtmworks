'use client';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import type { LearningAgent } from '@/lib/company-learning.mjs';
import { SettingsIcon } from './settings-icons';
import { Label } from './settings-overlay-parts';
import { holdSaved, savedAt, send, useSave, useSavedEach, type Answer } from './settings-saved';

// The Learning section's controls (#28): the Owner's two mode choices for the Company or one Agent, and an Owner's or a
// Manager's "Forget this" and "Bring it back" on a rule. Each sends one request to a route that checks the Role again
// (/api/agent-settings, /api/agent-rules). A mode is marked at once and says "Saving" while the Engine writes it, and is
// then held on the page (app/settings-saved.ts, #663); a rule's change reads the page again.
async function sendRule(method:'POST'|'PUT',body:object) {
 try {
  const response=await fetch('/api/agent-rules',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.ok;
 } catch { return false; }
}
type Mode='auto'|'ask';
type Read=Mode|'mixed'|null;
const modeLabels=['auto','ask'] as const;
const modeName={auto:'settingsLearnOnItsOwn',ask:'settingsLearnAsks'} as const;
const modeWords={auto:'settingsLearnAutoD',ask:'settingsLearnAskD'} as const;
const modeKey={auto:'settingsLearnOnItsOwn',ask:'settingsLearnAsks',mixed:'settingsLearnMixed'} as const;
// Arrow keys move the choice as the reference's other segmented controls do: forward is left in Arabic and right in
// English, the first and last choice stop the arrow, and a group with no choice selected gives its first one the Tab stop
// so the keyboard can reach it. Moving selects, as the effort control does (#179).
function arrowChoice(event:KeyboardEvent<HTMLButtonElement>,rtl:boolean) {
 if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return null;
 event.preventDefault();
 return (event.key==='ArrowLeft')===rtl?1:-1;
}
// What a mode save leaves one Agent on, held under its key: the mode its profile reads, and whether it follows the Company.
type Held={mode:Read,follow:boolean|null};
const agentKey=(company:string,agent:string)=>`learning:${company}:${agent}`;
const companyKey=(company:string)=>`learning:${company}:company`;
const modeOf=(answer:Answer,fallback:Read):Read=>answer.data?.mode==='auto'||answer.data?.mode==='ask'?answer.data.mode:fallback;
const Saving=({className}:{className:string})=>{ const {t}=useI18n(); return <span className={`${className} is-saving`} role="status">{t('settingsSaving')}</span>; };

// The Company's mode is what its Agents' profiles agree on: one mode when every Agent reads it, mixed when an Agent has
// its own, and unknown when a profile could not be read.
function companyModeOf(modes:Read[]|null):Read {
 if(!modes?.length) return null;
 if(modes.some(mode=>mode===null)) return null;
 return modes.every(mode=>mode===modes[0])?modes[0]:'mixed';
}

export type ModeAgent=Pick<LearningAgent,'id'|'name'|'own'|'shared'|'mode'|'follow'>;
// The Company's mode and each Agent's (sovLearnHTML's "For the whole company" and "Each agent"). `readAt` is the
// server's time the page was read, so a mode saved after it stands over what the page read (#663). The Company's mode is
// drawn here from every Agent's held mode, so a Company change shows on each Agent row it reached at once.
export function LearningModes({company,owner,readAt,agents}:{company:string,owner:boolean,readAt:number,agents:ModeAgent[]|null}) {
 const {t}=useI18n();
 const held=useSavedEach<Held>((agents??[]).map(agent=>({key:agentKey(company,agent.id),server:{mode:agent.mode,follow:agent.follow}})),readAt);
 const rows=(agents??[]).map((agent,at)=>({...agent,...held[at]}));
 const companyMode=companyModeOf(agents?rows.map(agent=>agent.mode):null);
 return <>
  <section className="dp-sec" aria-labelledby="ln-h-co"><Label id="ln-h-co" info={t('settingsLearnTapHint')}>{t('settingsLearnCompany')}</Label>
   {!agents?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :<CompanyLearningMode company={company} mode={companyMode} canChange={owner} readAt={readAt} agents={rows}/>}</section>
  <section className="dp-sec" aria-labelledby="ln-h-per"><Label id="ln-h-per">{t('settingsLearnPerAgent')}</Label>
   {!agents?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :agents.length===0?<div className="panel-card"><p className="panel-empty">{t('noAgentsYet')}</p></div>
    :<div className="panel-card">{agents.map(agent=><AgentLearningRow key={agent.id} company={company} owner={owner} readAt={readAt} agent={agent}/>)}</div>}</section>
 </>;
}

// The Company's mode: "Learns on its own" or "Asks first", each a card of the approved reference (cr-kind). Reading
// Roles see the same cards with no choice, and a mixed Company reads as mixed in the hint beside them. The choice is
// marked at once with a "Saving" line; every Agent the change reached then holds the new mode.
function CompanyLearningMode({company,mode,canChange,readAt,agents}:{company:string,mode:Read,canChange:boolean,readAt:number,agents:(ModeAgent&Held)[]}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 // The value held here is the mode the Company's own space took; what the cards show is what its Agents agree on.
 const saved=useSave<Read>(companyKey(company),mode,readAt);
 const shown:Read=saved.saving?saved.value:mode;
 const choose=async(next:Mode)=>{
  if(!canChange||shown===next) return;
  const answer=await saved.save(next,()=>send('/api/agent-settings',{company,mode:next}),found=>modeOf(found,next));
  if(!answer.ok) return;
  const at=savedAt(answer);
  for(const entry of Array.isArray(answer.data?.agents)?answer.data.agents as {agent?:unknown,written?:unknown}[]:[]) {
   const agent=agents.find(found=>found.id===entry?.agent);
   if(entry?.written===true&&agent) holdSaved(agentKey(company,agent.id),{mode:modeOf(answer,next),follow:agent.follow},at);
  }
 };
 const chosen=shown==='auto'||shown==='ask'?shown:null;
 // The arrow key selects the choice it reaches, the Tab stop's when no choice is marked; a reader with no choice moves the
 // focus alone.
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const direction=arrowChoice(event,rtl); if(direction===null) return;
  const next=chosen===null?index:Math.max(0,Math.min(modeLabels.length-1,index+direction));
  choose(modeLabels[next]);
  document.getElementById(`ln-co-${modeLabels[next]}`)?.focus();
 };
 return <>
  <div className="cr-kinds" role="radiogroup" aria-labelledby="ln-h-co" aria-busy={saved.saving||undefined}>{modeLabels.map((key,index)=>{
   const on=shown===key;
   return <button type="button" key={key} className="cr-kind" role="radio" id={`ln-co-${key}`} aria-checked={on} tabIndex={on||(chosen===null&&index===0)?0:-1} aria-disabled={canChange?undefined:true} onClick={()=>choose(key)} onKeyDown={event=>move(event,index)}>
    <span className="cr-kind__t">{t(modeName[key])}</span><span className="cr-kind__d">{t(modeWords[key])}</span>
    {on&&<span className="cr-kind__check" aria-hidden="true"><SettingsIcon name="check"/></span>}
   </button>;})}</div>
  {saved.saving&&<p className="set-hint"><Saving className="ln-saving"/></p>}
  {saved.error&&<p className="set-err" role="alert">{t('settingsLearnModeFailed')}</p>}
  {/* Each Agent on its own mode is new information, so it stays on the page (#614). */}
  {!saved.saving&&mode==='mixed'&&<p className="set-hint">{t('settingsLearnMixed')}</p>}
 </>;
}

// One Agent's row: its name and mode, and for the Owner its own switch. An Agent on another Agent's shared profile has
// no switch, since a write there would change both.
function AgentLearningRow({company,owner,readAt,agent}:{company:string,owner:boolean,readAt:number,agent:ModeAgent}) {
 const {t}=useI18n();
 const saved=useSave<Held>(agentKey(company,agent.id),{mode:agent.mode,follow:agent.follow},readAt);
 const choose=async(next:Mode|'follow')=>{
  const follows=next==='follow';
  // Following again takes the Company's mode, which the answer names; until then the row keeps its mode and says "Saving".
  await saved.save({mode:follows?saved.value.mode:next,follow:follows},()=>send('/api/agent-settings',{company,agent:agent.id,mode:next}),
   answer=>({mode:modeOf(answer,follows?saved.value.mode:next),follow:follows}));
 };
 const {mode,follow}=saved.value;
 return <div className="panel-row ln-ag">
  <span className="panel-row__text"><span className="panel-row__t" id={`ln-ag-t-${agent.id}`}><bdi>{agent.name}</bdi></span>
   {saved.saving?<Saving className="panel-row__d"/>:<span className="panel-row__d">{mode?t(modeKey[mode]):t('settingsLearnUnread')}</span>}</span>
  {owner&&agent.own&&!agent.shared&&mode?<AgentLearningMode agent={agent.id} labelId={`ln-ag-t-${agent.id}`} mode={mode} follows={follow} busy={saved.saving} onChoose={choose}/>:null}
  {saved.error&&<p className="set-err" role="alert">{t('settingsLearnModeFailed')}</p>}
 </div>;
}

// One Agent's mode, as its own profile reads: the reference's segmented control. "Follow the company" is there for an
// Agent that chose its own mode, and gives it back to the Company's (#28). A second choice made while one is saving is
// marked at once and sent after it (app/settings-saved.ts), so nothing here waits or greys out.
export function AgentLearningMode({agent,labelId,mode,follows,busy=false,onChoose}:{agent:string,labelId:string,mode:Read,follows:boolean|null,busy?:boolean,onChoose:(next:Mode|'follow')=>void}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 const choose=(next:Mode|'follow')=>{ if(next==='follow'?follows:!follows&&mode===next) return; onChoose(next); };
 const choices=follows===null?modeLabels:[...modeLabels,'follow'] as const;
 const chosen=follows===true?'follow':!follows&&(mode==='auto'||mode==='ask')?mode:null;
 const idOf=(choice:Mode|'follow')=>choice==='follow'?`ln-${agent}-follow`:`ln-${agent}-${choice}`;
 // The arrow key selects the choice it reaches, as the effort control does; with no choice marked the first has the Tab
 // stop and the arrow selects it.
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const direction=arrowChoice(event,rtl); if(direction===null) return;
  const next=chosen===null?index:Math.max(0,Math.min(choices.length-1,index+direction));
  choose(choices[next]);
  document.getElementById(idOf(choices[next]))?.focus();
 };
 return <div className="segmented segmented--field ln-seg" role="radiogroup" aria-labelledby={labelId} aria-busy={busy||undefined}>{choices.map((choice,index)=>
   <button type="button" key={choice} role="radio" id={idOf(choice)} aria-checked={chosen===choice} tabIndex={chosen===choice||(chosen===null&&index===0)?0:-1}
    onClick={()=>choose(choice)} onKeyDown={event=>move(event,index)}>{t(choice==='follow'?'settingsLearnFollowCompany':modeName[choice])}</button>)}
  </div>;
}

// "Forget this" on a rule, and "Bring it back" on one that was forgotten (reference: ln-forget, ln-unforget). The
// server checks the Role again (remove_agent_rule, restore_agent_rule); the focus moves to the next rule's control, or
// to the list's heading when none is left.
export function RuleActions({company,rule,body,removed}:{company:string,rule:string,body:string,removed:boolean}) {
 const {t}=useI18n(); const router=useRouter(); const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const act=(button:HTMLButtonElement)=>startTransition(async()=>{
  setFailed(false);
  if(!await sendRule(removed?'PUT':'POST',{company,rule})) { setFailed(true); return; }
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.ln-rule-act')]; const at=buttons.indexOf(button);
  (buttons[at+1]||buttons[at-1]||document.getElementById('ln-h-rec'))?.focus();
  router.refresh();
 });
 const name=body.length>40?`${body.slice(0,40)}…`:body;
 return <span className="ln-acts">{failed&&<span className="set-err" role="alert">{t(removed?'settingsLearnBringBackFailed':'settingsLearnForgetFailed')}</span>}
  <button type="button" className="link-btn ln-rule-act" disabled={pending} aria-label={t(removed?'settingsLearnBringBackLabel':'settingsLearnForgetLabel',name)} onClick={event=>act(event.currentTarget)}>{t(removed?'settingsLearnBringBack':'settingsLearnForget')}</button></span>;
}
