'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';

// Voice dictation in the composer (#160). A hold of the microphone longer than 400 ms records until it is released; a
// quick click starts and a second click finishes; Escape and the cross cancel. While it records, 28 bars take the place
// of the field, the dot breathes and the clock runs; the words then go in at the caret (design-reference: recs,
// recClock, WAVE_N, phFor, syncMic, waveTick, startMic, stopMic, composerHTML 1350-1356, the mic press and click, Escape
// and insertAtCaret). The recording is made by the browser and sent once to the Engine, which turns it into text for the
// Agent's own profile; nothing keeps it here, and the Engine's answer is only its words.
export type DictationTarget={company:string,agent?:string,channel?:string};
const WAVE_N=28;
const HOLD_MS=400;
const LIMIT_S=60;
const TICK_MS=140;
// With reduced motion the bars stand still, at the reference's own heights (design-reference: waveTick).
const baseBars=()=>Array.from({length:WAVE_N},(_,index)=>0.3+0.5*Math.abs(Math.sin(index*0.9)));
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
const reducedMotion=()=>typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// The listening language's name in the interface's own language, so an Arabic page says "العربية (مصر)" and not an English
// name; a language Intl does not know is shown by its tag.
const languageName=(language:string,interfaceLanguage:'ar'|'en')=>{ try { return new Intl.DisplayNames([interfaceLanguage],{type:'language'}).of(language)||language; } catch { return language; } };
const audioUrl=async(blob:Blob)=>{
 const bytes=new Uint8Array(await blob.arrayBuffer());
 let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
 return `data:${blob.type||'audio/webm'};base64,${btoa(binary)}`;
};

type Mode='press'|'hold'|'click';
type Session={mode:Mode,started:number};

