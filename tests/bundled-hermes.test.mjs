import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, validateInstallEnv, missingInstallEnv } from '../lib/install-env.mjs';
import { hermesVersion, isHermesAddressAllowed } from '../lib/hermes.mjs';
import { bundledHermes, hermesAt, onProfile } from '../lib/bundled-hermes.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// Hermes ships inside the install (ADR 0010): one release, pinned by tag and digest, reachable only on the compose network.
const compose=load(readFileSync('docker-compose.install.yml','utf8'));
const pinned=image=>/^[a-z0-9./-]+:v(\d+\.\d+\.\d+)@sha256:[a-f0-9]{64}$/.exec(image||'')?.[1]||null;

test('the bundled Hermes is one release pinned by tag and digest, the one the driver accepts', () => {
 const image=compose.services.hermes.image;
 assert.equal(pinned(image),hermesVersion);
 // A tag alone could move under the install; the check fails without the digest.
 assert.equal(pinned(image.split('@')[0]),null);
 assert.equal(pinned(`${image.split(':')[0]}@${image.split('@')[1]}`),null);
});

test('the Hermes API publishes no host port and receives none of the gtmworks secrets', () => {
 const hermes=compose.services.hermes;
 assert.equal(hermes.ports,undefined);
 assert.equal(hermes.network_mode,undefined);
 assert.equal(hermes.env_file,undefined);
 assert.equal(hermes.restart,'unless-stopped');
 assert.equal(hermes.environment.API_SERVER_HOST,'0.0.0.0');
 // Empty, not required, when the key is unset: compose reads every service, and an install updated by the installer
 // before ADR 0010 has no key yet. Hermes then refuses to start instead of serving an API with no key.
 assert.equal(hermes.environment.API_SERVER_KEY,'${HERMES_API_KEY:-}');
 assert.doesNotMatch(readFileSync('docker-compose.install.yml','utf8'),/HERMES_API_KEY:\?/);
 assert.ok(hermes.volumes.includes('hermes:/opt/data'));
 assert.ok(Object.hasOwn(compose.volumes,'hermes'));
 assert.match(hermes.healthcheck.test.join(' '),/127\.0\.0\.1:8642\/health/);
 assert.deepEqual(hermes.command.slice(0,2),['sh','-ec']);
 const start=hermes.command[2].replaceAll('$$','$');
 assert.match(start,/exec hermes gateway run$/);
 const started=key=>spawnSync('sh',['-ec',start.replace('exec hermes gateway run','echo gateway started')],{env:{PATH:process.env.PATH,API_SERVER_KEY:key},encoding:'utf8'});
 assert.equal(started('k'.repeat(64)).stdout,'gateway started\n');
 const refused=started('');
 assert.notEqual(refused.status,0);
 assert.equal(refused.stdout,'');
 assert.match(refused.stderr,/HERMES_API_KEY/);
 // Only the address the browser reaches (the gateway) and the mail viewer are published, on loopback.
 for(const [name,service] of Object.entries(compose.services)) for(const port of service.ports||[]) assert.match(port,/^127\.0\.0\.1:/,name);
});

test('the web app and the worker reach the bundled Hermes by service name, and the worker waits for it', () => {
 const worker=compose.services.worker;
 assert.deepEqual(worker.depends_on.hermes,{condition:'service_healthy'});
 assert.equal(worker.environment.BUNDLED_HERMES_URL,'http://hermes:8642');
 assert.equal(isHermesAddressAllowed(worker.environment.BUNDLED_HERMES_URL),true);
 // The web app starts Runs and reads sign-ins on it too (#342: it is the only Hermes).
 assert.equal(compose.services.web.environment.BUNDLED_HERMES_URL,'http://hermes:8642');
});

test('the Hermes key is install-generated, validated, and an older install gains it on update', () => {
 const env=generateInstallEnv(),other=generateInstallEnv();
 assert.match(env.HERMES_API_KEY,/^[a-f0-9]{64}$/);
 assert.notEqual(env.HERMES_API_KEY,other.HERMES_API_KEY);
 for(const invalid of ['','replace-me','a'.repeat(64)]) {
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid}),/HERMES_API_KEY/);
  assert.throws(()=>validateInstallEnv({...env,HERMES_API_KEY:invalid},{complete:true}),/HERMES_API_KEY/);
 }
 const older={...env}; delete older.HERMES_API_KEY;
 // The containers and the installer before ADR 0010 accept an install with no key yet; this installer requires it.
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
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 // Written without a final newline: an added line must still start a line of its own.
 writeFileSync(join(directory,'.env.install'),envText(env));
 writeFileSync(join(directory,'bin/docker'),dockerShim,{mode:0o755});
 const commands=join(directory,'commands');
 const env2={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,GH_TOKEN:'',
  NEW_INSTALLER:join(process.cwd(),'scripts/install.sh'),INSTALL_ENV:join(process.cwd(),'lib/install-env.mjs')};
 return {run:(...args)=>spawnSync('sh',['scripts/install.sh',...(args.length?args:['update','main'])],{cwd:directory,env:env2,encoding:'utf8'}),
  file:()=>readFileSync(join(directory,'.env.install'),'utf8'),commands:()=>readFileSync(commands,'utf8')};
}

test('install and update add a missing Hermes key before validating, and update starts Hermes with the app', t => {
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
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 auth hermes web worker/);
 // A complete install file is left byte for byte as it was.
 const repeat=install.run();
 assert.equal(repeat.status,0,repeat.stderr);
 assert.equal(install.file(),written);
});

