import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #160: voice dictation. One recording becomes text on the Engine's management listener, for the Agent's own profile
// (v0.23.0 hermes_cli/web_routers/audio.py 89-149). The recording goes in the request body only; the driver returns its
// words, and nothing of the recording is stored or logged.
const profile='ag-10000000000000000000000000000001';
const settings=fake=>{ fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{stt:{language:'ar-EG'}},credentials:{}}); };
const connection=(fake,key='test-only-key')=>({address:fake.address,managementAddress:fake.managementAddress,profile,key});
const dataUrl=`data:audio/webm;base64,${Buffer.from('the recording').toString('base64')}`;
const audio={dataUrl,mimeType:'audio/webm'};

test('the driver posts one recording to the Engine for the Agent\'s profile and returns its words',async()=>{
 const fake=await fakeHermes(); settings(fake);
 try {
  fake.settings.transcriptionTranscript='اكتب خطة الإطلاق الأسبوع الجاي';
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.transcribe(audio),{state:'transcribed',text:'اكتب خطة الإطلاق الأسبوع الجاي'});
  const sent=fake.settings.managementRequests.find(request=>request.path.startsWith('/api/audio/transcribe'));
  assert.deepEqual({method:sent.method,path:sent.path,authorization:sent.authorization},{method:'POST',path:`/api/audio/transcribe?profile=${profile}`,authorization:'Bearer test-only-key'});
  assert.deepEqual(sent.body,{data_url:dataUrl,mime_type:'audio/webm'});
  // The fake keeps only the recording's size and type for its assertions, never the recording itself.
  assert.deepEqual(fake.settings.transcriptions,[{profile,mimeType:'audio/webm',bytes:dataUrl.length-dataUrl.indexOf(',')-1}]);
 } finally { await fake.close(); }
});

test('an empty transcript is silence, not an error',async()=>{
 const fake=await fakeHermes(); settings(fake); fake.settings.transcriptionTranscript='';
 try {
  assert.deepEqual(await engineFor(connection(fake)).transcribe(audio),{state:'transcribed',text:''});
 } finally { await fake.close(); }
});

test('a refused key is refused, and a missing speech-to-text provider is unavailable',async()=>{
 const fake=await fakeHermes(); settings(fake);
 try {
  assert.deepEqual(await engineFor(connection(fake,'wrong-key')).transcribe(audio),{state:'refused'});
  fake.settings.transcriptionStatus=400;
  fake.settings.transcriptionDetail='No STT provider available. Configure stt.provider or install a local speech model.';
  assert.deepEqual(await engineFor(connection(fake)).transcribe(audio),{state:'unavailable'});
  fake.settings.transcriptionDetail='stt.enabled is off for this profile.';
  assert.deepEqual(await engineFor(connection(fake)).transcribe(audio),{state:'unavailable'});
  fake.settings.transcriptionStatus=500; fake.settings.transcriptionDetail='Internal Server Error';
  assert.deepEqual(await engineFor(connection(fake)).transcribe(audio),{state:'failed'});
 } finally { await fake.close(); }
});

test('an unreachable Engine is unreachable, and a body that is not an audio data URL is never sent',async()=>{
 const fake=await fakeHermes(); settings(fake); const engine=engineFor(connection(fake));
 try {
  for(const bad of [{dataUrl:'not-a-recording',mimeType:'audio/webm'},{dataUrl:'data:text/plain;base64,aGk=',mimeType:'text/plain'},{dataUrl:'',mimeType:'audio/webm'}])
   assert.deepEqual(await engine.transcribe(bad),{state:'refused'});
  assert.equal(fake.settings.transcriptions.length,0);
 } finally { await fake.close(); }
 assert.deepEqual(await engine.transcribe(audio),{state:'unreachable'});
});

test('the language the profile listens in is read from its config, and an empty one means detect',async()=>{
 const fake=await fakeHermes(); settings(fake);
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.dictation(),{state:'found',language:'ar-EG'});
  fake.settings.profiles.get(profile).config={stt:{language:''}};
  assert.deepEqual(await engine.dictation(),{state:'found',language:null});
  // No language set is the Engine's default, English.
  fake.settings.profiles.get(profile).config={};
  assert.deepEqual(await engine.dictation(),{state:'found',language:'en'});
 } finally { await fake.close(); }
});

test('the recording never reaches a log line',async()=>{
 const fake=await fakeHermes(); settings(fake);
 const written=[]; const originals=Object.fromEntries(['log','info','warn','error','debug'].map(name=>[name,console[name]]));
 for(const name of Object.keys(originals)) console[name]=(...args)=>{ written.push(args.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ')); };
 try { await engineFor(connection(fake)).transcribe(audio); }
 finally { for(const [name,write] of Object.entries(originals)) console[name]=write; await fake.close(); }
 const marker=Buffer.from('the recording').toString('base64');
 assert.deepEqual(written.filter(line=>line.includes(marker)||line.includes('the recording')).map(line=>line.slice(0,120)),[]);
});
