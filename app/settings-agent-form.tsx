'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { toast } from './toast';
import { SettingsIcon } from './settings-icons';
import { GuardedSectionLink } from './settings-guard-link';
import { changedValues, commitDraft, draftStamp, isCurrentDraft, registerFirstField, registerSave, restoreDraft, seedDraft, setDraftValue, useBarFlash, useDraftDirty, useDraftState, useDraftValue } from './settings-draft';

// An Agent's page in Settings (#161, #176, #180; design-reference: settingsHTML's About, How it works and Skills, and
// sovAgentHTML's save bar). The fields hold a draft until Save, and the bar appears at the bottom of the page as soon as
// one differs from what was saved. The Voice section (#162, settings-agent-voice.tsx) and later fields join this draft and bar.

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
// the Company's shared skills stay on the team's page. A learned Skill's mark carries "See the steps" (#181) for everyone
// who has the Learning section: it opens that Skill's page there, and a draft that differs holds the page first.
export type AgentSkillRow={name:string,description:string,enabled:boolean,learned:boolean};
function SkillRow({agent,slug,learning,skill,editable,index}:{agent:string,slug:string,learning:boolean,skill:AgentSkillRow,editable:boolean,index:number}) {
 const {t}=useI18n();
 const field=`skill:${skill.name}`;
 const on=useDraftValue(agent,field,skill.enabled?'on':'off')==='on';
 const title=`set-skill-t-${index}`;
 return <li className="panel-row">
  <span className="panel-row__text">
   <span className="panel-row__t" id={title} dir="auto">{skill.name}</span>
   {skill.description&&<span className="panel-row__d" dir="auto">{skill.description}</span>}
   {skill.learned&&<span className="sk-learned"><SettingsIcon name="spark"/><span>{t('settingsSkillLearned')}</span>
    {learning&&<GuardedSectionLink className="link-btn" id={`sk-see-${skill.name}`} href={overlayHref(slug,'learning',{agent,skill:skill.name})} current={false}>{t('settingsSkillSeeSteps')}</GuardedSectionLink>}
   </span>}
  </span>
  {editable?<button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={title} onClick={()=>setDraftValue(field,on?'off':'on')}/>
   :<span className="panel-row__meta">{on?t('settingsSkillOn'):t('settingsSkillOff')}</span>}
 </li>;
}
export function AgentSkills({agent,name,slug,learning,skills,editable}:{agent:string,name:string,slug:string,learning:boolean,skills:AgentSkillRow[]|null,editable:boolean}) {
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
   :<ul className="panel-card">{skills.map((skill,index)=><SkillRow key={skill.name} agent={agent} slug={slug} learning={learning} skill={skill} editable={editable} index={index}/>)}</ul>}
 </section>;
}

// How it works is the Agent's profile SOUL.md outside the team's rules section (#176), with the reference's tall field,
// its hint and a counter of the whole file against the size the Engine loads (the rules section counts). The field takes
// no text that would push the file past that size; there is no placeholder (the reference's name demo Agents).
export function AgentInstructions({agent,name,instructions,sectionChars,limit}:{agent:string,name:string,instructions:string,sectionChars:number,limit:number}) {
 const {t,locale}=useI18n();
 const text=useDraftValue(agent,'instructions',instructions);
 // The draft starts from what the server read, once for this Agent; a read that changed while nothing is unsaved wins.
 useEffect(()=>{ seedDraft(agent,{instructions}); },[agent,instructions]);
 // The counter follows the typing, as the reference's input handler does (design-reference app.js 3631).
 const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 const allowed=Math.max(0,limit-sectionChars);
 return <div className="panel-card set-card"><div className="set-field">
  <label className="sr-only" htmlFor="set-instr">{t('settingsHowFor',name)}</label>
  <textarea className="set-input set-textarea set-textarea--tall" id="set-instr" rows={6} dir="auto" value={text} maxLength={allowed}
   aria-describedby="set-instr-hint set-instr-count" onChange={event=>setDraftValue('instructions',event.target.value.slice(0,allowed))}/>
  <div className="set-hint-row"><span className="set-hint od-fill" id="set-instr-hint">{t('settingsHowHint',name)}</span>
   <span className="set-count num" id="set-instr-count">{count(text.length+sectionChars)} / {count(limit)}</span></div>
 </div></div>;
}

