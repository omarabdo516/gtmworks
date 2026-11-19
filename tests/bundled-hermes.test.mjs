import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, validateInstallEnv, missingInstallEnv } from '../lib/install-env.mjs';
import { hermesVersion, isHermesAddressAllowed } from '../lib/hermes.mjs';
import { hermesAt, onProfile, selfHosted } from '../lib/bundled-hermes.mjs';

// Each Company's Engine is made from the template shipped with the release (ADR 0018): one release of the official Hermes
// image, pinned by tag and digest, on its own network with its own volume and key. scripts/install.sh makes the first
// Company's Engine from it; `gtmworks company add` (#382) makes each later one the same way.
const template=load(readFileSync('scripts/engine-template.yml','utf8'));
const compose=load(readFileSync('docker-compose.install.yml','utf8'));
const pinned=image=>/^[a-z0-9./-]+:v(\d+\.\d+\.\d+)@sha256:[a-f0-9]{64}$/.exec(image||'')?.[1]||null;

test('the Engine template runs the pinned Hermes release, by tag and digest, the one the driver accepts', () => {
 const image=template.services.engine.image;
 assert.equal(pinned(image),hermesVersion);
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
  const env=compose.services[name].environment;
  assert.equal(Object.hasOwn(env,'BUNDLED_HERMES_URL'),true,`${name} unsets BUNDLED_HERMES_URL`);
  assert.equal(env.BUNDLED_HERMES_URL,null);
  assert.equal(Object.hasOwn(env,'HERMES_API_KEY'),true,`${name} unsets HERMES_API_KEY`);
  assert.equal(env.HERMES_API_KEY,null);
 }
 assert.equal(compose.services.worker.depends_on?.hermes,undefined);
 assert.equal(compose.volumes?.hermes,undefined);
 assert.equal(isHermesAddressAllowed('http://gtmworks-engine-first:8642'),true);
 assert.equal(isHermesAddressAllowed('http://gtmworks-engine-first:9119'),true);
});

