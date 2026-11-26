import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDriver, engineServing } from './engine-records.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readSpeech, writeSpeech } from '../lib/engine/speech.mjs';
import { hermesEngine } from '../lib/engine/contract.mjs';
import { changeCompanySpeech, readCompanySpeech, changeCompanyVoice, readCompanyVoice, deepgramCommand, deepgramArabic } from '../lib/company-speech.mjs';
// The driver calls a test answers its own way, by their names before #782, as the Engine handle names them.
const DRIVER={'read':'speech.read','write':'speech.write'};

// #430: the Company's speech-to-text provider, written by gtmworks to every profile of the Company in its Engine.
const hex=n=>`10000000000000000000000000000${String(n).padStart(3,'0')}`;
const companyOf=n=>({space:`cs-${hex(n)}`,main:`co-${hex(n)}`,agents:[`ag-a${hex(n).slice(1)}`,`ag-b${hex(n).slice(1)}`]});
const [one,two]=[companyOf(1),companyOf(2)];
const company='10000000-0000-0000-0000-000000000001';
const agentId=profile=>`${profile.slice(3,11)}-${profile.slice(11,15)}-${profile.slice(15,19)}-${profile.slice(19,23)}-${profile.slice(23)}`;
const names={[one.main]:'Lead',[one.agents[0]]:'Writer',[one.agents[1]]:'Designer'};
const made=(fake,...profiles)=>{ for(const name of profiles) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}}); };
const madeCompany=(fake,found)=>made(fake,found.space,found.main,...found.agents);
const all=[one.space,one.main,...one.agents];
const profileOf=(fake,name)=>fake.settings.profiles.get(name);
const key='dg-0123456789abcdef0123456789abcdef';

// The person's own session: is_company_owner, the Company's Engine target and its profiles.
function sessions({owner,removed=[]}) {
 const asked=[];
 const rows=[{profile:one.space,kind:'space',agent:null,name:null},...[one.main,...one.agents].map(profile=>({profile,kind:profile.startsWith('co-')?'company':'agent',agent:agentId(profile),name:names[profile]})),
  ...removed.map(profile=>({profile,kind:'removed',agent:null,name:null}))];
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:one.main,profiles:[]}],error:null};
  if(name==='company_key_profiles') return {data:rows,error:null};
  return {data:null,error:{message:'unexpected'}}; }};
 return {db,asked};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
const pointedAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress});
 return {read:(target,asked)=>readSpeech(at(target),asked),write:(target,change)=>writeSpeech(at(target),change)}; };
const change=(person,fake,request)=>withDriver(DRIVER,pointedAt(fake),()=>changeCompanySpeech(person.db,{company,...request}));
const read=(person,fake)=>withDriver(DRIVER,pointedAt(fake),()=>readCompanySpeech(person.db,{company}));

const voice=(person,fake,request)=>withDriver(DRIVER,pointedAt(fake),()=>changeCompanyVoice(person.db,{company,...request}));
const readVoice=(person,fake)=>withDriver(DRIVER,pointedAt(fake),()=>readCompanyVoice(person.db,{company}));

// #863: the Owner sets Hermes's own speech-to-text options once, and every profile of the Company (its space, its main
// Agent and each Agent) holds them; no other Company's profile is touched.
test('an Owner sets the language once: Automatic is a blank stt.language on every profile, Arabic is ar', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  const owner=sessions({owner:true});
  await change(owner,fake,{provider:'openai',intent:'set',value:key});
  const automatic=await voice(owner,fake,{language:''});
  assert.equal(automatic.status,200);
  assert.deepEqual(automatic.body,{provider:'openai',keys:['openai'],language:'',model:'whisper-1',prompt:'',trimSilence:true,
   languages:['','ar','en'],models:['whisper-1','gpt-4o-mini-transcribe','gpt-4o-transcribe','gpt-transcribe'],failed:[]});
  for(const name of all) assert.equal(profileOf(fake,name).config.stt.language,'',name);
  const arabic=await voice(owner,fake,{language:'ar'});
  assert.equal(arabic.body.language,'ar');
  for(const name of all) assert.equal(profileOf(fake,name).config.stt.language,'ar',name);
  for(const name of [two.space,two.main,...two.agents]) assert.equal(profileOf(fake,name).config.stt,undefined,`${name} of another Company`);
 } finally { await fake.close(); }
});

