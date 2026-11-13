import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateSetupCode, setupCodeMatches } from '../lib/setup-code.mjs';
import { setupCodeFromHash, setupLink } from '../lib/setup-link.mjs';
import { generateInstallEnv, validateInstallEnv, missingInstallEnv, readyLine } from '../lib/install-env.mjs';

// First-run setup works only through the one-time link the installer prints (issue #50): whoever runs the installer on
// the server sets the install up, not whoever reaches /first-run first.
test('the setup code carries 256 bits of randomness, as 64 hex characters, and differs every time', () => {
 const codes=Array.from({length:20},generateSetupCode);
 for(const code of codes) assert.match(code,/^[a-f0-9]{64}$/);
 assert.equal(new Set(codes).size,codes.length);
});

test('the setup code comparison accepts only the exact code and refuses when the install has none', () => {
 const code=generateSetupCode();
 assert.equal(setupCodeMatches(code,code),true);
 for(const given of [null,undefined,'',code.slice(0,-1),`${code}0`,code.toUpperCase(),generateSetupCode(),` ${code}`,123,new File([code],'code')]) {
  assert.equal(setupCodeMatches(given,code),false,String(given));
 }
 // An install with no code, or a code that is not install-generated, opens to nobody.
 for(const expected of [undefined,'','replace-me','a'.repeat(64)]) assert.equal(setupCodeMatches(expected,expected),false,String(expected));
});

test('the setup code comparison is constant time: equal-length digests through timingSafeEqual, never ===', () => {
 const source=readFileSync('lib/setup-code.mjs','utf8');
 assert.match(source,/timingSafeEqual\(digest\(given\),digest\(expected\)\)/);
 assert.doesNotMatch(source,/given\s*===?\s*expected|expected\s*===?\s*given/);
});

test('a new install gets a setup code; an older one gains it; a bad one is refused', () => {
 const env=generateInstallEnv();
 assert.match(env.SETUP_CODE,/^[a-f0-9]{64}$/);
 assert.notEqual(env.SETUP_CODE,generateInstallEnv().SETUP_CODE);
 assert.doesNotThrow(()=>validateInstallEnv(env,{complete:true}));
 const older={...env}; delete older.SETUP_CODE;
 assert.doesNotThrow(()=>validateInstallEnv(older));
 assert.throws(()=>validateInstallEnv(older,{complete:true}),/SETUP_CODE/);
 for(const invalid of ['','replace-me','a'.repeat(64)]) assert.throws(()=>validateInstallEnv({...env,SETUP_CODE:invalid}),/SETUP_CODE/);
 assert.deepEqual(Object.keys(missingInstallEnv(older)),['SETUP_CODE']);
 assert.deepEqual(missingInstallEnv(env),{});
});

// The code travels after `#` (Omar, 2026-11-12): a browser never sends the fragment in a request, so no proxy or server
// request log receives it; the page reads it and sends it only in the submit request's body.
test('the ready line is the setup link, its code in the fragment, while setup is open and the sign-in address after', () => {
 const env={...generateInstallEnv(),APP_ORIGIN:'https://app.example.test'};
 assert.equal(readyLine(env,'open'),`Set up gtmworks with this one-time link: https://app.example.test/first-run#code=${env.SETUP_CODE}`);
 assert.equal(new URL(readyLine(env,'open').split(' ').at(-1)).search,'','no query string');
 for(const state of ['closed','',undefined]) {
  assert.equal(readyLine(env,state),'gtmworks is ready: https://app.example.test/sign-in');
 }
});

test('the page reads the code from the link fragment only', () => {
 const code=generateSetupCode();
 assert.equal(setupCodeFromHash(`#code=${code}`),code);
 assert.equal(setupCodeFromHash(setupLink('https://app.example.test',code).slice('https://app.example.test/first-run'.length)),code);
 for(const hash of ['','#','#code=','#other=1',`?code=${code}`]) assert.equal(setupCodeFromHash(hash),undefined,hash);
});

test('the first-run form sends the code only as a field of its POST body, read from the fragment', () => {
 const form=readFileSync('app/first-run/form.tsx','utf8');
 assert.match(form,/<form action="\/first-run\/submit" method="post"/);
 assert.match(form,/<input type="hidden" name="code" value=\{code\}\/>/);
 assert.match(form,/setupCodeFromHash\(window\.location\.hash\)/);
 // The server page no longer looks for a code: it cannot see the fragment, and a query string would reach the logs.
 assert.doesNotMatch(readFileSync('app/first-run/page.tsx','utf8'),/code/i);
 // The submit route reads the code from the body, never from the request address.
 const route=readFileSync('app/first-run/submit/route.ts','utf8');
 assert.match(route,/code=form\.get\('code'\)/);
 assert.doesNotMatch(route,/searchParams|nextUrl/);
});

