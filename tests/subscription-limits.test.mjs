import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { companyHermesHome } from '../lib/hermes-sign-in.mjs';
import { busy, signInFor, signInLimits, subscriptionAction, subscriptionStates } from '../lib/subscription-sign-in.mjs';

// Reading a company's subscription state costs the Engine work (a `hermes auth list` child, or management calls), so it
// is bounded (#3): reads of one company and provider share one answer while it is asked and for a few seconds after,
// and new work has a global and a per-caller limit; past them the caller is told to wait (busy), nothing more starts.
const [a,b]=['10000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000b'];
const companies=Array.from({length:30},(_,index)=>`10000000-0000-0000-0000-${String(index+1).padStart(12,'0')}`);
const later=()=>new Promise(resolve=>setTimeout(resolve,20));
/** A sign-in stand-in that counts how many reads run at once and in all. */
function counted() {
 const seen={calls:0,running:0,most:0};
 const signIn={seen,state:async()=>{ seen.calls++; seen.running++; seen.most=Math.max(seen.most,seen.running); await later(); seen.running--; return {state:'disconnected'}; },
  start:async()=>{ seen.calls++; seen.running++; seen.most=Math.max(seen.most,seen.running); await later(); seen.running--; return {state:'pending',link:'https://auth.example.test/device',code:'WXYZ-4K8M'}; },
  disconnect:async()=>({state:'disconnected'}),complete:async()=>({state:'failed'})};
 return signIn;
}

test('thirty status reads of one company at once share one read per provider, and the answer is kept a few seconds',async()=>{
 const limits=signInLimits(); const signIn=counted();
 const answers=await Promise.all(Array.from({length:30},(_,index)=>subscriptionStates(signIn,{company:a,caller:`person-${index%3}`,limits})));
 assert.equal(signIn.seen.calls,2);
 for(const answer of answers) assert.deepEqual(answer,{providers:{'openai-codex':{state:'disconnected'},anthropic:{state:'disconnected'}}});
 await subscriptionStates(signIn,{company:a,caller:'person-0',limits});
 assert.equal(signIn.seen.calls,2);
 // A connect or disconnect makes the next read ask again.
 await subscriptionAction(signIn,{company:a,caller:'person-0',provider:'openai-codex',intent:'connect',limits});
 await subscriptionStates(signIn,{company:a,caller:'person-0',limits});
 assert.equal(signIn.seen.calls,4);
});

test('reads of many companies are bounded globally and per caller, and the rest are told to wait',async()=>{
 const limits=signInLimits({reads:4,perCaller:3}); const signIn=counted();
 const one=await Promise.all(companies.map(company=>subscriptionStates(signIn,{company,caller:'same-person',limits})));
 assert.ok(signIn.seen.most<=3,`${signIn.seen.most} at once`);
 assert.ok(one.filter(answer=>answer===busy).length>=25);
 const many=signInLimits({reads:4,perCaller:3}); const other=counted();
 const all=await Promise.all(companies.map((company,index)=>subscriptionStates(other,{company,caller:`person-${index}`,limits:many})));
 assert.ok(other.seen.most<=4,`${other.seen.most} at once`);
 assert.ok(all.filter(answer=>answer===busy).length>=20);
 assert.ok(all.some(answer=>answer!==busy));
});

test('connects are bounded globally and per caller',async()=>{
 const limits=signInLimits({actions:2,perCaller:1}); const signIn=counted();
 const answers=await Promise.all(companies.slice(0,10).map((company,index)=>subscriptionAction(signIn,{company,caller:`person-${index}`,provider:'openai-codex',intent:'connect',limits})));
 assert.ok(signIn.seen.most<=2);
 assert.ok(answers.filter(answer=>answer===busy).length>=8);
 const mine=await Promise.all([a,b].map(company=>subscriptionAction(signIn,{company,caller:'same-person',provider:'openai-codex',intent:'connect',limits})));
 assert.equal(mine.filter(answer=>answer===busy).length,1);
 // A provider or an intent outside the list does no work.
 assert.deepEqual(await subscriptionAction(signIn,{company:a,caller:'x',provider:'gemini',intent:'connect',limits}),{state:'failed'});
 assert.deepEqual(await subscriptionAction(signIn,{company:a,caller:'x',provider:'openai-codex',intent:'remove',limits}),{state:'failed'});
});

test('on the CLI path, thirty status reads at once start one `hermes auth list` per provider, not one per request',async()=>{
 const command=resolve('tests/fake-hermes-cli.mjs');
 const quoted=(/** @type {string} */ text)=>`'${text.replaceAll("'","'\\''")}'`;
 const launcher=join(mkdtempSync(join(tmpdir(),'fake hermes ')),'hermes');
 writeFileSync(launcher,`#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(command)} "$@"\n`,{mode:0o755});
 const env={PATH:process.env.PATH,HERMES_COMPANY_HOMES:mkdtempSync(join(tmpdir(),'hermes-homes-')),HERMES_COMMAND:launcher};
 const signIn=signInFor(a,env); assert.ok(signIn);
 const limits=signInLimits();
 const answers=await Promise.all(Array.from({length:30},(_,index)=>subscriptionStates(signIn,{company:a,caller:`person-${index}`,limits})));
 for(const answer of answers) assert.notEqual(answer,busy);
 const home=/** @type {string} */(companyHermesHome(a,env));
 assert.equal(readFileSync(join(home,'.seen-list'),'utf8').trim().split('\n').length,2);
 // Thirty different companies at once: no more children than the global limit.
 const homes=signInLimits({reads:4});
 await Promise.all(companies.map((company,index)=>subscriptionStates(/** @type {any} */(signInFor(company,env)),{company,caller:`person-${index}`,limits:homes})));
 const children=companies.map(company=>join(/** @type {string} */(companyHermesHome(company,env)),'.seen-list')).filter(existsSync).map(file=>readFileSync(file,'utf8').trim().split('\n').length).reduce((sum,count)=>sum+count,0);
 assert.ok(children<=4,`${children} children`);
});

test('the bundled Engine is used when the web app is wired to it, the CLI home otherwise, and nothing without either',()=>{
 const engine={GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_MANAGEMENT_URL:'http://hermes:9119',HERMES_API_KEY:'k'.repeat(64)};
 assert.equal(signInFor(a,{...engine,HERMES_COMPANY_HOMES:'/tmp/homes'})?.kind,'engine');
 assert.equal(signInFor(a,{HERMES_COMPANY_HOMES:'/tmp/homes'})?.kind,'home');
 assert.equal(signInFor(a,{}),null);
 assert.equal(signInFor(a,{...engine,HERMES_API_KEY:''}),null);
});
