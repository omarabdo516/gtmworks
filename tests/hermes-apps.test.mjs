import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile } from '../lib/engine/agents.mjs';
import { readApps, prepareApp, prepareServer, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp, testServer } from '../lib/engine/apps.mjs';
import { writeProfileModel } from '../lib/engine/models.mjs';
import { setProviderKey, removeProviderKey } from '../lib/engine/providers.mjs';
import { readUsage } from '../lib/engine/sessions.mjs';
import { toolConfig, companyProfile } from '../lib/agent-toolsets.mjs';
import { apps } from '../lib/app-catalogue.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { designProfileOf, designProfileConfig, openDesignServer } from '../lib/open-design.mjs';

// The app driver (#30, #458) against a fake of the pinned release's MCP routes: the catalogued apps, a ready-made remote
// server, a server the Owner added, the three sign-in kinds and removal. No config it writes carries a tool filter, and
// nothing it answers carries the Engine's text, a path or a token.
const company='10000000-0000-0000-0000-000000000002';
const back=key=>`http://127.0.0.1:3000/api/apps/callback/${key}`;
async function companyEngine() {
 const fake=await fakeHermes();
 const name=companyProfile(company);
 const install={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
 await provideProfile(install,{name,soul:'',config:toolConfig({profile:name}),forbidden:toolConfig().agent.disabled_toolsets});
 return {fake,target:{...install,profile:name},servers:()=>fake.settings.profiles.get(name).config.mcp_servers||{}};
}
const states=async target=>Object.fromEntries((await readApps(target)).apps.map(app=>[app.key,app.state]));
const signInState=url=>new URL(url).searchParams.get('state');
const engineKeys=fake=>apps.filter(app=>app.source==='engine'&&fake.settings.catalog.includes(app.key)).map(app=>app.key);
const spaceOf=`cs-${company.replaceAll('-','')}`;
const remoteKeys=apps.filter(app=>app.source==='remote').map(app=>app.key);

test('the apps listed are the pinned Engine entries it offers, the ready-made servers and the card that adds one', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.catalog=fake.settings.catalog.filter(name=>name!=='gamma');
  const read=await readApps(target);
  assert.equal(read.state,'found');
  assert.deepEqual(read.apps.filter(app=>app.source==='engine').map(app=>app.key),engineKeys(fake));
  assert.ok(!read.apps.some(app=>app.key==='gamma'),'an entry the Engine does not offer is not listed');
  assert.deepEqual(read.apps.filter(app=>app.source==='remote').map(app=>app.key),remoteKeys);
  assert.equal(read.apps.find(app=>app.key==='own')?.source,'own');
  assert.equal(read.apps.find(app=>app.key==='klaviyo')?.state,'off');
  assert.equal(read.apps[0].installed,false);
 } finally { await fake.close(); }
});

test('connecting installs the catalogue entry, writes it on with its way back and no tool filter, and the sign-in comes back through gtmworks', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.managementRequests.length=0;
  const started=await startAppSignIn(target,'klaviyo',back('klaviyo'));
  assert.equal(started.state,'started');
  assert.equal(new URL(started.url).protocol,'https:');
  assert.equal(new URL(started.url).searchParams.get('redirect_uri'),back('klaviyo'));
  const steps=fake.settings.managementRequests.map(request=>`${request.method} ${request.path?.split('?')[0]}`);
  assert.deepEqual(steps,['GET /api/mcp/catalog','POST /api/mcp/catalog/install','GET /api/config','PUT /api/config','POST /api/mcp/servers/klaviyo/auth']);
  assert.equal(fake.settings.managementRequests[1].body.enable,false,'installed off, and turned on only with its config');
  assert.deepEqual(servers().klaviyo,{url:'https://mcp.klaviyo.example/mcp',auth:'oauth',enabled:true,oauth:{redirect_uri:back('klaviyo')}});
  assert.equal('tools' in servers().klaviyo,false,'no tool filter is written');
  assert.equal((await states(target)).klaviyo,'attention','on, but not signed in yet');
  assert.deepEqual(await pollAppSignIn(target,started.flow),{state:'waiting'});

  const finished=await finishAppSignIn(target,{key:'klaviyo',flow:started.flow,answer:{code:'vendor-code',state:signInState(started.url),iss:'https://auth.klaviyo.example',scope:'everything',redirect:'https://evil.example'}});
  assert.deepEqual(finished,{state:'approved'});
  assert.deepEqual(fake.settings.appCallbacks.map(search=>[...new URLSearchParams(search).keys()]),[['code','state','iss']],'only what OAuth returns goes on');
  assert.equal((await states(target)).klaviyo,'connected');
 } finally { await fake.close(); }
});

