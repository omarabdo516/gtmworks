import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { companyHermesHome, credentialIds, deviceCode, hermesSignIn } from '../lib/hermes-sign-in.mjs';

// A company connects its own ChatGPT or Claude subscription through Hermes's own sign-in, in its own Hermes home (#3).
const command=resolve('tests/fake-hermes-cli.mjs');
// HERMES_COMMAND is one program path, never split: the fake is reached through a launcher in a folder with a space.
const quoted=(/** @type {string} */ text)=>`'${text.replaceAll("'","'\\''")}'`;
const launcher=join(mkdtempSync(join(tmpdir(),'fake hermes ')),'hermes');
writeFileSync(launcher,`#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(command)} "$@"\n`,{mode:0o755});
const [a,b]=['10000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000b'];
const env={PATH:process.env.PATH,HERMES_COMPANY_HOMES:'',HERMES_COMMAND:launcher,SUPABASE_SERVICE_ROLE_KEY:'service-role-must-not-reach-hermes',WEBHOOK_ENCRYPTION_KEY:'encryption-key-must-not-reach-hermes'};
const setup=()=>{ const root=mkdtempSync(join(tmpdir(),'hermes-homes-')); const local={...env,HERMES_COMPANY_HOMES:root}; return {root,local,home:company=>/** @type {string} */(companyHermesHome(company,local))}; };
const listed=home=>execFileSync(process.execPath,[command,'auth','list'],{env:{PATH:process.env.PATH,HERMES_HOME:home},encoding:'utf8'});
// The arguments and environment of every run of one `auth` action in a home, as the fake records them.
const runs=(home,action)=>readFileSync(join(home,`.seen-${action}`),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const accepted='fake-authorization-code-7Q2P';
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
 // The credential is stored in this company's home, which `auth list` there reports, and in no other home.
 const secret=JSON.parse(readFileSync(join(home(a),'auth.json'),'utf8'))['openai-codex'][0].access_token;
 assert.match(secret,/^fake-subscription-secret-/);
 assert.match(listed(home(a)),/^openai-codex \(1 credential\):\n {2}#1 .* id=[0-9a-f]+ /m);
 assert.equal(existsSync(join(home(b),'auth.json')),false);
 // Nothing gtmworks hands back carries the credential.
 assert.doesNotMatch(JSON.stringify(outcomes),/fake-subscription-secret/);
 // Hermes runs with the company home and none of gtmworks's own secrets.
 const seen=JSON.parse(readFileSync(join(home(a),'.env-add'),'utf8'));
 assert.ok(seen.includes('HERMES_HOME'));
 assert.deepEqual(seen.filter(name=>/SUPABASE|WEBHOOK|HERMES_COMPANY_HOMES|HERMES_COMMAND/.test(name)),[]);
});

test('disconnect removes the company credential with hermes auth remove, and auth list no longer lists it',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 await signIn.start('anthropic');
 assert.deepEqual(await signIn.complete('anthropic',accepted),{state:'connected'});
 assert.match(listed(home(a)),/^anthropic /m);
 const [id]=/** @type {string[]} */(credentialIds(listed(home(a)),'anthropic'));
 assert.deepEqual(await signIn.disconnect('anthropic'),{state:'disconnected'});
 assert.doesNotMatch(listed(home(a)),/anthropic/);
 assert.deepEqual(await signIn.state('anthropic'),{state:'disconnected'});
 // `auth remove` was given the provider and the credential's id as its target, and the credential is gone from the home.
 assert.deepEqual(runs(home(a),'remove').map(run=>run.argv),[['auth','remove','anthropic',id]]);
 assert.deepEqual(JSON.parse(readFileSync(join(home(a),'auth.json'),'utf8')),{});
});

test('disconnect removes every credential of that provider by id and leaves the other provider signed in',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 mkdirSync(home(a),{recursive:true});
 writeFileSync(join(home(a),'auth.json'),JSON.stringify({
  'openai-codex':[{id:'first_1',label:'work',access_token:'fake-subscription-secret-1'},{id:'second-2',label:'personal',access_token:'fake-subscription-secret-2'}],
  anthropic:[{id:'claude_3',label:'openai-codex',access_token:'fake-subscription-secret-3'}],
 }));
 assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
 assert.deepEqual(runs(home(a),'remove').map(run=>run.argv.slice(2)),[['openai-codex','first_1'],['openai-codex','second-2']]);
 assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(home(a),'auth.json'),'utf8'))),['anthropic']);
 // A Claude credential whose label names ChatGPT does not make ChatGPT connected.
 assert.deepEqual(await signIn.state('openai-codex'),{state:'disconnected'});
 assert.deepEqual(await signIn.state('anthropic'),{state:'connected'});
});

