import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing, withNoEngine } from './engine-records.mjs';
import { companyProfile, toolConfig } from '../lib/agent-toolsets.mjs';
import { provideProfile } from '../lib/engine/agents.mjs';
import { releasePlugin, pluginRevision } from '../lib/engine/plugin.mjs';
import { keepMainAgentPlugins } from '../lib/main-agent-plugin.mjs';
import { checkAgentTools } from '../lib/company-profiles.mjs';
import { companyEngine } from '../lib/engine/handle.mjs';

// gtmworks's plugin of the main Agent's profile (#884), kept in place by the worker through the Engine handle against
// the Hermes wire fake: the plugin's files and its name land in the main Agent's profile, the Engine restarts once to
// load it, at a moment it works no turn, and its toolset is then offered to that profile's Runs and no other's.
const company='10000000-0000-0000-0000-000000000084';
const main=companyProfile(company);
const own='ag-a0000000000000000000000000000084';
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const due=(...profiles)=>({rpc:async name=>name==='engine_tools_due'?{data:profiles.map(profile=>({company_id:company,profile,subagents:false})),error:null}:{data:null,error:null}});
const clock=()=>{ let at=1_800_000_000_000; return {now:()=>at,pass:ms=>{ at+=ms; }}; };
const offered=async(fake,profile)=>(await (await fetch(`${fake.address}/p/${profile}/v1/toolsets`,{headers:{Authorization:'Bearer test-only-key'}})).json())
 .data.filter(toolset=>toolset.enabled).map(toolset=>toolset.name);
const provided=async(fake,profile)=>{
 const config=toolConfig({profile});
 assert.equal((await provideProfile(install(fake),{name:profile,soul:'',config,forbidden:config.agent.disabled_toolsets})).state,'configured');
};

test('the main Agent\'s new profile gets this release\'s plugin, and its Engine restarts once to offer its tool', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  // Before it is placed the main Agent's profile is the fixed set, and its record holds.
  assert.ok(!(await offered(fake,main)).includes('gtmworks'));
  const kept=new Map(), {now,pass}=clock();
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:1,restarted:1,offered:0});
  // Every file of the plugin, as this release ships it, in the profile's own plugins folder, and its name enabled.
  const files=await releasePlugin();
  assert.deepEqual(files.map(file=>file.path),['__init__.py','dashboard/manifest.json','dashboard/plugin_api.py','marks.py','plugin.yaml']);
  for(const file of files) assert.deepEqual(Buffer.from(fake.settings.fileBytes.get(`/opt/data/profiles/${main}/plugins/gtmworks/${file.path}`).body),file.data,file.path);
  assert.deepEqual(fake.settings.profiles.get(main).config.plugins.enabled,['gtmworks']);
  assert.equal(fake.settings.restarts,1);
  assert.ok((await offered(fake,main)).includes('gtmworks'));
  // The Engine is given time to start; then the tool is found offered and nothing is written or restarted again.
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:0,restarted:0,offered:0});
  pass(20000);
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:0,restarted:0,offered:1});
  const uploads=fake.settings.managementRequests.filter(request=>request.path==='/api/files/upload').length;
  pass(10*60000);
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:0,restarted:0,offered:1});
  assert.equal(fake.settings.managementRequests.filter(request=>request.path==='/api/files/upload').length,uploads);
  assert.equal(fake.settings.restarts,1);
 } finally { await fake.close(); }
});

test('a plugin a release changed is written again, file by file, and its Engine restarts once more', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  const {now}=clock();
  await keepMainAgentPlugins(due(main),{now});
  // A release whose marks.py differs: the Engine holds the earlier one. A new worker (an update starts one) reads it.
  fake.settings.fileBytes.set(`/opt/data/profiles/${main}/plugins/gtmworks/marks.py`,{body:Buffer.from('# the release before\n')});
  const before=fake.settings.managementRequests.length;
  assert.deepEqual(await keepMainAgentPlugins(due(main),{now}),{placed:1,restarted:1,offered:0});
  assert.deepEqual(fake.settings.managementRequests.slice(before).filter(request=>request.method!=='GET').map(request=>`${request.method} ${request.path} ${request.body?.path??''}`.trim()),
   [`POST /api/files/upload /opt/data/profiles/${main}/plugins/gtmworks/marks.py`,'POST /api/gateway/restart']);
  assert.equal(fake.settings.restarts,2);
  // The other plugins the profile enables stay enabled when gtmworks's is added.
  fake.settings.profiles.get(main).config.plugins.enabled=['someone-else'];
  await keepMainAgentPlugins(due(main),{now});
  assert.deepEqual(fake.settings.profiles.get(main).config.plugins.enabled,['someone-else','gtmworks']);
 } finally { await fake.close(); }
});

test('an Engine at work on a turn is restarted only once it works none, and an Engine that already offers the tool is not restarted', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  fake.settings.gatewayBusy=true;
  const kept=new Map(), {now,pass}=clock();
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:1,restarted:0,offered:0});
  assert.equal(fake.settings.restarts,0);
  pass(1000);
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:0,restarted:0,offered:0});
  fake.settings.gatewayBusy=false;
  pass(1000);
  assert.deepEqual(await keepMainAgentPlugins(due(main),{kept,now}),{placed:0,restarted:1,offered:0});
  // An Engine that started with the plugin in place (an update, a restore): a new worker finds it offered and restarts nothing.
  assert.deepEqual(await keepMainAgentPlugins(due(main),{now}),{placed:0,restarted:0,offered:1});
  assert.equal(fake.settings.restarts,1);
 } finally { await fake.close(); }
});

