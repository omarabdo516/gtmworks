import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNoEngine } from './engine-records.mjs';
import { withDriver, engineServing } from './engine-records.mjs';
import { readConfig, readSavedConfig, writeConfig } from '../lib/engine/config.mjs';
import { readVoices, speakText } from '../lib/engine/speech.mjs';
import { readAgentVoice, changeAgentVoice, speakAgentSample, voiceSpeeds, voiceSample } from '../lib/agent-voice.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
// The driver calls a test answers its own way, by their names before #782, as the Engine handle names them.
const DRIVER={'config':'config.read','saved':'config.readSaved','schema':'config.schema','defaults':'config.defaults','write':'config.write','profileModels':'models.ofProfiles','options':'models.read','writeModel':'models.write','voices':'speech.voices','speak':'speech.speak','read':'skills.read','learned':'skills.learned'};

// #162: an Agent's voice is its own Engine profile's settings. The database says which profile is the Agent's and whether
// it is its own (an Agent still on the Company's shared profile changes the main Agent too, so it is refused), checks
// that the person is an active Owner or Manager who sees the Agent before the Engine is written, and writes one Company
// log row per save. The Engine's own words decide the choices and the defaults; a voice list exists only for ElevenLabs.
const company='10000000-0000-0000-0000-000000000001';
const [lead,helper]=['3b100000-0000-0000-0000-000000000011','3b100000-0000-0000-0000-000000000021'];
const rows=[
 {agent:lead,name:'Lead',connection:'f2000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:helper,name:'Helper',connection:'f2000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
];
// The database as the signed-in person reaches it: check_agent_setting answers the Role and visibility check (`refuse`
// names its refusal), and every log_agent_setting call is kept.
function sessions(fake,{refuse=null,agents=rows,target=true}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_engine_target') return {data:target?[{profile:companyProfile(args.c)}]:[],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_agent_setting') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_agent_setting') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 return {db,logged};
}
// The Engine's own defaults for the keys this page reads (hermes_cli/config_defaults.py 1061-1148): the fake merges them
// over what a profile saved, as get_config does.
const defaults={stt:{language:'en'},tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}};
const engine=async()=>{ const fake=await engineServing(company); fake.settings.configDefaults=defaults; return fake; };
const driverAt=fake=>{
 const at=target=>({...target,managementAddress:fake.managementAddress});
 return {config:target=>readConfig(at(target)),saved:target=>readSavedConfig(at(target)),write:(target,config)=>writeConfig(at(target),config),
  voices:target=>readVoices(at(target)),speak:(target,say)=>speakText(at(target),say)};
};
const profileOn=(fake,name,config={},meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{},...meta});
const writesTo=(fake,path)=>fake.settings.managementRequests.filter(request=>request.method==='PUT'&&request.path.startsWith(path));
const saved=fake=>fake.settings.profiles.get(companyProfile(company))?.config||{};

test('the voice is read from the Agent\'s own profile: its speed, provider and voice, never a listening language (#863)', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{stt:{language:'ar'},tts:{provider:'edge',edge:{voice:'ar-EG-SalmaNeural'},speed:1.25}});
  const {db}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentVoice(db,{company,agent:lead})),{state:'found',own:true,
   speed:1.25,provider:'edge',voice:'ar-EG-SalmaNeural',voiceName:'ar-EG-SalmaNeural',list:null});
  // A profile that saved nothing reads the Engine's own defaults, and a speed it never set reads as 1.
  profileOn(fake,companyProfile(company),{});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentVoice(db,{company,agent:lead})),{state:'found',own:true,
   speed:1,provider:'edge',voice:'en-US-AriaNeural',voiceName:'en-US-AriaNeural',list:null},'the Engine\'s defaults, and no list for a provider that has none');
  // An Agent sharing the Company profile is read with the same values and says the profile is not its own.
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  assert.equal((await withDriver(DRIVER,driverAt(fake),()=>readAgentVoice(db,{company,agent:helper}))).own,false);
 } finally { await fake.close(); }
});