test('the credential ids are read under the provider header only, and the header alone means connected',()=>{
 const output=['openai-codex (2 credentials):','  #1  work                 oauth id=first_1 priority=0 device_code ok ←','  #2  personal             oauth id=second-2 priority=0 device_code ok','',
  'anthropic (1 credential):','  #1  openai-codex         oauth id=claude_3 priority=0 claude_oauth ok ←','',
  'External CLI logins (Codex CLI, Claude Code) are not adopted: sign in with `hermes auth add` instead.'].join('\n');
 assert.deepEqual(credentialIds(output,'openai-codex'),['first_1','second-2']);
 assert.deepEqual(credentialIds(output,'anthropic'),['claude_3']);
 assert.equal(credentialIds('External CLI logins (Codex CLI, Claude Code) are not adopted: openai-codex anthropic',`openai-codex`),null);
 assert.equal(credentialIds('  #1  openai-codex         oauth id=x priority=0\n','openai-codex'),null);
});

test('the fake keeps Hermes\'s contract: remove needs a target, and the Claude sign-in saves nothing without an input line',()=>{
 const home=mkdtempSync(join(tmpdir(),'hermes-contract-')); const options={env:{PATH:process.env.PATH,HERMES_HOME:home},encoding:/** @type {const} */('utf8')};
 assert.equal(spawnSync(process.execPath,[command,'auth','remove','anthropic'],options).status,2);
 const ended=spawnSync(process.execPath,[command,'auth','add','anthropic','--type','oauth','--no-browser'],{...options,input:''});
 assert.notEqual(ended.status,0);
 assert.match(ended.stdout,/After authorizing, you will see a code\. Paste it below\.\nAuthorization code: /);
 assert.equal(existsSync(join(home,'auth.json')),false);
});

test('a Claude sign-in waits for the pasted code, which reaches Hermes only on its input and is never handed back',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 const outcomes=[await signIn.start('anthropic')];
 assert.deepEqual(outcomes[0],{state:'pending',link:'https://auth.example.test/oauth/authorize?provider=anthropic',code:null,needsCode:true});
 // An empty, multi-line or overlong code is refused without being sent, and the sign-in keeps waiting.
 for(const code of ['','   ','one\ntwo',accepted.padEnd(513,'x'),undefined,42]) outcomes.push(await signIn.complete('anthropic',code));
 assert.deepEqual(outcomes.slice(1).map(outcome=>outcome.state),['failed','failed','failed','failed','failed','failed']);
 assert.deepEqual(await signIn.state('anthropic'),outcomes[0]);
 // ChatGPT's device sign-in takes no code.
 assert.deepEqual(await signIn.complete('openai-codex',accepted),{state:'failed'});
 // A code Hermes does not accept ends that sign-in, and nothing is saved.
 assert.deepEqual(await signIn.complete('anthropic','wrong-code'),{state:'failed'});
 assert.equal(existsSync(join(home(a),'auth.json')),false);
 assert.deepEqual(await signIn.state('anthropic'),{state:'disconnected'});
 outcomes.push(await signIn.start('anthropic'));
 outcomes.push(await signIn.complete('anthropic',`  ${accepted}  `));
 assert.deepEqual(outcomes.at(-1),{state:'connected'});
 assert.doesNotMatch(JSON.stringify(outcomes),/fake-authorization-code|wrong-code|fake-subscription-secret/);
 assert.doesNotMatch(JSON.stringify(runs(home(a),'add')),/fake-authorization-code|wrong-code/);
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

test('the device code is found on the line after its label as well as on the same line',()=>{
 assert.equal(deviceCode('Open https://auth.example.test/device\nEnter this code:\n    WXYZ-4K8M\nWaiting...'),'WXYZ-4K8M');
 assert.equal(deviceCode('\u001b[1mEnter this code:\u001b[0m\r\n\u001b[36mWXYZ-4K8M\u001b[0m'),'WXYZ-4K8M');
 assert.equal(deviceCode('Then enter this code: CLDE-7Q2P'),'CLDE-7Q2P');
 assert.equal(deviceCode('Open https://auth.example.test/device?provider=openai-codex\nWaiting...'),null);
});

test('two connects at once share one sign-in, and a disconnect while it is starting leaves no Hermes running',async()=>{
 const {home,local}=setup(); const signIn=hermesSignIn({home:home(a),env:local});
 const [first,second]=await Promise.all([signIn.start('openai-codex'),signIn.start('openai-codex')]);
 assert.deepEqual(second,first);
 assert.equal(first.state,'pending');
 assert.equal(readFileSync(join(home(a),'.adds'),'utf8'),'openai-codex\n');
 assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
 // A disconnect that arrives while the connect is still asking `auth list` stops it before any sign-in starts.
 const starting=signIn.start('anthropic');
 assert.deepEqual(await signIn.disconnect('anthropic'),{state:'disconnected'});
 assert.equal((await starting).state,'disconnected');
 assert.equal(readFileSync(join(home(a),'.adds'),'utf8'),'openai-codex\n');
 assert.deepEqual(await signIn.state('anthropic'),{state:'disconnected'});
});