test('an Engine that does not load the plugin after its restart is not restarted again by the same worker', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  const kept=new Map(), {now,pass}=clock();
  // A restart that loads nothing (the Engine refused the plugin): the profile is not offered its tool.
  fake.settings.profiles.get(main).config.plugins={enabled:[]};
  await keepMainAgentPlugins(due(main),{kept,now});
  fake.settings.profiles.get(main).config.plugins.enabled=['gtmworks'];
  fake.settings.pluginsLoaded.clear();
  for(let pass_=0;pass_<4;pass_++) { pass(10*60000); await keepMainAgentPlugins(due(main),{kept,now}); }
  assert.equal(fake.settings.restarts,1);
 } finally { await fake.close(); }
});

test('only the main Agent\'s profile gets the plugin, and its tool is no difference from the fixed set there', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  await provided(fake,own);
  await keepMainAgentPlugins(due(own,main,main),{});
  assert.equal([...fake.settings.fileBytes.keys()].filter(path=>path.includes('/plugins/')&&!path.includes(`/profiles/${main}/`)).length,0);
  assert.equal(fake.settings.restarts,1);
  // The tool check reads both profiles and corrects neither: the main Agent's profile may offer its plugin's toolset.
  const writes=()=>fake.settings.managementRequests.filter(request=>request.method==='PUT'&&request.path.startsWith('/api/config')).length;
  const before=writes();
  const calls=[];
  const db={rpc:async(name,args)=>{ calls.push(name); return name==='engine_tools_due'?{data:[{company_id:company,profile:main,subagents:false},{company_id:company,profile:own,subagents:false}],error:null}:{data:null,error:null}; }};
  assert.equal(await checkAgentTools(db,{}),2);
  assert.equal(writes(),before);
  assert.deepEqual(calls,['engine_tools_due']);
  // The worker's own write of the main Agent's tools reads back as the fixed set with the plugin's toolset beside it.
  const on=(await companyEngine(company)).on('default');
  const config=toolConfig({profile:main});
  assert.equal((await on.agents.configure({name:main,config,forbidden:config.agent.disabled_toolsets})).state,'configured');
 } finally { await fake.close(); }
});

test('a Company with no Engine, or an Engine that does not answer, is left for a later pass', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  assert.deepEqual(await withNoEngine(company,()=>keepMainAgentPlugins(due(main),{})),{placed:0,restarted:0,offered:0});
  fake.settings.managementStatus=503;
  assert.deepEqual(await keepMainAgentPlugins(due(main),{}),{placed:0,restarted:0,offered:0});
  assert.equal(fake.settings.restarts,0);
  await assert.rejects(keepMainAgentPlugins({rpc:async()=>({data:null,error:{message:'database down'}})},{}),/database down/);
 } finally { await fake.close(); }
});

test('gtmworks marks a session of the main Agent\'s profile as an Owner\'s through the plugin\'s own route', async () => {
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  const on=(await companyEngine(company)).on(main);
  // No plugin yet: the Engine has no such route.
  assert.equal((await on.plugin.markOwner({session:'conversation-1',person:'owner-1'})).state,'failed');
  await keepMainAgentPlugins(due(main),{});
  const marked=await on.plugin.markOwner({session:'conversation-1',person:'owner-1',seconds:60});
  assert.equal(marked.state,'marked');
  const read=await on.plugin.ownerSessions();
  assert.equal(read.state,'found');
  assert.deepEqual(read.sessions.map(one=>[one.session,one.person]),[['conversation-1','owner-1']]);
  assert.ok(read.sessions[0].until>Date.now()/1000);
 } finally { await fake.close(); }
});

test('plugin.yaml states the revision of the plugin\'s other files, which the Engine reports for what it loaded', async () => {
 // A change to any file of the plugin changes its revision; plugin.yaml must then name the new one, or the worker could
 // never tell a loaded earlier release from this one.
 const files=await releasePlugin();
 const yaml=files.find(file=>file.path==='plugin.yaml').data.toString();
 assert.match(yaml,new RegExp(`^description: ".* Revision ${pluginRevision(files)}\\."$`,'m'),`plugin.yaml names revision ${pluginRevision(files)}`);
 assert.notEqual(pluginRevision(files.map(file=>file.path==='marks.py'?{...file,data:Buffer.from('# changed')}:file)),pluginRevision(files));
 assert.equal(pluginRevision(files.map(file=>file.path==='plugin.yaml'?{...file,data:Buffer.from('changed')}:file)),pluginRevision(files));
});

test('a new worker that finds this release\'s files in place and an earlier revision loaded restarts the Engine once', async () => {
 // The worker wrote a changed plugin while the Engine was busy, and stopped before the Engine was free to restart: the
 // files on disk are this release's and the Engine still runs the earlier ones.
 const fake=await engineServing(company);
 try {
  await provided(fake,main);
  await keepMainAgentPlugins(due(main),{});
  fake.settings.pluginsLoaded.set(main,"gtmworks: the release before. Revision 000000000000.");
  const restarts=fake.settings.restarts;
  assert.deepEqual(await keepMainAgentPlugins(due(main),{}),{placed:0,restarted:1,offered:0});
  assert.equal(fake.settings.restarts,restarts+1);
  assert.deepEqual(await keepMainAgentPlugins(due(main),{}),{placed:0,restarted:0,offered:1});
 } finally { await fake.close(); }
});