test('a server the previous version limited is cleared of its tool filter the next time it is turned on', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.profiles.get(target.profile).config.mcp_servers={klaviyo:{url:'https://mcp.klaviyo.example/mcp',auth:'oauth',enabled:true,tools:{include:['get_campaigns'],prompts:false,resources:false}}};
  fake.settings.appTokens.add(`${target.profile}:klaviyo`);
  fake.settings.managementRequests.length=0;
  assert.equal(await prepareApp(target,'klaviyo',back('klaviyo')),null);
  assert.equal('tools' in servers().klaviyo,false);
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.path?.startsWith('/api/mcp/servers')&&request.method==='PUT').length,1,'the whole-map replace clears it');
  assert.equal((await states(target)).klaviyo,'connected');
 } finally { await fake.close(); }
});

test('an app with no sign-in is installed and turned on with no vendor window, and its state is the Engine’s reach', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.catalog.push('alltrails'); fake.settings.catalogAuth.alltrails='none';
  assert.equal(await prepareApp(target,'alltrails',null),null);
  assert.deepEqual(servers().alltrails,{url:'https://mcp.alltrails.example/mcp',enabled:true},'the catalogue install then the turn-on, with no OAuth block');
  const tested=await testServer(target,'alltrails');
  assert.equal(tested.state,'connected');
  assert.deepEqual(tested.tools,['get_alltrails','delete_alltrails']);
  assert.equal((await states(target)).alltrails,'connected');
  assert.equal(fake.settings.appFlows.size,0,'no sign-in starts');
 } finally { await fake.close(); }
});

test('a catalogue entry’s declared fields come from the Engine and their values go only to its install', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.catalog.push('asana');
  fake.settings.catalogEnv.asana=[{name:'ASANA_CLIENT_ID',prompt:'Client ID',required:true},{name:'ASANA_CLIENT_SECRET',prompt:'Client secret',required:true}];
  const listed=(await readApps(target)).apps.find(app=>app.key==='asana');
  assert.deepEqual(listed?.fields,[{name:'ASANA_CLIENT_ID',prompt:'Client ID',required:true},{name:'ASANA_CLIENT_SECRET',prompt:'Client secret',required:true}]);
  assert.equal(JSON.stringify(listed).includes('value'),false,'a field holds no value');
  const started=await startAppSignIn(target,'asana',back('asana'),{fields:{ASANA_CLIENT_ID:'id',ASANA_CLIENT_SECRET:'secret'}});
  assert.equal(started.state,'started');
  const install=fake.settings.managementRequests.find(request=>request.path?.startsWith('/api/mcp/catalog/install'));
  assert.deepEqual(install.body.env,{ASANA_CLIENT_ID:'id',ASANA_CLIENT_SECRET:'secret'});
  // A reconnect with new values installs the entry again with them; without values the installed entry is kept as it is.
  fake.settings.managementRequests.length=0;
  await cancelAppSignIn(target,started.flow);
  const rotated=await startAppSignIn(target,'asana',back('asana'),{fields:{ASANA_CLIENT_ID:'id',ASANA_CLIENT_SECRET:'rotated'}});
  assert.equal(rotated.state,'started');
  const again=fake.settings.managementRequests.filter(request=>request.path?.startsWith('/api/mcp/catalog/install'));
  assert.deepEqual(again.map(request=>request.body.env),[{ASANA_CLIENT_ID:'id',ASANA_CLIENT_SECRET:'rotated'}]);
  await cancelAppSignIn(target,rotated.flow);
  fake.settings.managementRequests.length=0;
  assert.equal((await startAppSignIn(target,'asana',back('asana'))).state,'started');
  assert.equal(fake.settings.managementRequests.some(request=>request.path?.startsWith('/api/mcp/catalog/install')||request.method==='DELETE'),false);
 } finally { await fake.close(); }
});

