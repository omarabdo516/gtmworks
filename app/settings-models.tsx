'use client';
import { useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { effortDefault, effortHintKey, effortLabelKey } from '@/lib/engine-effort.mjs';
import { toast } from './toast';
import { Advanced } from './settings-info';
import { Label } from './settings-overlay-parts';
import { AppTile } from '@/components/app-tile';
import { markOf, modelMarkOf } from '@/lib/app-mark.mjs';
import { holdSaved, savedAt, send, useSave, useSaved, type Answer } from './settings-saved';

// The "Subscription and models" section's defaults and speech-to-text (#29; its Providers are settings-providers.tsx) and an Agent's "Thinks with" rows: the Engine's model options for the
// Company's space and for each Agent's own profile, the model written to that profile and read back, and the Owner's
// switch for sub-agents. A model is provider/model as the Engine lists and takes it. No control here carries a key, and
// a key the Owner types goes straight to the route that hands it to the Engine and is then cleared from the page.

export type ModelOption={provider:string,providerName:string,model:string};
type ModelSetting={key:string,type:'string'|'number'|'boolean'|'select',choices:string[]|null,default:unknown,value:unknown,limits:{min?:number,max?:number,integer?:boolean}|null,label:string};
export type AgentModels={id:string,name:string,own:boolean,choosable:boolean,model:string|null,choice:string|null,subagents:boolean,options:ModelOption[],effort:string|null,settings:ModelSetting[]};
export type ModelsData={default:{model:string|null,options:ModelOption[]},agents:AgentModels[]};
import type { Named } from './settings-providers';

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
 if(code==='settingModelNotEnabled') return 'settingsModelsNotEnabled';
 return 'settingsModelsError';
}

