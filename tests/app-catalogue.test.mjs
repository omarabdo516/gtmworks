import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apps, appByKey, appState, appConfig } from '../lib/app-catalogue.mjs';

// The include list is the only way a connected app's tool reaches an Agent (#30): the Engine registers exactly the
// names listed, matched as exact names or globs, so a list with a glob or a tool that acts would expose more than
// reading. A name is split into its words on `_`, `-` and case changes, so a word inside another word (the "set" in
// "dataset") is not a verb.
const acting=new Set(['create','update','delete','send','publish','schedule','add','remove','edit','set','post','trigger','import','upload','charge','refund','pay','transfer','cancel','archive','merge','invite','assign','move','write','put','patch','submit','execute']);
const words=name=>name.split(/[_-]|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map(word=>word.toLowerCase());

test('a name is split into whole words on underscores, hyphens and case changes', () => {
 assert.deepEqual(words('get_brand_template_dataset'),['get','brand','template','dataset']);
 assert.deepEqual(words('Describe-Cohort-Schema'),['describe','cohort','schema']);
 assert.deepEqual(words('createCampaignDraft'),['create','campaign','draft']);
 assert.deepEqual(words('event_types-list_event_types'),['event','types','list','event','types']);
});

test('every app lists only exact names of tools that read, with no name twice', () => {
 for (const app of apps) {
  assert.ok(app.readTools.length>0,`${app.key} offers its Agents something to read`);
  assert.equal(new Set(app.readTools).size,app.readTools.length,`${app.key}: no tool listed twice`);
  for (const tool of app.readTools) {
   assert.match(tool,/^[A-Za-z0-9_-]+$/,`${app.key}: ${tool} is an exact name, never a glob`);
   assert.deepEqual(words(tool).filter(word=>acting.has(word)),[],`${app.key}: ${tool} acts`);
  }
 }
});

test('the check fails for a tool that acts and passes for reviewed reads that look like verbs', () => {
 const acts=tool=>words(tool).some(word=>acting.has(word));
 for (const tool of ['create_campaign','Update-Report','send-email','assignTask','notion-move-pages']) assert.ok(acts(tool),tool);
 for (const tool of ['get_brand_template_dataset','Run-Query','run-basic-report','render_email_template','get_flows_triggered_by_metric']) assert.ok(!acts(tool),tool);
});

test('the config written for every app turns it on with only its read tools and brings its sign-in back to gtmworks', () => {
 for (const app of apps) {
  const redirect=`https://gtm.example/api/apps/callback/${app.key}`;
  assert.deepEqual(appConfig(app,redirect),{mcp_servers:{[app.key]:{enabled:true,tools:{include:[...app.readTools],prompts:false,resources:false},oauth:{redirect_uri:redirect}}}});
 }
});

test('the registry holds the reviewed apps once each, keyed by the catalogue name, and nothing that moves money', () => {
 assert.deepEqual(apps.map(app=>app.key),['klaviyo','canva','notion','airtable','gamma','intercom','amplitude','mixpanel','attio','close','calendly']);
 for (const left of ['figma','webflow','wordpress-com','stripe','paypal']) assert.equal(appByKey(left),undefined,left);
 assert.equal(appByKey('notion')?.name,'Notion');
 assert.throws(()=>{ /** @type {any} */(apps[0].readTools).push('delete_campaign'); },TypeError,'a list cannot grow at run time');
});

test('an app is off until installed, connected once the Engine reaches it with a sign-in, and needs attention otherwise', () => {
 assert.equal(appState(false,false),'off');
 assert.equal(appState(false,true),'off');
 assert.equal(appState(true,true),'connected');
 assert.equal(appState(true,false),'attention');
});
