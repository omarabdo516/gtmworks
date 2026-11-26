import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, generateEngineKey, validateInstallEnv, missingInstallEnv } from '../lib/install-env.mjs';
import { hermesVersion } from '../lib/engine/version.mjs';
import { isHermesAddressAllowed } from '../lib/engine/transport.mjs';
import { selfHosted } from '../lib/company-engine.mjs';
import { companyEngine } from '../lib/engine/handle.mjs';
import { engineRecord } from './engine-records.mjs';
import { installJob } from './install-job.mjs';

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

test('an Engine publishes no host port, joins its install network and its work network, and keeps its own volume and key', () => {
 const engine=template.services.engine;
 assert.equal(engine.ports,undefined);
 assert.equal(engine.expose,undefined);
 assert.equal(engine.network_mode,undefined);
 assert.equal(engine.env_file,undefined);
 assert.equal(engine.restart,'unless-stopped');
 assert.equal(engine.container_name,'${ENGINE_NAME:?Run scripts/install.sh}');
 // The listeners bind to the install network's own address, resolved when the Engine starts: a wildcard bind answers on
 // the sandbox's network too (docs/engine-probes/work-sandbox-ssh.md, section 6). The hook that writes it is mounted here,
 // and the install job proves the behaviour: it reads every port the Engine listens on and asks each from the work
 // network, after a restart and after a restore (#393).
 assert.equal(engine.environment.API_SERVER_HOST,undefined);
 assert.equal(engine.environment.HERMES_DASHBOARD_HOST,undefined);
 assert.ok(engine.volumes.includes('./engine-listener-address.sh:/etc/cont-init.d/05-engine-listener-address:ro'));
 assert.deepEqual(engine.networks,{engine:null,work:null});
 assert.equal(engine.environment.API_SERVER_PORT,8642);
 // The Engine's own key is required and is the only key in it: an Engine with none refuses to start rather than serve.
 assert.equal(engine.environment.API_SERVER_KEY,'${ENGINE_KEY:?Run scripts/install.sh}');
 assert.equal(engine.environment.HERMES_DASHBOARD,'1');
 assert.equal(engine.environment.HERMES_DASHBOARD_SESSION_TOKEN,'${ENGINE_KEY:?Run scripts/install.sh}');
 // The dashboard refuses a Host header that is not the address it bound (DNS-rebinding guard), and the app and the
 // worker reach it by this Engine's container name: the name is declared as the one public host, so the name answers on
 // the install address and the sandbox's network leg still refuses.
 assert.equal(engine.environment.HERMES_DASHBOARD_PUBLIC_URL,'http://${ENGINE_NAME:?Run scripts/install.sh}:9119');
 // The file tools write only under the work folder, which is the sandbox's (#390).
 assert.equal(engine.environment.HERMES_WRITE_SAFE_ROOT,'/work');
 // A start hook that fails stops the Engine (s6-overlay's own switch): the file-sync patch and the listener address
 // either hold or the Engine does not serve, never an Engine that started without them.
 assert.equal(engine.environment.S6_BEHAVIOUR_IF_STAGE2_FAILS,2);
 assert.ok(engine.volumes.includes('data:/opt/data'));
 // The Company's work folder, read-only: the Library reads an Agent's folder in it through this Engine's file routes,
 // and nothing on the Engine may write what its Agents made (#395).
 assert.ok(engine.volumes.includes('work:/opt/data/work:ro'));
 assert.ok(engine.volumes.includes('./engine-managed.yml:/etc/hermes/config.yaml:ro'));
 assert.ok(engine.volumes.includes('./engine-listener-address.py:/etc/hermes/listener-address.py:ro'));
 assert.equal(template.volumes.data.name,'${ENGINE_VOLUME:?Run scripts/install.sh}');
 assert.equal(template.networks.engine.name,'${ENGINE_NETWORK:?Run scripts/install.sh}');
 assert.deepEqual(engine.healthcheck.test.slice(0,3),['CMD','/opt/hermes/.venv/bin/python','/etc/hermes/listener-address.py']);
 assert.equal(engine.healthcheck.test.at(-1),'--health');
 assert.deepEqual(engine.command.slice(0,2),['sh','-ec']);
 const start=engine.command[2].replaceAll('$$','$');
 assert.match(start,/exec hermes gateway run$/);
 // The key guard still runs before anything else: an Engine with no key refuses rather than serve, and makes nothing.
 // A fresh volume has no cache/scratch, and Python's tempfile passes over a TMPDIR that is not there: after the guard and
 // before the gateway the start makes the Engine's temp folder (below), the Engine's user's alone.
 const guard=start.slice(0,start.indexOf('exec hermes gateway run'));
 const home=mkdtempSync(join(tmpdir(),'engine-start-'));
 const scratch=join(home,'cache','scratch');
 const started=key=>spawnSync('sh',['-ec',`${guard} test -d "$TMPDIR" && echo gateway started`],{env:{PATH:process.env.PATH,API_SERVER_KEY:key,TMPDIR:scratch},encoding:'utf8'});
 try {
  const refused=started('');
  assert.notEqual(refused.status,0);
  assert.equal(refused.stdout,'');
  assert.match(refused.stderr,/The Engine has no key/);
  assert.throws(()=>statSync(scratch),/ENOENT/,'an Engine with no key makes no folder');
  assert.equal(started('k'.repeat(64)).stdout,'gateway started\n');
  assert.equal(statSync(scratch).mode&0o777,0o700);
  assert.equal(started('k'.repeat(64)).stdout,'gateway started\n','an Engine whose folder is there starts as before');
 } finally {
  rmSync(home,{recursive:true,force:true});
 }
 // A board worker runs re-homed to its Agent's profile, and Hermes points its TMPDIR at that profile's scratch unless one
 // is set: the ssh control socket under it ran past Linux's 108-byte limit for a Unix socket (#833, CI run 45854207378).
 // The Engine sets the root profile's own scratch for every process, so the worker's socket path stays short.
 assert.equal(engine.environment.TMPDIR,'/opt/data/cache/scratch');
 const socket=folder=>Buffer.byteLength(`${folder}/hermes-ssh/${'0'.repeat(16)}.sock.${'0'.repeat(16)}`);
 assert.ok(socket(engine.environment.TMPDIR)<108,'a control socket under it fits a Unix socket path');
 assert.ok(socket(`/opt/data/profiles/ag-${'0'.repeat(32)}/cache/scratch`)>=108,'one under a profile\'s scratch did not');
 // The install's managed scope pins the sandbox backend, so no profile and no Settings write moves it, and a board
 // worker's dangerous command runs (spec #831, ADR 0033 item 2): a worker's Run is single-query, which refuses one by
 // default. The dispatcher and the review dispatch are not named, so they stay as Hermes ships them, on.
 const managed=load(readFileSync('scripts/engine-managed.yml','utf8'));
 assert.deepEqual(managed,{terminal:{backend:'ssh',ssh_host:'sandbox',ssh_user:'pn',ssh_port:2222,ssh_key:'/opt/data/ssh/id_ed25519',ssh_sync_files:false},
  approvals:{single_query_mode:'approve'}});
 // Nothing is copied between the Engine and the sandbox (#393): ssh_sync_files is false in the managed scope, and the
 // cont-init hook that adds that key to the pinned Engine runs before anything starts and fails the start if the pinned
 // text moved. The Engine's launch home (/opt/data) names no shared Skills folder, so nothing of a profile's Skills is
 // reachable from there either.
 assert.equal(managed.terminal.ssh_sync_files,false,'the ssh backend copies nothing in and nothing back');
 assert.ok(engine.volumes.includes('./engine-ssh-sync-files.sh:/etc/cont-init.d/06-engine-ssh-sync-files:ro'),'the file-sync switch patch runs at start');
 // The install job runs the hook against the pinned image and proves the ssh sandbox is built with sync off.
 assert.ok(statSync('scripts/engine-ssh-sync-files.sh').mode&0o111,'the hook is executable as s6 runs it');
 // A ChatGPT sign-in adds its account beside the Company's others (#618): the same kind of hook, after the file-sync one;
 // the install job runs it against the pinned image and proves two accounts stay apart.
 assert.ok(engine.volumes.includes('./engine-codex-accounts.sh:/etc/cont-init.d/07-engine-codex-accounts:ro'),'the ChatGPT accounts patch runs at start');
 assert.ok(statSync('scripts/engine-codex-accounts.sh').mode&0o111,'the accounts hook is executable as s6 runs it');
 // A request goes on on the next account in the Owner's order, and the move is recorded (#621): the same kind of hook;
 // the install job runs it against the pinned image and proves the order, the switch-off and the record.
 assert.ok(engine.volumes.includes('./engine-pool-order.sh:/etc/cont-init.d/08-engine-pool-order:ro'),'the account order patch runs at start');
 assert.ok(statSync('scripts/engine-pool-order.sh').mode&0o111,'the order hook is executable as s6 runs it');
 const launch=readFileSync('scripts/ci-install-lib.sh','utf8');
 assert.match(launch,/cat > \/opt\/data\/config\.yaml/,'the install names the launch profile it writes');
 assert.doesNotMatch(launch,/external_dirs/,'the launch profile names no shared Skills folder');
 // Only the address the browser reaches (the gateway) and the mail viewer are published, on loopback.
 for(const [name,service] of Object.entries(compose.services)) for(const port of service.ports||[]) assert.match(port,/^127\.0\.0\.1:/,name);
});