test('ElevenLabs is the one provider with a list of voices, and the profile\'s own key decides whether it is offered', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'elevenlabs',elevenlabs:{voice_id:'21m00Tcm4TlvDq8ikWAM'}}},{env:{ELEVENLABS_API_KEY:'test-only-elevenlabs'}});
  const {db}=sessions(fake);
  const read=await withDriver(DRIVER,driverAt(fake),()=>readAgentVoice(db,{company,agent:lead}));
  assert.deepEqual([read.state,read.own,read.provider,read.voice,read.voiceName],[ 'found',true,'elevenlabs','21m00Tcm4TlvDq8ikWAM','Bella']);
  assert.deepEqual(read.list,{state:'found',available:true,voices:[{id:'pNInz6obpgDQGcFmaJgB',name:'Rachel',label:'Rachel'},{id:'21m00Tcm4TlvDq8ikWAM',name:'Bella',label:'Bella'}]});
  // No key on the profile: the Engine answers no list, and the page shows the saved voice with the unavailable state.
  fake.settings.profiles.get(companyProfile(company)).env={};
  const bare=await withDriver(DRIVER,driverAt(fake),()=>readAgentVoice(db,{company,agent:lead}));
  assert.deepEqual([bare.voiceName,bare.list],['21m00Tcm4TlvDq8ikWAM',{state:'found',available:false,voices:[]}]);
 } finally { await fake.close(); }
});

test('the Owner changes the speed, the Engine holds it, and the log gets one row; a language is not the Agent\'s to change (#863)', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{stt:{language:'en'},tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const {db,logged}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{language:'ar',speed:'0.85'}})),
   {state:'written',voice:{speed:0.85,voice:'en-US-AriaNeural'}});
  assert.deepEqual([saved(fake).stt?.language,saved(fake).tts?.speed],[ 'en',0.85],'the Company\'s language stays');
  assert.deepEqual(logged,[{c:company,agent:lead,field:'voice',old_value:null,new_value:null}],'one row names the section, never a value');
  assert.deepEqual(writesTo(fake,'/api/config').map(request=>Object.keys(request.body.config)),[['tts']],'only the speed is sent');
  // Saving the same values again is written and logs nothing new: the Engine already holds them.
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{speed:'0.85'}})),
   {state:'written',voice:{speed:0.85,voice:'en-US-AriaNeural'}});
  assert.equal(logged.length,1);
 } finally { await fake.close(); }
});

test('a voice is written only from the ElevenLabs list the profile offers; any other provider keeps its saved voice', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'elevenlabs',elevenlabs:{voice_id:'21m00Tcm4TlvDq8ikWAM'}}},{env:{ELEVENLABS_API_KEY:'test-only-elevenlabs'}});
  const {db,logged}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{voice:'pNInz6obpgDQGcFmaJgB'}})),
   {state:'written',voice:{speed:1,voice:'pNInz6obpgDQGcFmaJgB'}});
  assert.equal(saved(fake).tts.elevenlabs.voice_id,'pNInz6obpgDQGcFmaJgB');
  assert.equal(logged.length,1);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{voice:'not-a-voice'}})),{state:'invalid',voice:null});
  assert.equal(logged.length,1,'a refused choice writes and logs nothing');
  // The provider's key is gone, so there is no list to choose from: nothing is written.
  fake.settings.profiles.get(companyProfile(company)).env={};
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{voice:'pNInz6obpgDQGcFmaJgB'}})),{state:'noVoices',voice:null});
  // A provider without a list cannot take a voice from this page at all.
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{voice:'en-US-GuyNeural'}})),{state:'invalid',voice:null});
  assert.equal(saved(fake).tts.edge.voice,'en-US-AriaNeural');
 } finally { await fake.close(); }
});

test('a speed the Engine does not have, or a language alone, is refused before any write', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const {db,logged}=sessions(fake);
  for(const voice of [{language:'ar'},{speed:'2'},{speed:'1.1'},{speed:'fast'},{speed:0.85}])
   assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice})),{state:'invalid',voice:null},JSON.stringify(voice));
  assert.deepEqual(voiceSpeeds,[0.7,0.85,1,1.25,1.5]);
  assert.equal(writesTo(fake,'/api/config').length,0);
  assert.equal(logged.length,0);
 } finally { await fake.close(); }
});

