import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { readVoices, speakText, speakLimit } from '../lib/hermes.mjs';

// #162: an Agent's voice is its own Engine profile's settings, and the sample it hears is the Engine speaking with them.
// The list of voices exists only for ElevenLabs (v0.23.0 hermes_cli/web_routers/audio.py 223-295); the sound is
// POST /api/audio/speak?profile= with the text alone (298-352) and comes back base64 in the answer, capped at 4 MB here.
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'co-one',key:fake.settings.key});
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},...meta});

test('the ElevenLabs voices are listed for the profile, and a profile without its key says the list is not available', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one',{env:{ELEVENLABS_API_KEY:'test-only-elevenlabs'}});
  assert.deepEqual(await readVoices(connection(fake)),{state:'found',available:true,voices:[
   {id:'pNInz6obpgDQGcFmaJgB',name:'Rachel',label:'Rachel'},{id:'21m00Tcm4TlvDq8ikWAM',name:'Bella',label:'Bella'}]});
  assert.equal(fake.settings.managementRequests.at(-1).path,'/api/audio/elevenlabs/voices?profile=co-one');
  profileOn(fake,'co-plain');
  assert.deepEqual(await readVoices({...connection(fake),profile:'co-plain'}),{state:'found',available:false,voices:[]});
  // The Engine's own words for a refused key are kept, never turned into a list gtmworks made up.
  fake.settings.elevenLabsVoices={available:false,voices:[],error:'unauthorized'};
  assert.deepEqual(await readVoices(connection(fake)),{state:'found',available:false,voices:[],error:'unauthorized'});
  fake.settings.managementStatus=403;
  assert.deepEqual(await readVoices(connection(fake)),{state:'refused',available:false,voices:[]});
  fake.settings.managementStatus=500;
  assert.deepEqual(await readVoices(connection(fake)),{state:'unreachable',available:false,voices:[]},'as every read in the driver: refused for a refused key, unreachable for anything else');
  assert.deepEqual(await readVoices({...connection(fake),key:'wrong'}),{state:'refused',available:false,voices:[]});
  assert.deepEqual(await readVoices({address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2',profile:'co-one',key:'k'}),{state:'unreachable',available:false,voices:[]});
  assert.deepEqual(await readVoices(connection(fake)).then(()=>readVoices({...connection(fake),profile:'Not A Profile'})),{state:'failed',available:false,voices:[]});
 } finally { await fake.close(); }
});

test('a spoken sample is the Engine\'s own sound, with the profile\'s saved voice and speed, as a data URL', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one',{config:{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'},speed:1.25}}});
  const spoken=await speakText(connection(fake),{text:'Hi Sara, I finished the December campaign analysis.'});
  assert.deepEqual(spoken,{state:'spoken',dataUrl:fake.settings.speakDataUrl,mimeType:'audio/mpeg',provider:'edge'});
  const request=fake.settings.managementRequests.at(-1);
  assert.equal(request.method,'POST');
  assert.equal(request.path,'/api/audio/speak?profile=co-one');
  assert.deepEqual(request.body,{text:'Hi Sara, I finished the December campaign analysis.'},'the Engine takes the text alone: the voice and speed are the saved ones');
 } finally { await fake.close(); }
});

test('a provider that cannot speak is the Engine\'s refusal, a refused key is refused, and an Engine away is unreachable', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one');
  // What the shipped image answers with no speech package installed, as proved on the pinned digest.
  fake.settings.speakRefusal='TTS chunk 1 failed (edge): No TTS provider available.';
  assert.deepEqual(await speakText(connection(fake),{text:'Hello.'}),{state:'failed',dataUrl:null,mimeType:null,provider:null});
  fake.settings.speakRefusal='';
  assert.deepEqual(await speakText({...connection(fake),key:'wrong'},{text:'Hello.'}),{state:'refused',dataUrl:null,mimeType:null,provider:null});
  assert.deepEqual(await speakText({address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2',profile:'co-one',key:'k'},{text:'Hello.'}),
   {state:'unreachable',dataUrl:null,mimeType:null,provider:null});
  fake.settings.managementStatus=500;
  assert.deepEqual(await speakText(connection(fake),{text:'Hello.'}),{state:'failed',dataUrl:null,mimeType:null,provider:null});
 } finally { await fake.close(); }
});

test('a sound past the reading cap is too large, and no text is not sent at all', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one');
  fake.settings.speakLarge=true;
  assert.deepEqual(await speakText(connection(fake),{text:'Hello.'}),{state:'tooLarge',dataUrl:null,mimeType:null,provider:null});
  const sent=fake.settings.managementRequests.filter(request=>request.path==='/api/audio/speak?profile=co-one').length;
  for(const text of ['','   ',null,7,'x'.repeat(speakLimit+1)])
   assert.deepEqual(await speakText(connection(fake),{text}),{state:'failed',dataUrl:null,mimeType:null,provider:null},JSON.stringify(text));
  assert.equal(fake.settings.managementRequests.filter(request=>request.path==='/api/audio/speak?profile=co-one').length,sent,'nothing is sent for text the Engine would refuse');
 } finally { await fake.close(); }
});
