'use client';
import { useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { effortDefault, effortHintKey, effortLabelKey } from '@/lib/engine-effort.mjs';
import { toast } from './toast';
import { AppTile } from '@/components/app-tile';
import { markOf } from '@/lib/app-mark.mjs';

// The "Subscription and models" section's defaults and speech-to-text (#29; its Providers are settings-providers.tsx) and an Agent's "Thinks with" rows: the Engine's model options for the
// Company's space and for each Agent's own profile, the model written to that profile and read back, and the Owner's
// switch for sub-agents. A model is provider/model as the Engine lists and takes it. No control here carries a key, and
// a key the Owner types goes straight to the route that hands it to the Engine and is then cleared from the page.

export type ModelOption={provider:string,providerName:string,model:string};
type ModelSetting={key:string,type:'string'|'number'|'boolean'|'select',choices:string[]|null,default:unknown,value:unknown,limits:{min?:number,max?:number,integer?:boolean}|null,label:string};
export type AgentModels={id:string,name:string,own:boolean,choosable:boolean,model:string|null,choice:string|null,subagents:boolean,options:ModelOption[],effort:string|null,settings:ModelSetting[]};
export type ModelsData={default:{model:string|null,options:ModelOption[]},agents:AgentModels[]};
import type { Named } from './settings-providers';

type Answer={ok:boolean,error:string,data:Record<string,unknown>|null};
async function send(path:string,body:object):Promise<Answer> {
 try {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const answer=await response.json().catch(()=>null);
  return {ok:response.ok,error:response.ok?'':String((answer as {error?:unknown}|null)?.error||''),data:answer&&typeof answer==='object'?answer as Record<string,unknown>:null};
 } catch { return {ok:false,error:'',data:null}; }
}
const modelOf=(option:ModelOption)=>`${option.provider}/${option.model}`;
// A provider's logo, or its first letter where it has none (#424). A key row names it (label); a model choice already
// says its provider in words, so there it has no label and stays out of the radio's name.
const ProviderLogo=({provider,name,label}:{provider:string,name:string,label?:string})=><AppTile app={{key:provider,mark:markOf(name)}} label={label}/>;
// The arrow keys move through a list of model choices as the reference's other radio groups do: down or right forward in
// English, down or left forward in Arabic; the first and last stop the arrow, and a group with no choice marked starts
// from the focused row. Moving selects, as the effort control does (#179).
function moveChoice(event:KeyboardEvent<HTMLButtonElement>,rtl:boolean) {
 const key=event.key;
 if(key!=='ArrowLeft'&&key!=='ArrowRight'&&key!=='ArrowUp'&&key!=='ArrowDown') return null;
 event.preventDefault();
 return key==='ArrowDown'?1:key==='ArrowUp'?-1:(key==='ArrowLeft')===rtl?1:-1;
}
// The route's error code, as the line under the control that made the change: a refusal is the Owner's line, an Agent
// that keeps the Company profile says why, and anything else is that control's own retry line.
function reasonKey(code:string) {
 if(code==='settingNotAllowed') return 'settingsModelsOwnerOnly';
 if(code==='settingAgentShared'||code==='settingSubagentsOff') return 'settingsModelsShared';
 if(code==='settingNoDefault'||code==='settingNoEngine') return 'settingsModelsNoChoice';
 return 'settingsModelsError';
}

// The Company's speech-to-text provider (#430): the Owner picks one and pastes its key once, and every Agent transcribes
// with it in its own speaking language. Deepgram comes first, for Arabic. As with model keys, the value is never drawn
// back: the field starts empty and is cleared after it is sent. Provider names are their own brands, in either language.
export type SpeechData={provider:string|null,missing:Named[]|null};
const speechRows=[['deepgram','Deepgram Nova-3','settingsSpeechDeepgram'],['elevenlabs','ElevenLabs',''],['openai','OpenAI',''],['groq','Groq','settingsSpeechGroq']] as const;
export function SpeechToText({company,owner,data}:{company:string,owner:boolean,data:SpeechData|null}) {
 const {t}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(''); const [value,setValue]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const [missed,setMissed]=useState<string[]>([]);
 const act=async(provider:string,intent:'set'|'remove')=>{
  if(busy) return;
  if(intent==='set'&&value.trim().length<8) { setError('speechInvalid'); return; }
  setBusy(true); setError('');
  const answer=await send('/api/speech-provider',{company,provider,intent,...(intent==='set'?{value:value.trim()}:{})});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'speechFailed'); return; }
  setOpen(''); setValue('');
  // Agents a write did not reach are named, with no success toast, so the Owner tries again.
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as Named[]).map(item=>item.name||t('settingsModelsAnAgent')):[];
  setMissed(failed);
  if(!failed.length) toast(t(intent==='set'?'settingsModelsKeySaved':'settingsModelsKeyRemoved'));
  router.refresh();
 };
 const missing=data?.provider&&data.missing?.length?data.missing.map(item=>item.name||t('settingsModelsAnAgent')):[];
 return <section className="dp-sec" aria-labelledby="md-h-stt" id="md-stt"><h4 className="dp-label" id="md-h-stt"><span>{t('settingsSpeech')}</span></h4>
  {data?.missing?<div className="panel-card md-keys">{speechRows.map(([id,label,note])=>{ const on=data.provider===id; return <div className="md-key" key={id} id={`mdl-stt-row-${id}`}>
   <div className="panel-row"><ProviderLogo provider={id} name={label} label={label}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{label}</bdi></span>
    <span className="panel-row__d" id={`mdl-stt-${id}-state`}>{on?t('settingsSpeechInUse'):note?t(note):''}</span></span>
    {owner&&on&&<button type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={t('settingsModelsKeyRemoveLabel',label)} onClick={()=>act(id,'remove')}>{t('settingsModelsKeyRemove')}</button>}
    {owner&&<button type="button" className="link-btn" aria-expanded={open===id} aria-controls={`mdl-stt-${id}-form`} onClick={()=>{ setOpen(open===id?'':id); setValue(''); setError(''); }}>{t(on?'settingsModelsKeyReplace':'settingsSpeechUse')}</button>}
   </div>
   {owner&&open===id&&<div className="sub-step" id={`mdl-stt-${id}-form`}>
    <label className="set-label" htmlFor={`mdl-stt-${id}-value`}>{t('settingsModelsKeyValue')}</label>
    <input className="set-input" id={`mdl-stt-${id}-value`} type="password" dir="ltr" autoComplete="new-password" spellCheck={false} value={value} disabled={busy}
     onChange={event=>setValue(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter') act(id,'set'); }}/>
    <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={()=>act(id,'set')}>{t('settingsModelsKeySave')}</button></div>
   </div>}
  </div>; })}</div>
  :<div className="panel-card"><p className="panel-empty">{t(data?'settingsSpeechUnread':'settingsModelsKeyNoEngine')}</p></div>}
  {data?.missing&&!data.provider&&<p className="set-hint" id="mdl-stt-none">{t('settingsSpeechNone')}</p>}
  {error&&<p className="set-err" role="alert">{t(error==='speechNotAllowed'?'settingsSpeechOwnerOnly':'settingsModelsKeyError')}</p>}
  {missed.length>0&&<p className="set-err" role="alert">{t('settingsSpeechNotReached',missed.join(', '))}</p>}
  {!owner&&<p className="set-hint">{t('settingsSpeechOwnerOnly')}</p>}
  {owner&&missing.length>0&&<ul className="set-hint md-waiting">{missing.map((name,at)=><li key={at}>{t('settingsSpeechMissing')} <bdi>{name}</bdi></li>)}</ul>}
  <p className="set-hint">{t('settingsSpeechHint')}</p>
 </section>;
}

// The Company's default model: the Engine's list for the Company's shared space. The Owner chooses one; every other
// member reads the choice with the default marked.
export function DefaultModel({company,owner,models}:{company:string,owner:boolean,models:ModelsData['default']}) {
 const {t,language}=useI18n(); const rtl=language==='ar'; const router=useRouter();
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 // The Agents a default did not reach, and the value to send them again: the shared space takes it but an Agent's profile
 // can refuse, so the Owner sees which Agents stayed on the old model and can retry the same default.
 const [missed,setMissed]=useState<string[]>([]); const [retry,setRetry]=useState('');
 const choose=async(value:string)=>{
  if(busy) return;
  setBusy(true); setError('');
  const answer=await send('/api/agent-settings',{company,setting:'model',value});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'settingFailed'); return; }
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as {name?:unknown}[]).map(entry=>String(entry?.name||'')).filter(Boolean):[];
  if(failed.length) { setMissed(failed); setRetry(value); router.refresh(); return; }
  setMissed([]); setRetry('');
  toast(t('settingsModelsSaved')); router.refresh();
 };
 const idOf=(option:ModelOption)=>`mdl-def-${option.provider}-${option.model}`;
 const chosenIndex=owner?models.options.findIndex(option=>modelOf(option)===models.model):-1;
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const step=moveChoice(event,rtl); if(step===null) return;
  const next=chosenIndex<0?index:Math.max(0,Math.min(models.options.length-1,index+step));
  if(next!==chosenIndex) choose(modelOf(models.options[next]));
  document.getElementById(idOf(models.options[next]))?.focus();
 };
 const row=(option:ModelOption,index:number)=>{
  const choice=modelOf(option); const on=choice===models.model; const text=<><ProviderLogo provider={option.provider} name={option.providerName}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{option.model}</bdi></span><span className="panel-row__d"><bdi>{option.providerName}</bdi></span></span></>;
  const meta=on?<span className="panel-row__meta"><span aria-hidden="true">✓</span>{t('settingsModelsDefaultMark')}</span>:null;
  return owner
   ? <button type="button" className="panel-row" role="radio" id={idOf(option)} key={choice} aria-checked={on} tabIndex={on||(chosenIndex<0&&index===0)?0:-1} disabled={busy} onClick={()=>{ if(!on) choose(choice); }} onKeyDown={event=>move(event,index)}>{text}{meta}</button>
   : <div className="panel-row" key={choice} aria-current={on?'true':undefined}>{text}{meta}</div>;
 };
 return <section className="dp-sec" aria-labelledby="md-h-default"><h4 className="dp-label" id="md-h-default"><span>{t('settingsModelsDefault')}</span></h4>
  {models.options.length?<div className="panel-card" role={owner?'radiogroup':undefined} aria-labelledby="md-h-default">{models.options.map(row)}</div>
   :<div className="panel-card"><p className="panel-empty">{t('settingsModelsNoChoice')}</p></div>}
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
  {missed.length>0&&<div className="set-err" role="alert">
   <p>{t('settingsModelsNotReached',missed.join(', '))}</p>
   <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={()=>choose(retry)}>{t('settingsModelsRetry')}</button>
  </div>}
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
  <p className="set-hint">{t('settingsModelsDefaultHint')}</p>
 </section>;
}

