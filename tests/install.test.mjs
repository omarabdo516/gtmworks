import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, validateInstallEnv } from '../lib/install-env.mjs';
import { checkSettings } from '../lib/settings.mjs';
import { supabaseSettings } from '../lib/supabase-settings.mjs';
import { createServerClient, createBrowserClient } from '@supabase/ssr';

test('CI prints the captured update log on every failed-update assertion', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-update-log-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install;
 const step=install.steps.find(step=>step.env?.INSTALL_REF);
 assert.equal(install.permissions.contents,'read');
 assert.equal(step.env.GH_TOKEN,'${{ github.token }}');
 const script=`${step.run.split('\n')[0]}
sh() { cat "$UPDATE_FIXTURE"; return "$UPDATE_STATUS"; }
compose() { echo "$WEB_CONTAINER"; }
db() { echo "$ROLLED_BACK"; }
docker() { printf '%s' "$HEALTH_STATUS"; return "$HEALTH_EXIT"; }
old_web=original
${step.run.slice(step.run.indexOf('fail_update()'))}`;
 const fixture=join(directory,'update.fixture');
 const env={...process.env,UPDATE_FIXTURE:fixture,UPDATE_STATUS:'3',WEB_CONTAINER:'original',ROLLED_BACK:'t',HEALTH_STATUS:'200',HEALTH_EXIT:'0'};
 for(const [failure,reason] of [
  [{UPDATE_STATUS:'0'},'update must fail'],
  [{MISSING_LABEL:'1'},'failed migration name'],
  [{WEB_CONTAINER:'replacement'},'old web container still serving'],
  [{ROLLED_BACK:'f'},'migration transaction rolled back'],
  [{HEALTH_EXIT:'7'},'old version health request'],
  [{HEALTH_STATUS:'503'},'old version healthy after failed update']
 ]) {
  // This fixture tests CI's log forwarding; it does not run the installer or simulate psql.
  writeFileSync(fixture,`update diagnostic marker\n${failure.MISSING_LABEL ? '' : 'Applying migration: 99999999999999_failure.sql\n'}`);
  const failed=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:directory,env:{...env,...failure},encoding:'utf8'});
  assert.equal(failed.status,1,failed.stderr);
  assert.ok(failed.stderr.includes(readFileSync(fixture,'utf8')));
  assert.ok(failed.stderr.includes(`install check failed: ${reason}`));
 }
 const passed=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:directory,env,encoding:'utf8'});
 assert.equal(passed.status,0,passed.stderr);
 assert.equal(passed.stderr,'');
});

test('update preserves the serving containers on migration failure and safely replaces its own source', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-update-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'existing secrets');
 writeFileSync(join(directory,'supabase/migrations/999_failure.sql'),"select 1/0;");
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *alpine:3.21*) while [ "$1" != alpine:3.21 ]; do shift; done; shift; "$@";;
 *validate*) exit "\${VALIDATION_EXIT:-0}";;
 *'exec -T db psql'*) cat > "$MIGRATION_SQL"; if [ "\${FAIL_MIGRATION:-1}" = 1 ]; then echo 'ERROR: division by zero' >&2; exit 3; fi;;
esac
`,{mode:0o755});
 writeFileSync(join(directory,'bin/wget'),`#!/bin/sh
printf '%s\\n' "$@" > "$DOWNLOAD_ARGS"
exit "\${DOWNLOAD_EXIT:-0}"
`,{mode:0o755});
 writeFileSync(join(directory,'bin/tar'),`#!/bin/sh
