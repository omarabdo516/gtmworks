import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, generateEngineKey, validateInstallEnv, missingInstallEnv } from '../lib/install-env.mjs';
import { hermesVersion, isHermesAddressAllowed } from '../lib/hermes.mjs';
import { onProfile, selfHosted } from '../lib/bundled-hermes.mjs';

// Each Company's Engine is made from the template shipped with the release (ADR 0018): one release of the official Hermes
// image, pinned by tag and digest, on its own network with its own volume and key. scripts/install.sh makes the first
// Company's Engine from it; `gtmworks company add` (#382) makes each later one the same way.
const template=load(readFileSync('scripts/engine-template.yml','utf8'));
const compose=load(readFileSync('docker-compose.install.yml','utf8'));
const pinned=image=>/^[a-z0-9./-]+:v(\d+\.\d+\.\d+)@sha256:[a-f0-9]{64}$/.exec(image||'')?.[1]||null;

test('the Engine template runs the pinned Hermes release, by tag and digest, the one the driver accepts', () => {
 const image=template.services.engine.image;
 assert.equal(pinned(image),hermesVersion);
 // Nothing overrides the pin: the image line names no variable.
 assert.doesNotMatch(image,/\$/);
 // A tag alone could move under the install; the check fails without the digest.
 assert.equal(pinned(image.split('@')[0]),null);
 assert.equal(pinned(`${image.split(':')[0]}@${image.split('@')[1]}`),null);
 // The install compose file no longer names an Engine: the template is the one place the Engine release is pinned.
 assert.equal(compose.services.hermes,undefined);
 assert.equal(readFileSync('docker-compose.install.yml','utf8').includes('nousresearch/hermes-agent'),false);
});

test('an Engine publishes no host port, joins only its own network, and keeps its own volume and key', () => {
 const engine=template.services.engine;
 assert.equal(engine.ports,undefined);
 assert.equal(engine.expose,undefined);
 assert.equal(engine.network_mode,undefined);
 assert.equal(engine.env_file,undefined);
 assert.equal(engine.restart,'unless-stopped');
 assert.equal(engine.container_name,'${ENGINE_NAME:?Run scripts/install.sh}');
 assert.equal(engine.environment.API_SERVER_HOST,'0.0.0.0');
 // The Engine's own key is required and is the only key in it: an Engine with none refuses to start rather than serve.
 assert.equal(engine.environment.API_SERVER_KEY,'${ENGINE_KEY:?Run scripts/install.sh}');
 assert.equal(engine.environment.HERMES_DASHBOARD,'1');
 assert.equal(engine.environment.HERMES_DASHBOARD_SESSION_TOKEN,'${ENGINE_KEY:?Run scripts/install.sh}');
 assert.equal(engine.environment.HERMES_DASHBOARD_HOST,undefined);
 assert.equal(engine.environment.HERMES_DASHBOARD_PORT,undefined);
 assert.ok(engine.volumes.includes('data:/opt/data'));
 assert.equal(template.volumes.data.name,'${ENGINE_VOLUME:?Run scripts/install.sh}');
 assert.ok(engine.networks.includes('engine'));
 assert.equal(template.networks.engine.name,'${ENGINE_NETWORK:?Run scripts/install.sh}');
 assert.match(engine.healthcheck.test.join(' '),/127\.0\.0\.1:8642\/health/);
 assert.deepEqual(engine.command.slice(0,2),['sh','-ec']);
 const start=engine.command[2].replaceAll('$$','$');
 assert.match(start,/exec hermes gateway run$/);
 const started=key=>spawnSync('sh',['-ec',start.replace('exec hermes gateway run','echo gateway started')],{env:{PATH:process.env.PATH,API_SERVER_KEY:key},encoding:'utf8'});
 assert.equal(started('k'.repeat(64)).stdout,'gateway started\n');
 const refused=started('');
 assert.notEqual(refused.status,0);
 assert.equal(refused.stdout,'');
 assert.match(refused.stderr,/The Engine has no key/);
 // Only the address the browser reaches (the gateway) and the mail viewer are published, on loopback.
 for(const [name,service] of Object.entries(compose.services)) for(const port of service.ports||[]) assert.match(port,/^127\.0\.0\.1:/,name);
});

