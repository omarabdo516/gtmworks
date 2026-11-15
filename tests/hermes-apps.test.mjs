import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile, readApps, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from '../lib/hermes.mjs';
import { levelConfig, alwaysOff, companyProfile } from '../lib/agent-levels.mjs';
import { apps, appByKey } from '../lib/app-catalogue.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The app driver (#30) against a fake of the pinned release's MCP routes: the Company's own profile, its apps' states,
// the sign-in that comes back through gtmworks, and removal. Nothing it answers carries the Engine's text, a path or a
// token.
const company='10000000-0000-0000-0000-000000000002';
const back=key=>`http://127.0.0.1:3000/api/apps/callback/${key}`;
async function companyEngine() {
 const fake=await fakeHermes();
 const name=companyProfile(company);
 const install={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
 await provideProfile(install,{name,soul:'',config:levelConfig(1),forbidden:alwaysOff});
 return {fake,target:{...install,profile:name},servers:()=>fake.settings.profiles.get(name).config.mcp_servers||{}};
}
const states=async target=>Object.fromEntries((await readApps(target)).apps.map(app=>[app.key,app.state]));
const signInState=url=>new URL(url).searchParams.get('state');

test('the apps listed are the registry apps the Engine offers, each off until connected', async () => {
 const {fake,target}=await companyEngine();
 try {
  fake.settings.catalog=fake.settings.catalog.filter(name=>name!=='gamma');
  const read=await readApps(target);
  assert.equal(read.state,'found');
  assert.deepEqual(read.apps.map(app=>app.key),apps.map(app=>app.key).filter(key=>key!=='gamma'));
  assert.deepEqual(read.apps[0],{key:'klaviyo',name:'Klaviyo',mark:'K',category:'communication',state:'off'});
  assert.ok(!read.apps.some(app=>['figma','webflow','wordpress-com'].includes(app.key)),'a catalogue entry outside the registry is never listed');
 } finally { await fake.close(); }
});

test('connecting writes only the read tools and the way back before the sign-in, and the sign-in comes back through gtmworks', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.managementRequests.length=0;
  const started=await startAppSignIn(target,'klaviyo',back('klaviyo'));
  assert.equal(started.state,'started');
  assert.equal(new URL(started.url).protocol,'https:');
  assert.equal(new URL(started.url).searchParams.get('redirect_uri'),back('klaviyo'));
  const steps=fake.settings.managementRequests.map(request=>`${request.method} ${request.path?.split('?')[0]}`);
  assert.deepEqual(steps,['GET /api/mcp/catalog','POST /api/mcp/catalog/install','PUT /api/config','POST /api/mcp/servers/klaviyo/auth']);
  assert.equal(fake.settings.managementRequests[1].body.enable,false,'installed off, and turned on only with its list');
  assert.equal(servers().klaviyo.enabled,true);
  assert.deepEqual(servers().klaviyo.tools,{include:[...appByKey('klaviyo').readTools],prompts:false,resources:false});
  assert.equal(servers().klaviyo.oauth.redirect_uri,back('klaviyo'));
  assert.equal((await states(target)).klaviyo,'attention','on, but not signed in yet');
  assert.deepEqual(await pollAppSignIn(target,started.flow),{state:'waiting'});

  const finished=await finishAppSignIn(target,{key:'klaviyo',flow:started.flow,answer:{code:'vendor-code',state:signInState(started.url),iss:'https://auth.klaviyo.example',scope:'everything',redirect:'https://evil.example'}});
  assert.deepEqual(finished,{state:'approved'});
  assert.deepEqual(fake.settings.appCallbacks.map(search=>[...new URLSearchParams(search).keys()]),[['code','state','iss']],'only what OAuth returns goes on');
  assert.equal((await states(target)).klaviyo,'connected');
  assert.deepEqual(await pollAppSignIn(target,started.flow),{state:'approved'});
 } finally { await fake.close(); }
});