test('every Company\'s work sandbox is the least container its Agents\' work needs, on a network with no way out', () => {
 const sandbox=template.services.sandbox;
 // The Company's one work sandbox (#393, ADR 0018): its own image (built once, or a release's pinned digest), its own
 // container, and no host port, env file or socket of any kind.
 assert.equal(sandbox.image,'${SANDBOX_IMAGE:-gtmworks-work-sandbox:local}');
 assert.equal(sandbox.container_name,'${SANDBOX_NAME:-gtmworks-sandbox}');
 assert.equal(sandbox.restart,'unless-stopped');
 for(const key of ['ports','expose','network_mode','env_file','user']) assert.equal(sandbox[key],undefined,`the sandbox sets no ${key}`);
 // Hardening: the image's own ordinary user, no capability, no new privilege, and the limits the install gives it.
 assert.deepEqual(sandbox.cap_drop,['ALL']);
 assert.deepEqual(sandbox.security_opt,['no-new-privileges:true']);
 assert.equal(sandbox.pids_limit,2048);
 assert.equal(sandbox.shm_size,'1gb','shared memory large enough for Chromium');
 assert.equal(sandbox.mem_limit,'${SANDBOX_MEMORY:-2g}');
 assert.equal(sandbox.cpus,'${SANDBOX_CPUS:-2.0}');
 // The template is the one place those defaults are set (#400): the installer repeats none of them, so nothing can drift
 // from the measured figures; it passes only a Company's own limits, read from that Company's file (#396).
 assert.doesNotMatch(readFileSync('scripts/install.sh','utf8'),/SANDBOX_(MEMORY|CPUS|PIDS|SHM)=[0-9'"]|sandbox_(memory|cpus|pids|shm)=/);
 // The README's server sizes state those same defaults, and the shared-kernel risk in plain words (#400).
 const readme=readFileSync('README.md','utf8');
 assert.match(readme,new RegExp(`\\*\\*${sandbox.mem_limit.match(/:-(\d+)g\}$/)[1]} GB of RAM and ${Number(sandbox.cpus.match(/:-([\d.]+)\}$/)[1])} CPUs\\*\\* by default`));
 assert.match(readme,/\*\*The sandbox shares the server's kernel\.\*\*/);
 // Nothing it writes lands on the server's own disk (#507, ADR 0032): a read-only root, scratch folders in memory of a
 // fixed size, and its home and the Company's work folder on the Company's work disk, whose default size is set here
 // alone; the README states it.
 assert.equal(sandbox.read_only,true);
 assert.deepEqual(sandbox.tmpfs,['/tmp:size=1g,mode=1777','/var/tmp:size=256m,mode=1777']);
 assert.equal(sandbox.labels['gtmworks.disk'],'${SANDBOX_DISK:-10g}');
 assert.doesNotMatch(readFileSync('scripts/install.sh','utf8'),/SANDBOX_DISK=[0-9]|disk_size=[0-9'"]/);
 assert.match(readme,new RegExp(`a work disk\\s+of \\*\\*${sandbox.labels['gtmworks.disk'].match(/:-(\d+)g\}$/)[1]} GB\\*\\*\\s+by default`));
 // The Company's work folder, the sandbox's home and its own host key, and nothing else; the only key that reaches it is
 // a public one, passed when the container starts.
 assert.deepEqual(sandbox.volumes,['work:/work','home:/home/pn','host-key:/home/pn/.ssh-host:ro']);
 assert.deepEqual(Object.keys(sandbox.environment),['SSH_AUTHORIZED_KEY']);
 assert.deepEqual(JSON.parse(JSON.stringify(sandbox.networks)),{work:{aliases:['sandbox']}});
 assert.match(sandbox.healthcheck.test.join(' '),/2222/);
 // One volume per Company's work folder, home and host key, and one internal network with no route out of the install.
 // The work folder and the home bind the Company's work disk, which the installer makes: Compose never makes either.
 assert.equal(template.volumes.work.name,'${WORK_VOLUME:-gtmworks-folder-first}');
 assert.equal(template.volumes.work.external,true);
 assert.equal(template.volumes.home.name,'${SANDBOX_HOME_VOLUME:-gtmworks-home-first}');
 assert.equal(template.volumes.home.external,true);
 assert.equal(template.volumes['host-key'].name,'${SANDBOX_HOST_KEY_VOLUME:-gtmworks-sandbox-hostkey-first}');
 assert.equal(template.networks.work.name,'${WORK_NETWORK:-gtmworks-work-first}');
 assert.equal(template.networks.work.internal,true);
 // The sandbox mounts no Docker socket and holds no gtmworks secret: the loop below covers every service.
 assert.equal(String(JSON.stringify(sandbox)).includes('docker.sock'),false);
 assert.equal(String(JSON.stringify(sandbox)).includes('.env.install'),false);
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
  // Each container names the values it gets (#446, tests/container-env.test.mjs): no file hands it the whole install's.
  assert.equal(compose.services[name].env_file,undefined);
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
  *'.State.Health.Status'*) echo healthy;;
  *'/data/ssh/id_ed25519'*) printf 'client ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIclient\nhost ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhost\n';;
 *'tar -xzf /install/.install-lock/source.tgz'*) cp "$NEW_INSTALLER" scripts/install.sh;;
 *alpine:3.21*) exit 0;;
 *'ps -q web'*) echo web-id;;
 *'ps -q worker'*) echo worker-id;;
 *install-env.mjs*)
  file=; previous=; all="$*"
  for argument do [ "$previous" = --env-file ] && file=$argument; previous=$argument; done
  if [ -n "$file" ]; then
   exec env -i PATH="$PATH" sh -c 'set -a; case "$1" in /*) . "$1";; *) . "./$1";; esac; set +a; shift; exec node "$@"' sh "$file" "$INSTALL_ENV" \${all##*install-env.mjs }
  fi
  exec node "$INSTALL_ENV" \${all##*install-env.mjs };;
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
 const install=installDirectory(t,'scripts/install-before-company-engine.sh',older);
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

test('every Run goes to its Company\'s Engine on the profile it was pinned to, and a Company profile serves its own Company only', async () => {
 // The Engine its record names (#378, T1): no install-wide environment value is read.
 const company='10000000-0000-0000-0000-000000000001';
 engineRecord(company,{address:'http://gtmworks-engine-first:8642',key:'k'.repeat(64)});
 const engine=/** @type {NonNullable<Awaited<ReturnType<typeof companyEngine>>>} */(await companyEngine(company));
 assert.equal(engine.on('co-10000000000000000000000000000001')?.profile,'co-10000000000000000000000000000001');
 assert.equal(engine.on('co-10000000000000000000000000000002'),null,'another Company\'s profile');
 assert.equal(engine.on('ag-a0000000000000000000000000000001')?.profile,'ag-a0000000000000000000000000000001');
 assert.equal(engine.on(null),null);
 engineRecord(company,null);
 assert.equal(await companyEngine(company),null,'no Engine to reach');
});

test('the Engine network probe checks the install services by name and by their addresses (#378, S5)', () => {
 const script=readFileSync('scripts/check-install-engine-network.mjs','utf8');
 // A service name does not resolve from an Engine's network, so the probe also asks each service's own address there;
 // CI reads those addresses with docker inspect and passes them in.
 assert.match(script,/INSTALL_SERVICE_IPS/);
 assert.match(script,/reachable\(address,port\)/);
 const ci=installJob().steps.map(step=>step.run||'').join('\n');
 assert.match(ci,/for service in db auth rest storage gateway; do/);
 assert.equal((ci.match(/-e INSTALL_SERVICE_IPS="\$\(install_service_ips\)"/g)||[]).length,3,'every Engine-network probe passes the addresses');
});

test('a Company names its Engine in one place: the record names no Company (#378, T3)', () => {
 const migrations=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')&&!file.endsWith('.verify.sql')).sort();
 const oneLink=migrations.map(file=>[file,readFileSync(`supabase/migrations/${file}`,'utf8')]).filter(([,sql])=>sql.includes('drop column company_id')).at(-1);
 assert.ok(oneLink,'a migration drops company_engines.company_id');
 assert.match(oneLink[1],/alter table public\.company_engines drop column company_id/);
 assert.match(oneLink[1],/unique \(engine_id\)/,'one Engine record serves one Company');
 assert.match(oneLink[1],/not exists\(select 1 from public\.companies c where c\.engine_id=e\.id\)/,'a waiting Engine is one no Company names');
 // Nothing new writes the dropped column: the seed names each Company's Engine on the Company.
 assert.doesNotMatch(readFileSync('supabase/seed.sql','utf8'),/company_engines\s*\([^)]*company_id/);
 assert.match(readFileSync('supabase/seed.sql','utf8'),/insert into public\.companies[\s\S]*engine_id/);
});

test('the threat model names every service-role holder the Engine work added (#378, X5)', () => {
 const doc=readFileSync('docs/threat-model.md','utf8');
 for(const name of ['lib/company-engine.mjs','app/first-owner/submit/route.ts','scripts/company-add.mjs','scripts/company-list.mjs','scripts/install-engine.mjs']) {
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
 // The app takes two: its pages, and the WebSockets it carries itself, the Screen's live stream and the board's live
 // changes (ADR 0029, #840).
 assert.deepEqual([...gateway.matchAll(/set \$\w+ ([\w-]+):\d+;/g)].map(match=>match[1]),['auth','rest','storage','web','web']);
 assert.match(gateway,/location ~ \^\/api\/\(display\/ws\|board\/events\)\$ \{\s+set \$web web:3000;/);
 assert.doesNotMatch(gateway,/gtmworks-engine-first|9119|8642/);
 // The install job proves it on the real release: an Agent made through the contract, refused from outside.
 const install=installJob().steps.map(step=>step.run||'').join('\n');
 assert.match(install,/check-install-agent\.mjs/);
 assert.match(install,/engine_management=http:\/\/gtmworks-engine-first:9119/);
 assert.match(install,/worker node -e .*engine_management\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:3000\/api\/profiles/);
 assert.match(install,/http:\/\/127\.0\.0\.1:9119\/api\/profiles/);
});

// The Docker stand-in runs lib/install-env.mjs for real with the --env-file it was given (#378, C16): an install that
// names no file (the Engine key this installer generates) runs it with nothing sourced, never with `. "./"`, which a
// stricter shell reads as the install folder.
test('the Docker stand-in sources an env file only when --env-file named one', () => {
 const own=readFileSync(new URL(import.meta.url),'utf8');
 const branch=own.slice(own.indexOf('*install-env.mjs*)'),own.indexOf('*\'exec -T db psql\'*)'));
 assert.match(branch,/if \[ -n "\$file" \]; then\n   exec env -i/,'the env file is sourced only when one was named');
 assert.match(branch,/\n  exec node "\$INSTALL_ENV"/,'without one, the script runs with no source at all');
});