test "\${EXTRACTION_EXIT:-0}" = 0 || exit "$EXTRACTION_EXIT"
if [ -n "\${UPDATE_SOURCE:-}" ]; then cp "$UPDATE_SOURCE" scripts/install.sh; fi
`,{mode:0o755});
 const commands=join(directory,'commands');
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,
  MIGRATION_SQL:join(directory,'migration.sql'),DOWNLOAD_ARGS:join(directory,'download.args'),GH_TOKEN:''};
 const result=spawnSync('sh',['scripts/install.sh','update','main'],{cwd:directory,
  env,encoding:'utf8'});
 assert.equal(result.status,3,result.stderr);
 assert.match(result.stderr,/division by zero/);
 assert.doesNotMatch(readFileSync(commands,'utf8'),/\bstop\b|\bup\b|\bbuild\b/);
 assert.match(readFileSync(commands,'utf8'),/ON_ERROR_STOP=1 --single-transaction/);
 // The stub reports only the SQL error; the installer must generate its own migration label.
 assert.match(readFileSync(env.MIGRATION_SQL,'utf8'),/\\else\n\\echo Applying migration: 999_failure.sql\n\\ir \/migrations\/999_failure.sql/);
 assert.match(readFileSync(env.DOWNLOAD_ARGS,'utf8'),/https:\/\/codeload.github.com\/omarabdo516\/gtmworks\/tar.gz\/main/);
 assert.doesNotMatch(readFileSync(env.DOWNLOAD_ARGS,'utf8'),/Authorization/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
 const replacement=join(directory,'replacement.sh');
 writeFileSync(replacement,`${readFileSync('scripts/install.sh','utf8')}\n${'# padding\n'.repeat(2000)}exit 42\n`);
 const success=spawnSync('sh',['scripts/install.sh','update','main'],{cwd:directory,
  env:{...env,FAIL_MIGRATION:'0',UPDATE_SOURCE:replacement,GH_TOKEN:'test-github-token'},encoding:'utf8'});
 assert.equal(success.status,0,success.stderr);
 assert.match(readFileSync(env.DOWNLOAD_ARGS,'utf8'),/--header\nAuthorization: Bearer test-github-token\nhttps:\/\/api.github.com\/repos\/omarabdo516\/gtmworks\/tarball\/main/);
 assert.match(readFileSync(commands,'utf8'),/run --rm -e GH_TOKEN -v/);
 assert.doesNotMatch(success.stdout+success.stderr+readFileSync(commands,'utf8'),/test-github-token/);
 for(const [failure,status,lastStage] of [
  [{DOWNLOAD_EXIT:'8'},8,/Downloading update source/],
  [{EXTRACTION_EXIT:'9'},9,/Extracting update source/],
  [{VALIDATION_EXIT:'7'},7,/Validating install configuration/]
 ]) {
  writeFileSync(commands,'');
  rmSync(env.MIGRATION_SQL,{force:true});
  const failed=spawnSync('sh',['scripts/install.sh','update','main'],{cwd:directory,env:{...env,...failure},encoding:'utf8'});
  assert.equal(failed.status,status,failed.stderr);
  assert.match(failed.stdout,lastStage);
  assert.equal(existsSync(env.MIGRATION_SQL),false);
  assert.doesNotMatch(readFileSync(commands,'utf8'),/exec -T db psql|\bstop\b|\bup\b|\bbuild\b/);
  assert.equal(existsSync(join(directory,'.install-lock')),false);
  assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),'existing secrets');
 }
});

test('failed backup resumes the install and leaves no archive or secrets behind', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-backup-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'private-key');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in *'tar -czf'*) echo 'partial-private-archive'; exit 9;; esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const result=spawnSync('sh',['scripts/install.sh','backup'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands},encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(readFileSync(commands,'utf8'),/stop[\s\S]*tar -czf[\s\S]*up -d/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
 assert.doesNotMatch(result.stdout+result.stderr,/private-key|partial-private-archive/);
 assert.deepEqual(readdirSync(join(directory,'backups')),[]);
});

test('backup and restore round-trip the Compose volumes and keys; failed extraction stays offline', t => {
 const compose=load(readFileSync('docker-compose.install.yml','utf8'));
 const paths=['var/lib/postgresql/data','etc/postgresql-custom','var/lib/storage'];
 assert.ok(compose.services.db.volumes.includes(`database:/${paths[0]}`));
 assert.ok(compose.services.db.volumes.includes(`database-config:/${paths[1]}`));
 assert.ok(compose.services.storage.volumes.includes(`files:/${paths[2]}`));
 assert.equal(compose.services.storage.environment.FILE_STORAGE_BACKEND_PATH,`/${paths[2]}`);
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-roundtrip-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin',...paths.map(path=>`volumes/${path}`)]) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o600});
 for(const path of paths) writeFileSync(join(directory,'volumes',path,'saved'),'original',{mode:0o640});
 writeFileSync(join(directory,'bin/docker'),`#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2),cwd=process.cwd(),root=cwd+'/volumes';
