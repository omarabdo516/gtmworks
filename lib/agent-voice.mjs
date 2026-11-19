import { engineOf } from './company-engine.mjs';
import { agentGate, agentTarget } from './agent-gate.mjs';
import { readConfig, readVoices, speakText, speakLimit } from './hermes.mjs';
import { engineSettings, writeSetting } from './engine-settings.mjs';
import { i18n } from './i18n.mjs';

// An Agent's voice (#162): the language the Engine listens in when a Member dictates (`stt.language`), the speed it
// speaks at (`tts.speed`, read as 1 when the profile saved none), the voice of the profile's `tts.provider` (for example
// `tts.edge.voice`), the list of voices the Engine offers, and the sample it speaks. The Engine's own choices decide
// everything: `ar`, `en` or empty for detect (hermes_cli/config_defaults.py 1141-1148); five speeds inside what it
// accepts; `tts.provider` decides which voice key is the profile's (1061-1139). The list of voices exists only for
// ElevenLabs (web_routers/audio.py 223-295); every other provider reads its saved voice with no list, and the page says
// so instead of inventing names. Its voice-config route is never called: it returns provider keys (ADR 0017).

/** The language choices the Engine accepts: Arabic, English, and empty for detect. */
export const voiceLanguages=Object.freeze(['ar','en','']);
/** The reference's five steps, all inside what the Engine accepts (tools/tts_tool_providers.py 199). */
export const voiceSpeeds=Object.freeze([0.7,0.85,1,1.25,1.5]);
// The sample Listen speaks is the page's own sentence, built here from the reader's first name so no route ever speaks
// text a browser sent, in the reader's language.
/** @param {'en'|'ar'|string} language @param {unknown} name */
export function voiceSample(language,name) {
 const first=typeof name==='string'?name.trim().split(/\s+/)[0]:'';
 return i18n(language==='ar'?'ar':'en').t('settingsVoiceSample',first||'');
}
// Where a provider keeps its voice: ElevenLabs names a voice id, every other provider a voice (config_defaults.py 1061-1139).
const voiceKey=provider=>provider==='elevenlabs'?'tts.elevenlabs.voice_id':`tts.${provider}.voice`;
const at=(object,key)=>key.split('.').reduce((found,part)=>found&&typeof found==='object'?found[part]:undefined,object);
const stringAt=(object,key)=>{ const value=at(object,key); return typeof value==='string'&&value?value:null; };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the profile's merged config says, in the Engine's own terms: its tts.provider (default edge), that provider's voice
// key, stt.language (default en) and tts.speed (absent reads as 1).
function heldVoice(config) {
 const provider=stringAt(config,'tts.provider')||'edge';
 const speed=at(config,'tts.speed');
 return {provider,voice:stringAt(config,voiceKey(provider)),
  language:stringAt(config,'stt.language')??'',
  speed:typeof speed==='number'&&Number.isFinite(speed)?speed:1};
}

const drivers={config:readConfig,voices:readVoices,speak:speakText};
/** @type {any} */
const noneRead=state=>({state,own:false,language:'',speed:1,provider:'edge',voice:null,voiceName:null,list:null});

// What the Agent's page shows of its voice, or null when the Agent is not one the person sees. The list of voices is read
// only for ElevenLabs, the one provider the Engine offers a list for; every other provider shows its saved voice. An
// Engine that cannot be read is that state with no values, so the page still draws.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readAgentVoice(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state!=='found') return null;
 const connection=target;
 const read=await (driver.config||drivers.config)(connection);
 if(read.state!=='found') return {...noneRead(read.state),own:target.own};
 const held=heldVoice(read.config);
 const list=held.provider==='elevenlabs'?await (driver.voices||drivers.voices)(connection):null;
 const chosen=list?.state==='found'&&list.available?list.voices.find(voice=>voice.id===held.voice):undefined;
 return {state:'found',own:target.own,...held,voiceName:chosen?chosen.name||chosen.label||chosen.id:held.voice,list};
}

