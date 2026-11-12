import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateSetupCode, setupCodeMatches } from '../lib/setup-code.mjs';
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

test('the ready line is the setup link while setup is open and the sign-in address after', () => {
 const env={...generateInstallEnv(),APP_ORIGIN:'https://app.example.test'};
 assert.equal(readyLine(env,'open'),`Set up gtmworks with this one-time link: https://app.example.test/first-run?code=${env.SETUP_CODE}`);
 for(const state of ['closed','',undefined]) {
  assert.equal(readyLine(env,state),'gtmworks is ready: https://app.example.test/sign-in');
 }
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
 const link=`Set up gtmworks with this one-time link: http://localhost:3000/first-run?code=${code}`;
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

// The gateway reads install-nginx.conf once, through a bind mount fixed when its container is made, and an update
// starts only hermes, web and worker. Without a recreated gateway, an upgraded install keeps the old log format, which
// writes the setup link's code to the access log (Codex review of issue #50's pull request).
test('install and update recreate the gateway, so the new nginx configuration applies before the link is printed', t => {
 const install=installDirectory(t);
 for(const args of [[],['update','main']]) {
  const result=install.run('open',...args);
  assert.equal(result.status,0,`${args.join(' ')||'install'}: ${result.stderr}`);
  const commands=install.commands();
  const recreate=commands.findIndex(command=>/compose .* up -d --no-deps --force-recreate --wait --wait-timeout 300 gateway$/.test(command));
  const ready=commands.findIndex(command=>/install-env\.mjs ready open$/.test(command));
  assert.ok(recreate>=0,`${args.join(' ')||'install'} recreates the gateway:\n${commands.join('\n')}`);
  assert.ok(recreate<ready,'before the setup link is printed');
  // The app is up first, so the recreated gateway has something to route to.
  assert.ok(commands.findIndex(command=>/up -d (--no-deps )?--wait --wait-timeout 300( hermes web worker)?$/.test(command))<recreate);
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
 at('link="Set up gtmworks with this one-time link: http://localhost:3000/first-run?code=$code"');
 at('[[ $(tail -n 1 first-install.log) == "$link" ]]');
 at('[[ $(grep -cF "$code" first-install.log) == 1 ]]');
 assert.ok(at('[[ $(tail -n 1 repeat-before-setup.log) == "$link" ]]')<localCheck,'repeated while setup is still open');
 // The links check completes setup with the code; afterwards no container log holds it and a repeat prints sign-in.
 assert.ok(localCheck<at('if grep -qF "$code" <<< "$logs"; then fail'));
 assert.ok(localCheck<at("[[ $(tail -n 1 repeat-after-setup.log) == 'gtmworks is ready: http://localhost:3000/sign-in' ]]"));
 at('if grep -qF "$code" repeat-after-setup.log; then fail');
 at('[[ $(tail -n 1 proxied-install.log) == "Set up gtmworks with this one-time link: $public/first-run?code=$code" ]]');
 const checks=[...run.matchAll(/docker run [^\n]*(?:\\\n[^\n]*)*node --input-type=module - < scripts\/check-install-proxy\.mjs/g)];
 assert.equal(checks.length,2);
 for(const {0:command} of checks) assert.ok(command.includes("--env-file <(grep -E '^SETUP_CODE=' .env.install)"),command);
});

test('the gateway log keeps the path and drops the query string and Referer, where the setup code travels', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const format=/log_format\s+(\w+)\s+'([^;]*)';/.exec(conf);
 assert.ok(format,'the gateway defines its own log format');
 assert.match(conf,new RegExp(`access_log\\s+\\S+\\s+${format[1]};`));
 assert.match(format[2],/\$uri/);
 assert.doesNotMatch(format[2],/\$request\b|\$request_uri|\$args|\$query_string|\$http_referer/);
});

// nginx's error log has a fixed format: on an upstream error it writes the request line and the Referer, query string
// included (CodeRabbit review of issue #50's pull request). The setup link logs no error, and its page sends no Referer to later requests.
test('the setup link logs no gateway error and its page sends no Referer, so no error line can carry the code', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const block=/location = \/first-run \{([^}]*)\}/.exec(conf)?.[1];
 assert.ok(block!==undefined,'the gateway has an exact location for the setup link');
 assert.match(block,/error_log\s+\S+\s+emerg;/);
 assert.match(block,/add_header\s+Referrer-Policy\s+no-referrer\s+always;/);
 // It routes exactly as / does, and sets no proxy header of its own, so it inherits the server's (issue #40).
 const root=/location \/ \{([^}]*)\}/.exec(conf)?.[1];
 assert.match(conf.replace(/location [^{]*\{[^}]*\}/g,''),/^\s*set \$web web:3000;$/m);
 assert.match(root,/^ proxy_pass http:\/\/\$web; $/);
 assert.match(block,/ proxy_pass http:\/\/\$web; $/);
 assert.doesNotMatch(block,/proxy_set_header/);
 // No server-wide error_log is lowered: every other path still logs its errors.
 assert.doesNotMatch(conf.replace(/location [^{]*\{[^}]*\}/g,''),/error_log/);
});

test('the install job proves the gateway logs errors, but none for the setup link, and reloads a changed configuration', async () => {
 const {load}=await import('js-yaml');
 const run=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.find(step=>step.env?.INSTALL_REF).run;
 const at=text=>{ const index=run.indexOf(text); assert.notEqual(index,-1,text); return index; };
 // With web stopped both requests fail at the gateway; the probe's error line shows errors are logged at all.
 const stop=at("compose stop web || fail 'stop web for the gateway error check'");
 assert.ok(stop<at('"http://127.0.0.1:3000/first-run?code=$code"'));
 assert.ok(stop<at('"http://127.0.0.1:3000/sign-in?probe=gateway-error-probe"'));
 assert.ok(at('grep -qF gateway-error-probe <<< "$gateway_logs" || fail')<at('if grep -qF "$code" <<< "$gateway_logs"; then fail'));
 at('referrer-policy: no-referrer');
 // An update replaces install-nginx.conf on disk; the installer that follows serves the new file.
 const marker=at("'# changed by an update'");
 assert.ok(marker<at("{ sh scripts/install.sh || fail 'repeat install before setup'; }"));
 assert.ok(at("{ sh scripts/install.sh || fail 'repeat install before setup'; }")<at('compose exec -T gateway head -n 1 /etc/nginx/conf.d/default.conf'));
});
