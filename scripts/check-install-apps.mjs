// CI runs this on stdin inside /app in the installed web container, after check-install-profiles.mjs prepare, on the
// pinned Hermes release (#30). On the first company's own profile, with no vendor sign-in: every app of the registry is
// in the pinned catalogue; connecting writes exactly the app's read tools and the way back to gtmworks; a way back the
// Engine does not know reads as expired, with none of its text; disconnecting turns the app off. It prints states only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const {readApps,prepareApp,finishAppSignIn,disconnectApp}=await import(`${process.cwd()}/lib/hermes.mjs`);
const {apps,appByKey}=await import(`${process.cwd()}/lib/app-catalogue.mjs`);
const {appUrl}=await import(`${process.cwd()}/lib/app-origin.mjs`);

const key=process.env.HERMES_API_KEY;
assert.ok(key,'the install key is in the web container');
const [{profile}]=JSON.parse(readFileSync('/tmp/check-install-profiles.json','utf8'));
const target={address:'http://hermes:8642',managementAddress:'http://hermes:9119',profile,key};
const stateOf=async name=>(await readApps(target)).apps?.find(app=>app.key===name)?.state;

const listed=await readApps(target);
assert.equal(listed.state,'found');
assert.deepEqual(listed.apps.map(app=>app.key),apps.map(app=>app.key),'every app of the registry is in the pinned catalogue');
const back=appUrl('/api/apps/callback/klaviyo').href;
assert.equal(await prepareApp(target,'klaviyo',back),null,'klaviyo installed with its list');
const config=await (await fetch(`http://hermes:9119/api/config?profile=${profile}`,{headers:{Authorization:`Bearer ${key}`}})).json();
assert.deepEqual(config.mcp_servers?.klaviyo?.tools,{include:[...appByKey('klaviyo').readTools],prompts:false,resources:false},'only the read tools are written');
assert.equal(config.mcp_servers?.klaviyo?.oauth?.redirect_uri,back,'the sign-in comes back through gtmworks');
assert.equal(await stateOf('klaviyo'),'attention','on, but not signed in');
assert.deepEqual(await finishAppSignIn(target,{key:'klaviyo',flow:'install-check-unknown-flow',answer:{code:'bogus',state:'bogus'}}),{state:'expired'});
assert.deepEqual(await disconnectApp(target,'klaviyo'),{state:'disconnected'});
assert.equal(await stateOf('klaviyo'),'off');
console.log(JSON.stringify({profile,apps:listed.apps.length,klaviyo:'read tools and way back written; unknown way back expired; disconnected'}));