// What every other Role reads in its place: the text with its line breaks kept, or the reference's empty line.
export function AgentInstructionsReadOnly({instructions,empty}:{instructions:string,empty:string}) {
 return <div className="panel-card"><p className="ro-text ro-text--lines" id="set-how">{instructions||empty}</p></div>;
}

// The page's save bar: hidden until the draft differs. Cancel puts back what was saved and the focus on the first field;
// Save sends every changed field in one request, then shows what the Engine kept. Every key of the draft is its own part
// of `changes` (About, How it works, the thinking level and each Skill's switch), except the Voice section's keys, which
// go as one `voice` object with the section's values. Every way out of the page asks the shared store first, which
// flashes this bar and focuses Save.
export function AgentSaveBar({company,agent,name}:{company:string,agent:string,name:string}) {
 const {t}=useI18n();
 const language=useDraftValue(agent,'voice.language','');
 const speed=useDraftValue(agent,'voice.speed','1');
 const voice=useDraftValue(agent,'voice.voice','');
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
  // The request belongs to this Agent's draft as it is now: a response that arrives after another Agent was opened, a
  // newer read or Cancel is dropped, and the values it carried are the snapshot a later edit is compared with.
  const changed=changedValues(agent);
  const stamp=draftStamp(agent);
  const changes:Record<string,unknown>=Object.fromEntries(Object.entries(changed).filter(([key])=>!key.startsWith('voice.')));
  if(Object.keys(changed).some(key=>key.startsWith('voice.'))) changes.voice={language,speed,...(voice?{voice}:{})};
  if(!Object.keys(changes).length) return;
  setSaving(true); setFailed(false);
  try {
   const response=await fetch('/api/agent-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,changes})});
   const answer=await response.json().catch(()=>null);
   if(!isCurrentDraft(stamp)) return;
   const kept=answer?.saved&&typeof answer.saved==='object'?answer.saved as Record<string,unknown>:null;
   if(!response.ok||!kept) { setFailed(true); return; }
   const patch:Record<string,string>={};
   for(const key of Object.keys(changes)) {
    if(key==='voice') {
     const keptVoice=kept.voice as {language?:unknown,speed?:unknown,voice?:unknown}|null|undefined;
     if(!keptVoice||typeof keptVoice.language!=='string'||typeof keptVoice.speed!=='number') { setFailed(true); return; }
     patch['voice.language']=keptVoice.language;
     patch['voice.speed']=String(keptVoice.speed);
     if(typeof keptVoice.voice==='string') patch['voice.voice']=keptVoice.voice;
    } else {
     if(typeof kept[key]!=='string') { setFailed(true); return; }
     patch[key]=kept[key] as string;
    }
   }
   commitDraft(patch,stamp);
   toast(t('settingsSaved',name));
  } catch { if(isCurrentDraft(stamp)) setFailed(true); } finally { setSaving(false); }
 };
 return <div className="dp-savebar sov-savebar" id="dp-savebar" role="region" aria-label={t('settingsSaveLabel')} hidden={!dirty} ref={bar}>
  <span className="dp-savebar__t">{t('settingsSaveBar')}{failed&&<span className="set-err" role="alert">{t('settingsSaveFailed')}</span>}</span>
  <button type="button" className="btn btn--secondary btn--sm" id="set-cancel" onClick={discard}>{t('settingsCancel')}</button>
  <button type="button" className="btn btn--primary btn--sm" id="set-save" onClick={write} disabled={saving} ref={save}>{t('settingsSave')}</button>
 </div>;
}

// The Memory tab is not built yet; drawn, disabled, saying Soon. Pressed while the draft differs it keeps the page, as
// every way out does (sovDirty), and gives the bar its nudge.
