import { keyTarget } from './provider-keys.mjs';
import { speechEnvs } from './engine/handle.mjs';

// The Company's speech-to-text provider (#430): the Owner picks one and pastes its key once, and every Agent of the
// Company transcribes with it, with the options the Owner sets once on Settings → Voice (#863, below). The key
// goes straight to the Engine, into the .env of the Company's shared space and of each of its Agent profiles, as model
// keys do (lib/provider-keys.mjs, ADR 0016): no answer, log line or database row holds it. The provider is each
// profile's `stt.provider`; the space's is the Company's choice. An Agent's profile made later is given the space's key and
// `stt` section (lib/engine/agents.mjs giveProviders); one that does not match it yet (one the Engine did not answer
// for) is named to the Owner, who sets the key again.
// Deepgram is not one of the Engine's own providers, so it is an Engine command provider (stt.providers.deepgram,
// tools/transcription_command.py) that runs curl, which the pinned Engine image ships, and reads the transcript with the
// image's own Python; the key reaches the command only through env_passthrough, never in its text.

/** The providers in the order the Owner sees them, Deepgram first for Arabic, each with the variable its key lives in. */
const speechProviders=Object.freeze([
 {id:'deepgram',env:speechEnvs.deepgram},
 // The Engine's own providers that work with a key (tools/transcription_cloud.py). OpenAI's is its voice key, apart
 // from its model key; Groq's is the one key Groq has, the same its models use (`shared`): a model key alone makes Groq
 // a provider with a key here too, as the Engine would transcribe with it, and removing Groq never takes it.
 {id:'elevenlabs',env:speechEnvs.elevenlabs},
 {id:'openai',env:speechEnvs.openai},
 {id:'groq',env:speechEnvs.groq,shared:true},
]);
/** The models Hermes accepts for each provider it names one for, under its own key and in its own order, its default
 * first (hermes_cli/config_defaults.py 1167-1192, tools/transcription_tools.py _BUILTIN_MODEL_KEYS). Deepgram is a
 * command provider: Hermes has no model for it, and its command asks Nova-3. */
const speechModels=Object.freeze({
 elevenlabs:Object.freeze({key:'model_id',values:Object.freeze(['scribe_v2','scribe_v1'])}),
 openai:Object.freeze({key:'model',values:Object.freeze(['whisper-1','gpt-4o-mini-transcribe','gpt-4o-transcribe','gpt-transcribe'])}),
 groq:Object.freeze({key:'model',values:Object.freeze(['whisper-large-v3-turbo','whisper-large-v3'])}),
});
/** The languages offered for a provider: blank is Hermes's automatic (stt.language ""), then Arabic and English. On
 * Deepgram Arabic is Egyptian and its other Arabic variants stay; it has no automatic, since Hermes sends a command
 * provider English for a blank language (tools/transcription_command.py DEFAULT_COMMAND_STT_LANGUAGE).
 * @param {string|null|undefined} provider */
const speechLanguages=provider=>provider==='deepgram'?['ar',...deepgramArabic,'en']:['','ar','en'];
/** The vocabulary Hermes uses: whisper-family providers condition on the last 224 tokens of `stt.prompt`, about four
 * characters each (tools/transcription_command.py _WHISPER_PROMPT_TOKEN_CAP, agent/model_metadata.py CHARS_PER_TOKEN). */
const promptLimit=896;

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

const envs=speechProviders.map(provider=>provider.env);
const providerOf=id=>speechProviders.find(provider=>provider.id===id);
const outcomes={invalid:[400,'speechInvalid'],notAllowed:[403,'speechNotAllowed'],noSpace:[409,'speechNoSpace'],refused:[502,'speechFailed'],failed:[502,'speechFailed'],unreachable:[503,'speechFailed']};
const refused=state=>{ const [status,error]=outcomes[state]||outcomes.failed; return {status,body:{error}}; };
const named=found=>({agent:found.agent,name:found.name});

// What a member sees: the Company's provider (null when none is set with its key), the providers whose key the space
// holds (in the Owner's order), so one is chosen again with no new key, and the Agents whose profile does not transcribe
// with the provider yet. null for all three when the Engine or the Company's profiles cannot be read.
/** @param {any} db @param {{company:string}} request */
export async function readCompanySpeech(db,{company}) {
 const unread={provider:null,keys:null,missing:null};
 const target=await keyTarget(db,company);
 if(!target) return unread;
 const read=await target.at.speech.read({profiles:[target.space,...target.agents.map(found=>found.profile)],envs});
 const space=read.state==='found'?read.profiles[target.space]:null;
 if(!space) return unread;
 const keys=speechProviders.filter(provider=>space.held.includes(provider.env)).map(provider=>provider.id);
 const chosen=providerOf(space.provider);
 if(!chosen||!keys.includes(chosen.id)) return {provider:null,keys,missing:[]};
 const missing=target.agents.filter(found=>{ const own=read.profiles[found.profile]; return !own||own.provider!==chosen.id||!own.held.includes(chosen.env); }).map(named);
 return {provider:chosen.id,keys,missing};
}