// The microphone's own state and its four parts in the composer: the cross, the waveform with its hint, the dot and
// clock, and the button. `insert` puts the words in at the caret; `field` gives the field the focus again.
export function useComposerDictation({target,insert,field,onStart}:{target?:DictationTarget,insert:(text:string)=>void,field:()=>void,onStart?:()=>void}) {
 // The clock's own count, so reaching 60 stops the recording once, outside React's state updater.
 const counted=useRef(0);
 const {t,language:interfaceLanguage}=useI18n();
 const [session,setSession]=useState<Session|null>(null);
 const [seconds,setSeconds]=useState(0);
 const [bars,setBars]=useState<number[]>(baseBars);
 const [writing,setWriting]=useState(false);
 const [error,setError]=useState('');
 const [unavailable,setUnavailable]=useState(false);
 // The language read with the Agent it was read for, so another Agent's language never shows here.
 const placeKeyOf=(place?:DictationTarget)=>place?`${place.company}:${place.agent??''}:${place.channel??''}`:'';
 const placeKey=placeKeyOf(target);
 const [spoken,setSpoken]=useState<{key:string,language:string}|null>(null);
 const listening=spoken?.key===placeKey?spoken.language:null;
 const live=useRef<Session|null>(null); const askedFor=useRef('');
 const clockTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const waveTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const modeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const skipClick=useRef(false); const skipTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const press=useRef<Session|null>(null);
 // Each recording owns its stream, audio, recorder and chunks, keyed by its session number: a later session, or an
 // earlier one whose recorder stops late, never takes another's microphone.
 type Assets={stream:MediaStream|null,audio:{context:AudioContext,analyser:AnalyserNode}|null,recorder:MediaRecorder|null,chunks:Blob[]};
 const owned=useRef(new Map<number,Assets>());
 const phase=useRef(0); const mounted=useRef(true);
 // Each recording is its own session: a permission that comes back late, or a recorder's callback from a session the
 // person already replaced, is let go instead of taking the live session's stream, audio or recorder.
 const sessionNo=useRef(0);
 const insertNow=useRef(insert); insertNow.current=insert;
 const focusField=useRef(field); focusField.current=field;
 // The field was hidden while it recorded: the focus goes back once React has drawn it again.
 const focusAfterDraw=()=>setTimeout(()=>focusField.current(),0);
 const targetNow=useRef(target); targetNow.current=target;
 const placeKeyNow=useRef(placeKey); placeKeyNow.current=placeKey;
 // What the last draw was for: every change of it invalidates an answer already on its way, even one that comes back to
 // the same Agent (A → B → A), so an old recording is never put into the box the person is looking at.
 const lastPlaceKey=useRef(placeKey);
 // What a recording was started for, and the insert of the composer it was started in: a later pick never redirects it.
 const recordingFor=useRef<{key:string,target:DictationTarget,insert:(text:string)=>void}|null>(null);
 const finishing=useRef(false);

 const put=(next:Session|null)=>{ live.current=next; if(mounted.current) setSession(next); };
 const assetsOf=(id:number)=>{ let found=owned.current.get(id); if(!found) { found={stream:null,audio:null,recorder:null,chunks:[]}; owned.current.set(id,found); } return found; };
 const currentAssets=()=>owned.current.get(sessionNo.current)??null;
 const stopClock=()=>{ if(clockTimer.current) { clearInterval(clockTimer.current); clockTimer.current=null; } };
 const stopWave=()=>{ if(waveTimer.current) { clearInterval(waveTimer.current); waveTimer.current=null; } };
 const stopAudio=(assets:Assets|null=currentAssets())=>{
  if(assets?.audio) { void assets.audio.context.close().catch(()=>{}); assets.audio=null; }
  for(const track of assets?.stream?.getTracks?.()??[]) { try { track.stop(); } catch {} }
  if(assets) assets.stream=null;
 };
 const level=()=>{
  const node=currentAssets()?.audio?.analyser; if(!node) return null;
  const values=new Uint8Array(node.frequencyBinCount); node.getByteFrequencyData(values);
  const sum=values.reduce((total,value)=>total+value,0);
  // A silent stream has no level to follow: the bars keep the reference's own motion rather than freezing.
  return sum?Math.min(1,(sum/values.length/255)*3):null;
 };
 const waveTick=()=>{
  phase.current+=0.55; const heard=level();
  if(!mounted.current) return;
  setBars(Array.from({length:WAVE_N},(_,index)=>{
   const envelope=0.35+0.65*Math.abs(Math.sin(phase.current*0.45+index*0.32));
   const value=heard===null?envelope:heard*(0.4+envelope*0.6);
   return Math.max(0.12,Math.min(1,value));
  }));
 };
 function startWave() {
  setBars(baseBars());
  if(reducedMotion()) return;
  waveTick();
  waveTimer.current=setInterval(waveTick,TICK_MS);
 }
 function askLanguage() {
  const place=targetNow.current; if(!place) return;
  const key=placeKeyOf(place);
  if(askedFor.current===key) return;
  askedFor.current=key;
  const query=new URLSearchParams({company:place.company,...(place.agent?{agent:place.agent}:{}),...(place.channel?{channel:place.channel}:{})});
  void fetch(`/api/dictation?${query}`,{cache:'no-store'}).then(response=>response.ok?response.json():null)
   .then(body=>{ if(mounted.current&&typeof body?.language==='string'&&body.language) setSpoken({key,language:body.language}); }).catch(()=>{});
 }
 async function start(mode:Mode) {
  if(live.current||!targetNow.current||unavailable) return;
  const id=++sessionNo.current;
  const assets=assetsOf(id);
  const place=targetNow.current;
  // The recording belongs to the Agent it started on, and its words to the composer it started in.
  recordingFor.current={key:placeKeyOf(place),target:place,insert:insertNow.current};
  finishing.current=false;
  setError(''); setSeconds(0); counted.current=0; put({mode,started:Date.now()});
  onStart?.();
  askLanguage();
  startWave();
  clockTimer.current=setInterval(()=>{
   if(!live.current) return;
   counted.current+=1;
   if(counted.current>=LIMIT_S) { setSeconds(LIMIT_S); finish(true); return; }
   setSeconds(counted.current);
  },1000);
  try {
   if(!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone');
   const media=await navigator.mediaDevices.getUserMedia({audio:true});
   // Cancelled while the browser was asking, or replaced by a later session: its tracks are let go at once, and the
   // live session's stream, audio and recorder are left alone.
   if(id!==sessionNo.current||!live.current||!mounted.current) { for(const track of media.getTracks?.()??[]) { try { track.stop(); } catch {} } return; }
   assets.stream=media;
   let context:AudioContext|undefined;
   try {
    const Context=window.AudioContext;
    context=new Context();
    const source=context.createMediaStreamSource(media);
    const analyser=context.createAnalyser(); analyser.fftSize=256; source.connect(analyser);
    assets.audio={context,analyser};
   } catch { void context?.close().catch(()=>{}); assets.audio=null; }
   const Recorder=window.MediaRecorder;
   if(!Recorder) throw new Error('no recorder');
   let made:MediaRecorder;
   try { made=new Recorder(media,{mimeType:'audio/webm'}); } catch { made=new Recorder(media); }
   assets.chunks=[];
   made.ondataavailable=event=>{ if(id!==sessionNo.current) return; if(event.data?.size) assets.chunks.push(event.data); };
   assets.recorder=made; made.start();
  } catch {
   if(id!==sessionNo.current) return;
   clearTimers(); stopAudio(assets); owned.current.delete(id); put(null); setSeconds(0); setBars(baseBars()); focusAfterDraw();
   if(mounted.current) setError('chatDictationDenied');
  }
 }
 function clearTimers() {
  stopClock(); stopWave();
  if(modeTimer.current) { clearTimeout(modeTimer.current); modeTimer.current=null; }
  if(skipTimer.current) { clearTimeout(skipTimer.current); skipTimer.current=null; }
 }
 async function send(blob:Blob) {
  const place=recordingFor.current; if(!place) return;
  if(!mounted.current) return;
  const id=sessionNo.current;
  setWriting(true);
  try {
   const dataUrl=await audioUrl(blob);
   const response=await fetch('/api/dictation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...place.target,dataUrl,mimeType:blob.type||'audio/webm'})});
   const body=await response.json().catch(()=>null);
   // A newer recording, or another Agent picked while this one was being written, owns the box now: its answer is not
   // this composer's to put in.
   if(!mounted.current||id!==sessionNo.current||place.key!==placeKeyNow.current) return;
   if(response.ok&&typeof body?.text==='string') { const words=body.text.trim(); if(words) place.insert(words); return; }
   if(response.ok&&body?.state==='unavailable') { setUnavailable(true); setError('chatDictationUnavailable'); return; }
   setError('chatDictationFailed');
  } catch { if(mounted.current&&id===sessionNo.current&&place.key===placeKeyNow.current) setError('chatDictationFailed'); }
  finally { if(mounted.current) setWriting(false); focusField.current(); }
 }
 function finish(keep:boolean) {
  if(!live.current||finishing.current) return;
  finishing.current=true;
  const id=sessionNo.current;
  const assets=currentAssets();
  put(null); clearTimers(); stopWave(); setSeconds(0);
  const made=assets?.recorder??null; if(assets) assets.recorder=null;
  if(!keep) {
   try { made?.stop(); } catch {}
   stopAudio(assets); owned.current.delete(id); setBars(baseBars()); focusAfterDraw(); finishing.current=false; return;
  }
  const done=()=>{
   // This recording's own microphone goes whatever happened since: a later session's stream is not this one's to stop.
   stopAudio(assets); owned.current.delete(id);
   if(id!==sessionNo.current) { finishing.current=false; return; }
   const chunks=assets?.chunks??[];
   if(!chunks.length) { focusAfterDraw(); finishing.current=false; return; }
   void send(chunks[0]); finishing.current=false;
  };
  if(made&&made.state!=='inactive') { made.onstop=done; try { made.stop(); } catch { done(); } }
  else done();
 }
 // The reference's press-and-hold: a press starts at once, 400 ms makes it a hold, and a release after that finishes it
 // while an earlier one leaves it recording for the next click.
 function onPointerDown(event:PointerEvent<HTMLButtonElement>) {
  if(event.button>0||unavailable) return;
  if(live.current) { press.current=null; skipClick.current=false; return; }
  press.current={mode:'press',started:Date.now()}; skipClick.current=true;
  void start('press');
  if(modeTimer.current) clearTimeout(modeTimer.current);
  modeTimer.current=setTimeout(()=>{
   if(!live.current||!press.current) return;
   const next={...live.current,mode:'hold' as Mode}; put(next);
  },HOLD_MS);
 }
 function onPointerUp() {
  const held=press.current; if(!held) return;
  press.current=null;
  if(modeTimer.current) { clearTimeout(modeTimer.current); modeTimer.current=null; }
  if(live.current) {
   if(Date.now()-held.started>HOLD_MS) finish(true);
   else { const next={...live.current,mode:'click' as Mode}; put(next); }
  }
  if(skipTimer.current) clearTimeout(skipTimer.current);
  skipTimer.current=setTimeout(()=>{skipClick.current=false;},0);
 }
 function onPointerCancel() {
  press.current=null;
  if(modeTimer.current) { clearTimeout(modeTimer.current); modeTimer.current=null; }
  skipClick.current=false;
  finish(false);
 }
 function onClick() {
  if(skipClick.current) { skipClick.current=false; return; }
  if(unavailable) return;
  if(live.current) finish(true); else void start('click');
 }
 function cancel() { finish(false); }

 // Escape cancels a recording wherever the focus is, as the reference does, and a release outside the button still ends a
 // hold (the reference listens on the document).
 const finishNow=useRef(finish); finishNow.current=finish;
 const upNow=useRef(onPointerUp); upNow.current=onPointerUp;
 const cancelNow=useRef(onPointerCancel); cancelNow.current=onPointerCancel;
 // A pick changes the Agent without remounting this box: every target change invalidates the session, so a recording
 // started for the old one is cancelled and a transcription still on its way inserts nothing, even when the pick
 // comes back to the Agent it started on (A → B → A).
 useEffect(()=>{
  if(lastPlaceKey.current===placeKey) return;
  lastPlaceKey.current=placeKey;
  if(live.current) finishNow.current(false);
  sessionNo.current+=1;
  recordingFor.current=null;
 },[placeKey]);
 useEffect(()=>{
  if(!session) return;
  const keys=(event:KeyboardEvent)=>{ if(event.key==='Escape') { event.preventDefault(); finishNow.current(false); } };
  const up=()=>upNow.current();
  const cancelled=()=>cancelNow.current();
  document.addEventListener('keydown',keys);
  document.addEventListener('pointerup',up);
  document.addEventListener('pointercancel',cancelled);
  return ()=>{ document.removeEventListener('keydown',keys); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',cancelled); };
 },[session]);
 useEffect(()=>{ mounted.current=true; return ()=>{ mounted.current=false; clearTimers(); for(const assets of owned.current.values()) { stopAudio(assets); try { assets.recorder?.stop(); } catch {} } owned.current.clear(); }; },[]); // eslint-disable-line react-hooks/exhaustive-deps

 const mode=session?.mode;
 // The catalogue's "Listening ·" keeps its separator; the language and its own separator are left out when none was read,
 // so the hint never shows two separators in a row.
 const listeningLine=t('chatDictationListening').replace(/\s*·\s*$/,'');
 const hint=session?`${listeningLine}${listening?` · ${languageName(listening,interfaceLanguage)}`:''}${mode==='hold'?` ${t('chatDictationHold')}`:mode==='click'?` ${t('chatDictationClick')}`:''}`:'';
 const disabled=unavailable?'true':undefined;
 const label=session?t('chatDictationFinish'):unavailable?t('chatDictationUnavailable'):t('chatDictationStart');
 const cancelButton=<button type="button" className="composer__btn" aria-label={t('chatDictationCancel')} title={t('chatDictationCancel')} onClick={cancel}><ShellIcon name="x"/></button>;
 const wave=<div className="wave"><span className="wave__bars" aria-hidden="true">{bars.map((value,index)=><span key={index} className="wave__bar" style={{transform:`scaleY(${value.toFixed(2)})`}}/>)}</span><span className="wave__hint">{hint}</span></div>;
 const rec=<span className="composer__rec"><span className="rec-dot" aria-hidden="true"/><span className="num">{clock(seconds)}</span></span>;
 const button=<button type="button" className="composer__btn composer__mic" aria-pressed={!!session} aria-disabled={disabled} aria-label={label}
  title={session?t('chatDictationFinish'):unavailable?t('chatDictationUnavailable'):t('chatDictationTitle')}
  onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClick={onClick}><ShellIcon name={session?'stop':'mic'}/></button>;
 return {recording:!!session,writing,error,unavailable,cancel:cancelButton,wave,clock:rec,button,finish};
}