test('an app on with any other tool list, or whose server does not answer, needs attention', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  for(const key of ['notion','canva']) {
   const started=await startAppSignIn(target,key,back(key));
   assert.equal((await finishAppSignIn(target,{key,flow:started.flow,answer:{code:'c',state:signInState(started.url)}})).state,'approved');
  }
  assert.deepEqual([(await states(target)).notion,(await states(target)).canva],['connected','connected']);
  servers().notion.tools.include=[...appByKey('notion').readTools,'notion-update-page'];
  delete servers().canva.tools.prompts;
  assert.deepEqual([(await states(target)).notion,(await states(target)).canva],['attention','attention']);
  const again=await startAppSignIn(target,'notion',back('notion'));
  assert.equal(again.state,'started');
  assert.deepEqual(servers().notion.tools.include,[...appByKey('notion').readTools],'connecting again writes the list back');
  await cancelAppSignIn(target,again.flow);
  assert.equal((await states(target)).notion,'connected');
  fake.settings.appsUnreachable.add('notion');
  const read=await readApps(target);
  assert.equal(read.apps.find(app=>app.key==='notion').state,'attention');
  assert.doesNotMatch(JSON.stringify(read),/opt|secret|hermes|token/i);
 } finally { await fake.close(); }
});

test('a server installed without its list is removed again when the list cannot be written', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  fake.settings.failStep='config';
  assert.deepEqual(await startAppSignIn(target,'airtable',back('airtable')),{state:'failed',flow:null,url:null});
  assert.equal(servers().airtable,undefined);
  assert.equal(fake.settings.appFlows.size,0,'no sign-in starts');
 } finally { await fake.close(); }
});

test('a second sign-in waits for the first, a cancelled or unknown one never finishes, and a bad answer is not passed on as text', async () => {
 const {fake,target}=await companyEngine();
 try {
  const first=await startAppSignIn(target,'close',back('close'));
  assert.equal((await startAppSignIn(target,'close',back('close'))).state,'busy');
  assert.deepEqual(await cancelAppSignIn(target,first.flow),{state:'cancelled'});
  assert.deepEqual(await pollAppSignIn(target,first.flow),{state:'failed'});
  assert.deepEqual(await finishAppSignIn(target,{key:'close',flow:first.flow,answer:{code:'c',state:signInState(first.url)}}),{state:'expired'});
  const second=await startAppSignIn(target,'close',back('close'));
  assert.deepEqual(await finishAppSignIn(target,{key:'close',flow:second.flow,answer:{code:'c',state:'forged'}}),{state:'expired'});
  assert.deepEqual(await finishAppSignIn(target,{key:'close',flow:second.flow,answer:{error:'access_denied',state:signInState(second.url)}}),{state:'failed'});
  assert.deepEqual(await pollAppSignIn(target,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),{state:'expired'});
  fake.settings.approveApps=false;
  const third=await startAppSignIn(target,'close',back('close'));
  assert.deepEqual(await finishAppSignIn(target,{key:'close',flow:third.flow,answer:{code:'c',state:signInState(third.url)},settle:2}),{state:'waiting'});
 } finally { await fake.close(); }
});

test('disconnecting turns the app off for the Company, and again changes nothing', async () => {
 const {fake,target,servers}=await companyEngine();
 try {
  const started=await startAppSignIn(target,'mixpanel',back('mixpanel'));
  await finishAppSignIn(target,{key:'mixpanel',flow:started.flow,answer:{code:'c',state:signInState(started.url)}});
  assert.deepEqual(await disconnectApp(target,'mixpanel'),{state:'disconnected'});
  assert.equal(servers().mixpanel,undefined);
  assert.equal((await states(target)).mixpanel,'off');
  assert.deepEqual(await disconnectApp(target,'mixpanel'),{state:'disconnected'});
 } finally { await fake.close(); }
});

test('only a Company profile, a registry app and an http way back are used; a refused key is refused', async () => {
 const {fake,target}=await companyEngine();
 try {
  assert.deepEqual(await readApps({...target,profile:'default'}),{state:'failed',apps:null});
  for(const [key,redirect,profile] of [['figma',back('figma'),target.profile],['klaviyo','javascript:alert(1)',target.profile],['klaviyo',back('klaviyo'),'default']])
   assert.equal((await startAppSignIn({...target,profile},key,redirect)).state,'failed',`${key} ${redirect} ${profile}`);
  assert.equal((await disconnectApp(target,'stripe')).state,'failed');
  assert.deepEqual(await readApps({...target,key:'wrong'}),{state:'refused',apps:null});
  assert.equal((await startAppSignIn({...target,key:'wrong'},'klaviyo',back('klaviyo'))).state,'refused');
  assert.equal(fake.settings.appFlows.size,0);
 } finally { await fake.close(); }
});
