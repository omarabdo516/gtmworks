import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { markSession, readSessionList, titleSession } from '../lib/engine/sessions.mjs';

// #881 on the fake Engine server, which serves a profile's sessions as the pinned release lists them
// (hermes_cli/web_routers/sessions.py get_sessions) and takes a session's title and archived mark on the API listener
// (gateway/platforms/api_server.py _handle_patch_session): the list is one read per profile, newest activity first,
// archived ones beside the rest, each with its title, its preview and its last activity.
const profile='co-list';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const user=(/** @type {number} */ timestamp,/** @type {string} */ content)=>({role:'user',content,timestamp});
const replied=(/** @type {number} */ timestamp,/** @type {string} */ content)=>({role:'assistant',content,timestamp});

test('a profile\'s sessions are listed newest activity first, archived ones beside the rest, by title or preview',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set('older',{profile,messages:[user(1000,'Plan the spring ads\nwith a long second line'),replied(1001,'Done.')]});
  fake.settings.sessions.set('newer',{profile,messages:[user(2000,'Write the newsletter'),replied(2002,'Here it is.')]});
  fake.settings.sessions.set('elsewhere',{profile:'co-other',messages:[user(3000,'Not this profile')]});
  fake.settings.sessionTitles.set(`${profile}:newer`,'Newsletter');
  fake.settings.archivedSessions.add(`${profile}:older`);
  const read=await readSessionList(connection(fake));
  assert.equal(read.state,'found');
  assert.deepEqual(read.state==='found'&&read.sessions,[
   {id:'newer',title:'Newsletter',preview:'Write the newsletter',at:new Date(2002000).toISOString(),archived:false},
   {id:'older',title:null,preview:'Plan the spring ads with a long second line',at:new Date(1001000).toISOString(),archived:true}]);
  assert.equal(read.state==='found'&&read.total,2);
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/sessions?profile=${profile}&order=recent&archived=include&limit=100&offset=0`),'one read of the profile, archived ones included');
 } finally { await fake.close(); }
});

test('a deleted profile lists missing, and a busy or stopped Engine unreachable',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set('kept',{profile,messages:[user(1000,'Hello')]});
  fake.settings.sessionListStatus=503;
  assert.equal((await readSessionList(connection(fake))).state,'unreachable');
  fake.settings.sessionListStatus=null;
  const removed=await fetch(`${fake.managementAddress}/api/profiles/${profile}`,{method:'DELETE',headers:{authorization:`Bearer ${fake.settings.key}`}});
  assert.equal(removed.status,200);
  assert.equal((await readSessionList(connection(fake))).state,'missing','its sessions went with it');
  assert.equal((await readSessionList({...connection(fake),key:'wrong'})).state,'refused');
 } finally { await fake.close(); }
 const gone=await readSessionList({address:'http://127.0.0.1:9',managementAddress:'http://127.0.0.1:9',profile,key:'k'});
 assert.equal(gone.state,'unreachable');
});

test('a session is renamed and archived on the Engine, and a title another session holds is refused',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set('one',{profile,messages:[user(1000,'First')]});
  fake.settings.sessions.set('two',{profile,messages:[user(2000,'Second')]});
  assert.equal(await titleSession(connection(fake),'one','  Spring ads  '),'marked');
  assert.equal(fake.settings.sessionTitles.get(`${profile}:one`),'Spring ads');
  assert.deepEqual(fake.settings.sessionMarks.at(-1)?.body,{title:'Spring ads'},'the title is the only field sent');
  assert.equal(await titleSession(connection(fake),'two','Spring ads'),'invalid');
  assert.equal(await titleSession(connection(fake),'two','   '),'invalid');
  assert.equal(await titleSession(connection(fake),'nobody','Anything'),'missing');
  assert.equal(await markSession(connection(fake),'one',true),'marked');
  const read=await readSessionList(connection(fake));
  assert.deepEqual(read.state==='found'&&read.sessions.map(({id,title,archived})=>({id,title,archived})),[{id:'two',title:null,archived:false},{id:'one',title:'Spring ads',archived:true}]);
 } finally { await fake.close(); }
});
