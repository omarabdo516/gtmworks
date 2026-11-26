import { keyProfile, keyValue } from './providers.mjs';
import { agentName, manage, query, reachable, refusal, stepState, tooLarge } from './wire.mjs';

// An Agent's voice (#162): the words the Engine speaks for a profile with its saved voice and speed, and the list of
// voices it offers for the profile's provider. The Engine offers a list only for ElevenLabs (v0.23.0
// hermes_cli/web_routers/audio.py 223-295); every other provider answers the saved voice alone. Its voice-config route is
// never read here: it returns provider keys (ADR 0017). The sound comes back base64 inside the JSON answer, so a long
// sentence can pass the 4 MB reading cap: that is `tooLarge`, never a truncated sound.
export const speakLimit=600;
/** @param {any} connection */
export async function readVoices(connection) {
 const none=state=>({state,available:false,voices:[]});
 if(!agentName.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/audio/elevenlabs/voices${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return none('failed');
  const voices=Array.isArray(read.result.voices)?read.result.voices.map(voice=>({id:typeof voice?.voice_id==='string'?voice.voice_id:'',
   name:typeof voice?.name==='string'&&voice.name?voice.name:typeof voice?.label==='string'?voice.label:'',label:typeof voice?.label==='string'?voice.label:''})).filter(voice=>voice.id):[];
  // The Engine's own line for a provider it cannot list (its key is missing or was refused) is kept as words, not a state.
  const error=typeof read.result.error==='string'?read.result.error:null;
  return {state:'found',available:read.result.available===true,voices,...(error?{error}:{})};
 } catch { return none('unreachable'); }
}
/** @param {any} connection @param {{text:string}} say @returns {Promise<{state:'spoken',dataUrl:string,mimeType:string|null,provider:string|null}|{state:'refused'|'unreachable'|'failed'|'tooLarge',dataUrl:null,mimeType:null,provider:null}>} */
export async function speakText(connection,{text}) {
 const none=state=>({state,dataUrl:null,mimeType:null,provider:null});
 if(!agentName.test(connection.profile)||typeof text!=='string'||!text.trim()||text.length>speakLimit) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  // Synthesis is slower than a setting write: the Engine builds the whole sound before it answers.
  const spoken=await manage(connection,`/api/audio/speak${query(connection.profile)}`,{method:'POST',body:{text},timeout:30000});
  if(spoken.result===tooLarge) return none('tooLarge');
  if(!spoken.response.ok) return none(stepState(spoken));
  const dataUrl=spoken.result?.data_url;
  if(spoken.result?.ok!==true||typeof dataUrl!=='string'||!dataUrl.startsWith('data:')) return none('failed');
  return {state:'spoken',dataUrl,mimeType:typeof spoken.result.mime_type==='string'?spoken.result.mime_type:null,
   provider:typeof spoken.result.provider==='string'?spoken.result.provider:null};
 } catch { return none('unreachable'); }
}