// The thinking level every new Agent starts with (#179): the Engine has no setting that gives a new profile a level, so a
// new profile has none and reads as the reference's Medium. The reference's read-only form for every Role: the level and
// its line, with nothing to change (design-reference/app.js 7362-7366).
export function DefaultEffort() {
 const {t}=useI18n();
 const hint=effortHintKey(effortDefault);
 return <section className="dp-sec" aria-labelledby="md-h-eff"><h4 className="dp-label" id="md-h-eff"><span>{t('settingsModelsEffort')}</span></h4>
  <div className="panel-card set-card"><div className="set-field">
   <p className="ro-text" id="mdl-eff">{t(effortLabelKey(effortDefault))}</p>
   {hint&&<span className="set-hint" aria-live="polite">{t(hint)}</span>}
  </div></div></section>;
}

// One Agent's model rows, for its "Thinks with" section (#29): the Engine's choices for that Agent's own profile, the main
// Agent's `co-` one included (#425). An Agent that shares a profile it does not keep has no model of its own and says so.
export function AgentModel({company,agent,name,model,options,choosable,owner}:{company:string,agent:string,name:string,model:string|null,options:ModelOption[],choosable:boolean,owner:boolean}) {
 const {t,language}=useI18n(); const rtl=language==='ar'; const router=useRouter();
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const choose=async(value:string|null)=>{
  if(busy) return;
  setBusy(true); setError('');
  const answer=await send('/api/agent-settings',{company,agent,setting:'model',value});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'settingFailed'); return; }
  toast(t('settingsModelsSaved')); router.refresh();
 };
 if(!choosable) return <div className="panel-card"><p className="ro-text" id="set-model">{model||t('settingsModelsNoModel')}</p></div>;
 if(!owner) return <div className="panel-card"><p className="ro-text" id="set-model">{model||t('settingsModelsNoModel')}</p></div>;
 if(!options.length) return <div className="panel-card"><p className="panel-empty">{t('settingsModelsNoChoice')}</p></div>;
 const idOf=(option:ModelOption)=>`set-model-${option.provider}-${option.model}`;
 const chosenIndex=options.findIndex(option=>modelOf(option)===model);
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const step=moveChoice(event,rtl); if(step===null) return;
  const next=chosenIndex<0?index:Math.max(0,Math.min(options.length-1,index+step));
  if(next!==chosenIndex) choose(modelOf(options[next]));
  document.getElementById(idOf(options[next]))?.focus();
 };
 const row=(option:ModelOption,index:number)=>{
  const choice=modelOf(option); const on=choice===model; const text=<span className="panel-row__text"><span className="panel-row__t"><bdi>{option.model}</bdi></span><span className="panel-row__d"><bdi>{option.providerName}</bdi></span></span>;
  return owner
   ? <button type="button" className="panel-row" role="radio" id={idOf(option)} key={choice} aria-checked={on} tabIndex={on||(chosenIndex<0&&index===0)?0:-1} disabled={busy} onClick={()=>{ if(!on) choose(choice); }} onKeyDown={event=>move(event,index)}>{text}{on&&<span className="panel-row__meta" aria-hidden="true">✓</span>}</button>
   : <div className="panel-row" key={choice} aria-current={on?'true':undefined}>{text}{on&&<span className="panel-row__meta" aria-hidden="true">✓</span>}</div>;
 };
 return <div className="md-agent-model" id="set-model">
  <div className="panel-card" role={owner?'radiogroup':undefined} aria-label={t('settingsModelsChoose',name)}>{options.map(row)}</div>
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
 </div>;
}