test('an Agent on the Company profile, a person the database refuses and a bad request change nothing', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const shared=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(shared.db,{company,agent:helper,voice:{speed:'0.85'}})),{state:'notOwn',voice:null});
  assert.deepEqual(shared.logged,[],'nothing is logged for a change that did not happen');
  const refused=sessions(fake,{refuse:'agentSettingNotAllowed'});
  assert.deepEqual(await withDriver(DRIVER,{config:async()=>assert.fail('the Engine is not read'),write:async()=>assert.fail('the Engine is not written')},()=>changeAgentVoice(refused.db,{company,agent:lead,voice:{speed:'0.85'}})),
   {state:'notAllowed',voice:null});
  const noEngine=sessions(fake,{target:false});
  assert.deepEqual(await withNoEngine(company,()=>withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(noEngine.db,{company,agent:lead,voice:{speed:'0.85'}}))),{state:'noEngine',voice:null});
  for(const bad of [{company:'',agent:lead,voice:{speed:'0.85'}},{company,agent:'Lead',voice:{speed:'0.85'}},{company,agent:lead,voice:null},{company,agent:lead,voice:'0.85'},{company,agent:lead,voice:{}}])
   assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(refused.db,{...bad})),{state:'invalid',voice:null},JSON.stringify(bad));
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,0,'a refused change writes nothing');
 } finally { await fake.close(); }
});

test('an Engine that fails the write is that state, and nothing is logged', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const {db,logged}=sessions(fake);
  fake.settings.failStep='config';
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{speed:'0.85'}})),{state:'unreachable',voice:null});
  fake.settings.failStep='';
  fake.settings.managementStatus=401;
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentVoice(db,{company,agent:lead,voice:{speed:'0.85'}})),{state:'refused',voice:null});
  assert.deepEqual(logged,[]);
 } finally { await fake.close(); }
});

test('the sample is the Engine speaking the text: sound, a provider that cannot speak, and an Engine away', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const {db}=sessions(fake);
  const say={company,agent:lead,text:'Hi Sara, I finished the December campaign analysis.'};
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(db,{...say})),
   {state:'spoken',dataUrl:fake.settings.speakDataUrl,mimeType:'audio/mpeg',provider:'edge'});
  // The shipped image as proved on the pinned digest: no speech package, so the provider answers 400 with its words.
  fake.settings.speakRefusal='TTS chunk 1 failed (edge): No TTS provider available.';
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(db,{...say})),{state:'failed',dataUrl:null,mimeType:null,provider:null});
  fake.settings.speakRefusal='';
  fake.settings.managementStatus=401;
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(db,{...say})),{state:'refused',dataUrl:null,mimeType:null,provider:null});
  fake.settings.managementStatus=200;
  const away=driverAt(fake); away.speak=()=>speakText({address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2',profile:'co-one',key:'k'},{text:say.text});
  assert.deepEqual(await withDriver(DRIVER,away,()=>speakAgentSample(db,{...say})),{state:'unreachable',dataUrl:null,mimeType:null,provider:null});
 } finally { await fake.close(); }
});

test('a sample a person outside the allowed Roles asks for is refused, and no text means no request', async () => {
 const fake=await engine();
 try {
  profileOn(fake,companyProfile(company),{tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}});
  const say={company,agent:lead,text:'Hello.'};
  const refused=sessions(fake,{refuse:'agentSettingNotAllowed'});
  assert.equal((await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(refused.db,{...say}))).state,'notAllowed');
  const shared=sessions(fake);
  for(const text of ['','  ',7,'x'.repeat(601)])
   assert.equal((await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(shared.db,{...say,text}))).state,'invalid',JSON.stringify(text));
  assert.equal(fake.settings.managementRequests.filter(request=>request.path==='/api/audio/speak?profile='+companyProfile(company)).length,0,'text that is not there is never sent');
  // Speaking changes nothing, so an Agent on the shared profile may still hear the profile's own saved voice.
  assert.equal((await withDriver(DRIVER,driverAt(fake),()=>speakAgentSample(shared.db,{company,agent:helper,text:'Hello.'}))).state,'spoken');
  assert.equal(fake.settings.managementRequests.filter(request=>request.path==='/api/audio/speak?profile='+companyProfile(company)).length,1,'one request per sample asked for');
 } finally { await fake.close(); }
});

test('the sample is the server\'s own sentence: the reader\'s first name, in the reader\'s language', () => {
 assert.equal(voiceSample('en','Omar Hassan'),'Hi Omar, I finished the December campaign analysis and I have three new angles.');
 assert.equal(voiceSample('ar','Omar Hassan'),'أهلاً يا Omar، خلصت تحليل حملة ديسمبر وعندي تلات زوايا جديدة.');
 assert.equal(voiceSample('en','  Sara  '),'Hi Sara, I finished the December campaign analysis and I have three new angles.');
});