// Speech-to-text (#430): a profile transcribes with its saved `stt.provider` (tools/transcription_tools.py 249-277) and
// that provider's key, one variable of the profile's own .env, read in the profile's own secret scope (agent/
// secret_scope.py). A provider the Engine has no handler for is its own `stt.providers.<name>` command
// (tools/transcription_command.py), so nothing inside the Engine changes. Of a key, only whether it is set leaves the
// driver: the row's redacted preview is dropped. `held` lists which of `envs` the profile holds; a profile the Engine
// does not answer for is null.
const envName=/^[A-Z][A-Z0-9_]{2,63}$/;
/** The variable each speech provider's key lives in (tools/transcription_cloud.py; Deepgram's is its command's own). */
export const speechEnvs=Object.freeze({deepgram:'DEEPGRAM_API_KEY',elevenlabs:'ELEVENLABS_API_KEY',openai:'VOICE_TOOLS_OPENAI_KEY',groq:'GROQ_API_KEY'});
/** @param {any} connection @param {{profiles:string[],envs:string[]}} asked */
export async function readSpeech(connection,{profiles,envs}) {
 const none=state=>({state,profiles:null});
 if(!Array.isArray(profiles)||!profiles.every(name=>typeof name==='string'&&keyProfile.test(name))||!Array.isArray(envs)||!envs.every(name=>envName.test(name))) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const one=async profile=>{
  try {
   const [config,env]=await Promise.all([manage(connection,`/api/config${query(profile)}&include_defaults=false`),manage(connection,`/api/env${query(profile)}`)]);
   if(!config.response.ok||!env.response.ok||!env.result||typeof env.result!=='object') return null;
   const stt=config.result?.stt;
   // `stt` is the profile's own saved section, its options as Hermes names them (#863); it never holds a key.
   const own=stt&&typeof stt==='object'&&!Array.isArray(stt)?stt:{};
   return {provider:typeof stt?.provider==='string'&&stt.provider?stt.provider:null,language:typeof stt?.language==='string'?stt.language:null,
    held:envs.filter(name=>env.result[name]?.is_set===true),stt:own};
  } catch { return null; }
 };
 const read=await Promise.all(profiles.map(one));
 return {state:'found',profiles:Object.fromEntries(profiles.map((profile,at)=>[profile,read[at]]))};
}
// One profile's provider and key. A set writes the key before the config, so the provider never points at a key the
// profile lacks; a removal (no value) writes the config first and then takes the key, a 404 being a key it never held,
// or leaves every key where it is when `env` is null. A null config takes the key alone and leaves the provider as it is.
// The config write deep-merges, so it states only its own keys.
/** @param {any} connection @param {{profile:string,env:string|null,value?:string,config:object|null}} change @returns {Promise<'written'|'invalid'|'refused'|'unreachable'|'failed'>} */
export async function writeSpeech(connection,{profile,env,value,config}) {
 const keyOnly=config===null&&value===undefined&&typeof env==='string';
 if(typeof profile!=='string'||!keyProfile.test(profile)||!(env===null&&value===undefined)&&(typeof env!=='string'||!envName.test(env))||!keyOnly&&(!config||typeof config!=='object'||Array.isArray(config))) return 'failed';
 if(value!==undefined&&(typeof value!=='string'||!keyValue.test(value))) return 'invalid';
 if(!reachable(connection)) return 'unreachable';
 const path=`/api/env${query(profile)}`;
 const writeConfigOf=async()=>{ const written=await manage(connection,`/api/config${query(profile)}`,{method:'PUT',body:{config}}); return written.response.ok&&written.result?.ok===true?'written':stepState(written); };
 try {
  if(value!==undefined) {
   const keyed=await manage(connection,path,{method:'PUT',body:{key:env,value}});
   // The Engine refuses a value that reads as its own redacted preview.
   if(keyed.response.status===400) return 'invalid';
   if(!keyed.response.ok||keyed.result?.ok!==true) return stepState(keyed);
   return await writeConfigOf();
  }
  const configured=keyOnly?'written':await writeConfigOf();
  if(configured!=='written'||env===null) return configured;
  const removed=await manage(connection,path,{method:'DELETE',body:{key:env}});
  return removed.response.status===404||removed.response.ok&&removed.result?.ok===true?'written':stepState(removed);
 } catch { return 'unreachable'; }
}

// One recording as text (#160), on the management listener for the Agent's own profile (v0.23.0
// hermes_cli/web_routers/audio.py 89-149): the recording is a base64 data URL of at most 25 MB, the answer the
// transcript and the provider that wrote it. The recording goes in the request body only: gtmworks stores it nowhere and
// logs nothing of it, and the driver returns its words only. An empty transcript is silence, not an error. `unavailable`
// is the Engine saying it holds no speech-to-text provider to use: the profile's `stt.provider` is unset and its local
// model is not installed.
const maxRecording=25*1024*1024;
const maxAudioUrl=Math.ceil(maxRecording/3)*4+1024;
const noStt='No STT provider available';
/** @param {any} connection @param {{dataUrl:string,mimeType:string}} audio @returns {Promise<import('../engine.mjs').Transcription>} */
export async function transcribe(connection,audio) {
 if(!reachable(connection)) return {state:'unreachable'};
 const dataUrl=typeof audio?.dataUrl==='string'?audio.dataUrl:'';
 const mimeType=typeof audio?.mimeType==='string'&&/^audio\/[a-z0-9.+-]{1,40}$/i.test(audio.mimeType)?audio.mimeType:'audio/webm';
 if(!dataUrl.startsWith('data:audio/')||dataUrl.length>maxAudioUrl) return {state:'refused'};
 try {
  const sent=await manage(connection,`/api/audio/transcribe${query(connection.profile)}`,{method:'POST',body:{data_url:dataUrl,mime_type:mimeType},timeout:60000});
  if([401,403].includes(sent.response.status)) return {state:'refused'};
  const detail=typeof sent.result?.detail==='string'?sent.result.detail:'';
  if(sent.response.status===400&&(detail.includes(noStt)||/stt[^\n]*\b(disabled|off)\b/i.test(detail))) return {state:'unavailable'};
  if(!sent.response.ok||sent.result?.ok!==true) return {state:'failed'};
  return {state:'transcribed',text:typeof sent.result.transcript==='string'?sent.result.transcript:''};
 } catch { return {state:'unreachable'}; }
}
// The language the profile listens in (`stt.language`; the Engine's default is `en`, and an empty value means it detects
// the language itself). Read from the profile's config, as every other profile setting is.
/** @param {any} connection @returns {Promise<import('../engine.mjs').DictationSettings>} */
export async function readDictation(connection) {
 if(!reachable(connection)) return {state:'unreachable',language:null};
 try {
  const read=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!read.response.ok) return {state:refusal(read.response),language:null};
  // No `stt.language` at all is the Engine's own default (`en`); an empty one is the profile asking it to detect.
  const configured=read.result?.stt?.language;
  const language=typeof configured==='string'?configured.trim().slice(0,35):configured===undefined?'en':'';
  return {state:'found',language:language||null};
 } catch { return {state:'unreachable',language:null}; }
}