// Each Agent's model, with the Owner's sub-agents switch and the Engine's sub-agent settings while it is on. A member
// below Owner reads the value and no control.
export function EachAgent({company,owner,models}:{company:string,owner:boolean,models:ModelsData}) {
 const {t}=useI18n();
 return <section className="dp-sec" aria-labelledby="md-h-each"><h4 className="dp-label" id="md-h-each"><span>{t('settingsModelsEach')}</span></h4>
  <div className="panel-card md-agents">{models.agents.map(agent=><AgentRow key={agent.id} company={company} owner={owner} agent={agent} defaultModel={models.default.model}/>)}</div>
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
  <p className="set-hint">{t('settingsModelsEachHint')}</p>
 </section>;
}

function AgentRow({company,owner,agent,defaultModel}:{company:string,owner:boolean,agent:AgentModels,defaultModel:string|null}) {
 const {t}=useI18n(); const router=useRouter();
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const change=async(body:object,ok:string)=>{
  if(busy) return;
  setBusy(true); setError('');
  const answer=await send('/api/agent-settings',{company,agent:agent.id,...body});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'settingFailed'); return; }
  toast(t(ok)); router.refresh();
 };
 const chosen=agent.choice??'';
 const label=agent.model||(agent.choice?agent.choice:defaultModel)||t('settingsModelsNoModel');
 return <div className="md-agent" id={`mdl-agent-${agent.id}`}>
  <div className="panel-row">
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span>
    <span className="panel-row__d" id={`mdl-agent-${agent.id}-model`}>{agent.choice?<>{t('settingsModelsOwn')} · <bdi dir="ltr">{agent.model}</bdi></>:<>{t('settingsModelsFollows')} · <bdi dir="ltr">{label}</bdi></>}{agent.effort&&<> · {t(effortLabelKey(agent.effort))}</>}</span></span>
   {owner&&agent.choosable?<label className="md-agent__pick"><span className="set-label">{t('settingsModelsModelField',agent.name)}</span>
    <select className="set-input" value={chosen} disabled={busy} aria-label={t('settingsModelsModelField',agent.name)}
     onChange={event=>change({setting:'model',value:event.target.value||null},'settingsModelsSaved')}>
     <option value="">{t('settingsModelsFollows')}</option>
     {agent.options.map(option=><option key={modelOf(option)} value={modelOf(option)}>{option.model}</option>)}
    </select></label>
   :<span className="panel-row__meta"><bdi dir="ltr">{agent.model||t('settingsModelsNoModel')}</bdi></span>}
  </div>
  {agent.choosable&&<div className="panel-row">
   <span className="panel-row__text"><span className="panel-row__t" id={`mdl-sub-${agent.id}-t`}>{t('settingsSubagents')}</span>
    <span className="panel-row__d" id={`mdl-sub-${agent.id}-state`}>{t(agent.subagents?'settingsSubagentsOn':'settingsSubagentsOff')}</span></span>
   {owner?<button type="button" className="switch" role="switch" id={`mdl-sub-${agent.id}`} aria-checked={agent.subagents} aria-labelledby={`mdl-sub-${agent.id}-t`} disabled={busy} onClick={()=>change({setting:'subagents',value:!agent.subagents},'settingsSubagentsSaved')}/>
    :<span className="panel-row__meta">{t(agent.subagents?'settingsSubagentsOn':'settingsSubagentsOff')}</span>}
  </div>}
  {agent.subagents&&<SubagentFields company={company} owner={owner} agent={agent}/>}
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
  {!agent.choosable&&<p className="set-hint">{t('settingsModelsShared')}</p>}
 </div>;
}