test('the model, the vocabulary and the silence trim reach every profile of the Company and no other Company\'s', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  const owner=sessions({owner:true});
  await change(owner,fake,{provider:'groq',intent:'set',value:key});
  const set=await voice(owner,fake,{model:'whisper-large-v3',prompt:'  gtmworks, Hermes, Omar  ',trimSilence:false});
  assert.deepEqual(set.body,{provider:'groq',keys:['groq'],language:'en',model:'whisper-large-v3',prompt:'gtmworks, Hermes, Omar',trimSilence:false,
   languages:['','ar','en'],models:['whisper-large-v3-turbo','whisper-large-v3'],failed:[]});
  for(const name of all) {
   const {stt}=profileOf(fake,name).config;
   assert.deepEqual([stt.provider,stt.groq,stt.prompt,stt.cloud_trim_silence],['groq',{model:'whisper-large-v3'},'gtmworks, Hermes, Omar',false],name);
  }
  for(const name of [two.space,two.main,...two.agents]) assert.equal(profileOf(fake,name).config.stt,undefined,`${name} of another Company`);
  // ElevenLabs names its model model_id; a switch keeps every option the Company set.
  await change(owner,fake,{provider:'elevenlabs',intent:'set',value:key});
  const eleven=await voice(owner,fake,{model:'scribe_v1'});
  assert.deepEqual([eleven.body.model,eleven.body.prompt,eleven.body.trimSilence],['scribe_v1','gtmworks, Hermes, Omar',false]);
  for(const name of all) assert.deepEqual(profileOf(fake,name).config.stt.elevenlabs,{model_id:'scribe_v1'},name);
  // A language ElevenLabs keeps of its own would win over the Company's: a language save leaves it blank.
  profileOf(fake,one.agents[0]).config.stt.elevenlabs.language_code='eng';
  await voice(owner,fake,{language:'ar'});
  for(const name of all) assert.deepEqual([profileOf(fake,name).config.stt.language,profileOf(fake,name).config.stt.elevenlabs.language_code],['ar',''],name);
  assert.deepEqual(await readVoice(owner,fake),{provider:'elevenlabs',keys:['elevenlabs','groq'],language:'ar',model:'scribe_v1',prompt:'gtmworks, Hermes, Omar',trimSilence:false,
   languages:['','ar','en'],models:['scribe_v2','scribe_v1']});
 } finally { await fake.close(); }
});

test('a choice Hermes does not offer for the provider, a non-Owner and an unread space change nothing', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  const owner=sessions({owner:true});
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  const before=JSON.stringify(all.map(name=>profileOf(fake,name).config));
  // Deepgram has no automatic and no Hermes model; its Arabic variants stay.
  for(const request of [{language:''},{language:'fr'},{model:'whisper-1'},{trimSilence:'no'},{},{language:7}])
   assert.deepEqual(await voice(owner,fake,request),{status:400,body:{error:'speechInvalid'}},JSON.stringify(request));
  assert.deepEqual(await voice(sessions({owner:false}),fake,{language:'ar'}),{status:403,body:{error:'speechNotAllowed'}});
  assert.equal(JSON.stringify(all.map(name=>profileOf(fake,name).config)),before);
  const variant=await voice(owner,fake,{language:'ar-SA'});
  assert.deepEqual([variant.body.language,variant.body.model,variant.body.models,variant.body.languages],['ar-SA',null,[],['ar',...deepgramArabic,'en']]);
  // An Agent the Engine did not take the write for is named.
  fake.settings.configWriteFail.add(one.agents[1]);
  assert.deepEqual((await voice(owner,fake,{language:'en'})).body.failed,[{agent:agentId(one.agents[1]),name:'Designer'}]);
 } finally { await fake.close(); }
});

test('an Agent made after the save is given the Company\'s speech: its key and every option', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  const owner=sessions({owner:true});
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  await voice(owner,fake,{language:'ar-SA',prompt:'gtmworks',trimSilence:false});
  const later=`ag-c${hex(1).slice(1)}`;
  made(fake,later);
  const engine=hermesEngine({address:fake.address,managementAddress:fake.managementAddress,profile:one.main,key:'test-only-key'});
  await engine.giveProviders({name:later,space:one.space,keeper:one.main});
  const profile=profileOf(fake,later);
  assert.equal(profile.env.DEEPGRAM_API_KEY,key);
  assert.deepEqual(profile.config.stt,profileOf(fake,one.space).config.stt);
  assert.deepEqual([profile.config.stt.provider,profile.config.stt.language,profile.config.stt.prompt,profile.config.stt.cloud_trim_silence],['deepgram','ar-SA','gtmworks',false]);
 } finally { await fake.close(); }
});