test('a ready-made remote server is added through the Engine’s server route, signed in, and a token server keeps its token out of the config', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.managementRequests.length=0;
  const started=await startAppSignIn(target,'meta-ads',back('meta-ads'));
  assert.equal(started.state,'started');
  const added=fake.settings.managementRequests.find(request=>request.path?.startsWith('/api/mcp/servers?')&&request.method==='POST');
  assert.deepEqual(added.body,{name:'meta-ads',url:'https://mcp.facebook.com/ads',auth:'oauth',profile:target.profile});
  assert.deepEqual(servers()['meta-ads'],{url:'https://mcp.facebook.com/ads',auth:'oauth',enabled:true,oauth:{redirect_uri:back('meta-ads')}});
  assert.equal('tools' in servers()['meta-ads'],false);

  assert.equal(await prepareApp(target,'x',null,{token:'x-token-value'}),null);
  assert.deepEqual(servers().x,{url:'https://api.x.com/mcp',headers:{Authorization:'Bearer MCP_BEARER_TOKEN'},enabled:true});
  assert.equal(JSON.stringify(servers()).includes('x-token-value'),false,'the token is not in the profile config');
  assert.equal(fake.settings.serverTokens.get(`${target.profile}:x`),'x-token-value');
 } finally { await fake.close(); }
});

test('Test answers the tools the server lists, by name only', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.appTools['meta-ads']=['get_campaigns','create_campaign'];
  fake.settings.appTokens.add(`${target.profile}:meta-ads`);
  await prepareApp(target,'meta-ads',back('meta-ads'));
  assert.deepEqual(await testServer(target,'meta-ads'),{state:'connected',tools:['get_campaigns','create_campaign']});
  fake.settings.appsUnreachable.add('meta-ads');
  assert.deepEqual(await testServer(target,'meta-ads'),{state:'attention',tools:[]});
  assert.deepEqual(await testServer(target,'not a key'),{state:'failed',tools:null});
 } finally { await fake.close(); }
});

test('a server the Owner added is removed from its profile, and an unknown key changes nothing', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  await prepareApp(target,'meta-ads',back('meta-ads'));
  servers()['my-crm']={url:'https://crm.example/mcp',enabled:true};
  assert.deepEqual(await disconnectApp(target,'my-crm'),{state:'disconnected'});
  assert.equal(servers()['my-crm'],undefined);
  servers()['my-crm']={url:'https://crm.example/mcp',enabled:true};
  const read=await readApps(target);
  assert.equal(read.apps.find(app=>app.key==='my-crm')?.source,'custom');
  assert.equal(read.apps.find(app=>app.key==='my-crm')?.name,'my-crm');
 } finally { await fake.close(); }
});

test('a space the profile is not, the form’s own card and a refused key are refused before the Engine is asked', async () => {
 const {fake,target}=await companyEngine();
 try {
  const before=fake.settings.managementRequests.length;
  assert.deepEqual(await readApps({...target,profile:'default'}),{state:'failed',apps:null});
  assert.equal(await prepareApp(target,'own',null),'failed');
  assert.equal(await prepareApp(target,'not a key',null),'failed');
  assert.equal((await startAppSignIn(target,'own',back('own'))).state,'failed');
  assert.equal((await disconnectApp(target,'not a key')).state,'failed');
  assert.equal((await startAppSignIn({...target,profile:'default'},'klaviyo',back('klaviyo'))).state,'failed');
  assert.equal((await startAppSignIn(target,'klaviyo','javascript:alert(1)')).state,'failed');
  assert.equal(fake.settings.managementRequests.length,before,'the Engine was never asked');
 } finally { await fake.close(); }
});

test('a second sign-in waits for the first, a cancelled or unknown one never finishes, and a bad answer is not passed on as text', async () => {
 const {fake,target}=await companyEngine();
 try {
  const first=await startAppSignIn(target,'airtable',back('airtable'));
  assert.equal((await startAppSignIn(target,'airtable',back('airtable'))).state,'busy');
  assert.deepEqual(await cancelAppSignIn(target,first.flow),{state:'cancelled'});
  assert.deepEqual(await pollAppSignIn(target,first.flow),{state:'failed'});
  assert.deepEqual(await finishAppSignIn(target,{key:'airtable',flow:first.flow,answer:{code:'c',state:signInState(first.url)}}),{state:'expired'});
  const second=await startAppSignIn(target,'airtable',back('airtable'));
  assert.deepEqual(await finishAppSignIn(target,{key:'airtable',flow:second.flow,answer:{code:'c',state:'forged'}}),{state:'expired'});
  assert.deepEqual(await finishAppSignIn(target,{key:'airtable',flow:second.flow,answer:{error:'access_denied',state:signInState(second.url)}}),{state:'failed'});
  assert.deepEqual(await pollAppSignIn(target,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),{state:'expired'});
  fake.settings.approveApps=false;
  const third=await startAppSignIn(target,'airtable',back('airtable'));
  assert.deepEqual(await finishAppSignIn(target,{key:'airtable',flow:third.flow,answer:{code:'c',state:signInState(third.url)},settle:2}),{state:'waiting'});
 } finally { await fake.close(); }
});