// One save of the Voice section from the Agent's page: the language, the speed and a voice the profile's provider offers.
// Only the values that changed are written, each through #125's writeSetting on the Agent's own profile (an Agent still on
// the Company's shared profile would change the main Agent too, so it is refused), and the Engine's read-back decides
// whether it was saved. One Company log row records the save: "changed the voice in the settings of {Agent}".
// States: written (with the values the Engine holds), invalid (a choice the Engine does not have), notOwn, notAllowed
// (below Manager), noEngine, noVoices (ElevenLabs without its list), or the Engine's refused / unreachable / failed.
/** @param {any} db @param {{company:string,agent:unknown,voice:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeAgentVoice(db,{company,agent,voice,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const refused=state=>({state,voice:null});
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)
  ||!voice||typeof voice!=='object'||Array.isArray(voice)) return refused('invalid');
 const asked=/** @type {Record<string,unknown>} */(voice);
 const given=['language','speed','voice'].filter(field=>asked[field]!==undefined);
 if(!given.length||given.some(field=>typeof asked[field]!=='string')) return refused('invalid');
 const gate=await agentGate(db,{company,agent,hermes,check:'check_agent_setting'});
 if(gate.state!=='allowed') return refused(gate.state);
 const connection=gate.target;
 const read=await (driver.config||drivers.config)(connection);
 if(read.state!=='found') return refused(read.state);
 const held=heldVoice(read.config);
 // Every value is checked before the first write: the language the Engine listens in, one of the five speeds, and a voice
 // the provider offers (only ElevenLabs has a list; another provider's voice is never changed here).
 const language=asked.language===undefined?held.language:/** @type {string} */(asked.language);
 if(!voiceLanguages.includes(language)) return refused('invalid');
 const speed=asked.speed===undefined?held.speed:Number(asked.speed);
 if(!voiceSpeeds.includes(speed)) return refused('invalid');
 let chosen=held.voice;
 if(asked.voice!==undefined&&held.provider==='elevenlabs') {
  const list=await (driver.voices||drivers.voices)(connection);
  if(list.state!=='found') return refused(list.state);
  if(!list.available) return refused('noVoices');
  if(!list.voices.some(choice=>choice.id===asked.voice)) return refused('invalid');
  chosen=/** @type {string} */(asked.voice);
 } else if(asked.voice!==undefined&&asked.voice!==held.voice) return refused('invalid');
 const list=[...engineSettings,{key:voiceKey(held.provider),where:'profile',type:'string',label:''}];
 const current={'stt.language':held.language,'tts.speed':held.speed,[voiceKey(held.provider)]:held.voice};
 const wanted=/** @type {[string,unknown][]} */([['stt.language',language],['tts.speed',speed],[voiceKey(held.provider),chosen]]);
 let changed=false;
 for(const [setting,value] of wanted) {
  if(value===null||value===current[setting]) continue;
  const written=await writeSetting(connection,{setting,value,list,driver});
  if(written.state==='invalid') return refused('invalid');
  if(written.state!=='saved'&&written.state!=='unchanged') return refused(written.state);
  if(written.state==='saved') changed=true;
 }
 if(changed) {
  const {error:logError}=await db.rpc('log_agent_setting',{c:company,agent,field:'voice',old_value:null,new_value:null});
  if(logError) return refused('failed');
 }
 return {state:'written',voice:{language,speed,voice:chosen}};
}

// The Engine speaks the sample with the profile's saved voice and speed, which is why the page asks to save first. The
// text alone is sent (web_routers/audio.py 298-352): nothing here names a voice, and no key is read or logged. `text` is
// the server's own sample sentence, never a string the browser chose.
/** @param {any} db @param {{company:string,agent:unknown,text:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function speakAgentSample(db,{company,agent,text,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const none=state=>({state,dataUrl:null,mimeType:null,provider:null});
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof text!=='string'||!text.trim()||text.length>speakLimit) return none('invalid');
 const gate=await agentGate(db,{company,agent,hermes,check:'check_agent_setting',own:false,missing:'notAllowed'});
 if(gate.state!=='allowed') return none(gate.state);
 return (driver.speak||drivers.speak)(gate.target,{text});
}
