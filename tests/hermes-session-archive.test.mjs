import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #674 on the fake Engine server, which marks a session archived as the pinned release's API listener does
// (gateway/platforms/api_server.py _handle_patch_session, set_session_archived): the Conversation's own session, on its
// Agent's profile, with that flag alone, so nothing else of the session or the Agent's memory changes.
const profile='co-archive';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});

test('archiving a Conversation marks its session archived in the Engine, and restoring it unmarks it',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('session-1',{profile,messages:[]});
  const engine=engineFor(connection(fake));
  assert.equal(await engine.markSession('session-1',true),'marked');
  assert.deepEqual(fake.settings.sessionMarks,[{profile,session:'session-1',body:{archived:true},authorization:`Bearer ${fake.settings.key}`}],'the flag alone, on the profile, with its key');
  assert.equal(fake.settings.archivedSessions.has(`${profile}:session-1`),true);
  assert.equal(await engine.markSession('session-1',false),'marked');
  assert.equal(fake.settings.archivedSessions.has(`${profile}:session-1`),false);
  assert.deepEqual(fake.settings.sessionMarks.at(-1)?.body,{archived:false});
 } finally { await fake.close(); }
});

test('a session the Engine does not keep is missing, a refused key is refused, and an Engine that does not answer is unreachable',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  assert.equal(await engine.markSession('session-gone',true),'missing');
  assert.equal(await engine.markSession('../etc',true),'missing','a name that is no session id is never sent');
  fake.settings.sessions.set('session-1',{profile,messages:[]});
  assert.equal(await engineFor({...connection(fake),key:'wrong'}).markSession('session-1',true),'refused');
  fake.settings.sessionMarkStatus=503;
  assert.equal(await engine.markSession('session-1',true),'unreachable');
 } finally { await fake.close(); }
 assert.equal(await engineFor(connection(fake)).markSession('session-1',true),'unreachable','an Engine that is down');
});