test('the Engine key is install-generated, validated, and an older install gains it on update', () => {
 const env=generateInstallEnv(),other=generateInstallEnv();
 assert.match(env.HERMES_API_KEY,/^[a-f0-9]{64}$/);
 assert.notEqual(env.HERMES_API_KEY,other.HERMES_API_KEY);
 for(const invalid of ['','replace-me','a'.repeat(64)]) {
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid}),/HERMES_API_KEY/);
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid},{complete:true}),/HERMES_API_KEY/);
 }
 const older={...env}; delete older.HERMES_API_KEY;
 // The containers accept an install with no key yet; this installer requires it.
 assert.doesNotThrow(()=>validateInstallEnv(older));
 assert.throws(()=>validateInstallEnv(older,{complete:true}),/HERMES_API_KEY/);
 const cli=(file,...args)=>spawnSync(process.execPath,['lib/install-env.mjs',...args],{env:{...file,PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(cli(older,'validate').status,0);
 const strict=cli(older,'validate','complete');
 assert.equal(strict.status,1);
 assert.match(strict.stderr,/HERMES_API_KEY must be an install-generated secret/);
 assert.equal(cli(env,'validate','complete').status,0);
 for(const args of [['validate'],['validate','complete']]) assert.equal(cli({...env,HERMES_API_KEY:'replace-me'},...args).status,1);
 assert.equal(cli(env,'validate','other').status,1);
 const added=missingInstallEnv(older);
 assert.deepEqual(Object.keys(added),['HERMES_API_KEY']);
 assert.doesNotThrow(()=>validateInstallEnv({...older,...added}));
 assert.deepEqual(missingInstallEnv(env),{});
 const printed=spawnSync(process.execPath,['lib/install-env.mjs','missing'],{env:{...older,PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(printed.status,0,printed.stderr);
 assert.match(printed.stdout,/^HERMES_API_KEY=[a-f0-9]{64}\n$/);
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
 *'exec -T db psql'*) cat > /dev/null;;
esac
`;
const envText=env=>Object.entries(env).map(([name,value])=>`${name}=${value}`).join('\n');
const olderEnv=()=>{ const env=generateInstallEnv(); delete env.HERMES_API_KEY; return env; };
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
 return {run:(...args)=>spawnSync('sh',['scripts/install.sh',...(args.length?args:['update','main'])],{cwd:directory,env:env2,encoding:'utf8'}),
  file:()=>readFileSync(join(directory,'.env.install'),'utf8'),commands:()=>readFileSync(commands,'utf8'),
  engineEnv:()=>readFileSync(join(directory,'.engines/first/.env'),'utf8')};
}

test('install and update add a missing Engine key before validating, start the Engine from the template and pass its key only to registration', t => {
 const older=olderEnv();
 const install=installDirectory(t,'scripts/install.sh',older);
 const update=install.run();
 assert.equal(update.status,0,update.stderr);
 const written=install.file();
 const key=/\nHERMES_API_KEY=([a-f0-9]{64})\n$/.exec(written)?.[1];
 assert.ok(key,written.slice(-100));
 assert.ok(written.startsWith(envText(older)));
 assert.ok(!(update.stdout+update.stderr).includes(key));
 const run=install.commands();
 assert.ok(run.indexOf('install-env.mjs missing')<run.indexOf('install-env.mjs validate complete'));
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 auth web worker\n/);
 // The first Engine is its own Compose project, made from the shipped template with its own key, volume and network.
 assert.match(run,/compose --project-name gtmworks-engine-first --env-file \.engines\/first\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300/);
 // The app is named `web` on the Engine's network, where the install's own checks and the fake model reach it; the
 // worker joins under its container name only.
 assert.match(run,/network connect --alias web gtmworks-engine-first web-id/);
 assert.match(run,/network connect gtmworks-engine-first worker-id/);
 assert.equal(install.engineEnv(),`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${key}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`);
 // The address and key reach the registration script, and no line of the app or the worker carries them.
 const registration=run.split('\n').find(line=>line.includes('scripts/install-engine.mjs'));
 assert.ok(registration,run);
 assert.match(registration,/exec -T -e BUNDLED_HERMES_URL=http:\/\/gtmworks-engine-first:8642 -e HERMES_API_KEY=/);
 assert.doesNotMatch(run,/compose exec -T web node -e .*HERMES_API_KEY/);
 // A complete install file is left byte for byte as it was, and the Engine starts again.
 const repeat=install.run();
 assert.equal(repeat.status,0,repeat.stderr);
 assert.equal(install.file(),written);
});

test('an install updated by the installer before ADR 0010 keeps running without Hermes, and the next update brings its Engine in', t => {
 const older=olderEnv();
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
 // A backup taken before the next update starts the whole stack again, so it adds the key first.
 const backup=install.run('backup');
 assert.equal(backup.status,0,backup.stderr);
 const key=/\nHERMES_API_KEY=([a-f0-9]{64})\n$/.exec(install.file())?.[1];
 assert.ok(key);
 run=install.commands();
 assert.ok(run.lastIndexOf('install-env.mjs missing')<run.lastIndexOf('up -d --wait --wait-timeout 300'));
 // The source it extracted is this installer: the next update keeps that key and starts the Engine.
 const second=install.run();
 assert.equal(second.status,0,second.stderr);
 assert.equal((install.file().match(/HERMES_API_KEY=/g)||[]).length,1);
 assert.match(install.file(),new RegExp(`\\nHERMES_API_KEY=${key}\\n$`));
 run=install.commands();
 assert.match(run,/install-env\.mjs validate complete\n/);
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 auth web worker\n/);
 assert.match(run,/compose --project-name gtmworks-engine-first --env-file \.engines\/first\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300/);
});

test('update recreates the auth service with its password settings and waits until it is healthy (#41)', t => {
 const install=installDirectory(t,'scripts/install.sh',olderEnv());
 const update=install.run();
 assert.equal(update.status,0,update.stderr);
 // compose up recreates a service whose settings changed; --wait needs auth's healthcheck to pass before success.
 assert.match(install.commands(),/up -d --no-deps --wait --wait-timeout 300 auth web worker\n/);
 assert.ok(compose.services.auth.healthcheck?.test,'auth has a healthcheck for --wait');
 assert.deepEqual([compose.services.auth.environment.GOTRUE_PASSWORD_MIN_LENGTH,compose.services.auth.environment.GOTRUE_MAILER_OTP_EXP,compose.services.auth.environment.GOTRUE_SESSIONS_TIMEBOX],['10','86400','720h']);
});

test('only a self-hosted install keeps Company and Agent profiles, and no install-wide Engine names one', () => {
 const env={GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_URL:'http://gtmworks-engine-first:8642',HERMES_API_KEY:'k'.repeat(64)};
 assert.equal(selfHosted(env),true);
 assert.equal(selfHosted({...env,GTMWORKS_SELF_HOSTED:undefined}),false);
 assert.equal(selfHosted({...env,GTMWORKS_SELF_HOSTED:''}),false);
 // The install-wide address and key are an Engine's own for a module with no database, never a Company's Engine.
 assert.deepEqual(hermesAt(env),{address:'http://gtmworks-engine-first:8642',key:'k'.repeat(64)});
});

test('the Engine gives a company one main agent named Lead, never the Engine name', () => {
 // The newest migration that defines the function is the one the database runs.
 const latest=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort()
  .map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).filter(sql=>/function public\.attach_company_profile\(/.test(sql)).at(-1);
 const body=latest.slice(latest.search(/function public\.attach_company_profile\(/));
 assert.match(body.slice(0,body.indexOf('$function$;')),/insert into public\.hermes_agents\(company_id,profile,name,speciality,is_default\) values\(c,public\.company_engine_profile\(c\),'Lead','General',true\)/);
});

test('every Run goes to its Company\'s Engine on the profile it was pinned to, and a Company profile serves its own Company only', () => {
 const hermes=hermesAt({BUNDLED_HERMES_URL:'http://gtmworks-engine-first:8642',HERMES_API_KEY:'k'.repeat(64)});
 assert.deepEqual(hermes,{address:'http://gtmworks-engine-first:8642',key:'k'.repeat(64)});
 assert.equal(hermesAt({BUNDLED_HERMES_URL:'http://gtmworks-engine-first:8642'}),null);
 const company='10000000-0000-0000-0000-000000000001';
 assert.deepEqual(onProfile('co-10000000000000000000000000000001',company,hermes),{...hermes,profile:'co-10000000000000000000000000000001'});
 assert.equal(onProfile('co-10000000000000000000000000000002',company,hermes),null,'another Company\'s profile');
 assert.deepEqual(onProfile('ag-a0000000000000000000000000000001',company,hermes)?.profile,'ag-a0000000000000000000000000000001');
 assert.equal(onProfile(null,company,hermes),null);
 assert.equal(onProfile('default',company,null),null,'no Engine to reach');
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
