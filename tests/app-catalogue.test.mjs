import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { apps, appByKey, appKey, appState, appConfig, knownApp, serverKeyOf, offeredApp, presetOf, customApp, openDesignGuide } from '../lib/app-catalogue.mjs';

// #458: the apps a Company's Agents may use are the pinned Engine's whole catalogue, gtmworks's ready-made remote servers
// and one card for the Owner's own server. Under ADR 0020 each app comes with every tool it lists, so the list holds no
// per-app tool filter at all.

// The manifest names in the pinned image (NousResearch/hermes-agent v0.23.0, optional-mcps/*/manifest.yaml), read from the
// tag itself. A name added or removed by a later image changes this list with that image.
const pinned=['airtable','algolia','alltrails','amplitude','asana','atlassian','attio','aws-knowledge','betterstack','buildkite','calendly','canva','circleci','clickup','close','cloudflare','cloudinary','comfy-cloud','context7','craft','datadog','deepwiki','dropbox','figma','fireflies','gamma','gitlab','globalping','grafana','hugging_face','indeed','intercom','kiwi','klaviyo','linear','microsoft-learn','miro','mixpanel','monday','motherduck','n8n-official','neon','netlify','notion','paypal','plaid','postman','prisma-postgres','railway','rentahuman','robinhood','semgrep','sentry','square','strava','stripe','supabase','todoist','trivago','twelve-data','twilio-docs','unreal-engine','vercel','webflow','wolfram','wordpress-com'];

test('every entry of the pinned Engine catalogue is offered, by the manifest name exactly', () => {
 assert.equal(pinned.length,66);
 const engine=apps.filter(app=>app.source==='engine').map(app=>app.key);
 assert.deepEqual(engine,pinned);
});

test('the list is unique, keyed by a server-safe name, and every card has a name, a mark and a category', () => {
 assert.equal(new Set(apps.map(app=>app.key)).size,apps.length);
 const categories=new Set(['ads','content','communication','analytics','sales','more']);
 for (const app of apps) {
  assert.match(app.key,appKey,app.key);
  assert.ok(app.name.trim()&&app.mark.trim(),app.key);
  assert.ok(categories.has(app.category),`${app.key}: ${app.category}`);
 }
});

test('a ready-made entry has an https address and its vendor documentation link, and the Engine entries carry only a sign-in kind', () => {
 const remote=apps.filter(app=>app.source==='remote');
 assert.ok(remote.length>=19,`${remote.length} ready-made entries`);
 for (const app of remote) {
  assert.match(app.url,/^https:\/\/[^\s]+$/,`${app.key}: https address`);
  assert.match(app.docs,/^https:\/\/[^\s]+$/,`${app.key}: vendor documentation`);
  assert.ok(['oauth','header','none'].includes(app.auth),`${app.key}: ${app.auth}`);
 }
 const none=['alltrails','aws-knowledge','context7','deepwiki','kiwi','microsoft-learn','trivago','twilio-docs','unreal-engine','wolfram'];
 for (const app of apps.filter(app=>app.source==='engine')) {
  assert.deepEqual([app.url,app.docs],[undefined,undefined],app.key);
  assert.equal(app.auth,none.includes(app.key)?'none':'oauth',app.key);
 }
 // The marketing entries the issue started with, and the token-sign-in ones that shape the form.
 for (const key of ['meta-ads','tiktok-ads','apollo','semrush','ahrefs','supermetrics','similarweb','brevo','mailchimp-transactional','zapier','make','buffer','hootsuite-content','hootsuite-inbox','hootsuite-listening','typeform','clay','lusha','x']) assert.ok(appByKey(key),key);
 for (const key of ['similarweb','brevo','mailchimp-transactional','x']) assert.equal(appByKey(key)?.auth,'header',key);
});

test('apps that reach customer records or money are marked so their card can say it', () => {
 const care=key=>appByKey(key)?.care;
 for (const key of ['intercom','attio','close','calendly','lusha']) assert.equal(care(key),'customers',key);
 for (const key of ['stripe','paypal','square','plaid','robinhood']) assert.equal(care(key),'money',key);
 assert.equal(care('notion'),undefined);
});

test('the config written for an app turns it on and brings an OAuth sign-in back to gtmworks, with no tool filter', () => {
 for (const app of apps.filter(entry=>entry.source!=='own'&&entry.source!=='custom')) {
  const redirect=`https://gtm.example/api/apps/callback/${app.key}`;
  assert.deepEqual(appConfig(app,redirect),{mcp_servers:{[app.key]:{enabled:true,...(app.auth==='oauth'?{oauth:{redirect_uri:redirect}}:{})}}},app.key);
 }
});

test('an app is off until installed, connected once the Engine reaches it, and needs attention otherwise', () => {
 assert.equal(appState(false,false),'off');
 assert.equal(appState(false,true),'off');
 assert.equal(appState(true,true),'connected');
 assert.equal(appState(true,false),'attention');
});

test('a server key is the name’s own words, and a known app is found by its name in any case', () => {
 assert.equal(serverKeyOf('My CRM'),'my-crm');
 assert.equal(serverKeyOf('  Acme  Tools!  '),'acme-tools');
 assert.equal(serverKeyOf(42),'');
 assert.equal(knownApp('hugging face')?.key,'hugging_face');
 assert.equal(appByKey('own')?.source,'own','the form is a card, never a server');
});

// #458: every offered app says what it is for, what it can do and its search words, in both catalogues.
test('every catalogue key has use, can and alias lines in English and Arabic', () => {
 const en=JSON.parse(readFileSync(new URL('../lib/messages/apps.en.json',import.meta.url),'utf8'));
 const ar=JSON.parse(readFileSync(new URL('../lib/messages/apps.ar.json',import.meta.url),'utf8'));
 for (const app of apps) for (const key of [`use.${app.key}`,`can.${app.key}`,`alias.${app.key}`]) {
  assert.equal(typeof en[key],'string',`en ${key}`);
  assert.equal(typeof ar[key],'string',`ar ${key}`);
  assert.ok(en[key].trim()&&ar[key].trim(),key);
 }
});

// Decision 0079 (ADR 0035): Open Design is a preset of the own-tool card, never an app gtmworks connects itself. A command
// server added under its name keeps its name and guide; any other server of that name is the Owner's own.
test('Open Design is a preset of the command card, linking its guide, and no app source runs it', () => {
  const entry = presetOf('open-design');
  assert.equal(entry?.source, 'own');
  assert.equal(entry.auth, 'command');
  assert.equal(entry.docs, openDesignGuide);
  assert.deepEqual(entry.preset, { command: 'node', args: ['/home/pn/open-design/apps/daemon/dist/cli.js', 'mcp', '--daemon-url', 'http://127.0.0.1:7456'] });
  assert.equal(offeredApp('open-design'), undefined);
  assert.equal(presetOf('own'), undefined);
  assert.ok(!apps.some(app => !['engine', 'remote', 'own'].includes(app.source)), 'no other source kind');
  assert.deepEqual([customApp('open-design', { command: true }).name, customApp('open-design', { command: true }).docs], ['Open Design', openDesignGuide]);
  assert.deepEqual([customApp('open-design').name, customApp('open-design').docs], ['open-design', undefined]);
  assert.equal(knownApp('Open Design')?.key, 'open-design', 'an Agent can ask for it by name');
});
