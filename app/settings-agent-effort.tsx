'use client';
import { useEffect, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { effortDefault, effortHintKey, effortLabelKey, effortLevels } from '@/lib/engine-effort.mjs';
import { seedDraft, setDraftValue, useDraftValue } from './settings-draft';

// An Agent's thinking level (#179; design-reference: settingsHTML's set-effort at app.js 1598-1603 and its arrow keys at
// 3676-3680). The eight levels the Engine accepts, in its own order; the four the reference words carry its line under
// the control, the other four show the level's name and no line. The choice is one key of the page's draft (`effort`) and
// is saved with the bar, so every other changed field goes in the same request. Only the Owner gets the control; a Manager,
// a Contributor and a Viewer read the level as text, and the route refuses their save just the same. The arrow keys move
// the choice forward, which is left in Arabic and right in English.
/** @param {{agent:string,effort:string|null,editable:boolean}} props */
export function AgentEffort({agent,effort,editable}:{agent:string,effort:string|null,editable:boolean}) {
 const {t,language}=useI18n();
 const rtl=language==='ar';
 const level=useDraftValue(agent,'effort',effort??effortDefault);
 // The draft starts from what the server read, once for this Agent; a read that changed while nothing is unsaved wins.
 useEffect(()=>{ seedDraft(agent,{effort:effort??effortDefault}); },[agent,effort]);
 if(!editable) return <ul className="panel-card" aria-label={t('settingsEffort')}>
  <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsEffort')}</span>
   <span className="panel-row__d ro-val" id="set-effort-val">{effort?t(effortLabelKey(effort)):'—'}</span></span></li></ul>;
 const hint=effortHintKey(level);
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  const direction=(event.key==='ArrowLeft')===rtl?1:-1;
  const next=Math.max(0,Math.min(effortLevels.length-1,index+direction));
  event.preventDefault();
  setDraftValue('effort',effortLevels[next]);
  document.getElementById(`set-effort-${effortLevels[next]}`)?.focus();
 };
 return <div className="panel-card set-card"><div className="set-field">
  <span className="set-label" id="set-effort-l">{t('settingsEffort')}</span>
  <div className="segmented segmented--field" role="radiogroup" aria-labelledby="set-effort-l" aria-describedby="set-effort-hint">
   {effortLevels.map((choice,index)=><button type="button" role="radio" key={choice} id={`set-effort-${choice}`}
    aria-checked={level===choice} tabIndex={level===choice?0:-1} onClick={()=>setDraftValue('effort',choice)}
    onKeyDown={event=>move(event,index)}>{t(effortLabelKey(choice))}</button>)}
  </div>
  <span className="set-hint" id="set-effort-hint" aria-live="polite">{hint?t(hint):''}</span>
 </div></div>;
}