appendFileSync(cwd+'/commands',JSON.stringify(args)+'\\n');
if(args[0]==='compose') {
 if(args.includes('stop')) writeFileSync(cwd+'/stopped','yes');
 if(args.includes('up')) writeFileSync(cwd+'/stopped','no');
 if(args.includes('ps')) {
  assert.ok(args.includes('-aq'));
  assert.equal(readFileSync(cwd+'/stopped','utf8'),'yes');
  console.log(args.at(-1)+'-stopped');
 }
 if(args.includes('psql')) console.log('t');
} else if(args.includes('alpine:3.21')) {
 const command=args.slice(args.indexOf('alpine:3.21')+1);
 if(args.includes('--volumes-from')) {
  assert.equal(readFileSync(cwd+'/stopped','utf8'),'yes');
  assert.equal(args[args.indexOf('--volumes-from')+1],'db-stopped');
  assert.equal(args[args.lastIndexOf('--volumes-from')+1],'storage-stopped');
 }
 if(command[0]==='tar' && command[1]==='-czf') {
  // BusyBox has one global -C, unlike GNU tar's positional -C options.
  assert.equal(command.filter(arg=>arg==='-C').length,1);
  assert.ok(args.includes(cwd+'/.env.install:/.env.install:ro'));
  copyFileSync(cwd+'/.env.install',root+'/.env.install');
 }
 if(command[0]==='sh') {
  assert.ok(command[2].includes('--numeric-owner'));
  assert.ok(command[2].includes('-xzpf'));
  if(process.env.FAIL_EXTRACTION==='1') process.exit(9);
 }
 const mapped=command.map(arg=>arg==='/' ? root : arg
  .replaceAll('/backup/',cwd+'/.install-lock/')
  .replaceAll('/var/lib/',root+'/var/lib/')
  .replaceAll('/etc/postgresql-custom',root+'/etc/postgresql-custom')
  .replaceAll('-C / ','-C '+root+' '));
 const child=spawnSync(mapped[0],mapped.slice(1),{stdio:'inherit'});
 process.exit(child.status ?? 1);
}
`,{mode:0o755});
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`};
 const run=(...args)=>spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,env,encoding:'utf8'});
 const backup=run('backup');
 assert.equal(backup.status,0,backup.stderr);
 const archive=join('backups',readdirSync(join(directory,'backups'))[0]);
 assert.equal(statSync(join(directory,archive)).mode & 0o777,0o600);
 for(const path of paths) {
  rmSync(join(directory,'volumes',path,'saved'));
  writeFileSync(join(directory,'volumes',path,'fresh'),'discard');
 }
 writeFileSync(join(directory,'.env.install'),'fresh keys');
 const restore=run('restore',archive);
 assert.equal(restore.status,0,restore.stderr);
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
 assert.equal(statSync(join(directory,'.env.install')).mode & 0o777,0o600);
 for(const path of paths) {
  assert.deepEqual(readdirSync(join(directory,'volumes',path)),['saved']);
  assert.equal(readFileSync(join(directory,'volumes',path,'saved'),'utf8'),'original');
  assert.equal(statSync(join(directory,'volumes',path,'saved')).mode & 0o777,0o640);
 }
 assert.match(readFileSync(join(directory,'commands'),'utf8'),/--force-recreate/);
 writeFileSync(join(directory,'commands'),'');
 const failed=spawnSync('sh',['scripts/install.sh','restore',archive],{cwd:directory,env:{...env,FAIL_EXTRACTION:'1'},encoding:'utf8'});
 assert.equal(failed.status,9,failed.stderr);
 assert.doesNotMatch(readFileSync(join(directory,'commands'),'utf8'),/"up"/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

test('restore refuses an occupied install before replacing any volume or key', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-restore-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'original-private-key');
 writeFileSync(join(directory,'backup.tgz'),'backup');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *'tar -tzf'*) printf '%s\\n' var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install;;
 *'exec -T db psql'*) echo f;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const result=spawnSync('sh',['scripts/install.sh','restore','backup.tgz'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands},encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/empty install/);
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),'original-private-key');
 assert.doesNotMatch(readFileSync(commands,'utf8'),/find \/var|stop db|force-recreate/);
 assert.match(readFileSync(commands,'utf8'),/up -d/);
});

test('installer preserves secrets, tightens permissions and streams ordered transactional migrations, not verification files', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-install-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 for(const name of ['002_second.sql','001_first.sql','001_first.verify.sql']) writeFileSync(join(directory,'supabase/migrations',name),'select 1;');
 const secrets=Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o644});
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
case "$*" in
 *validate*) exit "\${VALIDATION_EXIT:-0}";;
 *'exec -T db psql'*) printf '%s\n' "$*" > "$INSTALL_SQL.args"; cat > "$INSTALL_SQL";;