test('an Owner sets Deepgram with a key: every profile holds the key and transcribes through the Engine\'s command provider, Arabic as Egyptian', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  const owner=sessions({owner:true});
  const set=await change(owner,fake,{provider:'deepgram',intent:'set',value:` ${key} `});
  assert.deepEqual(set,{status:200,body:{provider:'deepgram',keys:['deepgram'],missing:[],failed:[]}});
  for(const name of all) {
   const profile=profileOf(fake,name);
   assert.equal(profile.env.DEEPGRAM_API_KEY,key,name);
   assert.equal(profile.config.stt.provider,'deepgram');
   assert.deepEqual(profile.config.stt.providers.deepgram,{type:'command',command:deepgramCommand,normalize:true,env_passthrough:['DEEPGRAM_API_KEY']});
   assert.ok(!JSON.stringify(profile.config).includes(key),'the key is in the profile\'s .env only, never its config');
  }
  for(const name of [two.space,two.main,...two.agents]) assert.deepEqual(profileOf(fake,name).env??{},{},`${name} of another Company holds no key`);
  // The command fills the Engine's own placeholders, sends Nova-3 the language with Arabic as Egyptian, and reads the
  // key from the variable the Engine passes through.
  for(const part of ['{input_path}','{language}','[ "$lang" = ar ] && lang=ar-EG','model=nova-3','language=$lang','$DEEPGRAM_API_KEY','curl ','/opt/hermes/.venv/bin/python'])
   assert.ok(deepgramCommand.includes(part),part);
  assert.deepEqual(await read(owner,fake),{provider:'deepgram',keys:['deepgram'],missing:[]});
  assert.ok(!JSON.stringify(fake.settings.managementRequests.filter(request=>request.method==='GET')).includes(key));
 } finally { await fake.close(); }
});

for(const [provider,env] of [['elevenlabs','ELEVENLABS_API_KEY'],['openai','VOICE_TOOLS_OPENAI_KEY'],['groq','GROQ_API_KEY']]) {
 test(`an Owner sets ${provider}: every profile holds ${env} and the Engine's own ${provider} provider`, async () => {
  const fake=await engineServing(company);
  try {
   madeCompany(fake,one);
   const owner=sessions({owner:true});
   assert.deepEqual(await change(owner,fake,{provider,intent:'set',value:key}),{status:200,body:{provider,keys:[provider],missing:[],failed:[]}});
   for(const name of all) {
    assert.equal(profileOf(fake,name).env[env],key,name);
    assert.deepEqual(profileOf(fake,name).config.stt,{provider},name);
   }
  } finally { await fake.close(); }
 });
}

test('a switch keeps every other provider\'s key where the Engine keeps it, a held key is chosen again with no new one, and an Arabic variant only Deepgram has goes back to Arabic', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  const owner=sessions({owner:true});
  profileOf(fake,one.main).config={stt:{language:''}};
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  assert.equal(profileOf(fake,one.main).config.stt.language,'en','"detect" is English on Deepgram, as the Engine sends it');
  profileOf(fake,one.agents[0]).config.stt.language=deepgramArabic[1];
  profileOf(fake,one.agents[1]).config.stt.language='en';
  const openai='sk-voice-0123456789abcdef';
  assert.deepEqual(await change(owner,fake,{provider:'openai',intent:'set',value:openai}),{status:200,body:{provider:'openai',keys:['deepgram','openai'],missing:[],failed:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,key,name);
   assert.equal(profileOf(fake,name).env.VOICE_TOOLS_OPENAI_KEY,openai,name);
   assert.equal(profileOf(fake,name).config.stt.provider,'openai',name);
  }
  assert.equal(profileOf(fake,one.agents[0]).config.stt.language,'ar');
  assert.equal(profileOf(fake,one.agents[1]).config.stt.language,'en','a language every provider has is kept');
  // Deepgram again, with no key: its held key is used and the OpenAI key stays.
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'set'}),{status:200,body:{provider:'deepgram',keys:['deepgram','openai'],missing:[],failed:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).config.stt.provider,'deepgram',name);
   assert.deepEqual(profileOf(fake,name).config.stt.providers.deepgram.env_passthrough,['DEEPGRAM_API_KEY']);
   assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,key,name);
   assert.equal(profileOf(fake,name).env.VOICE_TOOLS_OPENAI_KEY,openai,name);
  }
  // A profile that lacks the held key keeps the provider it transcribes with, and is named as waiting for the key.
  delete profileOf(fake,one.agents[1]).env.VOICE_TOOLS_OPENAI_KEY;
  assert.deepEqual(await change(owner,fake,{provider:'openai',intent:'set'}),{status:200,body:{provider:'openai',keys:['deepgram','openai'],missing:[{agent:agentId(one.agents[1]),name:'Designer'}],failed:[]}});
  assert.equal(profileOf(fake,one.agents[1]).config.stt.provider,'deepgram','it is not moved onto a key it lacks');
  assert.equal(profileOf(fake,one.agents[0]).config.stt.provider,'openai');
  await change(owner,fake,{provider:'deepgram',intent:'set'});
  // A provider with no key held cannot be chosen without one, and nothing is written.
  const writes=fake.settings.managementRequests.filter(request=>request.method!=='GET').length;
  assert.deepEqual(await change(owner,fake,{provider:'elevenlabs',intent:'set'}),{status:400,body:{error:'speechInvalid'}});
  assert.equal(fake.settings.managementRequests.filter(request=>request.method!=='GET').length,writes);
  assert.deepEqual(await read(owner,fake),{provider:'deepgram',keys:['deepgram','openai'],missing:[]});
 } finally { await fake.close(); }
});