test('an own server may sign in over http, while a catalogue app still signs in over https only', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.appAuthScheme='http';
  const https=await startAppSignIn(target,'my-oauth','http://127.0.0.1:3000/api/apps/callback/my-oauth',{url:'https://mcp.my-oauth.example/mcp',auth:'oauth'});
  assert.equal(https.state,'failed','an https server needs an https sign-in page');
  fake.settings.appFlows.clear();
  const started=await startAppSignIn(target,'my-oauth','http://127.0.0.1:3000/api/apps/callback/my-oauth',{url:'http://mcp.my-oauth.example/mcp',auth:'oauth'});
  assert.equal(started.state,'started','an http server on the Company network may sign in over http');
  assert.equal(new URL(started.url).protocol,'http:');
  const catalogue=await startAppSignIn(target,'klaviyo',back('klaviyo'));
  assert.equal(catalogue.state,'failed','a vendor page is https only');
 } finally { await fake.close(); }
});

test('a server added again with a new address or token replaces the old one; the same OAuth server keeps its sign-in', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  await prepareServer(target,{key:'my-crm',url:'https://one.example/mcp',auth:'none',redirectUri:null});
  assert.equal(servers()['my-crm'].url,'https://one.example/mcp');
  const mark=fake.settings.managementRequests.length;
  await prepareServer(target,{key:'my-crm',url:'https://two.example/mcp',auth:'none',redirectUri:null});
  assert.equal(servers()['my-crm'].url,'https://two.example/mcp');
  assert.deepEqual(fake.settings.managementRequests.slice(mark).filter(request=>request.path?.startsWith('/api/mcp/servers')).map(request=>request.method),['DELETE','POST']);

  await prepareServer(target,{key:'my-oauth',url:'https://oauth.example/mcp',auth:'oauth',redirectUri:back('my-oauth')});
  const kept=fake.settings.managementRequests.length;
  await prepareServer(target,{key:'my-oauth',url:'https://oauth.example/mcp',auth:'oauth',redirectUri:back('my-oauth')});
  assert.equal(fake.settings.managementRequests.slice(kept).filter(request=>request.path?.startsWith('/api/mcp/servers')&&request.method==='DELETE').length,0,'the same OAuth server keeps its sign-in');
 } finally { await fake.close(); }
});

test('a server key that is an Object prototype name is added like any other', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.profiles.get(target.profile).config.mcp_servers={};
  assert.equal(await prepareServer(target,{key:'constructor',url:'https://crm.example/mcp',auth:'none',redirectUri:null}),null);
  assert.equal(servers().constructor.url,'https://crm.example/mcp');
  assert.ok(fake.settings.managementRequests.some(request=>request.path?.startsWith('/api/mcp/servers?')&&request.method==='POST'));
 } finally { await fake.close(); }
});

test('clearing one server\'s tool filter leaves another server in the profile unchanged', async () => {
 const {fake,target}=await companyEngine();
 try {
  const canva={url:'https://mcp.canva.example/mcp',auth:'oauth',enabled:false,oauth:{redirect_uri:back('canva')}};
  fake.settings.profiles.get(target.profile).config.mcp_servers={klaviyo:{url:'https://mcp.klaviyo.example/mcp',auth:'oauth',enabled:true,tools:{include:['get_campaigns']}},canva};
  fake.settings.appTokens.add(`${target.profile}:klaviyo`);
  assert.equal(await prepareApp(target,'klaviyo',back('klaviyo')),null);
  const read=fake.settings.profiles.get(target.profile).config.mcp_servers;
  assert.equal('tools' in read.klaviyo,false);
  assert.deepEqual(read.canva,canva,'the other server is untouched');
 } finally { await fake.close(); }
});

