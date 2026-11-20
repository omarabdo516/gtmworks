import { engineOf } from './company-engine.mjs';
import { keyTarget } from './provider-keys.mjs';
import { readSpeech, writeSpeech } from './hermes.mjs';

// The Company's speech-to-text provider (#430): the Owner picks one and pastes its key once, and every Agent of the
// Company transcribes with it while keeping its own listening language (`stt.language`, lib/agent-voice.mjs). The key
// goes straight to the Engine, into the .env of the Company's shared space and of each of its Agent profiles, as model
// keys do (lib/provider-keys.mjs, ADR 0016): no answer, log line or database row holds it. The provider is each
// profile's `stt.provider`; the space's is the Company's choice, and an Agent's profile that does not match it yet (one
// made after the key was set, or one the Engine did not answer for) is named to the Owner, who sets the key again.
// Deepgram is not one of the Engine's own providers, so it is an Engine command provider (stt.providers.deepgram,
// tools/transcription_command.py) that runs curl, which the pinned Engine image ships, and reads the transcript with the
// image's own Python; the key reaches the command only through env_passthrough, never in its text.

/** The providers in the order the Owner sees them, Deepgram first for Arabic, each with the variable its key lives in. */
const speechProviders=Object.freeze([
 {id:'deepgram',env:'DEEPGRAM_API_KEY'},
 // The Engine's own providers that work with a key (tools/transcription_cloud.py). OpenAI's is its voice key, apart
 // from its model key; Groq's is the one key Groq has, the same its models use.
 {id:'elevenlabs',env:'ELEVENLABS_API_KEY'},
 {id:'openai',env:'VOICE_TOOLS_OPENAI_KEY'},
 {id:'groq',env:'GROQ_API_KEY'},
]);
/** Deepgram Nova-3's Arabic variants besides Egyptian (developers.deepgram.com/docs/models-languages-overview, read
 * 2026-11-20). Plain `ar` on Deepgram is Egyptian, `ar-EG`: the command maps it. */
export const deepgramArabic=Object.freeze(['ar-AE','ar-SA','ar-QA','ar-KW','ar-SY','ar-LB','ar-PS','ar-JO','ar-SD','ar-TD','ar-MA','ar-DZ','ar-TN','ar-IQ','ar-IR']);
// The Engine fills {language} and {input_path} shell-quoted (tools/tts_command_provider.py render_command_template);
// `normalize` hands the command a 16 kHz mono m4a, whatever container the browser recorded.
export const deepgramCommand=[
 'lang={language}; [ "$lang" = ar ] && lang=ar-EG;',
 'curl -sS --fail-with-body --max-time 55 -H "Authorization: Token $DEEPGRAM_API_KEY" -H "Content-Type: audio/mp4" --data-binary @{input_path}',
 '"https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=$lang"',
 `| /opt/hermes/.venv/bin/python -c 'import json,sys; print(json.load(sys.stdin)["results"]["channels"][0]["alternatives"][0]["transcript"])'`,
].join(' ');
/** The config one profile is given for a provider. @param {string} id */
const speechConfig=id=>id==='deepgram'
 ?{stt:{provider:'deepgram',providers:{deepgram:{type:'command',command:deepgramCommand,normalize:true,env_passthrough:['DEEPGRAM_API_KEY']}}}}
 :{stt:{provider:id}};
// A removal leaves the profile with no provider, which the Engine answers as "No STT provider available".
const noProvider={stt:{provider:'none'}};

const drivers={read:readSpeech,write:writeSpeech};
const envs=speechProviders.map(provider=>provider.env);
const providerOf=id=>speechProviders.find(provider=>provider.id===id);
const outcomes={invalid:[400,'speechInvalid'],notAllowed:[403,'speechNotAllowed'],noSpace:[409,'speechNoSpace'],refused:[502,'speechFailed'],failed:[502,'speechFailed'],unreachable:[503,'speechFailed']};
const refused=state=>{ const [status,error]=outcomes[state]||outcomes.failed; return {status,body:{error}}; };
const named=found=>({agent:found.agent,name:found.name});

// What a member sees: the Company's provider (null when none is set with its key), and the Agents whose profile does not
// transcribe with it yet. null for both when the Engine or the Company's profiles cannot be read.
/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanySpeech(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const unread={provider:null,missing:null};
 const target=await keyTarget(db,null,company,hermes);
 if(!target) return unread;
 const read=await (driver.read||drivers.read)(target.connection,{profiles:[target.space,...target.agents.map(found=>found.profile)],envs});
 const space=read.state==='found'?read.profiles[target.space]:null;
 if(!space) return unread;
 const chosen=providerOf(space.provider);
 if(!chosen||!space.held.includes(chosen.env)) return {provider:null,missing:[]};
 const missing=target.agents.filter(found=>{ const own=read.profiles[found.profile]; return !own||own.provider!==chosen.id||!own.held.includes(chosen.env); }).map(named);
 return {provider:chosen.id,missing};
}

// An Owner sets the Company's provider with its key, or removes it. A set reaches the space and every Agent profile;
// a profile that listened in an Arabic variant only Deepgram has goes back to Arabic on another provider. A switch takes
// the previous provider's key away, except Groq's, which is also the Company's Groq model key. A removal reaches the
// removed Agents' profiles too, which the Engine keeps. The answer is a fresh read, so it never counts a 200 as saved.
/** @param {any} db @param {{company:string,provider?:unknown,intent:unknown,value?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySpeech(db,{company,provider,intent,value,hermes=engineOf(company),driver={}}) {
 const use={...drivers,...driver};
 const chosen=providerOf(provider);
 if(intent!=='set'&&intent!=='remove'||intent==='set'&&(!chosen||typeof value!=='string')) return refused('invalid');
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return refused('notAllowed');
 hermes=await hermes;
 const target=await keyTarget(db,null,company,hermes);
 if(!target) return refused('noSpace');
 const profiles=[target.space,...target.agents.map(found=>found.profile)];
 const before=await use.read(target.connection,{profiles:[...profiles,...target.removed.map(found=>found.profile)],envs});
 if(before.state!=='found') return refused(before.state);
 const held=before.profiles[target.space];
 if(!held) return refused('unreachable');
 const previous=providerOf(held.provider);
 if(intent==='set'&&chosen) {
  const states=await Promise.all(profiles.map(profile=>{
   const variant=chosen.id!=='deepgram'&&/^ar-/i.test(before.profiles[profile]?.language??'');
   const config=speechConfig(chosen.id);
   return use.write(target.connection,{profile,env:chosen.env,value:/** @type {string} */(value).trim(),config:variant?{stt:{...config.stt,language:'ar'}}:config});
  }));
  if(states[0]!=='written') return refused(states[0]);
  if(previous&&previous.id!==chosen.id&&previous.id!=='groq') await Promise.all(profiles.map(profile=>use.write(target.connection,{profile,env:previous.env,config:speechConfig(chosen.id)})));
 } else {
  // The provider the space holds, and every variable a profile holds for it, the removed Agents' profiles included.
  if(!previous) return {status:200,body:{provider:null,missing:[]}};
  const reached=[...profiles,...target.removed.map(found=>found.profile)];
  const states=await Promise.all(reached.map(profile=>use.write(target.connection,{profile,env:previous.env,config:noProvider})));
  if(states[0]!=='written') return refused(states[0]);
 }
 return {status:200,body:await readCompanySpeech(db,{company,hermes,driver:use})};
}