test('the first-run form shows only after the server confirms the code, asked in the body of a submit request', () => {
 const form=readFileSync('app/first-run/form.tsx','utf8');
 // The check goes to the submit route as a POST body, like the submission itself: no other request carries the code.
 assert.match(form,/fetch\('\/first-run\/submit',\{method:'POST',body\}\)/);
 assert.match(form,/body\.set\('code',code\)/);
 assert.match(form,/body\.set\('check','1'\)/);
 assert.doesNotMatch(form,/console\.|fetch\(`/);
 // Nothing renders the form until the answer for this exact code is "open"; a missing or refused code gets the message.
 const gate=form.indexOf("if(!code || checked?.state!=='open') return <p role=\"alert\"");
 assert.ok(gate>0,'the form waits for the server to accept the code');
 assert.ok(gate<form.indexOf('<form action="/first-run/submit"'));
 // The route answers the check only after the code matched, and before it reads the details or creates anything.
 const route=readFileSync('app/first-run/submit/route.ts','utf8');
 const answer=route.indexOf("if(form.get('check')==='1') return new NextResponse(null,{status:204});");
 assert.ok(answer>route.indexOf('if(!setupCodeMatches(code))'),'the check is answered after the code comparison');
 assert.ok(answer<route.indexOf('firstRunInput(form)'),'the check is answered before the details are read');
 assert.ok(answer<route.indexOf('createUser'));
});

// A Docker stand-in: runs lib/install-env.mjs for real with the --env-file it was given, and answers the installer's
// question to the app with SETUP_STATE. Every command is recorded in COMMANDS.
const dockerShim=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *install-env.mjs*)
  file=; previous=; all="$*"
  for argument do [ "$previous" = --env-file ] && file=$argument; previous=$argument; done
  if [ -z "$file" ]; then exec node "$INSTALL_ENV" \${all##*install-env.mjs }; fi
  exec env -i PATH="$PATH" sh -c 'set -a; case "$1" in /*) . "$1";; *) . "./$1";; esac; set +a; shift; exec node "$@"' sh "$file" "$INSTALL_ENV" \${all##*install-env.mjs };;
 *'exec -T db psql'*) cat > /dev/null;;
 *'exec -T web node'*) echo "$SETUP_STATE";;
esac
`;
function installDirectory(t) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-setup-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','lib','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'bin/docker'),dockerShim,{mode:0o755});
 const commands=join(directory,'commands');
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,INSTALL_ENV:join(process.cwd(),'lib/install-env.mjs'),COMMANDS:commands,GH_TOKEN:''};
 return {run:(state,...args)=>{ writeFileSync(commands,''); return spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,env:{...env,SETUP_STATE:state},encoding:'utf8'}); },
  commands:()=>readFileSync(commands,'utf8').trimEnd().split('\n'),
  code:()=>/^SETUP_CODE=([a-f0-9]{64})$/m.exec(readFileSync(join(directory,'.env.install'),'utf8'))?.[1]};
}

test('the installer ends with the setup link, prints the code nowhere else, repeats it until setup, then prints sign-in', t => {
 const install=installDirectory(t);
 const first=install.run('open');
 assert.equal(first.status,0,first.stderr);
 const code=install.code();
 assert.ok(code,'the first install writes a setup code to .env.install');
 const lines=first.stdout.trimEnd().split('\n');
 const link=`Set up gtmworks with this one-time link: http://localhost:3000/first-run#code=${code}`;
 assert.equal(lines.at(-1),link);
 assert.equal((first.stdout+first.stderr).split(code).length-1,1,'the code appears only in the setup link');
 const again=install.run('open');
 assert.equal(again.status,0,again.stderr);
 assert.equal(install.code(),code);
 assert.equal(again.stdout.trimEnd().split('\n').at(-1),link);
 const after=install.run('closed');
 assert.equal(after.status,0,after.stderr);
 assert.equal(after.stdout.trimEnd().split('\n').at(-1),'gtmworks is ready: http://localhost:3000/sign-in');
 assert.ok(!(after.stdout+after.stderr).includes(code));
});

