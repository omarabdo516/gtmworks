'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { toast } from './toast';
import { commitPatch, registerFirstField, registerSave, restoreDraft, seedDraft, setDraftValue, useBarFlash, useDraftChanges, useDraftDirty, useDraftValue } from './settings-draft';

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

// The page's save bar: hidden until the draft differs. Cancel puts back what was saved and the focus on the first field;
// Save sends every changed field in one request, then shows what the Engine kept. Each section is one part of `changes`
// (About's words, the Voice section's values), so a field added later joins the same save. Every way out of the page asks
// the shared store first, which flashes this bar and focuses Save.
export function AgentSaveBar({company,agent,name}:{company:string,agent:string,name:string}) {
 const {t}=useI18n();
 const changed=useDraftChanges(agent);
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
  setSaving(true); setFailed(false);
  const changes:Record<string,unknown>={};
  if('about' in changed) changes.about=changed.about;
  if(['voice.language','voice.speed','voice.voice'].some(key=>key in changed))
   changes.voice={language,speed,...(voice?{voice}:{})};
  try {
   const response=await fetch('/api/agent-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,changes})});
   const answer=await response.json().catch(()=>null);
   const kept=answer?.saved;
   if(!response.ok||!kept||typeof kept!=='object') { setFailed(true); return; }
   /** @type {Record<string,string>} */
   const patch:Record<string,string>={};
   if(changes.about!==undefined) {
    if(typeof kept.about!=='string') { setFailed(true); return; }
    patch.about=kept.about;
   }
   if(changes.voice!==undefined) {
    const keptVoice=kept.voice;
    if(!keptVoice||typeof keptVoice.language!=='string'||typeof keptVoice.speed!=='number') { setFailed(true); return; }
    patch['voice.language']=keptVoice.language;
    patch['voice.speed']=String(keptVoice.speed);
    if(typeof keptVoice.voice==='string') patch['voice.voice']=keptVoice.voice;
   }
   commitPatch(patch);
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