test('an install updated by the installer before ADR 0010 keeps running without Hermes, and the next update brings it in', t => {
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
 // The worker that update started finds no bundled Hermes, so it never waits on one.
 assert.equal(bundledHermes({...older,GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_URL:compose.services.worker.environment.BUNDLED_HERMES_URL}),null);
 // A backup taken before the next update starts the whole stack again, so it adds the key first.
 const backup=install.run('backup');
 assert.equal(backup.status,0,backup.stderr);
 const key=/\nHERMES_API_KEY=([a-f0-9]{64})\n$/.exec(install.file())?.[1];
 assert.ok(key);
 run=install.commands();
 assert.ok(run.lastIndexOf('install-env.mjs missing')<run.lastIndexOf('up -d --wait --wait-timeout 300'));
 // The source it extracted is this installer: the next update keeps that key and starts Hermes.
 const second=install.run();
 assert.equal(second.status,0,second.stderr);
 assert.equal((install.file().match(/HERMES_API_KEY=/g)||[]).length,1);
 assert.match(install.file(),new RegExp(`\\nHERMES_API_KEY=${key}\\n$`));
 run=install.commands();
 assert.match(run,/install-env\.mjs validate complete\n/);
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 auth hermes web worker\n/);
});

test('update recreates the auth service with its password settings and waits until it is healthy (#41)', t => {
 const install=installDirectory(t,'scripts/install.sh',olderEnv());
 const update=install.run();
 assert.equal(update.status,0,update.stderr);
 // compose up recreates a service whose settings changed; --wait needs auth's healthcheck to pass before success.
 assert.match(install.commands(),/up -d --no-deps --wait --wait-timeout 300 auth hermes web worker\n/);
 assert.ok(compose.services.auth.healthcheck?.test,'auth has a healthcheck for --wait');
 assert.deepEqual([compose.services.auth.environment.GOTRUE_PASSWORD_MIN_LENGTH,compose.services.auth.environment.GOTRUE_MAILER_OTP_EXP,compose.services.auth.environment.GOTRUE_SESSIONS_TIMEBOX],['10','86400','720h']);
});

test('the bundled Hermes is used only on a self-hosted install that has its address and key', () => {
 const env={GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_URL:'http://hermes:8642',HERMES_API_KEY:'k'.repeat(64)};
 assert.deepEqual(bundledHermes(env),{address:'http://hermes:8642',profile:'default',key:'k'.repeat(64)});
 assert.equal(bundledHermes({...env,GTMWORKS_SELF_HOSTED:undefined}),null);
 assert.equal(bundledHermes({...env,BUNDLED_HERMES_URL:''}),null);
 assert.equal(bundledHermes({...env,HERMES_API_KEY:''}),null);
});

test('the bundled Engine gives a company one main agent named Lead, never the Engine name', () => {
 // The newest migration that defines the function is the one the database runs.
 const latest=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort()
  .map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).filter(sql=>/function public\.attach_company_profile\(/.test(sql)).at(-1);
 const body=latest.slice(latest.search(/function public\.attach_company_profile\(/));
 assert.match(body.slice(0,body.indexOf('$function$;')),/insert into public\.hermes_agents\(company_id,profile,name,speciality,is_default\) values\(c,public\.company_engine_profile\(c\),'Lead','General',true\)/);
});

test('every Run goes to the bundled Hermes on the profile it was pinned to, and a Company profile serves its own Company only', () => {
 const hermes=hermesAt({BUNDLED_HERMES_URL:'http://hermes:8642',HERMES_API_KEY:'k'.repeat(64)});
 assert.deepEqual(hermes,{address:'http://hermes:8642',key:'k'.repeat(64)});
 assert.equal(hermesAt({BUNDLED_HERMES_URL:'http://hermes:8642'}),null);
 const company='10000000-0000-0000-0000-000000000001';
 assert.deepEqual(onProfile('co-10000000000000000000000000000001',company,hermes),{...hermes,profile:'co-10000000000000000000000000000001'});
 assert.equal(onProfile('co-10000000000000000000000000000002',company,hermes),null,'another Company\'s profile');
 assert.deepEqual(onProfile('ag-a0000000000000000000000000000001',company,hermes)?.profile,'ag-a0000000000000000000000000000001');
 assert.equal(onProfile(null,company,hermes),null);
 assert.equal(onProfile('default',company,null),null,'no Hermes to reach');
});

test('the Engine management listener is on for web and worker with the install key, and never public', () => {
 const hermes=compose.services.hermes;
 // Hermes's dashboard (ADR 0011) starts beside the gateway in the same container, on 9119, behind the same key.
 assert.equal(hermes.environment.HERMES_DASHBOARD,'1');
 assert.equal(hermes.environment.HERMES_DASHBOARD_SESSION_TOKEN,'${HERMES_API_KEY:-}');
 assert.equal(hermes.environment.HERMES_DASHBOARD_HOST,undefined);
 assert.equal(hermes.environment.HERMES_DASHBOARD_PORT,undefined);
 assert.equal(hermes.ports,undefined);
 assert.equal(hermes.expose,undefined);
 assert.equal(isHermesAddressAllowed('http://hermes:9119'),true);
 // The public gateway proxies to the app, auth, rest and storage only.
 const gateway=readFileSync('scripts/install-nginx.conf','utf8');
 assert.deepEqual([...gateway.matchAll(/set \$\w+ ([\w-]+):\d+;/g)].map(match=>match[1]),['auth','rest','storage','web']);
 assert.doesNotMatch(gateway,/hermes|9119|8642/);
 // The install job proves it on the real bundled release: an Agent made through the contract, refused from outside.
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
 assert.match(install,/compose exec -T web node --input-type=module - < scripts\/check-install-agent\.mjs/);
 assert.match(install,/compose exec -T worker node .*http:\/\/hermes:9119\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:3000\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:9119\/api\/profiles/);
});
