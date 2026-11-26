'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { CompanyVoice } from '@/lib/company-speech.mjs';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { InfoTip } from './settings-info';
import { send, useSave } from './settings-saved';
import { toast } from './toast';

// Settings → Voice (#863, vault decision 0075): Hermes's own speech-to-text options for the whole Company, as Hermes
// names and orders them and nothing new: the provider it transcribes with (one whose key Providers holds), that
// provider's model, the language (blank is automatic), the vocabulary (`stt.prompt`) and the silence trim. The page is
// drawn at once and filled by its own read (ADR 0030). Each change is saved at once to every profile of the Company;
// the Owner changes them, a Manager reads them.

// Provider names are their own brands, in either language; the order is the Providers page's (Deepgram first, for Arabic).
const providerNames:Record<string,string>={deepgram:'Deepgram Nova-3',elevenlabs:'ElevenLabs',openai:'OpenAI',groq:'Groq'};
type Provider=NonNullable<CompanyVoice['provider']>;
const order=Object.keys(providerNames) as Provider[];
type Read={data:CompanyVoice|null,readAt:number,state:'reading'|'read'|'failed'};
const unread:CompanyVoice={provider:null,keys:null,language:null,model:null,prompt:null,trimSilence:null,languages:null,models:null};
const voiceOf=(data:Record<string,unknown>|null):CompanyVoice=>({...unread,...(data as Partial<CompanyVoice>|null)});