// The Company's speech-to-text provider (#430): the Owner picks one and pastes its key once, and every Agent transcribes
// with it in its own speaking language. Deepgram comes first, for Arabic. As with model keys, the value is never drawn
// back: the field starts empty and is cleared after it is sent. Provider names are their own brands, in either language.
export type SpeechData={provider:string|null,missing:Named[]|null};
const speechRows=[['deepgram','Deepgram Nova-3','settingsSpeechDeepgram'],['elevenlabs','ElevenLabs',''],['openai','OpenAI',''],['groq','Groq','settingsSpeechGroq']] as const;
export function SpeechToText({company,owner,data,readAt}:{company:string,owner:boolean,data:SpeechData|null,readAt:number}) {
 const {t}=useI18n();
 // The provider in use and the Agents still waiting for it, as the save's answer read them back (#663).
 const saved=useSave<SpeechData>(`speech:${company}`,{provider:data?.provider??null,missing:data?.missing??null},readAt);
 const [open,setOpen]=useState(''); const [value,setValue]=useState(''); const [invalid,setInvalid]=useState(false);
 // The provider whose row says "Saving": the one being set, or the one being removed.
 const [sending,setSending]=useState('');
 const [missed,setMissed]=useState<string[]>([]);
 const act=async(provider:string,intent:'set'|'remove')=>{
  if(intent==='set'&&value.trim().length<8) { setInvalid(true); return; }
  // The key leaves the page as it is sent: the form closes and the row says "Saving" while the Engine takes it.
  const key=value.trim();
  setInvalid(false); setOpen(''); setValue(''); setSending(provider);
  const answer=await saved.save({provider:intent==='set'?provider:null,missing:saved.value.missing??[]},
   ()=>send('/api/speech-provider',{company,provider,intent,...(intent==='set'?{value:key}:{})}),
   found=>({provider:typeof found.data?.provider==='string'?found.data.provider:null,missing:Array.isArray(found.data?.missing)?found.data.missing as Named[]:null}));
  // A failed key opens its form again, unless the Owner already opened another one, whose key stays with it.
  if(!answer.ok) { if(answer.newest&&intent==='set') setOpen(current=>current||provider); return; }
  // Agents a write did not reach are named, with no success toast, so the Owner tries again.
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as Named[]).map(item=>item.name||t('settingsModelsAnAgent')):[];
  setMissed(failed);
  if(!failed.length&&answer.newest) toast(t(intent==='set'?'settingsModelsKeySaved':'settingsModelsKeyRemoved'));
 };
 const current=saved.value;
 const error=invalid?'speechInvalid':saved.error;
 const missing=!saved.saving&&current.provider&&current.missing?.length?current.missing.map(item=>item.name||t('settingsModelsAnAgent')):[];
 return <section className="dp-sec" aria-labelledby="md-h-stt" id="md-stt"><Label id="md-h-stt" info={t('settingsSpeechHint')}>{t('settingsSpeech')}</Label>
  {data&&current.missing?<div className="panel-card md-keys" aria-busy={saved.saving||undefined}>{speechRows.map(([id,label,note])=>{ const on=current.provider===id; return <div className="md-key" key={id} id={`mdl-stt-row-${id}`}>
   <div className="panel-row"><ProviderLogo provider={id} name={label} label={label}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{label}</bdi></span>
    {saved.saving&&sending===id?<span className="panel-row__d is-saving" id={`mdl-stt-${id}-state`} role="status">{t('settingsSaving')}</span>
     :<span className="panel-row__d" id={`mdl-stt-${id}-state`}>{on?t('settingsSpeechInUse'):note?t(note):''}</span>}</span>
    {owner&&on&&<button type="button" className="btn btn--secondary btn--sm" aria-label={t('settingsModelsKeyRemoveLabel',label)} onClick={()=>act(id,'remove')}>{t('settingsModelsKeyRemove')}</button>}
    {owner&&<button type="button" className="link-btn" aria-expanded={open===id} aria-controls={`mdl-stt-${id}-form`} onClick={()=>{ setOpen(open===id?'':id); setValue(''); setInvalid(false); }}>{t(on?'settingsModelsKeyReplace':'settingsSpeechUse')}</button>}
   </div>
   {owner&&open===id&&<div className="sub-step" id={`mdl-stt-${id}-form`}>
    <label className="set-label" htmlFor={`mdl-stt-${id}-value`}>{t('settingsModelsKeyValue')}</label>
    <input className="set-input" id={`mdl-stt-${id}-value`} type="password" dir="ltr" autoComplete="new-password" spellCheck={false} value={value}
     onChange={event=>setValue(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter') act(id,'set'); }}/>
    <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--primary btn--sm" onClick={()=>act(id,'set')}>{t('settingsModelsKeySave')}</button></div>
   </div>}
  </div>; })}</div>
  :<div className="panel-card"><p className="panel-empty">{t(data?'settingsSpeechUnread':'settingsModelsKeyNoEngine')}</p></div>}
  {data&&current.missing&&!current.provider&&!saved.saving&&<p className="set-hint" id="mdl-stt-none">{t('settingsSpeechNone')}</p>}
  {error&&<p className="set-err" role="alert">{t(error==='speechNotAllowed'?'settingsSpeechOwnerOnly':'settingsModelsKeyError')}</p>}
  {missed.length>0&&<p className="set-err" role="alert">{t('settingsSpeechNotReached',missed.join(', '))}</p>}
  {!owner&&<p className="set-hint">{t('settingsSpeechOwnerOnly')}</p>}
  {owner&&missing.length>0&&<ul className="set-hint md-waiting">{missing.map((name,at)=><li key={at}>{t('settingsSpeechMissing')} <bdi>{name}</bdi></li>)}</ul>}
 </section>;
}

// The Company's default model: the Engine's list for the Company's shared space. The Owner chooses one; every other
// member reads the choice with the default marked. The choice is marked at once and says "Saving" until the Engine has
// it (#661); every Agent the default reached then shows it too, with no read of the page.
export function DefaultModel({company,owner,models,readAt}:{company:string,owner:boolean,models:ModelsData['default'],readAt:number}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 const saved=useSave<string|null>(defaultKey(company),models.model,readAt);
 // The Agents a default did not reach, and the value to send them again: the shared space takes it but an Agent's profile
 // can refuse, so the Owner sees which Agents stayed on the old model and can retry the same default.
 const [missed,setMissed]=useState<string[]>([]); const [retry,setRetry]=useState('');
 // Every Agent the default reached now runs on it, and its row says so with no read of the page.
 const holdFollowers=(answer:Answer,value:string)=>{
  const at=savedAt(answer);
  for(const entry of Array.isArray(answer.data?.agents)?answer.data.agents as {agent?:unknown,written?:unknown}[]:[]) {
   if(entry?.written===true&&typeof entry.agent==='string') holdSaved(agentModelKey(company,entry.agent),{model:value,choice:null},at);
  }
 };
 const choose=async(value:string)=>{
  const answer=await saved.save(value,()=>send('/api/agent-settings',{company,setting:'model',value}));
  if(!answer.ok) return;
  holdFollowers(answer,value);
  // Every answer that saved names the Agents it missed, so a newer choice that then fails still leaves the Retry for them.
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as {name?:unknown}[]).map(entry=>String(entry?.name||'')).filter(Boolean):[];
  if(failed.length) { setMissed(failed); setRetry(value); return; }
  setMissed([]); setRetry('');
  if(answer.newest) toast(t('settingsModelsSaved'));
 };
 const current=saved.value;
 const idOf=(option:ModelOption)=>`mdl-def-${option.provider}-${option.model}`;
 const chosenIndex=owner?models.options.findIndex(option=>modelOf(option)===current):-1;
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const step=moveChoice(event,rtl); if(step===null) return;
  const next=chosenIndex<0?index:Math.max(0,Math.min(models.options.length-1,index+step));
  if(next!==chosenIndex) choose(modelOf(models.options[next]));
  document.getElementById(idOf(models.options[next]))?.focus();
 };
 const row=(option:ModelOption,index:number)=>{
  const choice=modelOf(option); const on=choice===current; const text=<><ProviderLogo provider={option.provider} name={option.providerName}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{option.model}</bdi></span><span className="panel-row__d"><bdi>{option.providerName}</bdi></span></span></>;
  const meta=on?(saved.saving?<Saving/>:<span className="panel-row__meta"><span aria-hidden="true">✓</span>{t('settingsModelsDefaultMark')}</span>):null;
  return owner
   ? <button type="button" className="panel-row" role="radio" id={idOf(option)} key={choice} aria-checked={on} tabIndex={on||(chosenIndex<0&&index===0)?0:-1} onClick={()=>{ if(!on) choose(choice); }} onKeyDown={event=>move(event,index)}>{text}{meta}</button>
   : <div className="panel-row" key={choice} aria-current={on?'true':undefined}>{text}{meta}</div>;
 };
 return <section className="dp-sec" aria-labelledby="md-h-default"><Label id="md-h-default" info={t('settingsModelsDefaultHint')}>{t('settingsModelsDefault')}</Label>
  {models.options.length?<div className="panel-card" role={owner?'radiogroup':undefined} aria-labelledby="md-h-default" aria-busy={saved.saving||undefined}>{models.options.map(row)}</div>
   :<div className="panel-card"><p className="panel-empty">{t('settingsModelsNoChoice')}</p></div>}
  {saved.error&&<p className="set-err" role="alert">{t(reasonKey(saved.error))}</p>}
  {missed.length>0&&<div className="set-err" role="alert">
   <p>{t('settingsModelsNotReached',missed.join(', '))}</p>
   <button type="button" className="btn btn--secondary btn--sm" disabled={saved.saving} onClick={()=>choose(retry)}>{t('settingsModelsRetry')}</button>
  </div>}
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
 </section>;
}

