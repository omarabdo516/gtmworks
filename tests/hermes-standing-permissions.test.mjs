import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStandingPermissions, revokeStandingPermission } from '../lib/hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #166: an Agent's standing permissions are its own profile's command_allowlist, the list every "always" answer adds to
// in the pinned Engine. The driver reads it, writes it back without one entry, and reads it back to confirm; an entry
// already gone writes nothing. A request that offers always says what always keeps: a flagged command's pattern keys,
// or for an app's tool the one key mcp:<server>/<tool> its trust gate remembers.
const ads='ag-a0000000000000000000000000000001';
const seo='ag-a0000000000000000000000000000002';
const connection=(fake,profile=ads)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const profileOn=(fake,config={},profile=ads)=>fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
const writes=fake=>fake.settings.managementRequests.filter(each=>each.method==='PUT'&&each.path.startsWith('/api/config'));

test('an empty or missing list is none, and a list of two reads both as the Engine keeps them',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake);
  assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'found',entries:[]});
  profileOn(fake,{command_allowlist:[]});
  assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'found',entries:[]});
  profileOn(fake,{command_allowlist:['mcp:meta-ads/create_campaign','recursive delete']});
  assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'found',entries:['mcp:meta-ads/create_campaign','recursive delete']});
  assert.equal(writes(fake).length,0,'a read writes nothing');
  // A list the Engine itself ignores is not drawn as none.
  profileOn(fake,{command_allowlist:'recursive delete'});
  assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'failed',entries:null});
  profileOn(fake,{command_allowlist:['ok',3]});
  assert.equal((await readStandingPermissions(connection(fake))).state,'failed');
  assert.equal((await readStandingPermissions(connection(fake,'default'))).state,'failed','only an Agent\'s own profile is read');
 } finally { await fake.close(); }
});

test('a removal writes the list back without that entry and reads it back; the other entries and another profile stay',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{command_allowlist:['mcp:meta-ads/create_campaign','recursive delete'],approvals:{mode:'manual'}});
  profileOn(fake,{command_allowlist:['mcp:meta-ads/create_campaign']},seo);
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'mcp:meta-ads/create_campaign'}),{state:'revoked',removed:'yes'});
  assert.deepEqual(fake.settings.profiles.get(ads).config,{command_allowlist:['recursive delete'],approvals:{mode:'manual'}});
  assert.deepEqual(writes(fake).map(each=>[each.path,each.body]),[[`/api/config?profile=${ads}`,{config:{command_allowlist:['recursive delete']}}]],'one write, of the list alone');
  assert.deepEqual(fake.settings.profiles.get(seo).config.command_allowlist,['mcp:meta-ads/create_campaign'],'another Agent keeps its own');
  // Already gone: nothing is written.
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'mcp:meta-ads/create_campaign'}),{state:'gone'});
  assert.equal(writes(fake).length,1);
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'revoked',removed:'yes'});
  assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'found',entries:[]});
  // An Engine that answers the write and keeps the old list has not revoked it.
  profileOn(fake,{command_allowlist:['recursive delete']});
  fake.settings.staleConfig=true;
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'failed',removed:'no'});
 } finally { await fake.close(); }
});

test('an unreachable or refusing Engine is a state, never a throw, and changes nothing',async()=>{
 const fake=await fakeHermes();
 profileOn(fake,{command_allowlist:['recursive delete']});
 fake.settings.managementStatus=401;
 assert.deepEqual(await readStandingPermissions(connection(fake)),{state:'refused',entries:null});
 assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'refused'});
 const gone=connection(fake);
 await fake.close();
 assert.deepEqual(await readStandingPermissions(gone),{state:'unreachable',entries:null});
 assert.deepEqual(await revokeStandingPermission(gone,{entry:'recursive delete'}),{state:'unreachable'});
 assert.deepEqual(await revokeStandingPermission(gone,{entry:''}),{state:'failed'});
});

