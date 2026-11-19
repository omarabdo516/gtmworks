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
 const rtl=language==='ar';
 const speaking=useDraftValue(agent,'voice.language',voice.language);
 const speed=useDraftValue(agent,'voice.speed',String(voice.speed));
 const chosen=useDraftValue(agent,'voice.voice',voice.voice??'');
 // The section's own keys: a change to About does not hold Listen, a change here does until Save.
 const draft=useDraftState(agent);
 const dirty=!!draft&&['voice.language','voice.speed','voice.voice'].some(key=>draft.saved[key]!==draft.draft[key]);
 const choices=voice.list?.state==='found'&&voice.list.available?voice.list.voices:null;
 const sample=t('settingsVoiceSample',firstName(personName));
 const sound=useRef<HTMLAudioElement|null>(null);
 const [playing,setPlaying]=useState(false);
 const [loading,setLoading]=useState(false);
 const [missing,setMissing]=useState<''|'noSpeech'|'unreachable'>('');
 // The sample is the saved voice's: the draft's values only reach the profile on Save, so Listen is off until then.
 useEffect(()=>{ seedDraft(agent,{'voice.language':voice.language,'voice.speed':String(voice.speed),...(
  voice.list?.state==='found'&&voice.list.available&&voice.voice?{'voice.voice':voice.voice}:{})}); },
  [agent,voice.language,voice.speed,voice.voice,voice.list?.state,voice.list?.available]);
 // Listen plays what is saved, so any change to the section stops the sound and leaves it off until Save.
 const stop=()=>{ sound.current?.pause(); sound.current=null; setPlaying(false); };
 // The sound stops when the section leaves the page.
 useEffect(()=>()=>{ sound.current?.pause(); sound.current=null; },[]);
 const listen=async()=>{
  if(playing) { stop(); return; }
  setMissing(''); setLoading(true);
  try {
   const response=await fetch('/api/agent-speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent})});
   const answer=await response.json().catch(()=>null);
   if(!response.ok||typeof answer?.dataUrl!=='string') { setMissing(response.status===503?'unreachable':'noSpeech'); return; }
   const audio=new Audio(answer.dataUrl);
   audio.addEventListener('ended',()=>{ if(sound.current===audio) { sound.current=null; setPlaying(false); } });
   sound.current=audio; setPlaying(true);
   await audio.play?.()?.catch?.(()=>{});
  } catch { setMissing('noSpeech'); } finally { setLoading(false); }
 };
 const nameOfVoice=(id:string)=>choices?.find(choice=>choice.id===id)?.name||choices?.find(choice=>choice.id===id)?.label||id;
 const shownVoice=(choices&&chosen?nameOfVoice(chosen):null)||voice.voiceName||chosen||null;
 const hint=playing?t('settingsVoiceSays',shownVoice||'—',sample,speed)
  :dirty?t('settingsVoiceSaveFirst')
  :missing==='unreachable'?t('settingsVoiceUnreachable')
  :missing==='noSpeech'?t('settingsVoiceNoSpeech')
  :t('settingsVoiceListenHint');
 // Arrow keys move the speed as the reference does: forward is left in Arabic and right in English.
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  const direction=(event.key==='ArrowLeft')===rtl?1:-1;
  const next=Math.max(0,Math.min(voiceSteps.length-1,index+direction));
  event.preventDefault();
  stop();
  setDraftValue('voice.speed',String(voiceSteps[next]));
  document.getElementById(`set-speed-${next}`)?.focus();
 };
 return <section className="dp-sec" aria-labelledby="set-h-voice"><h4 className="dp-label" id="set-h-voice"><span>{t('settingsVoice')}</span></h4>
  <div className="panel-card set-card">
   <div className="set-field"><label className="set-label" htmlFor="set-voice-lang">{t('settingsVoiceLang')}</label>
    <select className="set-input vc-select" id="set-voice-lang" value={speaking} aria-describedby="set-voice-lang-hint"
     onChange={event=>{ stop(); setDraftValue('voice.language',event.target.value); }}>
     {[['ar',t('settingsVoiceArabic')],['en',t('settingsVoiceEnglish')],['',t('settingsVoiceDetect')]].map(([value,label])=><option key={value||'detect'} value={value}>{label}</option>)}
     {!['ar','en',''].includes(speaking)&&<option value={speaking}>{speaking}</option>}
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
   <div className="set-field"><span className="set-label" id="set-speed-l">{t('settingsVoiceSpeed')}</span>
    <div className="segmented segmented--field" role="radiogroup" aria-labelledby="set-speed-l">
     {voiceSteps.map((step,index)=><button type="button" role="radio" key={step} id={`set-speed-${index}`} className="num" dir="ltr"
       aria-checked={speed===String(step)} tabIndex={speed===String(step)?0:-1} onClick={()=>{ stop(); setDraftValue('voice.speed',String(step)); }}
       onKeyDown={event=>move(event,index)}>{step}×</button>)}
    </div>
    <span className="set-hint">{t('settingsVoiceSpeedHint')}</span></div>
  </div></section>;
}
