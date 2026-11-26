import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes, screenFrame } from './fake-hermes.mjs';
import { hermesEngine as engineFor } from '../lib/engine/contract.mjs';

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

// #713: control of a Screen for one named viewer, and its live stream. A viewer is one connection to the management
// listener: display.observe names it and hands it a single-use ticket for /api/display/ws, and the lease names it while
// it holds control.
const rfbVersion=socket=>new Promise((resolve,reject)=>{
 socket.addEventListener('message',event=>resolve(Buffer.from(event.data).toString()),{once:true});
 socket.addEventListener('close',event=>reject(new Error(`closed ${event.code}`)),{once:true});
});
const closed=socket=>new Promise(resolve=>socket.addEventListener('close',event=>resolve(event.code),{once:true}));
const pointer=(x,y)=>{ const message=Buffer.alloc(6); message[0]=5; message[1]=1; message.writeUInt16BE(x,2); message.writeUInt16BE(y,4); return message; };
// The RFB handshake as a viewer answers it, up to the server's init, so the stream takes keyboard and pointer messages.
async function shake(socket) {
 const frames=[]; let wake=()=>{};
 socket.addEventListener('message',event=>{ frames.push(Buffer.from(event.data)); wake(); });
 const next=async()=>{ while(!frames.length) await new Promise(resolve=>{ wake=resolve; }); return frames.shift(); };
 await next(); socket.send(Buffer.from('RFB 003.008\n'));
 await next(); socket.send(Buffer.from([1]));
 await next(); socket.send(Buffer.from([1]));
 const init=await next();
 return {width:init.readUInt16BE(0),height:init.readUInt16BE(2)};
}

test('a viewer takes control of a Screen for itself, and gives it back',async()=>{
 const fake=await engineWith({ads:{running:true}});
 const opened=await engineFor(connection(fake,'ads')).screenViewer();
 try {
  assert.equal(opened.state,'open');
  const viewer=opened.viewer;
  assert.equal(await viewer.control(),'agent');
  assert.deepEqual(await viewer.take(),{state:'taken'});
  assert.equal(await viewer.control(),'mine');
  assert.deepEqual(await engineFor(connection(fake,'ads')).screen(),{state:'found',screen:{state:'awake',control:'person',refusal:null}});
  const observed=fake.settings.screenCalls.find(call=>call.method==='display.observe');
  const [acquired]=fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire');
  assert.equal(observed.params.profile,'ads');
  assert.equal(fake.settings.screens.get('ads').viewer,acquired.params.viewer_id,'the lease names the viewer that took it');
  assert.deepEqual(await viewer.giveBack(),{state:'given'});
  assert.equal(await viewer.control(),'agent');
  assert.equal(fake.settings.screens.get('ads').holder,'agent');
  const [released]=fake.settings.screenCalls.filter(call=>call.method==='display.lease.release');
  assert.equal(released.params.viewer_id,acquired.params.viewer_id,'the release names the same viewer');
 } finally { await opened?.viewer?.close(); await fake.close(); }
});

test('a take is refused while another viewer holds the Screen, whose control a second viewer cannot give back',async()=>{
 const fake=await engineWith({ads:{running:true}});
 const first=await engineFor(connection(fake,'ads')).screenViewer();
 const second=await engineFor(connection(fake,'ads')).screenViewer();
 try {
  assert.deepEqual(await first.viewer.take(),{state:'taken'});
  assert.deepEqual(await second.viewer.take(),{state:'held'});
  assert.equal(fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire').length,1,'the refused take never reached the Engine');
  assert.equal(await second.viewer.control(),'other');
  assert.equal(await first.viewer.control(),'mine');
  await second.viewer.giveBack();
  assert.equal(await first.viewer.control(),'mine','a viewer that does not hold gives nothing back');
  // A viewer closed while holding gives the Screen back as it goes.
  await first.viewer.close();
  assert.equal(fake.settings.screens.get('ads').holder,'agent');
  assert.deepEqual(await second.viewer.take(),{state:'taken'});
 } finally { await first?.viewer?.close(); await second?.viewer?.close(); await fake.close(); }
});

test('control a person left behind is given back by force, and an asleep or missing Screen opens no viewer',async()=>{
 const fake=await engineWith({ads:{running:true,holder:'human',viewer:'left-behind'}});
 const opened=await engineFor(connection(fake,'ads')).screenViewer();
 try {
  assert.equal(await opened.viewer.control(),'other');
  assert.deepEqual(await opened.viewer.giveBack({force:true}),{state:'given'});
  assert.equal(fake.settings.screens.get('ads').holder,'agent');
  assert.deepEqual(await engineFor(connection(fake,'writer')).screenViewer(),{state:'asleep'});
  assert.deepEqual(await engineFor(connection(fake,'gone')).screenViewer(),{state:'missing'});
  assert.deepEqual(await engineFor({...connection(fake),key:'wrong-key'}).screenViewer(),{state:'unreachable'});
 } finally { await opened?.viewer?.close(); await fake.close(); }
});

test('the live stream opens with a fresh ticket each time, takes input only while its viewer holds control, and refuses any other ticket',async()=>{
 const fake=await engineWith({ads:{running:true}});
 const opened=await engineFor(connection(fake,'ads')).screenViewer();
 try {
  const stream=await opened.viewer.stream();
  assert.ok(stream);
  assert.deepEqual(await shake(stream),{width:64,height:40});
  stream.send(pointer(3,4));
  await opened.viewer.take();
  stream.send(pointer(5,6));
  await opened.viewer.giveBack();
  stream.send(pointer(7,8));
  await opened.viewer.control();
  assert.deepEqual(fake.settings.screenInputs.map(input=>[input.kind,input.x,input.y]),[['pointer',5,6]],'only the input sent while holding control reached the Screen');
  // Each stream spends a ticket of its own.
  const again=await opened.viewer.stream();
  assert.equal(await rfbVersion(again),'RFB 003.008\n');
  assert.equal(fake.settings.screenCalls.filter(call=>call.method==='display.observe').length,2);
  stream.close(); again.close();
  assert.deepEqual([...fake.settings.screenTickets.keys()],[],'every ticket was used once');
  // No ticket and a made-up one are each closed with the Engine's 4401.
  const raw=suffix=>new WebSocket(`${fake.managementAddress.replace('http','ws')}/api/display/ws${suffix}`);
  for(const suffix of ['','?display_ticket=made-up']) assert.equal(await closed(raw(suffix)),4401);
 } finally { await opened?.viewer?.close(); await fake.close(); }
});