// The Company's Fallback model (#622; GLOSSARY: Fallback model): None first, the default, then the same choices as the
// default model, which are the models some Provider has switched on. The Owner picks one; every other Member reads the
// choice (they get no list of choices, so theirs names the provider by its id). For the Owner, a choice no Provider
// offers any more stays drawn, with a line saying Agents cannot move to it.
export function FallbackModel({company,owner,model:server,options,readAt}:{company:string,owner:boolean,model:string|null,options:ModelOption[],readAt:number}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 // The choice is marked at once and says "Saving" until the Company keeps it, then held on the page (#663).
 const saved=useSave<string|null>(`fallback:${company}`,server,readAt);
 const [missed,setMissed]=useState<string[]>([]);
 const choose=async(value:string|null)=>{
  const answer=await saved.save(value,()=>send('/api/fallback-model',{company,value}),found=>typeof found.data?.model==='string'?found.data.model:null);
  if(!answer.ok) return;
  // Agents whose profile did not take it now are named; the worker gives it to them later, so no retry is offered.
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as {name?:unknown}[]).map(entry=>String(entry?.name||'')).filter(Boolean):[];
  setMissed(failed);
  if(!failed.length&&answer.newest) toast(t('settingsFallbackSaved'));
 };
 const model=saved.value; const error=saved.error;
 const held=model&&model.includes('/')&&!options.some(option=>modelOf(option)===model)?(()=>{ const at=model.indexOf('/'); return {provider:model.slice(0,at),providerName:model.slice(0,at),model:model.slice(at+1)}; })():null;
 const rows:(ModelOption|null)[]=[null,...options,...(held?[held]:[])];
 const valueOf=(option:ModelOption|null)=>option?modelOf(option):null;
 const idOf=(option:ModelOption|null)=>option?`mdl-fb-${option.provider}-${option.model}`:'mdl-fb-none';
 const chosenIndex=rows.findIndex(option=>valueOf(option)===model);
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const step=moveChoice(event,rtl); if(step===null) return;
  const next=Math.max(0,Math.min(rows.length-1,(chosenIndex<0?index:chosenIndex)+step));
  if(next!==chosenIndex) choose(valueOf(rows[next]));
  document.getElementById(idOf(rows[next]))?.focus();
 };
 const row=(option:ModelOption|null,index:number)=>{
  const value=valueOf(option); const on=value===model;
  const text=option
   ?<><ProviderLogo provider={option.provider} name={option.providerName}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{option.model}</bdi></span>
     <span className="panel-row__d">{option===held&&owner?t('settingsFallbackOff'):<bdi>{option.providerName}</bdi>}</span></span></>
   :<span className="panel-row__text"><span className="panel-row__t">{t('settingsFallbackNone')}</span><span className="panel-row__d">{t('settingsFallbackNoneHint')}</span></span>;
  const meta=on?(saved.saving?<Saving/>:<span className="panel-row__meta"><span aria-hidden="true">✓</span>{option?t('settingsFallbackMark'):null}</span>):null;
  return owner
   ? <button type="button" className="panel-row" role="radio" id={idOf(option)} key={value??'none'} aria-checked={on} tabIndex={on?0:-1} onClick={()=>{ if(!on) choose(value); }} onKeyDown={event=>move(event,index)}>{text}{meta}</button>
   : on?<div className="panel-row" id={idOf(option)} key={value??'none'} aria-current="true">{text}{meta}</div>:null;
 };
 return <section className="dp-sec" aria-labelledby="md-h-fallback" id="md-fallback"><Label id="md-h-fallback" info={t('settingsFallbackHint')}>{t('settingsFallback')}</Label>
  <div className="panel-card" role={owner?'radiogroup':undefined} aria-labelledby="md-h-fallback" aria-busy={saved.saving||undefined}>{rows.map(row)}</div>
  {error&&<p className="set-err" role="alert">{t(error==='settingModelNotEnabled'?'settingsModelsNotEnabled':error==='fallbackNotAllowed'||error==='settingNotAllowed'?'settingsModelsOwnerOnly':'settingsFallbackError')}</p>}
  {missed.length>0&&<p className="set-err" role="alert">{t('settingsFallbackNotReached',missed.join(', '))}</p>}
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
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

