import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile } from '../lib/engine/agents.mjs';
import { readApps, prepareApp, prepareServer, prepareCommandServer, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp, turnOffApp, testServer } from '../lib/engine/apps.mjs';
import { toolConfig, companyProfile } from '../lib/agent-toolsets.mjs';
import { apps, openDesignGuide } from '../lib/app-catalogue.mjs';
import { sandboxCommandOf } from '../lib/sandbox-command.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The app driver (#30, #458) against a fake of the pinned release's MCP routes: the catalogued apps, a ready-made remote
// server, a server the Owner added, the three sign-in kinds and removal. No config it writes carries a tool filter, and
// no answer carries the Engine's text, a path or a token, but the reason a failed Test gives, redacted by the Engine (#947).
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

test('Test answers the tools the server lists, by name only, and the Engine’s own reason when it does not answer', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.appTools['meta-ads']=['get_campaigns','create_campaign'];
  fake.settings.appTokens.add(`${target.profile}:meta-ads`);
  await prepareApp(target,'meta-ads',back('meta-ads'));
  const listed=await testServer(target,'meta-ads');
  assert.deepEqual(listed,{state:'connected',tools:['get_campaigns','create_campaign']});
  assert.equal('reason' in listed,false,'an answer that connected carries no reason');
  fake.settings.appErrors['meta-ads']='Unsupported MCP-Protocol-Version: 2025-11-25';
  assert.deepEqual(await testServer(target,'meta-ads'),{state:'attention',tools:[],reason:'Unsupported MCP-Protocol-Version: 2025-11-25'});
  assert.deepEqual(await testServer(target,'not a key'),{state:'failed',tools:null});
 } finally { await fake.close(); }
});

test('a reason longer than a card shows is cut between words, and empty words leave no reason', async () => {
 const {fake,target}=await companyEngine();
 try {
  await prepareApp(target,'meta-ads',back('meta-ads'));
  fake.settings.appErrors['meta-ads']='Unsupported MCP-Protocol-Version: 2025-11-25. '+'detail '.repeat(200);
  const tested=await testServer(target,'meta-ads');
  assert.equal(tested.state,'attention');
  assert.match(tested.reason,/^Unsupported MCP-Protocol-Version: 2025-11-25\. detail/);
  assert.ok(tested.reason.length<=200,`${tested.reason.length} characters`);
  assert.equal(tested.reason,tested.reason.trim());
  fake.settings.appErrors['meta-ads']='   ';
  assert.deepEqual(await testServer(target,'meta-ads'),{state:'attention',tools:[]},'nothing to say leaves no reason line');
  fake.settings.appErrors['meta-ads']='x'.repeat(500);
  assert.deepEqual(await testServer(target,'meta-ads'),{state:'attention',tools:[]},'a word longer than the card is dropped whole, never cut to its prefix');
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

// Open Design is the Owner's (decision 0079, ADR 0035): its card is the own-tool form filled in for a command in the work
// sandbox, and once added under its name it is a command server like any other. No path makes, keys or removes a design
// profile: nothing gtmworks asks the Engine names an `od-` profile.
test('Open Design is a preset of the command card: a form until its server is added, then one command server card', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.managementRequests.length=0;
  const preset=apps.find(app=>app.key==='open-design');
  assert.equal(preset?.source,'own');
  assert.deepEqual(preset.preset,{command:'node',args:['/home/pn/open-design/apps/daemon/dist/cli.js','mcp','--daemon-url','http://127.0.0.1:7456']});
  const before=(await readApps(target,{test:false})).apps.filter(app=>app.key==='open-design');
  assert.deepEqual(before.map(app=>[app.source,app.installed,app.state]),[['own',false,'off']]);
  assert.deepEqual(before[0].preset,preset.preset,'the card carries what the form is filled with');
  assert.equal(await prepareApp(target,'open-design',null),'failed','nothing connects Open Design but the command card');
  assert.equal(await prepareCommandServer(target,{key:'open-design',...preset.preset}),null);
  assert.equal(sandboxCommandOf(servers()['open-design'])?.command,'node','a command server like any other, run in the work sandbox');
  const after=(await readApps(target,{test:false})).apps.filter(app=>app.key==='open-design');
  assert.equal(after.length,1,'one card per name: the server stands for the preset');
  assert.deepEqual({source:after[0].source,name:after[0].name,auth:after[0].auth,command:after[0].command,args:after[0].args,docs:after[0].docs,installed:after[0].installed},
   {source:'custom',name:'Open Design',auth:'command',command:'node',args:preset.preset.args,docs:openDesignGuide,installed:true});
  assert.deepEqual(await turnOffApp(target,'open-design'),{state:'disconnected'},'off for one Agent keeps it, as for any server the Owner added');
  assert.equal(servers()['open-design'].enabled,false);
  assert.deepEqual(await disconnectApp(target,'open-design'),{state:'disconnected'});
  assert.equal(servers()['open-design'],undefined);
  assert.equal((await readApps(target,{test:false})).apps.find(app=>app.key==='open-design')?.source,'own','the form is back');
  const named=fake.settings.managementRequests.map(request=>`${request.method} ${request.path}`).filter(request=>/od-|\/api\/profiles(?:\?|$)/.test(request));
  assert.deepEqual(named,[],'no design profile is listed, made or keyed');
 } finally { await fake.close(); }
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
  assert.deepEqual(await startAppSignIn(target,'tiktok-ads',back('tiktok-ads')),{state:'failed',flow:null,url:null,detail:'Internal error at /opt/data/mcp'});
  fake.settings.appAuthFailure={status:502,detail:'Registration failed: 400 invalid_client_metadata'};
  assert.equal((await startAppSignIn(target,'tiktok-ads',back('tiktok-ads'))).reason,'registration');
  // Only an explicit refusal is the vendor's: a registration that timed out is a fault, with Hermes's words for the log.
  fake.settings.appAuthFailure={status:502,detail:'Dynamic client registration request timed out'};
  assert.deepEqual(await startAppSignIn(target,'tiktok-ads',back('tiktok-ads')),{state:'failed',flow:null,url:null,detail:'Dynamic client registration request timed out'});
  // The reason is read from the whole answer, before its words are bounded.
  fake.settings.appAuthFailure={status:502,detail:`${'x'.repeat(450)} Registration failed: 400 invalid_client_metadata`};
  assert.equal((await startAppSignIn(target,'tiktok-ads',back('tiktok-ads'))).reason,'registration');
 } finally { await fake.close(); }
});