test('a state never carries the Engine\'s error text, a path or a token', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.appsUnreachable.add('klaviyo');
  await prepareApp(target,'klaviyo',back('klaviyo'));
  const read=await readApps(target);
  assert.equal(read.apps.find(app=>app.key==='klaviyo').state,'attention');
  assert.doesNotMatch(JSON.stringify(read),/opt|secret|hermes|token/i);
 } finally { await fake.close(); }
});

test('a server installed for a sign-in is removed again when its config cannot be written, and no sign-in starts', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.failStep='config';
  assert.equal(await prepareApp(target,'airtable',back('airtable')),'failed');
  assert.equal(servers().airtable,undefined);
  assert.deepEqual(await startAppSignIn(target,'airtable',back('airtable')),{state:'failed',flow:null,url:null});
  assert.equal(servers().airtable,undefined);
  assert.equal(fake.settings.appFlows.size,0,'no sign-in starts');
  fake.settings.failStep='';
  assert.equal(await prepareApp(target,'airtable',back('airtable')),null);
  assert.equal('tools' in servers().airtable,false);
 } finally { await fake.close(); }
});

// The Open Design app (#544, ADR 0025): a design profile of the Agent's own with a Run API key no other profile holds,
// and a server entry that runs Open Design's MCP command in the work sandbox with that key, never the install's.
test('Open Design gives the Agent a design profile with a key of its own, and runs its MCP command in the sandbox with it', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  const design=fake.settings.profiles.get(designProfileOf(target.profile));
  assert.ok(design,'the design profile is made');
  assert.match(design.key,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(design.key,target.key,'never the install\'s key');
  assert.deepEqual(design.config.terminal,{cwd:`/work/${target.profile}`},'it works in the Agent\'s own folder');
  assert.deepEqual(design.config.platform_toolsets,designProfileConfig(target.profile).platform_toolsets);
  assert.ok(!design.config.platform_toolsets.api_server.includes('clarify'),'a design Run asks no question nobody would read');
  const entry=servers()['open-design'];
  assert.deepEqual({command:entry.command,args:entry.args},openDesignServer({profile:target.profile,engine:new URL(fake.address).hostname,key:design.key}));
  assert.equal(entry.enabled,true);
  assert.equal(JSON.stringify(servers()).includes(target.key),false,'the install\'s key is in no server entry');
  const read=await readApps(target);
  const app=read.apps.find(one=>one.key==='open-design');
  assert.equal(app?.source,'sandbox');
  assert.equal(app?.state,'connected');
  // Turning it on again keeps the key the design profile takes, so the Agent's connected session stays as it is.
  fake.settings.managementRequests.length=0;
  assert.equal(await prepareApp(target,'open-design',null),null);
  assert.equal(fake.settings.profiles.get(designProfileOf(target.profile)).key,design.key);
  assert.ok(!fake.settings.managementRequests.some(request=>request.method==='DELETE'||request.path?.startsWith('/api/mcp/servers?')),'the entry is not added again');
 } finally { await fake.close(); }
});

test('a design profile that no longer takes the entry\'s key gets a new one, and off removes the entry and takes the key away, keeping the profile\'s history', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  const name=designProfileOf(target.profile);
  const before=fake.settings.profiles.get(name).key;
  fake.settings.profiles.get(name).key='changed-elsewhere-changed-elsewhere-1234';
  assert.equal(await prepareApp(target,'open-design',null),null);
  const after=fake.settings.profiles.get(name).key;
  assert.notEqual(after,before);
  assert.ok(servers()['open-design'].args.at(-1).endsWith(`'${after}'`));
  assert.deepEqual(await disconnectApp(target,'open-design'),{state:'disconnected'});
  assert.equal(servers()['open-design'],undefined);
  assert.equal(fake.settings.profiles.has(name),true,'the design profile stays, with the Runs its usage counts');
  assert.notEqual(fake.settings.profiles.get(name).key,after,'the key the sandbox kept runs nothing');
  assert.match(fake.settings.profiles.get(name).key,/^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await disconnectApp(target,'open-design'),{state:'disconnected'},'again: nothing left, nothing refused');
 } finally { await fake.close(); }
});