const effortLabel=(choice:string)=>choice?`settingsEffort${choice[0].toUpperCase()}${choice.slice(1)}`:'settingsEffortInherit';
function SubagentFields({company,owner,agent}:{company:string,owner:boolean,agent:AgentModels}) {
 const {t}=useI18n(); const router=useRouter();
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const setting=(key:string)=>agent.settings.find(found=>found.key===key);
 const write=async(key:string,value:string|number)=>{
  if(busy) return;
  setBusy(true); setError('');
  const answer=await send('/api/agent-settings',{company,agent:agent.id,setting:key,value});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'settingFailed'); return; }
  toast(t('settingsSubagentsSaved')); router.refresh();
 };
 // The sub-agent model is two Engine keys: its model id and the provider it runs on (config_defaults.py 1316-1317), so
 // one choice from the list saves both in one request.
 const writeMany=async(settings:Record<string,string|number>)=>{
  if(busy) return;
  setBusy(true); setError('');
  const answer=await send('/api/agent-settings',{company,agent:agent.id,settings});
  setBusy(false);
  if(!answer.ok) { setError(answer.error||'settingFailed'); return; }
  toast(t('settingsSubagentsSaved')); router.refresh();
 };
 const writeModel=async(value:string)=>{
  const chosen=agent.options.find(option=>modelOf(option)===value);
  await writeMany(chosen?{'delegation.provider':chosen.provider,'delegation.model':chosen.model}:{'delegation.provider':'','delegation.model':''});
 };
 const model=setting('delegation.model'); const provider=setting('delegation.provider');
 const providers=[...new Map(agent.options.map(option=>[option.provider,option.providerName])).entries()];
 const heldModel=typeof model?.value==='string'?model.value:'';
 const heldProvider=typeof provider?.value==='string'?provider.value:'';
 const heldChoice=heldModel?agent.options.find(option=>option.model===heldModel&&(!heldProvider||option.provider===heldProvider)):undefined;
 const modelChoices=[...agent.options, ...(heldModel&&!heldChoice?[{provider:heldProvider,providerName:heldProvider,model:heldModel}]:[])];
 const providerNames=typeof provider?.value==='string'&&provider.value&&!providers.some(([slug])=>slug===provider.value)?[...providers,[provider.value,provider.value]]:providers;
 const effort=setting('delegation.reasoning_effort');
 const numbers:Record<string,ModelSetting|undefined>={max_concurrent_children:setting('delegation.max_concurrent_children'),max_spawn_depth:setting('delegation.max_spawn_depth')};
 return <div className="sub-step md-subagent" id={`mdl-sub-${agent.id}-settings`}>
  <div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-model`}>{t('settingSubagentModel')}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-model`} value={heldChoice?modelOf(heldChoice):heldModel?`${heldProvider}/${heldModel}`:''} disabled={busy} onChange={event=>writeModel(event.target.value)}>
    <option value="">{t('settingsModelsFollows')}</option>
    {modelChoices.map(choice=><option key={modelOf(choice)} value={modelOf(choice)}>{choice.model}</option>)}
   </select>:<p className="ro-text">{(heldModel?`${heldProvider}${heldProvider?'/':''}${heldModel}`:'')||t('settingsModelsFollows')}</p>}
  </div>
  <div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-provider`}>{t('settingSubagentProvider')}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-provider`} value={String(provider?.value??'')} disabled={busy} onChange={event=>{ const next=event.target.value; writeMany(next?{'delegation.provider':next,'delegation.model':heldModel}:{'delegation.provider':'','delegation.model':''}); }}>
    <option value="">{t('settingsModelsFollows')}</option>
    {providerNames.map(([slug,name])=><option key={slug} value={slug}>{name}</option>)}
   </select>:<p className="ro-text">{String(provider?.value??'')||'—'}</p>}
  </div>
  {Object.entries(numbers).map(([key,entry])=>entry&&<div className="set-field" key={key}><label className="set-label" htmlFor={`mdl-sub-${agent.id}-${key}`}>{t(entry.label)}</label>
   {owner?<input className="set-input" id={`mdl-sub-${agent.id}-${key}`} type="number" inputMode="numeric" min={1} defaultValue={String(entry.value??entry.default??'')} disabled={busy}
    onBlur={event=>{ const next=Number(event.target.value); if(Number.isInteger(next)&&next>=1&&next!==entry.value) write(entry.key,next); }}/>
    :<p className="ro-text">{String(entry.value??entry.default??'')}</p>}
   {key==='max_concurrent_children'&&<span className="set-hint">{t('settingsSubagentsAtOnce',String(entry.default??10))}</span>}
  </div>)}
  {effort&&<div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-effort`}>{t(effort.label)}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-effort`} value={String(effort.value??'')} disabled={busy} onChange={event=>write('delegation.reasoning_effort',event.target.value)}>
    {(effort.choices??['']).map(choice=><option key={choice||'inherit'} value={choice}>{t(effortLabel(choice))}</option>)}
   </select>:<p className="ro-text">{t(effortLabel(String(effort.value??'')))}</p>}
  </div>}
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
 </div>;
}
