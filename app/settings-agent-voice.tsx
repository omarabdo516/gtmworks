'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { AgentVoice as AgentVoiceRead } from '@/lib/agent-voice.mjs';
import { seedDraft, setDraftValue, useDraftState, useDraftValue } from './settings-draft';
import { SettingsIcon } from './settings-icons';

// An Agent's Voice in Settings (#162; design-reference: voiceSetHTML): the language the agent engine listens in, the voice
// of the profile's provider with the reference's Listen, and the speed. Each control is one setting of the Agent's own
// profile, held in the page's draft until Save, so Listen plays the saved voice and is off while the section differs. The
// voice is a list only for ElevenLabs; every other provider shows its saved voice with one line naming what is missing.
// The Engine's default provider sends the sample to Microsoft to be spoken, and the line beside Listen says so.

/** The reference's five steps, all inside what the Engine accepts (tools/tts_tool_providers.py 199). */
const voiceSteps = [0.7, 0.85, 1, 1.25, 1.5];

const firstName = (name: string) => name.trim().split(/\s+/)[0] || '';

/** @param {{company:string,agent:string,personName:string,voice:AgentVoiceRead}} props */
export function AgentVoice({company,agent,personName,voice}:{company:string,agent:string,personName:string,voice:AgentVoiceRead}) {
 const {t,language}=useI18n();
 const speaking=useDraftValue(agent,'voice.language',voice.language);
 const speed=useDraftValue(agent,'voice.speed',String(voice.speed));
 const chosen=useDraftValue(agent,'voice.voice',voice.voice??'');
 // The section's own keys: a change to About does not hold Listen, a change here does until Save.
 const draft=useDraftState(agent);
 const dirty=!!draft&&['voice.language','voice.speed','voice.voice'].some(key=>draft.saved[key]!==draft.draft[key]);
 const choices=voice.list?.state==='found'&&voice.list.available?voice.list.voices:null;
 const sample=t('settingsVoiceSample',firstName(personName));
 const sound=useRef<HTMLAudioElement|null>(null);
 // Counts the section's changes: a Listen answer asked for before one is dropped, since it would play what is no longer
 // the draft.
 const epoch=useRef(0);
 const [playing,setPlaying]=useState(false);
 const [loading,setLoading]=useState(false);
 const [missing,setMissing]=useState<''|'noSpeech'|'unreachable'>('');
 // The sample is the saved voice's: the draft's values only reach the profile on Save, so Listen is off until then.
 useEffect(()=>{ seedDraft(agent,{'voice.language':voice.language,'voice.speed':String(voice.speed),...(
  voice.list?.state==='found'&&voice.list.available&&voice.voice?{'voice.voice':voice.voice}:{})}); },
  [agent,voice.language,voice.speed,voice.voice,voice.list?.state,voice.list?.available]);
 // Listen plays what is saved, so any change to the section stops the sound and leaves it off until Save.
 const stop=()=>{ sound.current?.pause(); sound.current=null; setPlaying(false); };
 // Any change to the section, the speed in Advanced too, stops the sound: Listen plays only what is saved. The button
 // reads Listen again in the same render, and the sound itself is paused once the change is drawn.
 if(dirty&&playing) setPlaying(false);
 useEffect(()=>{ if(dirty) { epoch.current+=1; sound.current?.pause(); sound.current=null; } },[dirty]);
 // The sound stops when the section leaves the page.
 useEffect(()=>()=>{ sound.current?.pause(); sound.current=null; },[]);
 const listen=async()=>{
  if(playing) { stop(); return; }
  setMissing(''); setLoading(true);
  const asked=epoch.current;
  try {
   const response=await fetch('/api/agent-speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent})});
   const answer=await response.json().catch(()=>null);
   if(epoch.current!==asked) return;
   if(!response.ok||typeof answer?.dataUrl!=='string') { setMissing(response.status===503?'unreachable':'noSpeech'); return; }
   const audio=new Audio(answer.dataUrl);
   audio.addEventListener('ended',()=>{ if(sound.current===audio) { sound.current=null; setPlaying(false); } });
   sound.current=audio; setPlaying(true);
   await audio.play?.()?.catch?.(()=>{});
  } catch { setMissing('noSpeech'); } finally { setLoading(false); }
 };
 // Arabic on Deepgram is Egyptian (#430); its other Arabic variants are named in the page's own language.
 const languageLabel=(value:string)=>value==='ar'?t(voice.speech==='deepgram'?'settingsVoiceArabicEgypt':'settingsVoiceArabic'):value==='en'?t('settingsVoiceEnglish'):!value?t('settingsVoiceDetect')
  :(()=>{ try { return new Intl.DisplayNames([language],{type:'language'}).of(value)||value; } catch { return value; } })();
 const nameOfVoice=(id:string)=>choices?.find(choice=>choice.id===id)?.name||choices?.find(choice=>choice.id===id)?.label||id;
 const shownVoice=(choices&&chosen?nameOfVoice(chosen):null)||voice.voiceName||chosen||null;
 const hint=playing?t('settingsVoiceSays',shownVoice||'—',sample,speed)
  :dirty?t('settingsVoiceSaveFirst')
  :missing==='unreachable'?t('settingsVoiceUnreachable')
  :missing==='noSpeech'?t('settingsVoiceNoSpeech')
  :t('settingsVoiceListenHint');
 // The page's Voice group carries the heading (#615); the speed is in its Advanced part (AgentVoiceSpeed below).
 return <div className="panel-card set-card">
   <div className="set-field"><label className="set-label" htmlFor="set-voice-lang">{t('settingsVoiceLang')}</label>
    <select className="set-input vc-select" id="set-voice-lang" value={speaking} aria-describedby="set-voice-lang-hint"
     onChange={event=>{ stop(); setDraftValue('voice.language',event.target.value); }}>
     {voice.languages.map(value=><option key={value||'detect'} value={value}>{languageLabel(value)}</option>)}
     {!voice.languages.includes(speaking)&&<option value={speaking}>{languageLabel(speaking)}</option>}
    </select>
    <span className="set-hint" id="set-voice-lang-hint">{t('settingsVoiceLangHint')}</span></div>
   <div className="set-field"><label className="set-label" htmlFor="set-voice">{t('settingsVoice')}</label>
    <div className="vc-row">
     {choices?<select className="set-input vc-select" id="set-voice" value={chosen} aria-describedby="set-voice-hint" aria-label={t('settingsVoice')}
       onChange={event=>{ stop(); setDraftValue('voice.voice',event.target.value); }}>
       {choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name||choice.label||choice.id}</option>)}
       {chosen&&!choices.some(choice=>choice.id===chosen)&&<option value={chosen}>{shownVoice||chosen}</option>}
      </select>
      :<select className="set-input vc-select" id="set-voice" value={voice.voice??''} disabled aria-describedby="set-voice-hint set-voice-no-list" aria-label={t('settingsVoice')}>
       <option value={voice.voice??''}>{shownVoice||'—'}</option>
      </select>}
     <button type="button" className="btn btn--secondary btn--sm vc-play" id="set-voice-play" aria-pressed={playing} disabled={dirty||loading} onClick={listen}>
      <SettingsIcon name={playing?'stopFill':'play'}/><span>{playing?t('settingsVoiceStop'):t('settingsVoiceListen')}</span></button>
    </div>
    {!choices&&<span className="set-hint" id="set-voice-no-list">{voice.provider==='elevenlabs'?t('settingsVoiceNoKey'):t('settingsVoiceNoList')}</span>}
    <span className={`set-hint${playing?' vc-quote':''}`} id="set-voice-hint" aria-live="polite">{hint}</span>
    {voice.provider==='edge'&&<span className="set-hint" id="set-voice-microsoft">{t('settingsVoiceMicrosoft')}</span>}
   </div>
  </div>;
}