test('removing a provider takes only its key; leaving the one in use turns the provider off, and Groq\'s model key stays', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  const owner=sessions({owner:true});
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  await change(owner,fake,{provider:'openai',intent:'set',value:key});
  // Removing a provider not in use takes its key and leaves the one in use as it is.
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'remove'}),{status:200,body:{provider:'openai',keys:['openai'],missing:[],failed:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,undefined,name);
   assert.equal(profileOf(fake,name).env.VOICE_TOOLS_OPENAI_KEY,key,name);
   assert.equal(profileOf(fake,name).config.stt.provider,'openai',name);
  }
  await change(owner,fake,{provider:'groq',intent:'set',value:key});
  assert.deepEqual(await change(owner,fake,{provider:'openai',intent:'remove'}),{status:200,body:{provider:'groq',keys:['groq'],missing:[],failed:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.VOICE_TOOLS_OPENAI_KEY,undefined,name);
   assert.equal(profileOf(fake,name).env.GROQ_API_KEY,key,name);
  }
  assert.deepEqual(await change(owner,fake,{provider:'groq',intent:'remove'}),{status:200,body:{provider:null,keys:['groq'],missing:[],failed:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.GROQ_API_KEY,key,'leaving Groq turns the provider off and keeps the models\' key');
   assert.equal(profileOf(fake,name).config.stt.provider,'none');
  }
 } finally { await fake.close(); }
});

test('a removal takes the key from every profile, the removed Agents\' too, and leaves no provider; an Agent the set missed is named', async () => {
 const fake=await engineServing(company);
 try {
  const gone=`ag-c${hex(1).slice(1)}`;
  madeCompany(fake,one); made(fake,gone);
  const owner=sessions({owner:true,removed:[gone]});
  fake.settings.envFail.add(one.agents[1]);
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'set',value:key}),{status:200,body:{provider:'deepgram',keys:['deepgram'],missing:[{agent:agentId(one.agents[1]),name:'Designer'}],failed:[{agent:agentId(one.agents[1]),name:'Designer'}]}});
  fake.settings.envFail.clear();
  profileOf(fake,gone).env={DEEPGRAM_API_KEY:key};
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'remove'}),{status:200,body:{provider:null,keys:[],missing:[],failed:[]}});
  for(const name of [...all,gone]) {
   assert.equal(profileOf(fake,name).env?.DEEPGRAM_API_KEY,undefined,name);
   assert.ok([undefined,'none'].includes(profileOf(fake,name).config.stt?.provider),'no provider; one that never held any is left alone');
  }
  assert.equal(profileOf(fake,one.main).config.stt.provider,'none');
  assert.deepEqual(await read(owner,fake),{provider:null,keys:[],missing:[]});
  // A removal that stops part way names the profile it missed, and the next removal finishes it from what that profile
  // holds, though the space already holds no provider.
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  fake.settings.configWriteFail.add(one.agents[0]);
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'remove'}),{status:200,body:{provider:null,keys:[],missing:[],failed:[{agent:agentId(one.agents[0]),name:'Writer'}]}});
  assert.equal(profileOf(fake,one.agents[0]).env.DEEPGRAM_API_KEY,key,'the key stays where the config could not be written');
  fake.settings.configWriteFail.clear();
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'remove'}),{status:200,body:{provider:null,keys:[],missing:[],failed:[]}});
  assert.equal(profileOf(fake,one.agents[0]).env.DEEPGRAM_API_KEY,undefined);
  assert.equal(profileOf(fake,one.agents[0]).config.stt.provider,'none');
 } finally { await fake.close(); }
});

