import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes, screenFrame } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #712: an Agent's Screen through the Engine contract, read over the management listener's /api/ws (display.status,
// display.start, display.thumbnail): its state, a start and a start refused with its reason, and one picture or a
// picture withheld while a person controls the Screen.
const connection=(fake,profile='writer')=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:'test-only-key'});
const profile={soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}};
async function engineWith(screens={}) {
 const fake=await fakeHermes();
 for(const name of ['writer','ads','seo']) fake.settings.profiles.set(name,profile);
 for(const [name,screen] of Object.entries(screens)) fake.settings.screens.set(name,screen);
 return fake;
}

test('a Screen reads asleep, awake, awake under a person\'s control, and none where the Engine offers none',async()=>{
 const fake=await engineWith({ads:{running:true},seo:{running:true,holder:'human'}});
 fake.settings.profiles.set('plain',profile); fake.settings.screens.set('plain',{supported:false});
 try {
  assert.deepEqual(await engineFor(connection(fake)).screen(),{state:'found',screen:{state:'asleep',control:'agent',refusal:null}});
  assert.deepEqual(await engineFor(connection(fake,'ads')).screen(),{state:'found',screen:{state:'awake',control:'agent',refusal:null}});
  assert.deepEqual(await engineFor(connection(fake,'seo')).screen(),{state:'found',screen:{state:'awake',control:'person',refusal:null}});
  assert.deepEqual(await engineFor(connection(fake,'plain')).screen(),{state:'found',screen:{state:'none',control:'agent',refusal:null}});
  // Every read named its own profile on /api/ws with the Engine's key, and went nowhere else.
  assert.deepEqual(fake.settings.screenCalls.map(call=>[call.method,call.params.profile,call.token]),[
   ['display.status','writer','test-only-key'],['display.status','ads','test-only-key'],['display.status','seo','test-only-key'],['display.status','plain','test-only-key']]);
 } finally { await fake.close(); }
});

test('a Screen whose sandbox lacks what it needs reads asleep with the reason a start would be refused',async()=>{
 const fake=await engineWith({writer:{missing:['Xvnc']}});
 try {
  assert.deepEqual(await engineFor(connection(fake)).screen(),{state:'found',screen:{state:'asleep',control:'agent',refusal:'missing'}});
 } finally { await fake.close(); }
});

test('a profile the Engine does not have, a refused key and an Engine that does not answer are told apart',async()=>{
 const fake=await engineWith();
 try {
  assert.deepEqual(await engineFor(connection(fake,'gone')).screen(),{state:'missing'});
  assert.deepEqual(await engineFor({...connection(fake),key:'wrong-key'}).screen(),{state:'unreachable'});
  assert.deepEqual(await engineFor({...connection(fake),managementAddress:'http://127.0.0.1:9'}).screen(),{state:'unreachable'});
  assert.deepEqual(await engineFor({...connection(fake),managementAddress:'http://example.com'}).screen(),{state:'unreachable'});
 } finally { await fake.close(); }
});

test('a start wakes the Screen, and a start the Engine refuses says why and leaves it asleep',async()=>{
 const fake=await engineWith({seo:{missing:['Xvnc']}});
 try {
  assert.deepEqual(await engineFor(connection(fake)).wakeScreen(),{state:'awake',screen:{state:'awake',control:'agent',refusal:null}});
  assert.equal(fake.settings.screens.get('writer')?.running,true);
  // The sandbox has one display: while the writer's Screen is awake another profile's start fails, as the pinned Engine's.
  assert.deepEqual(await engineFor(connection(fake,'ads')).wakeScreen(),{state:'notStarted',reason:'failed'});
  assert.deepEqual(await engineFor(connection(fake,'seo')).wakeScreen(),{state:'notStarted',reason:'missing'});
  assert.deepEqual(await engineFor(connection(fake,'ads')).screen(),{state:'found',screen:{state:'asleep',control:'agent',refusal:null}});
  assert.deepEqual(fake.settings.screenCalls.filter(call=>call.method==='display.start').map(call=>call.params.profile),['writer','ads','seo']);
 } finally { await fake.close(); }
});

test('a picture is the Engine\'s own grab each time, none while asleep, and withheld while a person controls the Screen',async()=>{
 const fake=await engineWith({ads:{running:true},seo:{running:true,holder:'human'}});
 try {
  const first=await engineFor(connection(fake,'ads')).screenPicture();
  const second=await engineFor(connection(fake,'ads')).screenPicture();
  assert.equal(first.state,'found'); assert.equal(second.state,'found');
  assert.equal(first.type,'image/jpeg');
  assert.deepEqual(Buffer.from(first.body),screenFrame(1)); assert.deepEqual(Buffer.from(second.body),screenFrame(2));
  assert.deepEqual(await engineFor(connection(fake)).screenPicture(),{state:'asleep'});
  assert.deepEqual(await engineFor(connection(fake,'seo')).screenPicture(),{state:'withheld'});
 } finally { await fake.close(); }
});

test('a picture that is not an image the Engine grabs is no picture',async()=>{
 const fake=await engineWith({ads:{running:true}});
 try {
  fake.settings.screenPictureUrl='data:text/html;base64,PGgxPmhpPC9oMT4=';
  assert.deepEqual(await engineFor(connection(fake,'ads')).screenPicture(),{state:'failed'});
 } finally { await fake.close(); }
});