esac
`,{mode:0o755});
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,INSTALL_SQL:join(directory,'migration.sql')};
 for(const attempt of [1,2]) {
  const result=spawnSync('sh',['scripts/install.sh'],{cwd:directory,env,encoding:'utf8'});
  assert.equal(result.status,0,`${attempt}: ${result.stderr}`);
  assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
  assert.equal(statSync(join(directory,'.env.install')).mode & 0o777,0o600);
  const sql=readFileSync(env.INSTALL_SQL,'utf8');
  assert.match(readFileSync(`${env.INSTALL_SQL}.args`,'utf8'),/ON_ERROR_STOP=1 --single-transaction/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/\\gset\n\\if :applied\n\\else\n\\echo Applying migration: 001_first.sql\n\\ir \/migrations\/001_first.sql/);
  assert.match(sql,/\\endif\n/);
  assert.ok(sql.indexOf('/001_first.sql')<sql.indexOf('/002_second.sql'));
  assert.doesNotMatch(sql,/verify\.sql|\x1b/);
 }
 const failed=spawnSync('sh',['scripts/install.sh'],{cwd:directory,env:{...env,VALIDATION_EXIT:'7'},encoding:'utf8'});
 assert.equal(failed.status,7);
 assert.doesNotMatch(failed.stdout,/is ready/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

test('self-hosted startup refuses the unchanged example without printing secrets', () => {
 const env=Object.fromEntries(readFileSync('.env.install.example','utf8').trim().split('\n').map(line=>line.split('=')));
 const result=spawnSync(process.execPath,['lib/install-env.mjs','validate'],{env,encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/POSTGRES_PASSWORD/);
 assert.doesNotMatch(result.stderr,/replace-me/);
});

test('browser and server share a session despite different Supabase hostnames; production defaults stay unchanged', async () => {
 const env={...generateInstallEnv(),GTMWORKS_SELF_HOSTED:'true'};
 const settings=supabaseSettings(env),jar=new Map();
 const cookies={getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))};
 const server=createServerClient(settings.url,settings.anonKey,{cookieOptions:settings.cookieOptions,cookies,
  global:{fetch:async()=>Response.json({id:'00000000-0000-4000-8000-000000000237'})}});
 const {error}=await server.auth.setSession({access_token:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,refresh_token:'test-refresh'});
 assert.equal(error,null);
 const browser=createBrowserClient(env.SUPABASE_PUBLIC_URL,settings.anonKey,{cookieOptions:settings.cookieOptions,cookies,isSingleton:false});
 const {data}=await browser.auth.getSession();
 assert.equal(data.session?.refresh_token,'test-refresh');
 assert.equal(supabaseSettings({...env,GTMWORKS_SELF_HOSTED:undefined}).cookieOptions,undefined);
});

test('generated installs start independently; tampered, missing and example secrets fail closed', () => {
 const env=generateInstallEnv(),other=generateInstallEnv();
 assert.doesNotThrow(()=>validateInstallEnv(env));
 for(const name of ['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY']) {
  assert.notEqual(env[name],other[name]);
  for(const invalid of ['', 'replace-me', 'a'.repeat(64)]) assert.throws(()=>validateInstallEnv({...env,[name]:invalid}),new RegExp(name));
 }
 assert.throws(()=>validateInstallEnv({...env,SUPABASE_SERVICE_ROLE_KEY:other.SUPABASE_SERVICE_ROLE_KEY}),/SUPABASE_SERVICE_ROLE_KEY/);
 assert.throws(()=>validateInstallEnv({...env,SUPABASE_SERVICE_ROLE_KEY:env.NEXT_PUBLIC_SUPABASE_ANON_KEY}),/SUPABASE_SERVICE_ROLE_KEY/);
 assert.throws(()=>validateInstallEnv({...env,WEBHOOK_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}),/WEBHOOK_ENCRYPTION_KEY/);
 assert.throws(()=>validateInstallEnv({...env,APP_ORIGIN:'http://example.com'}),/APP_ORIGIN/);
 assert.throws(()=>checkSettings({...env,NODE_ENV:'production'}),/APP_ORIGIN.*https/);
});
