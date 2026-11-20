import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readSpeech, writeSpeech } from '../lib/hermes.mjs';
import { changeCompanySpeech, readCompanySpeech, deepgramCommand, deepgramArabic } from '../lib/company-speech.mjs';
import { fakeHermes } from './fake-hermes.mjs';

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
const hermesOf=fake=>({address:fake.address,key:'test-only-key'});
const change=(person,fake,request)=>changeCompanySpeech(person.db,{company,driver:pointedAt(fake),hermes:hermesOf(fake),...request});
const read=(person,fake)=>readCompanySpeech(person.db,{company,driver:pointedAt(fake),hermes:hermesOf(fake)});

test('an Owner sets Deepgram with a key: every profile holds the key and transcribes through the Engine\'s command provider, Arabic as Egyptian', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  const owner=sessions({owner:true});
  const set=await change(owner,fake,{provider:'deepgram',intent:'set',value:` ${key} `});
  assert.deepEqual(set,{status:200,body:{provider:'deepgram',missing:[]}});
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
  assert.deepEqual(await read(owner,fake),{provider:'deepgram',missing:[]});
  assert.ok(!JSON.stringify(fake.settings.managementRequests.filter(request=>request.method==='GET')).includes(key));
 } finally { await fake.close(); }
});

for(const [provider,env] of [['elevenlabs','ELEVENLABS_API_KEY'],['openai','VOICE_TOOLS_OPENAI_KEY'],['groq','GROQ_API_KEY']]) {
 test(`an Owner sets ${provider}: every profile holds ${env} and the Engine's own ${provider} provider`, async () => {
  const fake=await fakeHermes();
  try {
   madeCompany(fake,one);
   const owner=sessions({owner:true});
   assert.deepEqual(await change(owner,fake,{provider,intent:'set',value:key}),{status:200,body:{provider,missing:[]}});
   for(const name of all) {
    assert.equal(profileOf(fake,name).env[env],key,name);
    assert.deepEqual(profileOf(fake,name).config.stt,{provider},name);
   }
  } finally { await fake.close(); }
 });
}

test('a switch takes the previous key away, except Groq\'s model key, and an Arabic variant only Deepgram has goes back to Arabic', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  const owner=sessions({owner:true});
  profileOf(fake,one.main).config={stt:{language:''}};
  await change(owner,fake,{provider:'deepgram',intent:'set',value:key});
  assert.equal(profileOf(fake,one.main).config.stt.language,'en','"detect" is English on Deepgram, as the Engine sends it');
  profileOf(fake,one.agents[0]).config.stt.language=deepgramArabic[1];
  profileOf(fake,one.agents[1]).config.stt.language='en';
  await change(owner,fake,{provider:'openai',intent:'set',value:key});
  for(const name of all) assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,undefined,name);
  assert.equal(profileOf(fake,one.agents[0]).config.stt.language,'ar');
  assert.equal(profileOf(fake,one.agents[1]).config.stt.language,'en','a language every provider has is kept');
  await change(owner,fake,{provider:'groq',intent:'set',value:key});
  await change(owner,fake,{provider:'elevenlabs',intent:'set',value:key});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.VOICE_TOOLS_OPENAI_KEY,undefined,name);
   assert.equal(profileOf(fake,name).env.GROQ_API_KEY,key,'Groq\'s key is also its models\' key, so a switch leaves it');
  }
  await change(owner,fake,{provider:'groq',intent:'set',value:key});
  assert.deepEqual(await change(owner,fake,{intent:'remove'}),{status:200,body:{provider:null,missing:[]}});
  for(const name of all) {
   assert.equal(profileOf(fake,name).env.GROQ_API_KEY,key,'leaving Groq turns the provider off and keeps the models\' key');
   assert.equal(profileOf(fake,name).config.stt.provider,'none');
  }
 } finally { await fake.close(); }
});

test('a removal takes the key from every profile, the removed Agents\' too, and leaves no provider; an Agent the set missed is named', async () => {
 const fake=await fakeHermes();
 try {
  const gone=`ag-c${hex(1).slice(1)}`;
  madeCompany(fake,one); made(fake,gone);
  const owner=sessions({owner:true,removed:[gone]});
  fake.settings.envFail.add(one.agents[1]);
  assert.deepEqual(await change(owner,fake,{provider:'deepgram',intent:'set',value:key}),{status:200,body:{provider:'deepgram',missing:[{agent:agentId(one.agents[1]),name:'Designer'}]}});
  fake.settings.envFail.clear();
  profileOf(fake,gone).env={DEEPGRAM_API_KEY:key};
  assert.deepEqual(await change(owner,fake,{intent:'remove'}),{status:200,body:{provider:null,missing:[]}});
  for(const name of [...all,gone]) {
   assert.equal(profileOf(fake,name).env?.DEEPGRAM_API_KEY,undefined,name);
   assert.equal(profileOf(fake,name).config.stt.provider,'none',name);
  }
  assert.deepEqual(await read(owner,fake),{provider:null,missing:[]});
 } finally { await fake.close(); }
});

test('only an Owner changes it, a provider outside the list or a bad key is refused, and none of it reaches the Engine', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  assert.deepEqual(await change(sessions({owner:false}),fake,{provider:'deepgram',intent:'set',value:key}),{status:403,body:{error:'speechNotAllowed'}});
  const owner=sessions({owner:true});
  for(const request of [{provider:'mistral',intent:'set',value:key},{provider:'deepgram',intent:'set'},{provider:'deepgram',intent:'replace',value:key}])
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
  '@/lib/company-speech.mjs':{readCompanySpeech:(db,request)=>readCompanySpeech(db,{...request,driver:pointedAt(fake),hermes:hermesOf(fake)}),
   changeCompanySpeech:(db,request)=>changeCompanySpeech(db,{...request,driver:pointedAt(fake),hermes:hermesOf(fake)})},
 };
 runInNewContext(outputText,{exports,require:name=>imports[name]??require(name),URL,URLSearchParams,Error,Response,Request,Headers,process});
 return exports;
}
const {NextRequest}=require('next/server');
const post=(route,body)=>route.POST(new NextRequest('http://app.test/api/speech-provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));

test('the route never answers the key back, and the key is removable', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  const route=await loadRoute(fake);
  const set=await post(route,{company,provider:'deepgram',intent:'set',value:key});
  assert.equal(set.status,200);
  const setText=await set.text();
  assert.deepEqual(JSON.parse(setText),{provider:'deepgram',missing:[]});
  const got=await route.GET(new NextRequest(`http://app.test/api/speech-provider?company=${company}`));
  const gotText=await got.text();
  assert.deepEqual(JSON.parse(gotText),{provider:'deepgram',missing:[]});
  for(const text of [setText,gotText]) for(const secret of [key,key.slice(0,4),key.slice(-4),'DEEPGRAM_API_KEY']) assert.ok(!text.includes(secret),secret);
  assert.equal(set.headers.get('cache-control'),'no-store');
  const removed=await post(route,{company,intent:'remove'});
  assert.equal(removed.status,200);
  assert.deepEqual(await removed.json(),{provider:null,missing:[]});
  for(const name of all) assert.equal(profileOf(fake,name).env.DEEPGRAM_API_KEY,undefined,name);
  const member=await loadRoute(fake,false);
  assert.equal((await post(member,{company,provider:'deepgram',intent:'set',value:key})).status,403);
 } finally { await fake.close(); }
});