// What one Agent's save confirmed, held under these keys until the page is read again (app/settings-saved.ts, #661): its
// model with its own choice, the Company default, its sub-agents switch and each sub-agent setting.
type HeldModel={model:string|null,choice:string|null};
const agentModelKey=(company:string,agent:string)=>`model:${company}:${agent}`;
const defaultKey=(company:string)=>`model:${company}:default`;
const settingKey=(company:string,agent:string,setting:string)=>`setting:${company}:${agent}:${setting}`;
// The model a save leaves the Agent on, from the route's answer: its own choice, or the default it follows.
const heldModelOf=(answer:Answer,fallback:HeldModel):HeldModel=>({model:typeof answer.data?.running==='string'?answer.data.running:fallback.model,choice:typeof answer.data?.model==='string'?answer.data.model:null});
// The "Saving" mark a control shows on its row while the Engine writes and reads the value back (#661).
function Saving({id}:{id?:string}) { const {t}=useI18n(); return <span className="panel-row__meta is-saving" id={id} role="status">{t('settingsSaving')}</span>; }

// One Agent's model rows, for its "Thinks with" section (#29): the Engine's choices for that Agent's own profile, the main
// Agent's `co-` one included (#425). An Agent that shares a profile it does not keep has no model of its own and says so.
export function AgentModel({company,agent,name,model,choice,options,choosable,owner,readAt}:{company:string,agent:string,name:string,model:string|null,choice:string|null,options:ModelOption[],choosable:boolean,owner:boolean,readAt:number}) {
 const {t,language}=useI18n(); const rtl=language==='ar';
 const saved=useSave<HeldModel>(agentModelKey(company,agent),{model,choice},readAt);
 const choose=async(value:string)=>{
  const answer=await saved.save({model:value,choice:value},()=>send('/api/agent-settings',{company,agent,setting:'model',value}),found=>heldModelOf(found,{model:value,choice:value}));
  if(answer.ok&&answer.newest) toast(t('settingsModelsSaved'));
 };
 const current=saved.value.model;
 if(!choosable||!owner) return <div className="panel-card"><p className="ro-text" id="set-model">{current||t('settingsModelsNoModel')}</p></div>;
 if(!options.length) return <div className="panel-card"><p className="panel-empty">{t('settingsModelsNoChoice')}</p></div>;
 const idOf=(option:ModelOption)=>`set-model-${option.provider}-${option.model}`;
 const chosenIndex=options.findIndex(option=>modelOf(option)===current);
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const step=moveChoice(event,rtl); if(step===null) return;
  const next=chosenIndex<0?index:Math.max(0,Math.min(options.length-1,index+step));
  if(next!==chosenIndex) choose(modelOf(options[next]));
  document.getElementById(idOf(options[next]))?.focus();
 };
 const row=(option:ModelOption,index:number)=>{
  const value=modelOf(option); const on=value===current; const text=<><AppTile app={{key:modelMarkOf(option),mark:markOf(option.providerName)}}/><span className="panel-row__text"><span className="panel-row__t"><bdi>{option.model}</bdi></span><span className="panel-row__d"><bdi>{option.providerName}</bdi></span></span></>;
  return <button type="button" className="panel-row" role="radio" id={idOf(option)} key={value} aria-checked={on} tabIndex={on||(chosenIndex<0&&index===0)?0:-1} onClick={()=>{ if(!on) choose(value); }} onKeyDown={event=>move(event,index)}>{text}{on&&(saved.saving?<Saving id="set-model-saving"/>:<span className="panel-row__meta" aria-hidden="true">✓</span>)}</button>;
 };
 return <div className="md-agent-model" id="set-model">
  <div className="panel-card" role="radiogroup" aria-label={t('settingsModelsChoose',name)} aria-busy={saved.saving||undefined}>{options.map(row)}</div>
  {saved.error&&<p className="set-err" role="alert">{t(reasonKey(saved.error))}</p>}
 </div>;
}

