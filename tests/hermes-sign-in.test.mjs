import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { companyHermesHome, hermesSignIn } from '../lib/hermes-sign-in.mjs';

// A company connects its own ChatGPT or Claude subscription through Hermes's own sign-in, in its own Hermes home (#3).
const command=resolve('tests/fake-hermes-cli.mjs');
const [a,b]=['10000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000b'];
const env={PATH:process.env.PATH,HERMES_COMPANY_HOMES:'',HERMES_COMMAND:`${process.execPath} ${command}`,SUPABASE_SERVICE_ROLE_KEY:'service-role-must-not-reach-hermes',WEBHOOK_ENCRYPTION_KEY:'encryption-key-must-not-reach-hermes'};
const setup=()=>{ const root=mkdtempSync(join(tmpdir(),'hermes-homes-')); const local={...env,HERMES_COMPANY_HOMES:root}; return {root,local,home:company=>/** @type {string} */(companyHermesHome(company,local))}; };
const listed=home=>execFileSync(process.execPath,[command,'auth','list'],{env:{PATH:process.env.PATH,HERMES_HOME:home},encoding:'utf8'});
const until=async check=>{ for(let i=0;i<100;i++) { const value=await check(); if(value) return value; await new Promise(next=>setTimeout(next,50)); } throw new Error('timed out'); };

test('each company has its own Hermes home under the configured root, and none without one',()=>{
 const {root,home}=setup();
 assert.equal(home(a),join(root,a));
 assert.notEqual(home(a),home(b));
 assert.equal(companyHermesHome(a,{...env,HERMES_COMPANY_HOMES:''}),null);
 assert.equal(companyHermesHome('../escape',{...env,HERMES_COMPANY_HOMES:root}),null);
});

test('an owner starts the sign-in, sees the link and the code, and the credential stays in that company home only',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local}); const other=hermesSignIn({home:home(b),env:local});
 const outcomes=[];
 const started=await signIn.start('openai-codex'); outcomes.push(started);
 assert.deepEqual(started,{state:'pending',link:'https://auth.example.test/device?provider=openai-codex',code:'WXYZ-4K8M'});
 // Asking again shows the same sign-in; no second one starts.
 outcomes.push(await signIn.start('openai-codex'));
 assert.deepEqual(outcomes[1],started);
 writeFileSync(join(home(a),'.finish-openai-codex'),'');
 outcomes.push(await until(async()=>{ const state=await signIn.state('openai-codex'); return state.state==='connected'&&state; }));
 outcomes.push(await signIn.state('anthropic'),await other.state('openai-codex'));
 assert.deepEqual(outcomes.slice(2).map(outcome=>outcome.state),['connected','disconnected','disconnected']);
 const secret=JSON.parse(readFileSync(join(home(a),'auth.json'),'utf8'))['openai-codex'].access_token;
 assert.match(listed(home(a)),new RegExp(secret));
 assert.equal(existsSync(join(home(b),'auth.json')),false);
 // Nothing gtmworks hands back carries the credential, though `auth list` prints it.
 assert.doesNotMatch(JSON.stringify(outcomes),/fake-subscription-secret/);
 // Hermes runs with the company home and none of gtmworks's own secrets.
 const seen=JSON.parse(readFileSync(join(home(a),'.env-add'),'utf8'));
 assert.ok(seen.includes('HERMES_HOME'));
 assert.deepEqual(seen.filter(name=>/SUPABASE|WEBHOOK|HERMES_COMPANY_HOMES|HERMES_COMMAND/.test(name)),[]);
});

test('disconnect removes the company credential with hermes auth remove, and auth list no longer lists it',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 await signIn.start('anthropic');
 writeFileSync(join(home(a),'.finish-anthropic'),'');
 await until(async()=>(await signIn.state('anthropic')).state==='connected');
 assert.match(listed(home(a)),/^anthropic /m);
 assert.deepEqual(await signIn.disconnect('anthropic'),{state:'disconnected'});
 assert.doesNotMatch(listed(home(a)),/anthropic/);
 assert.deepEqual(await signIn.state('anthropic'),{state:'disconnected'});
});

test('disconnect during a sign-in stops it, and a provider outside the list or a missing Hermes fails without throwing',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 await signIn.start('openai-codex');
 assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
 assert.deepEqual(await signIn.state('openai-codex'),{state:'disconnected'});
 assert.deepEqual(await signIn.start('gemini'),{state:'failed'});
 const missing=hermesSignIn({home:home(b),env:{...local,HERMES_COMMAND:join(home(b),'no-such-hermes')}});
 assert.deepEqual(await missing.start('openai-codex'),{state:'failed'});
 assert.deepEqual(await missing.state('openai-codex'),{state:'failed'});
});