// The worker reaches the database through the gateway (NEXT_PUBLIC_SUPABASE_URL). Recreating the gateway once the worker
// runs makes its loops log `Webhook worker: fetch failed`, which the install job reads as a worker refusing its
// configuration. With the code in the fragment no request line carries it, so the gateway needs no new log rules.
test('install and update restart no service once the worker runs', t => {
 const install=installDirectory(t);
 for(const args of [[],['update','main']]) {
  const result=install.run('open',...args);
  assert.equal(result.status,0,`${args.join(' ')||'install'}: ${result.stderr}`);
  const commands=install.commands();
  const started=commands.findIndex(command=>/compose .* up -d (--no-deps )?--wait --wait-timeout 300( (auth )?hermes web worker)?$/.test(command));
  assert.ok(started>=0,commands.join('\n'));
  assert.deepEqual(commands.slice(started+1).filter(command=>/ (up|restart|stop|down)\b|--force-recreate/.test(command)),[],`${args.join(' ')||'install'}:\n${commands.join('\n')}`);
 }
});

test('the installer asks the app whether setup is open, through the service role, before it prints the last line', () => {
 const installer=readFileSync('scripts/install.sh','utf8');
 const ask=installer.indexOf('rest/v1/rpc/setup_is_open'), ready=installer.indexOf('install-env.mjs ready');
 assert.ok(ask>0 && ready>ask,'setup_is_open is asked first');
 assert.ok(installer.trimEnd().split('\n').slice(-6).some(line=>line.includes('install-env.mjs ready')),'the ready line is printed last');
});

test('the install job checks the setup link before and after setup, and that no container logs the code', async () => {
 const {load}=await import('js-yaml');
 const run=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.find(step=>step.env?.INSTALL_REF).run;
 const at=text=>{ const index=run.indexOf(text); assert.notEqual(index,-1,text); return index; };
 const localCheck=run.indexOf('-e APP_ORIGIN=http://localhost:3000 -e MAIL_URL');
 // The first install ends with the link, its code in no other line; a repeat before setup prints the same link.
 assert.ok(at("{ sh scripts/install.sh || fail 'first install'; } 2>&1 | tee first-install.log")<at("code=$(sed -n 's/^SETUP_CODE=//p' .env.install)"));
 at('link="Set up gtmworks with this one-time link: http://localhost:3000/first-run#code=$code"');
 at('[[ $(tail -n 1 first-install.log) == "$link" ]]');
 at('[[ $(grep -cF "$code" first-install.log) == 1 ]]');
 at("if grep -qF '?code=' first-install.log; then fail");
 assert.ok(at('[[ $(tail -n 1 repeat-before-setup.log) == "$link" ]]')<localCheck,'repeated while setup is still open');
 // The links check completes setup with the code; afterwards no container log holds it and a repeat prints sign-in.
 assert.ok(localCheck<at('if grep -qF "$code" <<< "$logs"; then fail'));
 assert.ok(localCheck<at("[[ $(tail -n 1 repeat-after-setup.log) == 'gtmworks is ready: http://localhost:3000/sign-in' ]]"));
 at('if grep -qF "$code" repeat-after-setup.log; then fail');
 at('[[ $(tail -n 1 proxied-install.log) == "Set up gtmworks with this one-time link: $public/first-run#code=$code" ]]');
 assert.doesNotMatch(run,/first-run\?code=/,'no link in the job carries the code in its query string');
 const checks=[...run.matchAll(/docker run [^\n]*(?:\\\n[^\n]*)*node --input-type=module - < scripts\/check-install-proxy\.mjs/g)];
 assert.equal(checks.length,2);
 for(const {0:command} of checks) assert.ok(command.includes("--env-file <(grep -E '^SETUP_CODE=' .env.install)"),command);
});

// The issue's check for the fragment decision: the gateway's access log, written while the local check opens first run
// and completes setup with the code, never holds the code; it did log those requests, so the search is not of nothing.
test('the install job reads the gateway access log after setup and finds the setup requests but not the code', async () => {
 const {load}=await import('js-yaml');
 const run=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.find(step=>step.env?.INSTALL_REF).run;
 const at=text=>{ const index=run.indexOf(text); assert.notEqual(index,-1,text); return index; };
 const localCheck=at('-e APP_ORIGIN=http://localhost:3000 -e MAIL_URL');
 const read=at("gateway_logs=$(compose logs gateway 2>&1) || fail 'read gateway logs'");
 assert.ok(localCheck<read,'read after setup is completed');
 assert.ok(read<at("grep -qF 'POST /first-run/submit' <<< \"$gateway_logs\" || fail"));
 assert.ok(read<at('if grep -qF "$code" <<< "$gateway_logs"; then fail'));
});