// Each Agent's model, with the Owner's sub-agents switch and the Engine's sub-agent settings while it is on. A member
// below Owner reads the value and no control.
export function EachAgent({company,owner,models,readAt}:{company:string,owner:boolean,models:ModelsData,readAt:number}) {
 const {t}=useI18n();
 const defaultModel=useSaved(defaultKey(company),models.default.model,readAt);
 return <section className="dp-sec" aria-labelledby="md-h-each"><Label id="md-h-each" info={t('settingsModelsEachHint')}>{t('settingsModelsEach')}</Label>
  <div className="panel-card md-agents">{models.agents.map(agent=><AgentRow key={agent.id} company={company} owner={owner} agent={agent} defaultModel={defaultModel} readAt={readAt}/>)}</div>
  {!owner&&<p className="set-hint">{t('settingsModelsOwnerOnly')}</p>}
 </section>;
}

// One Agent's sub-agent settings as its own profile holds them (GET /api/agent-settings), or null when they cannot be read.
// `readAt` is the server's time that read started, so it stands over the fields' saves held from before it.
async function subagentSettings(company:string,agent:string):Promise<{settings:ModelSetting[],readAt:number}|null> {
 try {
  const response=await fetch(`/api/agent-settings?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}`);
  const read=response.ok?await response.json() as {agents?:{settings?:unknown}[],readAt?:unknown}:null;
  return Array.isArray(read?.agents?.[0]?.settings)&&typeof read.readAt==='number'?{settings:read.agents[0].settings as ModelSetting[],readAt:read.readAt}:null;
 } catch { return null; }
}