// The voice's speed (#162), in the Agent page's Advanced part since #615: the reference's five steps as one radio group,
// one key of the page's draft (`voice.speed`) saved with the bar together with the Voice group's language and voice. The
// arrow keys move it forward, which is left in Arabic and right in English. Everyone who may not change the voice reads
// the speed as text.
export function AgentVoiceSpeed({agent,speed:saved,editable}:{agent:string,speed:number|null,editable:boolean}) {
 const {t,language}=useI18n();
 const rtl=language==='ar';
 const speed=useDraftValue(agent,'voice.speed',String(saved??1));
 if(!editable) return <ul className="panel-card"><li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsVoiceSpeed')}</span>
  <span className="panel-row__d ro-val" id="set-speed-val">{saved===null?'—':<bdi dir="ltr">{saved}×</bdi>}</span></span></li></ul>;
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  const direction=(event.key==='ArrowLeft')===rtl?1:-1;
  const next=Math.max(0,Math.min(voiceSteps.length-1,index+direction));
  event.preventDefault();
  setDraftValue('voice.speed',String(voiceSteps[next]));
  document.getElementById(`set-speed-${next}`)?.focus();
 };
 return <div className="panel-card set-card"><div className="set-field"><span className="set-label" id="set-speed-l">{t('settingsVoiceSpeed')}</span>
  <div className="segmented segmented--field" role="radiogroup" aria-labelledby="set-speed-l" aria-describedby="set-speed-hint">
   {voiceSteps.map((step,index)=><button type="button" role="radio" key={step} id={`set-speed-${index}`} className="num" dir="ltr"
     aria-checked={speed===String(step)} tabIndex={speed===String(step)?0:-1} onClick={()=>setDraftValue('voice.speed',String(step))}
     onKeyDown={event=>move(event,index)}>{step}×</button>)}
  </div>
  <span className="set-hint" id="set-speed-hint">{t('settingsVoiceSpeedHint')}</span></div></div>;
}