test('a request says what always keeps, an always answer keeps it on the Run\'s own profile, and the next such request is not asked until it is revoked',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake); profileOn(fake,{},seo);
  fake.settings.approvals=input=>input==='Launch'?[{app:{server:'meta-ads',tool:'create_campaign'}}]:[{description:'recursive delete',command:'rm -rf /tmp/exports'},{description:'',command:'curl -X POST https://example.com',choices:['once','session','deny']}];
  const engine=engineFor(connection(fake));
  const run=/** @type {string} */(await engine.start({conversation:'s',input:'Launch',idempotencyKey:'k1'}));
  const {permission}=await engine.read(run);
  assert.equal(permission?.allows?.[0],'mcp:meta-ads/create_campaign','an app\'s tool is kept as mcp:<server>/<tool>');
  assert.deepEqual(permission?.allows,['mcp:meta-ads/create_campaign']);
  assert.equal(await engine.permit(run,/** @type {string} */(permission?.id),'always'),'answered');
  assert.deepEqual((await readStandingPermissions(connection(fake))).entries,['mcp:meta-ads/create_campaign']);
  assert.deepEqual((await readStandingPermissions(connection(fake,seo))).entries,[],'another Agent\'s profile is not widened');

  const again=/** @type {string} */(await engine.start({conversation:'s',input:'Launch',idempotencyKey:'k2'}));
  assert.equal((await engine.read(again)).permission,undefined,'a standing permission is not asked again');
  const other=/** @type {string} */(await engineFor(connection(fake,seo)).start({conversation:'t',input:'Launch',idempotencyKey:'k3'}));
  assert.ok((await engineFor(connection(fake,seo)).read(other)).permission,'nor does it apply to another Agent');

  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'mcp:meta-ads/create_campaign'}),{state:'revoked',removed:'yes'});
  const after=/** @type {string} */(await engine.start({conversation:'s',input:'Launch',idempotencyKey:'k4'}));
  assert.ok((await engine.read(after)).permission,'once revoked, the same tool asks again');

  const command=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k5'}));
  const first=(await engine.read(command)).permission;
  assert.deepEqual(first?.allows,['recursive delete'],'a flagged command keeps its pattern keys');
  assert.equal(await engine.permit(command,/** @type {string} */(first?.id),'once'),'answered');
  assert.deepEqual((await engine.read(command)).permission?.allows,[],'a request that offers no always keeps nothing');
 } finally { await fake.close(); }
});

test('a grant that lands between the reads is read again, and one that the write would drop is reported, never lost silently',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{command_allowlist:['recursive delete']});
  // An Always allow elsewhere adds an entry after the first read: the second read differs, so the list is read again
  // and the write keeps it.
  let reads=0; const engineFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{ const answer=await engineFetch(url,init); if(String(url).includes('/api/config?')&&(!init?.method||init.method==='GET')&&++reads===1) fake.settings.profiles.get(ads).config.command_allowlist=['recursive delete','mcp:notion/create_page']; return answer; };
  try { assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'revoked',removed:'yes'}); }
  finally { globalThis.fetch=engineFetch; }
  assert.deepEqual(fake.settings.profiles.get(ads).config.command_allowlist,['mcp:notion/create_page'],'the grant that landed meanwhile is kept');
  // An Engine whose write loses another entry is a failed revoke, not a quiet one.
  profileOn(fake,{command_allowlist:['recursive delete','mcp:notion/create_page']});
  globalThis.fetch=async(url,init)=>{ if(init?.method==='PUT') { fake.settings.profiles.get(ads).config.command_allowlist=[]; return new Response(JSON.stringify({ok:true}),{status:200}); } return engineFetch(url,init); };
  try { assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'failed',removed:'yes'}); }
  finally { globalThis.fetch=engineFetch; }
 } finally { await fake.close(); }
});

test('a grant that lands just before the write is kept when the caller names it, as Codex\'s case on #499',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,{command_allowlist:['recursive delete']});
  const engineFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{ if(init?.method==='PUT') fake.settings.profiles.get(ads).config.command_allowlist=['recursive delete','mcp:notion/create_page']; return engineFetch(url,init); };
  try {
   assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete',keep:['mcp:notion/create_page']}),{state:'revoked',removed:'yes'});
   assert.deepEqual(fake.settings.profiles.get(ads).config.command_allowlist,['mcp:notion/create_page'],'the grant that landed is written back');
  } finally { globalThis.fetch=engineFetch; }
 } finally { await fake.close(); }
});

test('a write the Engine took whose read-back fails is an unknown outcome, never a sure failure (CodeRabbit on #499)',async()=>{
 const fake=await fakeHermes(); const engineFetch=globalThis.fetch;
 try {
  profileOn(fake,{command_allowlist:['recursive delete','mcp:notion/create_page']});
  let written=false;
  globalThis.fetch=async(url,init)=>{ if(init?.method==='PUT') { written=true; return engineFetch(url,init); } if(written) return new Response('down',{status:500}); return engineFetch(url,init); };
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'recursive delete'}),{state:'unreachable',removed:'maybe'});
  globalThis.fetch=engineFetch;
  assert.deepEqual(fake.settings.profiles.get(ads).config.command_allowlist,['mcp:notion/create_page'],'the Engine did take it');
  // Nothing written at all (the reads fail first) says nothing of removal.
  fake.settings.managementStatus=500;
  assert.deepEqual(await revokeStandingPermission(connection(fake),{entry:'mcp:notion/create_page'}),{state:'unreachable'});
 } finally { globalThis.fetch=engineFetch; await fake.close(); }
});