export function VoiceSettings({company,slug,owner}:{company:string,slug:string,owner:boolean}) {
 const {t,language:shownIn}=useI18n();
 const [read,setRead]=useState<Read>({data:null,readAt:0,state:'reading'});
 const [asked,setAsked]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/voice-settings?company=${encodeURIComponent(company)}`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{ const body=response.ok?await response.json() as {data:CompanyVoice,readAt:number}:null;
    setRead(body&&body.data.keys!==null?{data:body.data,readAt:body.readAt,state:'read'}:{data:null,readAt:0,state:'failed'}); },
   ()=>{ if(!controller.signal.aborted) setRead({data:null,readAt:0,state:'failed'}); });
  return ()=>controller.abort();
 },[company,asked]);
 const saved=useSave<CompanyVoice>(`voice:${company}`,read.data??unread,read.readAt);
 const [vocabulary,setVocabulary]=useState<string|null>(null);
 const [missed,setMissed]=useState<string[]>([]);
 const current=saved.value;
 // One option, saved at once to every profile; the answer is the Engine's own read-back.
 const change=async(options:Partial<Pick<CompanyVoice,'language'|'model'|'prompt'|'trimSilence'>>)=>{
  const answer=await saved.save({...current,...options},()=>send('/api/voice-settings',{company,...options}),found=>voiceOf(found.data));
  if(!answer.ok) return;
  const failed=Array.isArray(answer.data?.failed)?(answer.data.failed as {name:string|null}[]).map(item=>item.name||t('settingsModelsAnAgent')):[];
  setMissed(failed);
  if(!failed.length&&answer.newest) toast(t('settingsVoiceSaved'));
 };
 // A provider is chosen with the key the Company already holds (#862); the page then reads itself again, as the
 // language and the model it offers are the new provider's.
 const choose=async(provider:Provider)=>{
  const answer=await saved.save({...current,provider},()=>send('/api/speech-provider',{company,provider,intent:'set'}),found=>({...current,provider:typeof found.data?.provider==='string'?found.data.provider as CompanyVoice['provider']:current.provider}));
  if(answer.ok) setAsked(value=>value+1);
 };
 const languageLabel=(value:string)=>!value?t('settingsVoiceAutomatic')
  :value==='ar'?t(current.provider==='deepgram'?'settingsVoiceArabicEgypt':'settingsVoiceArabic')
  :value==='en'?t('settingsVoiceEnglish')
  :(()=>{ try { return new Intl.DisplayNames([shownIn],{type:'language'}).of(value)||value; } catch { return value; } })();
 const keys=order.filter(id=>current.keys?.includes(id));
 const words=vocabulary??current.prompt??'';
 const row=(id:string,title:string,hint:string,control:ReactNode,tip?:string)=><li className="panel-row" id={`vc-${id}-row`}>
  <span className="panel-row__text"><span className="panel-row__t"><span id={`vc-${id}-t`}>{title}</span>{tip&&<InfoTip about={title} id={`vc-${id}-tip`}>{tip}</InfoTip>}</span>
   <span className="panel-row__d" id={`vc-${id}-d`}>{hint}</span></span>{control}</li>;
 const shown=(value:string)=><span className="panel-row__meta"><bdi>{value}</bdi></span>;
 const busy=saved.saving||undefined;
 let body;
 if(read.state==='reading'&&!read.data) body=<div className="panel-card"><p className="panel-empty">{t('settingsPartReading')}</p></div>;
 else if(!read.data) body=<div className="panel-card"><p className="panel-empty">{t('settingsVoiceUnread')}</p></div>;
 else if(!keys.length) body=<div className="panel-card"><p className="panel-empty" id="vc-none"><span>{t('settingsVoiceNoProvider')}</span> {owner&&<a className="link-btn" href={overlayHref(slug,'models')}>{t('settingsVoiceAddKey')}</a>}</p></div>;
 else body=<ul className="panel-card" aria-busy={busy}>
  {row('provider',t('settingsVoiceProvider'),t('settingsVoiceProviderD'),owner
   ?<select className="set-input" id="vc-provider" value={current.provider??''} aria-labelledby="vc-provider-t" aria-describedby="vc-provider-d" onChange={event=>choose(event.target.value as Provider)}>
     {!current.provider&&<option value="">—</option>}
     {keys.map(id=><option key={id} value={id}>{providerNames[id]}</option>)}</select>
   :shown(current.provider?providerNames[current.provider]:'—'))}
  {current.provider&&current.models&&current.models.length>0&&row('model',t('settingsVoiceModel'),t('settingsVoiceModelD'),owner
   ?<select className="set-input" id="vc-model" dir="ltr" value={current.model??''} aria-labelledby="vc-model-t" aria-describedby="vc-model-d" onChange={event=>change({model:event.target.value})}>
     {current.models.map(model=><option key={model} value={model}>{model}</option>)}</select>
   :<span className="panel-row__meta"><bdi dir="ltr">{current.model}</bdi></span>)}
  {current.provider&&current.language!==null&&row('language',t('settingsVoiceLanguage'),t('settingsVoiceLanguageD'),owner
   ?<select className="set-input" id="vc-language" value={current.language} aria-labelledby="vc-language-t" aria-describedby="vc-language-d" onChange={event=>change({language:event.target.value})}>
     {(current.languages??[]).map(value=><option key={value||'automatic'} value={value}>{languageLabel(value)}</option>)}
     {!(current.languages??[]).includes(current.language)&&<option value={current.language}>{languageLabel(current.language)}</option>}</select>
   :shown(languageLabel(current.language)))}
  {current.provider&&row('vocabulary',t('settingsVoiceVocabulary'),t('settingsVoiceVocabularyD'),owner
   ?<span className="vc-words"><input className="set-input" id="vc-vocabulary" dir="auto" maxLength={896} value={words} aria-labelledby="vc-vocabulary-t" aria-describedby="vc-vocabulary-d"
      onChange={event=>setVocabulary(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter'&&vocabulary!==null) { void change({prompt:vocabulary}); setVocabulary(null); } }}/>
     {vocabulary!==null&&vocabulary!==current.prompt&&<button type="button" className="btn btn--primary btn--sm" id="vc-vocabulary-save" onClick={()=>{ void change({prompt:vocabulary}); setVocabulary(null); }}>{t('settingsSave')}</button>}</span>
   :shown(current.prompt||'—'),t('settingsVoiceVocabularyTip'))}
  {current.provider&&row('trim',t('settingsVoiceTrim'),t('settingsVoiceTrimD'),owner
   ?<button type="button" className="switch" role="switch" id="vc-trim" aria-checked={current.trimSilence!==false} aria-labelledby="vc-trim-t" aria-describedby="vc-trim-d" onClick={()=>change({trimSilence:current.trimSilence===false})}/>
   :shown(t(current.trimSilence===false?'settingsVoiceTrimOff':'settingsVoiceTrimOn')))}
 </ul>;
 return <section className="dp-sec" aria-labelledby="sov-h">
  {body}
  {saved.saving&&<p className="set-hint is-saving" role="status">{t('settingsSaving')}</p>}
  {saved.error&&<p className="set-err" role="alert">{t(saved.error==='speechNotAllowed'?'settingsVoiceOwnerOnly':'settingsVoiceError')}</p>}
  {missed.length>0&&<p className="set-err" role="alert">{t('settingsSpeechNotReached',missed.join(', '))}</p>}
  {!owner&&<p className="set-hint">{t('settingsVoiceOwnerOnly')}</p>}
 </section>;
}