test('no container of the install mounts the Docker socket', () => {
 const mounted=service=>(service.volumes||[]).some(volume=>String(volume).includes('docker.sock'));
 for(const [name,service] of Object.entries({...compose.services,...template.services})) {
  assert.equal(mounted(service),false,`${name} mounts the Docker socket`);
 }
 for(const [name,volume] of Object.entries(compose.volumes||{})) assert.doesNotMatch(String(volume?.name||name),/docker\.sock/);
});

test('the app and the worker read no install-wide Engine address or key: the Engine record is the only source', () => {
 for(const name of ['web','worker']) {
  const env=compose.services[name].environment||{};
  // Nothing puts an Engine key or address in .env.install any more (#385), so no null entry is needed to mask one.
  assert.equal(Object.hasOwn(env,'BUNDLED_HERMES_URL'),false,`${name} names no BUNDLED_HERMES_URL`);
  assert.equal(Object.hasOwn(env,'HERMES_API_KEY'),false,`${name} names no HERMES_API_KEY`);
  assert.equal(compose.services[name].env_file,'.env.install');
 }
 assert.equal(compose.services.worker.depends_on?.hermes,undefined);
 assert.equal(compose.volumes?.hermes,undefined);
 assert.equal(isHermesAddressAllowed('http://gtmworks-engine-first:8642'),true);
 assert.equal(isHermesAddressAllowed('http://gtmworks-engine-first:9119'),true);
});

test('an Engine key is made into the Engine\'s own file, and an install made before it keeps the key it has', () => {
 const env=generateInstallEnv(),other=generateInstallEnv();
 // The app's and the worker's environment file holds no Engine key (#385): it lives in the Engine's own file only.
 assert.equal(Object.hasOwn(env,'HERMES_API_KEY'),false,'.env.install holds no Engine key');
 const key=generateEngineKey(),another=generateEngineKey();
 assert.match(key,/^[a-f0-9]{64}$/);
 assert.notEqual(key,another);
 assert.doesNotThrow(()=>validateInstallEnv(env));
 assert.doesNotThrow(()=>validateInstallEnv(env,{complete:true}));
 // An install the previous release made still carries its key there until the installer moves it; a present key is
 // checked as before, so a wrong one is never adopted.
 assert.doesNotThrow(()=>validateInstallEnv({...env,HERMES_API_KEY:'a1'.repeat(32)},{complete:true}));
 for(const invalid of ['','replace-me','A'.repeat(64)]) {
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid}),/HERMES_API_KEY/);
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid},{complete:true}),/HERMES_API_KEY/);
 }
 const cli=(file,...args)=>spawnSync(process.execPath,['lib/install-env.mjs',...args],{env:{...file,PATH:process.env.PATH},encoding:'utf8'});
 assert.match(cli(env,'engine-key').stdout,/^[a-f0-9]{64}\n$/);
 assert.equal(cli(env,'validate').status,0);
 assert.equal(cli(env,'validate','complete').status,0);
 assert.equal(cli(env,'validate','other').status,1);
 // The only value an older install gains now is the setup code; its Engine key arrives with the Engine's own file.
 assert.deepEqual(missingInstallEnv(env),{});
 const older={...env}; delete older.SETUP_CODE;
 assert.deepEqual(Object.keys(missingInstallEnv(older)),['SETUP_CODE']);
 const printed=spawnSync(process.execPath,['lib/install-env.mjs','missing'],{env:{...older,PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(printed.status,0,printed.stderr);
 assert.match(printed.stdout,/^SETUP_CODE=[a-f0-9]{64}\n$/);
});

// A Docker stand-in: records every command, runs lib/install-env.mjs for real with the --env-file it was given, and
// replaces scripts/install.sh with this branch's installer when an update extracts its source, as the archive would.
const dockerShim=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *'tar -xzf /install/.install-lock/source.tgz'*) cp "$NEW_INSTALLER" scripts/install.sh;;
 *alpine:3.21*) exit 0;;
 *'ps -q web'*) echo web-id;;
 *'ps -q worker'*) echo worker-id;;
 *install-env.mjs*)
  file=; previous=; all="$*"
  for argument do [ "$previous" = --env-file ] && file=$argument; previous=$argument; done
  exec env -i PATH="$PATH" sh -c 'set -a; case "$1" in /*) . "$1";; *) . "./$1";; esac; set +a; shift; exec node "$@"' sh "$file" "$INSTALL_ENV" \${all##*install-env.mjs };;
 *'exec -T db psql'*)
  case "$*" in *'count(*) from public.companies'*) echo 1;; *) cat > /dev/null;; esac;;
