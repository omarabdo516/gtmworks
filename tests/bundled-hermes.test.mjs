import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, validateInstallEnv, missingInstallEnv } from '../lib/install-env.mjs';
import { hermesVersion, isHermesAddressAllowed } from '../lib/hermes.mjs';
import { bundledHermes, provideBundledHermes } from '../lib/bundled-hermes.mjs';
import { decryptSecret } from '../lib/agent-crypto.mjs';
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

test('the worker reaches the bundled Hermes by service name and waits for it', () => {
 const worker=compose.services.worker;
 assert.deepEqual(worker.depends_on.hermes,{condition:'service_healthy'});
 assert.equal(worker.environment.BUNDLED_HERMES_URL,'http://hermes:8642');
 assert.equal(isHermesAddressAllowed(worker.environment.BUNDLED_HERMES_URL),true);
 assert.equal(compose.services.web.environment.BUNDLED_HERMES_URL,undefined);
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
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 hermes web worker/);
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
 assert.match(run,/up -d --no-deps --wait --wait-timeout 300 hermes web worker\n/);
});

// A service-role client stand-in: records the RPCs the worker calls and answers them.
function database({waiting=true,provided=1}={}) {
 const calls=[];
 return {calls,rpc:async(name,args)=>{ calls.push({name,args}); return name==='bundled_hermes_waiting'?{data:waiting,error:null}:{data:provided,error:null}; }};
}
const encryptionKey=Buffer.alloc(32,7).toString('base64');

test('the bundled Hermes is used only on a self-hosted install that has its address and key', () => {
 const env={GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_URL:'http://hermes:8642',HERMES_API_KEY:'k'.repeat(64)};
 assert.deepEqual(bundledHermes(env),{address:'http://hermes:8642',profile:'default',key:'k'.repeat(64)});
 assert.equal(bundledHermes({...env,GTMWORKS_SELF_HOSTED:undefined}),null);
 assert.equal(bundledHermes({...env,BUNDLED_HERMES_URL:''}),null);
 assert.equal(bundledHermes({...env,HERMES_API_KEY:''}),null);
});

test('a company with no Hermes gets the bundled one, tested first and its key stored encrypted', async () => {
 const fake=await fakeHermes();
 try {
  const hermes={address:fake.address,profile:'default',key:'test-only-key'};
  const db=database();
  assert.equal(await provideBundledHermes(db,{hermes,encryptionKey}),1);
  assert.deepEqual(fake.settings.requests.map(request=>request.path),['/p/default/v1/capabilities','/p/default/health']);
  const [{name:asked},{name,args}]=db.calls;
  assert.equal(asked,'bundled_hermes_waiting');
  assert.equal(name,'provide_bundled_hermes');
  assert.deepEqual({...args,bundled_key:undefined},{bundled_address:fake.address,bundled_profile:'default',bundled_key:undefined,bundled_version:'0.23.0',bundled_features:['run_submission','run_events_sse']});
  assert.doesNotMatch(args.bundled_key,/test-only-key/);
  assert.equal(decryptSecret(args.bundled_key,encryptionKey),'test-only-key');
 } finally { await fake.close(); }
});

test('nothing is provided when every company has Hermes, on a hosted install, or when the bundled Hermes fails its test', async () => {
 const fake=await fakeHermes();
 try {
  const hermes={address:fake.address,profile:'default',key:'test-only-key'};
  const settled=database({waiting:false});
  assert.equal(await provideBundledHermes(settled,{hermes,encryptionKey}),0);
  assert.deepEqual(settled.calls.map(call=>call.name),['bundled_hermes_waiting']);
  assert.equal(fake.settings.requests.length,0);
  const hosted=database();
  assert.equal(await provideBundledHermes(hosted,{hermes:null,encryptionKey}),0);
  assert.equal(hosted.calls.length,0);
  for(const change of [()=>{fake.settings.version='0.24.0';},()=>{fake.settings.key='other';},()=>{fake.settings.status=503;}]) {
   change();
   const db=database();
   assert.equal(await provideBundledHermes(db,{hermes,encryptionKey}),0);
   assert.deepEqual(db.calls.map(call=>call.name),['bundled_hermes_waiting']);
   Object.assign(fake.settings,{version:'0.23.0',key:'test-only-key',status:200});
  }
 } finally { await fake.close(); }
});

test('the bundled Engine gives a company one main agent named Lead, never the Engine name', () => {
 // The newest migration that defines the function is the one the database runs.
 const latest=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort()
  .map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).filter(sql=>/function public\.provide_bundled_hermes\(/.test(sql)).at(-1);
 const inserts=[...latest.matchAll(/insert into public\.hermes_agents\(([^)]*)\) values\(([^)]*)\)/g)];
 assert.equal(inserts.length,1);
 const [,columns,values]=inserts[0];
 const row=Object.fromEntries(columns.split(',').map((column,index)=>[column.trim(),values.split(',')[index].trim()]));
 assert.equal(row.name,"'Lead'");
 assert.equal(row.is_default,'true');
});

test('a database refusal is raised without the key in it', async () => {
 const fake=await fakeHermes();
 try {
  const db={rpc:async name=>name==='bundled_hermes_waiting'?{data:true,error:null}:{data:null,error:{message:'hermesAgentFailed'}}};
  await assert.rejects(provideBundledHermes(db,{hermes:{address:fake.address,profile:'default',key:'test-only-key'},encryptionKey}),error=>!String(error?.message).includes('test-only-key'));
 } finally { await fake.close(); }
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

test('the web app reaches the Engine management listener for subscription sign-in, and CI proves it on the pinned release', () => {
 const web=compose.services.web;
 // The listener's address only (ADR 0012): the Run API address stays the worker's, and no port is published.
 assert.equal(web.environment.BUNDLED_HERMES_MANAGEMENT_URL,'http://hermes:9119');
 assert.equal(isHermesAddressAllowed(web.environment.BUNDLED_HERMES_MANAGEMENT_URL),true);
 assert.equal(web.environment.BUNDLED_HERMES_URL,undefined);
 assert.equal(web.ports,undefined);
 assert.equal(compose.services.worker.environment.BUNDLED_HERMES_MANAGEMENT_URL,undefined);
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
 const agent=install.indexOf('scripts/check-install-agent.mjs');
 const subscription=install.indexOf('compose exec -T web node --input-type=module - < scripts/check-install-subscription.mjs');
 assert.ok(agent>0&&subscription>agent);
});