// The listening language a profile keeps on a provider, or undefined to leave it: an Arabic variant only Deepgram has goes
// back to Arabic elsewhere, and "detect" becomes English on Deepgram, which is what the Engine sends it for an empty
// language (tools/transcription_command.py) and which Nova-3 cannot detect Arabic in anyway.
/** @param {string} id @param {string|null|undefined} language */
const languageOn=(id,language)=>id!=='deepgram'&&/^ar-/i.test(language??'')?'ar':id==='deepgram'&&language===''?'en':undefined;

// An Owner sets the Company's provider, with its key or with the key the space already holds for it, or removes one
// provider's key. A set writes that provider's key and `stt.provider` to the space and every Agent profile, each keeping
// its listening language as languageOn says, and nothing else: every other provider's key stays where the Engine keeps
// it, as the Engine itself never takes a key away when `stt.provider` changes (#862, ADR 0033). A removal takes that
// provider's key from every profile, the removed Agents' too, which the Engine keeps, and turns off the provider of each
// profile that transcribes with it; Groq's key is also the Company's Groq model key, so removing Groq only turns it off.
// The answer is a fresh read, so it never counts a 200 as saved.
/** @param {any} db @param {{company:string,provider?:unknown,intent:unknown,value?:unknown}} request */
export async function changeCompanySpeech(db,{company,provider,intent,value}) {
 const chosen=providerOf(provider);
 if(!chosen||intent!=='set'&&intent!=='remove'||intent==='set'&&value!==undefined&&typeof value!=='string') return refused('invalid');
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return refused('notAllowed');
 const target=await keyTarget(db,company);
 if(!target) return refused('noSpace');
 const profiles=[target.space,...target.agents.map(found=>found.profile)];
 const reached=[...profiles,...target.removed.map(found=>found.profile)];
 const before=await target.at.speech.read({profiles:reached,envs});
 if(before.state!=='found') return refused(before.state);
 const space=before.profiles[target.space];
 if(!space) return refused('unreachable');
 // With no key sent, the provider is chosen again with the key the space holds; a provider it holds none for is refused.
 const key=typeof value==='string'?value.trim():undefined;
 if(intent==='set'&&key===undefined&&!space.held.includes(chosen.env)) return refused('invalid');
 // Every profile a write did not finish is named in the answer, so the Owner sees which Agents to try again for.
 const failed=new Set();
 const note=(list,states)=>list.forEach((profile,at)=>{ if(states[at]!=='written') failed.add(profile); });
 if(intent==='set') {
  const states=await Promise.all(profiles.map(async profile=>{
   const own=before.profiles[profile];
   // With the held key, a profile that lacks it keeps the provider it has, never one it holds no key for; the read names
   // it as still waiting for the key.
   if(key===undefined&&own&&!own.held.includes(chosen.env)) return 'written';
   const config=speechConfig(chosen.id); const language=languageOn(chosen.id,own?.language);
   return target.at.speech.write({profile,env:key===undefined?null:chosen.env,...(key===undefined?{}:{value:key}),config:language?{stt:{...config.stt,language}}:config});
  }));
  if(states[0]!=='written') return refused(states[0]);
  note(profiles,states);
 } else {
  // Each profile is cleaned by what it holds itself, not by the space's provider, so a removal that stopped part way
  // is finished by the next one. A shared key stays (Groq's models'); a profile the Engine did not read counts as not done.
  const env=chosen.shared?null:chosen.env;
  const states=await Promise.all(reached.map(async profile=>{
   const own=before.profiles[profile];
   const using=!own||own.provider===chosen.id;
   if(!using&&!(env&&own.held.includes(env))) return 'written';
   const state=await target.at.speech.write({profile,env,config:using?noProvider:null});
   return own?state:'failed';
  }));
  if(states[0]!=='written') return refused(states[0]);
  note(reached,states);
 }
 const people=new Map([...target.agents,...target.removed].map(found=>[found.profile,named(found)]));
 return {status:200,body:{...await readCompanySpeech(db,{company}),failed:[...failed].map(profile=>people.get(profile)??{agent:null,name:null})}};
}