test('only an Owner changes it, a provider outside the list or a bad key is refused, and none of it reaches the Engine', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  assert.deepEqual(await change(sessions({owner:false}),fake,{provider:'deepgram',intent:'set',value:key}),{status:403,body:{error:'speechNotAllowed'}});
  const owner=sessions({owner:true});
  for(const request of [{provider:'mistral',intent:'set',value:key},{provider:'deepgram',intent:'set'},{provider:'deepgram',intent:'replace',value:key},{intent:'remove'},{provider:'mistral',intent:'remove'}])
   assert.deepEqual(await change(owner,fake,request),{status:400,body:{error:'speechInvalid'}},JSON.stringify(request));
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method!=='GET'),[]);
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'set',value:'short'}),{status:400,body:{error:'speechInvalid'}});
  for(const name of all) assert.deepEqual(profileOf(fake,name).env??{},{},name);
 } finally { await fake.close(); }
});

// The route, with its permission check and its database session replaced and the real module behind
// it against the fake Engine (as agent-memory.test.mjs runs its routes).
const require=createRequire(import.meta.url);
async function loadRoute(fake,owner=true) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync('app/api/speech-provider/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext,esModuleInterop:true}});
 const person=sessions({owner});
 const imports={
  '@/lib/supabase':{supabase:async()=>({...person.db,auth:{getUser:async()=>({data:{user:{id:'9a000000-0000-0000-0000-000000000001'}}})}})},
  '@/lib/app-origin.mjs':await import('../lib/app-origin.mjs'),
  '@/lib/route-permissions.mjs':{routeAllowed:async()=>true},
  '@/lib/company-speech.mjs':{readCompanySpeech:(db,request)=>withDriver(DRIVER,pointedAt(fake),()=>readCompanySpeech(db,{...request})),
   changeCompanySpeech:(db,request)=>withDriver(DRIVER,pointedAt(fake),()=>changeCompanySpeech(db,{...request}))},
 };
 runInNewContext(outputText,{exports,require:name=>imports[name]??require(name),URL,URLSearchParams,Error,Response,Request,Headers,process});
 return exports;
}
const {NextRequest}=require('next/server');
const post=(route,body)=>route.POST(new NextRequest('http://app.test/api/speech-provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));

test('the route never answers the key back, and the key is removable', async () => {
 const fake=await engineServing(company);
 try {
  madeCompany(fake,one);
  const route=await loadRoute(fake);
  const set=await post(route,{company,provider:'deepgram',intent:'set',value:key});
  assert.equal(set.status,200);
  const setText=await set.text();
  // `savedAt` is the server's time the save finished, which the page holds the provider until (#663).
  const {savedAt,...setBody}=JSON.parse(setText);
  assert.deepEqual(setBody,{provider:'deepgram',keys:['deepgram'],missing:[],failed:[]});
  assert.equal(typeof savedAt,'number');
  const got=await route.GET(new NextRequest(`http://app.test/api/speech-provider?company=${company}`));
  const gotText=await got.text();
  assert.deepEqual(JSON.parse(gotText),{provider:'deepgram',keys:['deepgram'],missing:[]});
  for(const text of [setText,gotText]) for(const secret of [key,key.slice(0,4),key.slice(-4),'DEEPGRAM_API_KEY']) assert.ok(!text.includes(secret),secret);
  assert.equal(set.headers.get('cache-control'),'no-store');
  const removed=await post(route,{company,provider:'deepgram',intent:'remove'});
  assert.equal(removed.status,200);
  const {savedAt:removedAt,...removedBody}=await removed.json();
  assert.deepEqual(removedBody,{provider:null,keys:[],missing:[],failed:[]});
  assert.ok(removedAt>=savedAt);
  for(const name of all) assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,undefined,name);
  const member=await loadRoute(fake,false);
  assert.equal((await post(member,{company,provider:'deepgram',intent:'set',value:key})).status,403);
 } finally { await fake.close(); }
});