function AgentRow({company,owner,agent,defaultModel,readAt}:{company:string,owner:boolean,agent:AgentModels,defaultModel:string|null,readAt:number}) {
 const {t}=useI18n();
 const model=useSave<HeldModel>(agentModelKey(company,agent.id),{model:agent.model,choice:agent.choice},readAt);
 // Turning sub-agents on reads that Agent's sub-agent settings alone, which a profile without them never read (#661).
 const sub=useSave<{on:boolean,settings:ModelSetting[],readAt:number}>(`subagents:${company}:${agent.id}`,{on:agent.subagents,settings:agent.settings,readAt},readAt);
 const chooseModel=async(value:string|null)=>{
  const optimistic={model:value??defaultModel,choice:value};
  const answer=await model.save(optimistic,()=>send('/api/agent-settings',{company,agent:agent.id,setting:'model',value}),found=>heldModelOf(found,optimistic));
  if(answer.ok&&answer.newest) toast(t('settingsModelsSaved'));
 };
 const switchSubagents=async()=>{
  const next={...sub.value,on:!sub.value.on};
  const answer=await sub.save(next,async()=>{
   const written=await send('/api/agent-settings',{company,agent:agent.id,setting:'subagents',value:next.on});
   if(!written.ok||!next.on) return written;
   const read=await subagentSettings(company,agent.id);
   return read?{...written,data:{...written.data,settings:read.settings.filter(setting=>setting.key.startsWith('delegation.')),readAt:read.readAt}}:written;
  },answer=>({on:next.on,settings:Array.isArray(answer.data?.settings)?answer.data.settings as ModelSetting[]:next.settings,readAt:typeof answer.data?.readAt==='number'?answer.data.readAt:next.readAt}));
  if(answer.ok&&answer.newest) toast(t('settingsSubagentsSaved'));
 };
 const held=model.value;
 const label=held.model||(held.choice?held.choice:defaultModel)||t('settingsModelsNoModel');
 const subagents=sub.value.on;
 const error=model.error||sub.error;
 return <div className="md-agent" id={`mdl-agent-${agent.id}`}>
  <div className="panel-row">
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span>
    <span className="panel-row__d" id={`mdl-agent-${agent.id}-model`}>{held.choice?<>{t('settingsModelsOwn')} · <bdi dir="ltr">{held.model}</bdi></>:<>{t('settingsModelsFollows')} · <bdi dir="ltr">{label}</bdi></>}{agent.effort&&<> · {t(effortLabelKey(agent.effort))}</>}</span></span>
   {model.saving&&<Saving id={`mdl-agent-${agent.id}-saving`}/>}
   {owner&&agent.choosable?<label className="md-agent__pick"><span className="set-label">{t('settingsModelsModelField',agent.name)}</span>
    <select className="set-input" value={held.choice??''} aria-busy={model.saving||undefined} aria-label={t('settingsModelsModelField',agent.name)}
     onChange={event=>chooseModel(event.target.value||null)}>
     <option value="">{t('settingsModelsFollows')}</option>
     {agent.options.map(option=><option key={modelOf(option)} value={modelOf(option)}>{option.model}</option>)}
    </select></label>
   :<span className="panel-row__meta"><bdi dir="ltr">{held.model||t('settingsModelsNoModel')}</bdi></span>}
  </div>
  {agent.choosable&&<div className="panel-row">
   <span className="panel-row__text"><span className="panel-row__t" id={`mdl-sub-${agent.id}-t`}>{t('settingsSubagents')}</span>
    <span className="panel-row__d" id={`mdl-sub-${agent.id}-state`}>{t(sub.saving?'settingsSaving':subagents?'settingsSubagentsOn':'settingsSubagentsOff')}</span></span>
   {owner?<button type="button" className="switch" role="switch" id={`mdl-sub-${agent.id}`} aria-checked={subagents} aria-busy={sub.saving||undefined} aria-labelledby={`mdl-sub-${agent.id}-t`} onClick={switchSubagents}/>
    :<span className="panel-row__meta">{t(subagents?'settingsSubagentsOn':'settingsSubagentsOff')}</span>}
  </div>}
  {/* The sub-agents' own model, provider, limits and level are rarely changed (#614): under Advanced, closed at first.
      Drawn once the switch is confirmed on, with the settings that profile holds. */}
  {subagents&&!sub.saving&&<Advanced id={`mdl-sub-${agent.id}-advanced`}><SubagentFields company={company} owner={owner} agent={agent} settings={sub.value.settings} readAt={Math.max(readAt,sub.value.readAt)}/></Advanced>}
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
  {!agent.choosable&&<p className="set-hint">{t('settingsModelsShared')}</p>}
 </div>;
}