test('the design profile gets its Agent\'s provider key and model, and later key and model writes reach it too', async () => {
 const {fake,target}=await companyEngine();
 try {
  const agent=fake.settings.profiles.get(target.profile);
  agent.env={OPENROUTER_API_KEY:'sk-or-agent-key-1234567890'};
  agent.provider='openrouter'; agent.model='anthropic/claude-sonnet';
  assert.equal(await prepareApp(target,'open-design',null),null);
  const name=designProfileOf(target.profile);
  const design=fake.settings.profiles.get(name);
  assert.equal(design.env?.OPENROUTER_API_KEY,'sk-or-agent-key-1234567890','the Agent\'s key, copied inside the Engine');
  assert.deepEqual([design.provider,design.model],['openrouter','anthropic/claude-sonnet'],'the Agent\'s model');
  assert.deepEqual(fake.settings.reveals,[{profile:target.profile,key:'OPENROUTER_API_KEY'}],'only the keys the Agent holds are read');
  // A later model choice and a later key for the Agent reach its design profile.
  assert.equal((await writeProfileModel(target,{profile:target.profile,provider:'anthropic',model:'claude-opus'})).state,'saved');
  assert.deepEqual([design.provider,design.model],['anthropic','claude-opus']);
  fake.settings.profiles.set(spaceOf,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{},env:{}});
  const set=await setProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic',value:'sk-ant-new-key-1234567890'});
  assert.equal(set.state,'written');
  assert.equal(design.env.ANTHROPIC_API_KEY,'sk-ant-new-key-1234567890');
  const removed=await removeProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic'});
  assert.equal(removed.state,'removed');
  assert.equal(design.env.ANTHROPIC_API_KEY,undefined,'a removed key leaves the design profile too');
  // Turned off, the design profile keeps following the Agent's model, so turning it on again starts from the Agent's.
  await disconnectApp(target,'open-design');
  assert.equal((await writeProfileModel(target,{profile:target.profile,provider:'openrouter',model:'x/y'})).state,'saved');
  assert.deepEqual([design.provider,design.model],['openrouter','x/y']);
 } finally { await fake.close(); }
});

test('a design profile that refuses the Agent\'s new key or its removal leaves that Agent unfinished, never reported done', async () => {
 const {fake,target}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  const name=designProfileOf(target.profile);
  fake.settings.profiles.set(spaceOf,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{},env:{}});
  fake.settings.envFail.add(name);
  const set=await setProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic',value:'sk-ant-new-key-1234567890'});
  assert.equal(set.profiles[target.profile],'failed','the Agent is unfinished while its design profile lacks the key');
  fake.settings.envFail.delete(name);
  assert.equal((await setProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic',value:'sk-ant-new-key-1234567890'})).profiles[target.profile],'written');
  fake.settings.envFail.add(name);
  const removed=await removeProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic'});
  assert.equal(removed.profiles[target.profile],'failed','a key left in the design profile is not reported removed');
  assert.equal(fake.settings.profiles.get(name).env.ANTHROPIC_API_KEY,'sk-ant-new-key-1234567890');
  fake.settings.envFail.delete(name);
  assert.equal((await removeProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic'})).profiles[target.profile],'removed','asked again, it is removed');
  assert.equal(fake.settings.profiles.get(name).env.ANTHROPIC_API_KEY,undefined);
 } finally { await fake.close(); }
});

test('an Agent\'s usage counts the Runs of its design profile, and an Agent with none is read as before', async () => {
 const {fake,target}=await companyEngine();
 try {
  const before=await readUsage(target,30);
  assert.equal(before.state,'found');
  assert.equal(await prepareApp(target,'open-design',null),null);
  const name=designProfileOf(target.profile);
  fake.settings.sessions.set('own-1',{profile:target.profile,model:'m',input_tokens:100,output_tokens:10,messages:[]});
  fake.settings.sessions.set('design-1',{profile:name,model:'m',input_tokens:40,output_tokens:4,messages:[]});
  const after=await readUsage(target,30);
  assert.deepEqual([after.input,after.output,after.sessions],[140,14,2]);
  assert.deepEqual(after.models,[{model:'m',input:140,output:14,sessions:2}]);
 } finally { await fake.close(); }
});

test('an Engine whose profile list cannot be read leaves key changes unfinished, never reports a design profile cleared', async () => {
 const {fake,target}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  fake.settings.profiles.set(spaceOf,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{},env:{}});
  assert.equal((await setProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic',value:'sk-ant-new-key-1234567890'})).profiles[target.profile],'written');
  const listing=fake.settings.profilesListStatus;
  fake.settings.profilesListStatus=503;
  const removed=await removeProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic'});
  assert.notEqual(removed.profiles[target.profile],'removed','unknown whether a design profile keeps it');
  fake.settings.profilesListStatus=listing;
  assert.equal((await removeProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'anthropic'})).profiles[target.profile],'removed');
  assert.equal(fake.settings.profiles.get(designProfileOf(target.profile)).env.ANTHROPIC_API_KEY,undefined);
 } finally { await fake.close(); }
});

