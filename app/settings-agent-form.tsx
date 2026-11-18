'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';
import { SettingsIcon } from './settings-icons';
import { commitDraft, registerFirstField, registerSave, restoreDraft, seedDraft, setDraftValue, useBarFlash, useDraftDirty, useDraftState, useDraftValue } from './settings-draft';

// An Agent's page in Settings (#161; design-reference: settingsHTML's About and sovAgentHTML's save bar). The fields
// hold a draft until Save, and the bar appears at the bottom of the page as soon as it differs from what was saved.
// Later fields (#176, #179, #180, #182) join this same draft and bar.

// About is the description of the Agent's own Engine profile, with the reference's placeholder and hint.
export function AgentAbout({agent,name,description}:{agent:string,name:string,description:string}) {
 const {t}=useI18n();
 const about=useDraftValue(agent,'about',description);
 const field=useRef<HTMLTextAreaElement>(null);
 // The draft starts from what the server read, once for this Agent; a read that changed while nothing is unsaved wins.
 useEffect(()=>{ seedDraft(agent,{about:description}); },[agent,description]);
 useEffect(()=>{ registerFirstField(field.current); return ()=>registerFirstField(null); },[]);
 return <div className="panel-card set-card"><div className="set-field">
  <label className="sr-only" htmlFor="set-desc">{t('settingsAboutFor',name)}</label>
  <textarea className="set-input set-textarea" id="set-desc" rows={3} dir="auto" value={about} placeholder={t('settingsAboutPh')} aria-describedby="set-desc-hint"
   onChange={event=>setDraftValue('about',event.target.value)} ref={field}/>
  <span className="set-hint" id="set-desc-hint">{t('settingsAboutHint')}</span>
 </div></div>;
}

// The Skills section of an Agent's page (#180; design-reference: settingsHTML's Skills, skLearnedHTML and the set-skill
// handler): the heading counts the switches that are on of all, the rows are the Engine's own order with its description,
// and a skill the Engine says the Agent learned on its own carries the mark. Every switch is one key of the page's draft
// (`skill:<name>` = on|off) and is saved with the bar; a person below Manager, or an Agent still on the Company's shared
// profile, reads On and Off instead of a switch. The Engine's essential skill never reaches here (lib/hermes.mjs), and
// the Company's shared skills stay on the team's page.
export type AgentSkillRow={name:string,description:string,enabled:boolean,learned:boolean};
function SkillRow({agent,skill,editable,index}:{agent:string,skill:AgentSkillRow,editable:boolean,index:number}) {
 const {t}=useI18n();
 const field=`skill:${skill.name}`;
 const on=useDraftValue(agent,field,skill.enabled?'on':'off')==='on';
 const title=`set-skill-t-${index}`;
 return <li className="panel-row">
  <span className="panel-row__text">
   <span className="panel-row__t" id={title} dir="auto">{skill.name}</span>
   {skill.description&&<span className="panel-row__d" dir="auto">{skill.description}</span>}
   {skill.learned&&<span className="sk-learned"><SettingsIcon name="spark"/><span>{t('settingsSkillLearned')}</span></span>}
  </span>
  {editable?<button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={title} onClick={()=>setDraftValue(field,on?'off':'on')}/>
   :<span className="panel-row__meta">{on?t('settingsSkillOn'):t('settingsSkillOff')}</span>}
 </li>;
}
export function AgentSkills({agent,name,skills,editable}:{agent:string,name:string,skills:AgentSkillRow[]|null,editable:boolean}) {
 const {t}=useI18n();
 const draftState=useDraftState(agent);
 // The draft starts from what the server read, and this section seeds only its own keys so a later field never wipes it.
 useEffect(()=>{
  if(skills) seedDraft(agent,Object.fromEntries(skills.map(skill=>[`skill:${skill.name}`,skill.enabled?'on':'off'])));
 },[agent,skills]);
 const on=(skill:AgentSkillRow)=>draftState?draftState.draft[`skill:${skill.name}`]??(skill.enabled?'on':'off'):skill.enabled?'on':'off';
 const count=skills?skills.filter(skill=>on(skill)==='on').length:0;
 return <section className="dp-sec" aria-labelledby="set-h-skills">
  <h4 className="dp-label" id="set-h-skills"><span>{t('settingsSkills')}{skills&&<> <span className="muted num">{count}/{skills.length}</span></>}</span></h4>
  {!skills?<div className="panel-card"><p className="panel-empty">{t('settingsSkillsUnread')}</p></div>
   :skills.length===0?<div className="panel-card"><p className="panel-empty">{t('settingsSkillsEmpty',name)}</p></div>
   :<ul className="panel-card">{skills.map((skill,index)=><SkillRow key={skill.name} agent={agent} skill={skill} editable={editable} index={index}/>)}</ul>}
 </section>;
}

// The page's save bar: hidden until the draft differs. Cancel puts back what was saved and the focus on the first field;
// Save sends every changed field in one request, then shows what the Engine kept. Every way out of the page asks the
// shared store first, which flashes this bar and focuses Save.
export function AgentSaveBar({company,agent,name}:{company:string,agent:string,name:string}) {
 const {t}=useI18n();
 const draftState=useDraftState(agent);
 const dirty=useDraftDirty(agent);
 const flash=useBarFlash();
 const [saving,setSaving]=useState(false);
 const [failed,setFailed]=useState(false);
 const bar=useRef<HTMLDivElement>(null);
 const save=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ registerSave(save.current); return ()=>registerSave(null); },[]);
 // The same flash runs again on every held way out, as the reference removes the class and reads the width. The bar that
 // goes away with the draft comes back without it.
 useEffect(()=>{
  const element=bar.current;
  if(!element) return;
  if(!dirty) { element.classList.remove('is-flash'); return; }
  if(!flash) return;
  element.classList.remove('is-flash'); void element.offsetWidth; element.classList.add('is-flash');
 },[flash,dirty]);
 const discard=()=>{ setFailed(false); restoreDraft(); toast(t('settingsBackSaved'),{icon:'x'}); };
 const write=async()=>{
  if(!draftState) return;
  const changes=Object.fromEntries(Object.keys(draftState.saved).filter(key=>draftState.saved[key]!==draftState.draft[key]).map(key=>[key,draftState.draft[key]]));
  const keys=Object.keys(changes);
  if(!keys.length) return;
  setSaving(true); setFailed(false);
  try {
   const response=await fetch('/api/agent-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,changes})});
   const answer=await response.json().catch(()=>null);
   const saved=answer?.saved;
   if(!response.ok||!saved||typeof saved!=='object'||!keys.every(key=>typeof saved[key]==='string')) { setFailed(true); return; }
   commitDraft(saved);
   toast(t('settingsSaved',name));
  } catch { setFailed(true); } finally { setSaving(false); }
 };
 return <div className="dp-savebar sov-savebar" id="dp-savebar" role="region" aria-label={t('settingsSaveLabel')} hidden={!dirty} ref={bar}>
  <span className="dp-savebar__t">{t('settingsSaveBar')}{failed&&<span className="set-err" role="alert">{t('settingsSaveFailed')}</span>}</span>
  <button type="button" className="btn btn--secondary btn--sm" id="set-cancel" onClick={discard}>{t('settingsCancel')}</button>
  <button type="button" className="btn btn--primary btn--sm" id="set-save" onClick={write} disabled={saving} ref={save}>{t('settingsSave')}</button>
 </div>;
}

// The Memory tab is not built yet; drawn, disabled, saying Soon. Pressed while the draft differs it keeps the page, as
// every way out does (sovDirty), and gives the bar its nudge.