esac
`;
const envText=env=>Object.entries(env).map(([name,value])=>`${name}=${value}`).join('\n');
// An install the previous release made: the Engine's key is still in .env.install (#385).
const previousReleaseEnv=()=>{ const env=generateInstallEnv(); env.HERMES_API_KEY='a1'.repeat(32); return env; };
function installDirectory(t,installer,env) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-bundled-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync(installer,join(directory,'scripts/install.sh'));
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh','engine-template.yml']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 // Written without a final newline: an added line must still start a line of its own.
 writeFileSync(join(directory,'.env.install'),envText(env));
 writeFileSync(join(directory,'bin/docker'),dockerShim,{mode:0o755});
 const commands=join(directory,'commands');
 const env2={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,GH_TOKEN:'',
  NEW_INSTALLER:join(process.cwd(),'scripts/install.sh'),INSTALL_ENV:join(process.cwd(),'lib/install-env.mjs')};
 return {directory,run:(...args)=>spawnSync('sh',['scripts/install.sh',...(args.length?args:['update','main'])],{cwd:directory,env:env2,encoding:'utf8'}),
  file:()=>readFileSync(join(directory,'.env.install'),'utf8'),commands:()=>readFileSync(commands,'utf8'),
  engineEnv:()=>readFileSync(join(directory,'.engines/first/.env'),'utf8')};
}

test('an update moves the Engine key a previous release left in .env.install into the Engine\'s own file, unchanged', t => {
 const previous=previousReleaseEnv();
 const install=installDirectory(t,'scripts/install.sh',previous);
 const update=install.run();
 assert.equal(update.status,0,update.stderr);
 const written=install.file();
 // The key moves, and nothing else in the app's and the worker's environment file changes.
 assert.doesNotMatch(written,/HERMES_API_KEY=/);
 const kept=Object.entries(previous).filter(([name])=>name!=='HERMES_API_KEY').map(([name,value])=>`${name}=${value}`).join('\n');
 assert.ok(written.startsWith(kept),written.slice(-120));
 assert.ok(!(update.stdout+update.stderr).includes(previous.HERMES_API_KEY),'the key is never printed');
 const run=install.commands();
 assert.ok(run.indexOf('install-env.mjs validate complete')<run.indexOf('engine-template.yml up'));
 // The first Engine is its own Compose project, made from the shipped template with its own key, volume and network.
 assert.match(run,/compose --project-name gtmworks-engine-first --env-file \.engines\/first\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300/);
 // The app is named `web` on the Engine's network, where the install's own checks and the fake model reach it; the
 // worker joins under its container name only.
 assert.match(run,/network connect --alias web gtmworks-engine-first web-id/);
 assert.match(run,/network connect gtmworks-engine-first worker-id/);
 assert.equal(install.engineEnv(),`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${previous.HERMES_API_KEY}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`);
 // The address and key reach the registration script, and no line of the app or the worker carries them.
 const registration=run.split('\n').find(line=>line.includes('scripts/install-engine.mjs'));
 assert.ok(registration,run);
 assert.match(registration,/exec -T -e ENGINE_ADDRESS -e ENGINE_KEY web node scripts\/install-engine\.mjs/);
 // The address and key reach the script from the environment, by name: the key is never on a command line (#378, X4).
 assert.ok(!run.includes(previous.HERMES_API_KEY),'the Engine key is never on a command line');
 assert.doesNotMatch(run,/compose exec -T web node -e .*HERMES_API_KEY/);
 // A repeat install keeps the adopted key and leaves both files as they were.
 const repeat=install.run();
 assert.equal(repeat.status,0,repeat.stderr);
 assert.equal(install.file(),written);
 assert.match(install.engineEnv(),new RegExp(`\\nENGINE_KEY=${previous.HERMES_API_KEY}\\n`));
});

test('a fresh install makes the Engine\'s key into its own file, never into .env.install', t => {
 const install=installDirectory(t,'scripts/install.sh',{});
 rmSync(join(install.directory,'.env.install'));
 const first=install.run('install');
 assert.equal(first.status,0,first.stderr);
 // The installer generates .env.install without an Engine key, and the Engine's own file with one.
 assert.match(install.file(),/^POSTGRES_PASSWORD=[a-f0-9]{64}$/m);
 assert.doesNotMatch(install.file(),/HERMES_API_KEY=/);
 const key=/\nENGINE_KEY=([a-f0-9]{64})\n/.exec(install.engineEnv())?.[1];
 assert.ok(key,install.engineEnv());
 assert.ok(!(first.stdout+first.stderr).includes(key),'the key is never printed');
 const registration=install.commands().split('\n').find(line=>line.includes('scripts/install-engine.mjs'));
 assert.match(registration,/-e ENGINE_ADDRESS -e ENGINE_KEY /);
 assert.ok(!install.commands().includes(key),'the Engine key is never on a command line');
 // A repeat install changes neither file.
 const written=install.file(),engine=install.engineEnv();
 const repeat=install.run();
 assert.equal(repeat.status,0,repeat.stderr);
 assert.equal(install.file(),written);
 assert.equal(install.engineEnv(),engine);
});

test('an install updated by the installer before ADR 0010 keeps running without Hermes, and the next update brings its Engine in', t => {
 const older=generateInstallEnv();
 // The installer as it was before ADR 0010 (scripts/install.sh at 6957e6e), kept beside install-failing-migration.sql.
 const install=installDirectory(t,'scripts/install-before-bundled-hermes.sh',older);
 const first=install.run();
 assert.equal(first.status,0,first.stderr);
 // The previous installer validates with the downloaded lib and starts the app, never Hermes, and writes no key.
 assert.equal(install.file(),envText(older));
 let run=install.commands();
 assert.match(run,/install-env\.mjs validate\n/);
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 web worker\n/);
 assert.doesNotMatch(run,/hermes web worker/);
 // The worker that update started keeps no profiles until each Company's own Engine record answers one (#380).
 assert.equal(selfHosted({...older,GTMWORKS_SELF_HOSTED:'true'}),true);
 // A backup taken before the next update starts the whole stack again; the install has no Engine key, and the file
 // keeps none.
 const backup=install.run('backup');
 assert.equal(backup.status,0,backup.stderr);
 assert.equal(install.file(),envText(older));
 // The source it extracted is this installer: the next update makes the Engine a key of its own, in its own file.
 const second=install.run();
 assert.equal(second.status,0,second.stderr);
 assert.doesNotMatch(install.file(),/HERMES_API_KEY=/);
 const key=/\nENGINE_KEY=([a-f0-9]{64})\n/.exec(install.engineEnv())?.[1];
 assert.ok(key,install.engineEnv());
 run=install.commands();
 assert.match(run,/install-env\.mjs validate complete\n/);
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 auth web worker\n/);
 assert.match(run,/compose --project-name gtmworks-engine-first --env-file \.engines\/first\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300/);
});

test('update recreates the auth service with its password settings and waits until it is healthy (#41)', t => {
 const install=installDirectory(t,'scripts/install.sh',generateInstallEnv());
 const update=install.run();
 assert.equal(update.status,0,update.stderr);
 // compose up recreates a service whose settings changed; --wait needs auth's healthcheck to pass before success.
 assert.match(install.commands(),/up -d --no-deps --wait --wait-timeout 300 auth web worker\n/);
 assert.ok(compose.services.auth.healthcheck?.test,'auth has a healthcheck for --wait');
 assert.deepEqual([compose.services.auth.environment.GOTRUE_PASSWORD_MIN_LENGTH,compose.services.auth.environment.GOTRUE_MAILER_OTP_EXP,compose.services.auth.environment.GOTRUE_SESSIONS_TIMEBOX],['10','86400','720h']);
});

test('only a self-hosted install keeps Company and Agent profiles, and no install-wide Engine names one', () => {
 const env={GTMWORKS_SELF_HOSTED:'true'};
 assert.equal(selfHosted(env),true);
 assert.equal(selfHosted({...env,GTMWORKS_SELF_HOSTED:undefined}),false);
 assert.equal(selfHosted({...env,GTMWORKS_SELF_HOSTED:''}),false);
});

test('the Engine gives a company one main agent named Lead, never the Engine name', () => {
 // The newest migration that defines the function is the one the database runs.
 const latest=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort()
  .map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).filter(sql=>/function public\.attach_company_profile\(/.test(sql)).at(-1);
 const body=latest.slice(latest.search(/function public\.attach_company_profile\(/));
 assert.match(body.slice(0,body.indexOf('$function$;')),/insert into public\.hermes_agents\(company_id,profile,name,speciality,is_default\) values\(c,public\.company_engine_profile\(c\),'Lead','General',true\)/);
});

test('every Run goes to its Company\'s Engine on the profile it was pinned to, and a Company profile serves its own Company only', () => {
 // The Engine a caller names, as the record answers it (#378, T1): no install-wide environment value is read.
 const hermes={address:'http://gtmworks-engine-first:8642',key:'k'.repeat(64)};
 const company='10000000-0000-0000-0000-000000000001';
 assert.deepEqual(onProfile('co-10000000000000000000000000000001',company,hermes),{...hermes,profile:'co-10000000000000000000000000000001'});
 assert.equal(onProfile('co-10000000000000000000000000000002',company,hermes),null,'another Company\'s profile');
 assert.deepEqual(onProfile('ag-a0000000000000000000000000000001',company,hermes)?.profile,'ag-a0000000000000000000000000000001');
 assert.equal(onProfile(null,company,hermes),null);
 assert.equal(onProfile('default',company,null),null,'no Engine to reach');
});

test('the Engine network probe checks the install services by name and by their addresses (#378, S5)', () => {
 const script=readFileSync('scripts/check-install-engine-network.mjs','utf8');
 // A service name does not resolve from an Engine's network, so the probe also asks each service's own address there;
 // CI reads those addresses with docker inspect and passes them in.
 assert.match(script,/INSTALL_SERVICE_IPS/);
 assert.match(script,/reachable\(address,port\)/);
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 assert.match(ci,/for service in db auth rest storage gateway; do/);
 assert.equal((ci.match(/-e INSTALL_SERVICE_IPS="\$\(install_service_ips\)"/g)||[]).length,3,'every Engine-network probe passes the addresses');
});

test('the threat model names every service-role holder the Engine work added (#378, X5)', () => {
 const doc=readFileSync('docs/threat-model.md','utf8');
 for(const name of ['lib/bundled-hermes.mjs','app/api/dictation/route.ts','app/first-owner/submit/route.ts','scripts/company-add.mjs','scripts/company-list.mjs','scripts/install-engine.mjs']) {
  assert.ok(doc.includes(name),name);
 }
 assert.match(doc,/service-role call site listed above/);
});

test('the Engine management listener is on for web and worker with the Engine key, and never public', () => {
 const engine=template.services.engine;
 // Hermes's dashboard (ADR 0011) starts beside the gateway in the same container, on 9119, behind the same Engine key.
 assert.equal(engine.environment.HERMES_DASHBOARD,'1');
 assert.equal(engine.environment.HERMES_DASHBOARD_SESSION_TOKEN,'${ENGINE_KEY:?Run scripts/install.sh}');
 assert.equal(engine.environment.HERMES_DASHBOARD_HOST,undefined);
 assert.equal(engine.environment.HERMES_DASHBOARD_PORT,undefined);
 assert.equal(engine.ports,undefined);
 assert.equal(engine.expose,undefined);
 assert.equal(isHermesAddressAllowed('http://gtmworks-engine-first:9119'),true);
 // The public gateway proxies to the app, auth, rest and storage only.
 const gateway=readFileSync('scripts/install-nginx.conf','utf8');
 assert.deepEqual([...gateway.matchAll(/set \$\w+ ([\w-]+):\d+;/g)].map(match=>match[1]),['auth','rest','storage','web']);
 assert.doesNotMatch(gateway,/gtmworks-engine-first|9119|8642/);
 // The install job proves it on the real release: an Agent made through the contract, refused from outside.
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
 assert.match(install,/check-install-agent\.mjs/);
 assert.match(install,/engine_management=http:\/\/gtmworks-engine-first:9119/);
 assert.match(install,/worker node -e .*engine_management\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:3000\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:9119\/api\/profiles/);
});