test('turning Open Design off seals the design profile first: a key it cannot replace leaves the app on', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  const name=designProfileOf(target.profile);
  const key=fake.settings.profiles.get(name).key;
  fake.settings.envFail.add(name);
  assert.notEqual((await disconnectApp(target,'open-design')).state,'disconnected');
  assert.ok(servers()['open-design'],'the server stays, so the app is still shown on and can be turned off again');
  assert.equal(fake.settings.profiles.get(name).key,key);
  fake.settings.envFail.delete(name);
  assert.deepEqual(await disconnectApp(target,'open-design'),{state:'disconnected'});
  assert.notEqual(fake.settings.profiles.get(name).key,key);
 } finally { await fake.close(); }
});

test('a key set with no model listed still stays unfinished when the profile list cannot be read', async () => {
 const {fake,target}=await companyEngine();
 try {
  assert.equal(await prepareApp(target,'open-design',null),null);
  fake.settings.profiles.set(spaceOf,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{},env:{}});
  fake.settings.profilesListStatus=503;
  const set=await setProviderKey(target,{space:spaceOf,profiles:[target.profile],provider:'deepseek',value:'sk-deepseek-key-1234567890'});
  assert.notEqual(set.profiles[target.profile],'noModel');
  assert.notEqual(set.profiles[target.profile],'written');
 } finally { fake.settings.profilesListStatus=null; await fake.close(); }
});

// #914: Meta refuses OAuth dynamic client registration, so its server signs in with the install's own Meta app: its id
// (and a secret, when the install has one) are written into the server's oauth config, the config Hermes reads to skip
// registration, and the vendor's page is asked for with that id.
test('a vendor that refuses dynamic registration signs in with the install\'s own client, written for its server', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.dcrRefused.add('meta-ads');
  fake.settings.appAuthPages['meta-ads']='https://www.facebook.com/v27.0/dialog/oauth';
  const started=await startAppSignIn(target,'meta-ads',back('meta-ads'),{client:{id:'1234567890',secret:'meta-app-secret'}});
  assert.equal(started.state,'started');
  const page=new URL(started.url);
  assert.equal(`${page.origin}${page.pathname}`,'https://www.facebook.com/v27.0/dialog/oauth');
  assert.equal(page.searchParams.get('client_id'),'1234567890');
  assert.deepEqual(servers()['meta-ads'].oauth,{redirect_uri:back('meta-ads'),client_id:'1234567890',client_secret:'meta-app-secret'});
  assert.equal(JSON.stringify(started).includes('meta-app-secret'),false,'the secret goes only to the Engine');
 } finally { await fake.close(); }
});

test('a sign-in the vendor refuses says why, and hands Hermes\'s words on only for the log', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.dcrRefused.add('meta-ads');
  const refused=await startAppSignIn(target,'meta-ads',back('meta-ads'));
  assert.equal(refused.state,'vendorRefused');
  assert.equal(refused.reason,'registration');
  assert.equal(refused.url,null);
  assert.match(refused.detail,/^Registration failed: 400 .*Dynamic registration is not available/);
  // Hermes's own text is bounded: a long answer never reaches the log whole.
  assert.ok(refused.detail.length<=400);
  // A fault of Hermes's own is the Engine's, never blamed on the vendor; the vendor's refusal in its words still is.
  fake.settings.appAuthFailure={status:500,detail:'Internal error at /opt/data/mcp'};
  assert.deepEqual(await startAppSignIn(target,'tiktok-ads',back('tiktok-ads')),{state:'failed',flow:null,url:null});
  fake.settings.appAuthFailure={status:502,detail:'Registration failed: 400 invalid_client_metadata'};
  assert.equal((await startAppSignIn(target,'tiktok-ads',back('tiktok-ads'))).reason,'registration');
 } finally { await fake.close(); }
});