const effortLabel=(choice:string)=>choice?`settingsEffort${choice[0].toUpperCase()}${choice.slice(1)}`:'settingsEffortInherit';
// A field's "Saving" line under its label while the Engine writes it (#661).
function FieldSaving({on}:{on:boolean}) { const {t}=useI18n(); return on?<span className="set-hint is-saving" role="status">{t('settingsSaving')}</span>:null; }
function SubagentFields({company,owner,agent,settings,readAt}:{company:string,owner:boolean,agent:AgentModels,settings:ModelSetting[],readAt:number}) {
 const {t}=useI18n();
 const setting=(key:string)=>settings.find(found=>found.key===key);
 const model=setting('delegation.model'); const provider=setting('delegation.provider');
 const effort=setting('delegation.reasoning_effort');
 const children=setting('delegation.max_concurrent_children'); const depth=setting('delegation.max_spawn_depth');
 // The sub-agent model is two Engine keys: its model id and the provider it runs on (config_defaults.py 1316-1317), so
 // one choice from the list saves both in one request, and both are held as one value.
 const pair=useSave<{provider:string,model:string}>(settingKey(company,agent.id,'delegation.model'),{provider:typeof provider?.value==='string'?provider.value:'',model:typeof model?.value==='string'?model.value:''},readAt);
 const level=useSave<string>(settingKey(company,agent.id,'delegation.reasoning_effort'),String(effort?.value??''),readAt);
 const atOnce=useSave<unknown>(settingKey(company,agent.id,'delegation.max_concurrent_children'),children?.value??children?.default??'',readAt);
 const deep=useSave<unknown>(settingKey(company,agent.id,'delegation.max_spawn_depth'),depth?.value??depth?.default??'',readAt);
 const done=(answer:Answer&{newest:boolean})=>{ if(answer.ok&&answer.newest) toast(t('settingsSubagentsSaved')); };
 const writePair=async(next:{provider:string,model:string})=>done(await pair.save(next,()=>send('/api/agent-settings',{company,agent:agent.id,settings:{'delegation.provider':next.provider,'delegation.model':next.model}})));
 const writeModel=(value:string)=>{
  const chosen=agent.options.find(option=>modelOf(option)===value);
  return writePair(chosen?{provider:chosen.provider,model:chosen.model}:{provider:'',model:''});
 };
 const heldModel=pair.value.model; const heldProvider=pair.value.provider;
 const providers=[...new Map(agent.options.map(option=>[option.provider,option.providerName])).entries()];
 const heldChoice=heldModel?agent.options.find(option=>option.model===heldModel&&(!heldProvider||option.provider===heldProvider)):undefined;
 const modelChoices=[...agent.options, ...(heldModel&&!heldChoice?[{provider:heldProvider,providerName:heldProvider,model:heldModel}]:[])];
 const providerNames=heldProvider&&!providers.some(([slug])=>slug===heldProvider)?[...providers,[heldProvider,heldProvider]]:providers;
 const numbers=[['max_concurrent_children',children,atOnce],['max_spawn_depth',depth,deep]] as const;
 const error=pair.error||level.error||atOnce.error||deep.error;
 return <div className="sub-step md-subagent" id={`mdl-sub-${agent.id}-settings`}>
  <div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-model`}>{t('settingSubagentModel')}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-model`} value={heldChoice?modelOf(heldChoice):heldModel?`${heldProvider}/${heldModel}`:''} aria-busy={pair.saving||undefined} onChange={event=>writeModel(event.target.value)}>
    <option value="">{t('settingsModelsFollows')}</option>
    {modelChoices.map(choice=><option key={modelOf(choice)} value={modelOf(choice)}>{choice.model}</option>)}
   </select>:<p className="ro-text">{(heldModel?`${heldProvider}${heldProvider?'/':''}${heldModel}`:'')||t('settingsModelsFollows')}</p>}
   <FieldSaving on={pair.saving}/>
  </div>
  <div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-provider`}>{t('settingSubagentProvider')}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-provider`} value={heldProvider} aria-busy={pair.saving||undefined} onChange={event=>{ const next=event.target.value; writePair(next?{provider:next,model:heldModel}:{provider:'',model:''}); }}>
    <option value="">{t('settingsModelsFollows')}</option>
    {providerNames.map(([slug,name])=><option key={slug} value={slug}>{name}</option>)}
   </select>:<p className="ro-text">{heldProvider||'—'}</p>}
  </div>
  {numbers.map(([key,entry,saved])=>entry&&<div className="set-field" key={key}><label className="set-label" htmlFor={`mdl-sub-${agent.id}-${key}`}>{t(entry.label)}</label>
   {/* Keyed by the value it shows, so a save that fails puts the field back on the value held before it. */}
   {owner?<input className="set-input" id={`mdl-sub-${agent.id}-${key}`} key={String(saved.value)} type="number" inputMode="numeric" min={1} defaultValue={String(saved.value)} aria-busy={saved.saving||undefined}
    onBlur={event=>{ const next=Number(event.target.value); if(Number.isInteger(next)&&next>=1&&next!==saved.value) saved.save(next,()=>send('/api/agent-settings',{company,agent:agent.id,setting:entry.key,value:next})).then(done); }}/>
    :<p className="ro-text">{String(saved.value)}</p>}
   <FieldSaving on={saved.saving}/>
   {key==='max_concurrent_children'&&<span className="set-hint">{t('settingsSubagentsAtOnce',String(entry.default??10))}</span>}
  </div>)}
  {effort&&<div className="set-field"><label className="set-label" htmlFor={`mdl-sub-${agent.id}-effort`}>{t(effort.label)}</label>
   {owner?<select className="set-input" id={`mdl-sub-${agent.id}-effort`} value={level.value} aria-busy={level.saving||undefined} onChange={event=>{ const next=event.target.value; level.save(next,()=>send('/api/agent-settings',{company,agent:agent.id,setting:'delegation.reasoning_effort',value:next})).then(done); }}>
    {(effort.choices??['']).map(choice=><option key={choice||'inherit'} value={choice}>{t(effortLabel(choice))}</option>)}
   </select>:<p className="ro-text">{t(effortLabel(level.value))}</p>}
   <FieldSaving on={level.saving}/>
  </div>}
  {error&&<p className="set-err" role="alert">{t(reasonKey(error))}</p>}
 </div>;
}