// The Company's speech options (#863, vault decision 0075) are Hermes's own `stt` options, read from the Company's shared
// space, which every save writes alongside each Agent's profile: the provider in use (one whose key the space holds),
// that provider's model, the language (blank is automatic; none saved is Hermes's own `en`), the vocabulary and the
// silence trim, each as Hermes reads an absent value. Null for all when the Engine or the space cannot be read.
// `languages` and `models` are the choices Hermes offers for that provider, in its order.
const unreadVoice=Object.freeze({provider:null,keys:null,language:null,model:null,prompt:null,trimSilence:null,languages:null,models:null});
/** @param {{provider:string|null,held:string[],stt:Record<string,any>}} space */
function voiceOf(space) {
 const keys=speechProviders.filter(provider=>space.held.includes(provider.env)).map(provider=>provider.id);
 const chosen=providerOf(space.provider);
 const provider=chosen&&keys.includes(chosen.id)?chosen.id:null;
 const stt=space.stt||{};
 const models=provider?speechModels[provider]:undefined;
 const section=provider&&stt[provider]&&typeof stt[provider]==='object'?stt[provider]:{};
 const saved=models?section[models.key]:undefined;
 return {provider,keys,
  language:typeof stt.language==='string'?stt.language:'en',
  model:models?typeof saved==='string'&&saved?saved:models.values[0]:null,
  prompt:typeof stt.prompt==='string'?stt.prompt:'',
  trimSilence:stt.cloud_trim_silence!==false,
  languages:speechLanguages(provider),models:models?[...models.values]:[]};
}
/** @param {any} db @param {{company:string}} request */
export async function readCompanyVoice(db,{company}) {
 const target=await keyTarget(db,company);
 if(!target) return {...unreadVoice};
 const read=await target.at.speech.read({profiles:[target.space],envs});
 const space=read.state==='found'?read.profiles[target.space]:null;
 return space?voiceOf(space):{...unreadVoice};
}

// An Owner changes one or more options; each save writes the same values to every profile of the Company, its shared
// space first and then its main Agent's and each Agent's, as keys are written, and a new Agent's profile is given the
// space's `stt` section when it is made (lib/engine/agents.mjs giveProviders). A model is the chosen provider's; a
// language one speechLanguages offers for it. The answer is a fresh read of the space with the Agents a write missed.
/** @param {any} db @param {{company:string,language?:unknown,model?:unknown,prompt?:unknown,trimSilence?:unknown}} request */
export async function changeCompanyVoice(db,{company,language,model,prompt,trimSilence}) {
 const given=[language,model,prompt].filter(value=>value!==undefined);
 if(given.some(value=>typeof value!=='string')||trimSilence!==undefined&&typeof trimSilence!=='boolean'||!given.length&&trimSilence===undefined) return refused('invalid');
 const vocabulary=typeof prompt==='string'?prompt.trim():undefined;
 if(vocabulary!==undefined&&vocabulary.length>promptLimit) return refused('invalid');
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return refused('notAllowed');
 const target=await keyTarget(db,company);
 if(!target) return refused('noSpace');
 const profiles=[target.space,...target.agents.map(found=>found.profile)];
 const before=await target.at.speech.read({profiles:[target.space],envs});
 if(before.state!=='found') return refused(before.state);
 const space=before.profiles[target.space];
 if(!space) return refused('unreachable');
 const {provider}=voiceOf(space);
 if(typeof language==='string'&&!speechLanguages(provider).includes(language)) return refused('invalid');
 const models=provider?speechModels[provider]:undefined;
 if(typeof model==='string'&&(!models||!models.values.includes(model))) return refused('invalid');
 const stt={...(typeof language==='string'?{language}:{}),...(vocabulary!==undefined?{prompt:vocabulary}:{}),
  ...(trimSilence!==undefined?{cloud_trim_silence:trimSilence}:{}),...(typeof model==='string'&&provider&&models?{[provider]:{[models.key]:model}}:{})};
 const states=await Promise.all(profiles.map(profile=>target.at.speech.write({profile,env:null,config:{stt}})));
 if(states[0]!=='written') return refused(states[0]);
 const people=new Map(target.agents.map(found=>[found.profile,named(found)]));
 const failed=profiles.filter((profile,at)=>states[at]!=='written').map(profile=>people.get(profile)??{agent:null,name:null});
 return {status:200,body:{...await readCompanyVoice(db,{company}),failed}};
}
