'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';
import { changedValues, commitDraft, registerFirstField, registerSave, restoreDraft, seedDraft, setDraftValue, useBarFlash, useDraftDirty, useDraftValue } from './settings-draft';

// An Agent's page in Settings (#161, #176; design-reference: settingsHTML's About and How it works, and sovAgentHTML's
// save bar). The fields hold a draft until Save, and the bar appears at the bottom of the page as soon as one differs
// from what was saved. Later fields (#179, #180) join this same draft and bar.

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
// Save sends every changed field in one request, then shows what the Engine kept. Every way out of the page asks the
// shared store first, which flashes this bar and focuses Save.
export function AgentSaveBar({company,agent,name}:{company:string,agent:string,name:string}) {
 const {t}=useI18n();
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
  const changes=changedValues(agent);
  if(!Object.keys(changes).length) return;
  setSaving(true); setFailed(false);
  try {
   const response=await fetch('/api/agent-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,changes})});
   const answer=await response.json().catch(()=>null);
   const saved=answer?.saved&&typeof answer.saved==='object'?answer.saved as Record<string,unknown>:null;
   if(!response.ok||!saved||!Object.keys(changes).every(key=>typeof saved[key]==='string')) { setFailed(true); return; }
   commitDraft(Object.fromEntries(Object.keys(changes).map(key=>[key,saved[key] as string])));
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
