import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv, validateInstallEnv } from '../lib/install-env.mjs';
import { checkSettings } from '../lib/settings.mjs';
import { supabaseSettings } from '../lib/supabase-settings.mjs';
import { createServerClient, createBrowserClient } from '@supabase/ssr';
import { installJob } from './install-job.mjs';

test('CI prints the captured update log on every failed-update assertion', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-update-log-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const install=installJob();
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
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 const existing='existing secrets\nHERMES_API_KEY='+'k'.repeat(64);
 writeFileSync(join(directory,'.env.install'),existing);
 writeFileSync(join(directory,'supabase/migrations/999_failure.sql'),"select 1/0;");
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *alpine:3.21*) while [ "$1" != alpine:3.21 ]; do shift; done; shift; "$@";;
 *validate*) exit "\${VALIDATION_EXIT:-0}";;
 *'count(*) from public.companies'*) echo 1;;
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
 // The successful update moved the previous release's Engine key out of the app's environment file, into the
 // Engine's own file, and left everything else in it as it was (#385).
 const moved=readFileSync(join(directory,'.env.install'),'utf8');
 assert.equal(moved,'existing secrets\n');
 assert.match(readFileSync(join(directory,'.engines/first/.env'),'utf8'),/^ENGINE_KEY=k{64}$/m);
 // The work sandbox image every Company's sandbox runs (#392): a source checkout builds it from sandbox/Dockerfile and
 // records the reference the installer's later runs and every Company's sandbox read.
 assert.match(readFileSync(commands,'utf8'),/^build --tag gtmworks-work-sandbox:local sandbox$/m);
 assert.equal(readFileSync(join(directory,'.work-sandbox-image'),'utf8'),'gtmworks-work-sandbox:local\n');
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
  assert.doesNotMatch(readFileSync(commands,'utf8'),/--single-transaction|\bstop\b|\bup\b|\bbuild\b/);
  assert.equal(existsSync(join(directory,'.install-lock')),false);
  assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),moved);
 }
});

// Compose does not recreate a container when only a file it mounts changed, so an updated gateway config (it writes
// X-Real-IP, the auth rate limit's key, issue #41) would never load. The new config is checked before anything changes;
// the gateway is recreated on it after migrations and before the app starts: the worker reaches the database through the
// gateway, so no service restarts once the worker runs (tests/setup-code.test.mjs).
test('update checks the new gateway config before migrating and recreates the gateway on it before the app', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-update-gateway-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 writeFileSync(join(directory,'.env.install'),'existing secrets\nHERMES_API_KEY='+'k'.repeat(64));
 writeFileSync(join(directory,'supabase/migrations/001_first.sql'),'select 1;');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *alpine:3.21*) exit 0;;
 *'nginx -t'*) exit "\${GATEWAY_CONFIG_EXIT:-0}";;
 *'count(*) from public.companies'*) echo 1;;
 *'exec -T db psql'*) cat > /dev/null; exit "\${MIGRATION_EXIT:-0}";;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,GH_TOKEN:''};
 const run=(operation,extra={})=>{ writeFileSync(commands,''); const result=spawnSync('sh',['scripts/install.sh',...operation],{cwd:directory,env:{...env,...extra},encoding:'utf8'}); return {...result,lines:readFileSync(commands,'utf8').split('\n')}; };
 const at=(lines,pattern)=>lines.findIndex(line=>pattern.test(line));
 const check=/ run --rm --no-deps gateway nginx -t$/, migrate=/exec -T db psql .*--single-transaction$/;
 const companies=/count\(\*\) from public\.companies/;
 const app=/ up -d --no-deps --wait --wait-timeout 300 auth web worker$/;
 const gateway=/ up -d --no-deps --force-recreate --wait --wait-timeout 300 gateway$/;

 const updated=run(['update','main']);
 assert.equal(updated.status,0,updated.stderr);
 // The Companies are read from the running database before the update changes anything (#385).
 assert.ok(at(updated.lines,companies)>=0&&at(updated.lines,companies)<at(updated.lines,check),`the Companies are counted first: ${updated.lines.join(' | ')}`);
 const order=[check,migrate,gateway,app].map(pattern=>at(updated.lines,pattern));
 assert.ok(order.every(index=>index>=0),`every stage ran: ${updated.lines.join(' | ')}`);
 assert.deepEqual([...order].sort((a,b)=>a-b),order,`config check, migrations, gateway, then app: ${updated.lines.join(' | ')}`);
 // Only the gateway is recreated by force: the app containers are replaced only when their image or settings changed.
 assert.equal(updated.lines.filter(line=>/--force-recreate/.test(line)).length,1);

 // A broken gateway config stops the update before migrations, build or any container changes; the old version serves.
 const broken=run(['update','main'],{GATEWAY_CONFIG_EXIT:'5'});
 assert.equal(broken.status,5,broken.stderr);
 assert.match(broken.stdout,/Checking gateway configuration/);
 assert.equal(at(broken.lines,migrate),-1);
 assert.doesNotMatch(broken.lines.join('\n'),/\bstop\b|\bup\b|\bbuild\b/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);

 // A failed migration leaves the running gateway alone too.
 const failed=run(['update','main'],{MIGRATION_EXIT:'3'});
 assert.equal(failed.status,3,failed.stderr);
 assert.equal(at(failed.lines,gateway),-1);

 // A repeat install whose gateway is not serving (this fake docker reports no running container) starts it again after
 // the config check and before the app; tests/setup-code.test.mjs covers an unchanged or changed running gateway.
 const repeated=run([]);
 assert.equal(repeated.status,0,repeated.stderr);
 assert.ok(at(repeated.lines,check)>=0 && at(repeated.lines,check)<at(repeated.lines,migrate));
 assert.ok(at(repeated.lines,gateway)>=0 && at(repeated.lines,gateway)<at(repeated.lines,/ up -d --wait --wait-timeout 300$/));
});

// Each Company now runs on its own Engine (ADR 0018). An install the previous release made keeps every Company on the one
// Engine, and this release has no path from there: the update refuses it before it changes anything (#385).
test('an update of an install with more than one Company is refused before it changes anything', t => {
 // An install the previous release made: its Engine key is in .env.install and one Engine serves every Company.
 const existing='existing secrets\nHERMES_API_KEY='+'a1'.repeat(32)+'\n';
 const dockerShim=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *'count(*) from public.companies'*) echo "$COMPANIES";;
 *'label=com.docker.compose.service=hermes'*) echo "\${OLD_HERMES:-}";;
 *'exec -T db psql'*) cat > "$MIGRATION_SQL";;
 *install-env.mjs*) :;;
esac
`;
 const fixture=(mode)=>{
  const directory=mkdtempSync(join(tmpdir(),`gtmworks-several-${mode||'source'}-`));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const folder of ['bin','lib','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
  for(const name of ['install-env.mjs','setup-code.mjs','setup-link.mjs','settings.mjs','supabase-settings.mjs']) copyFileSync(join('lib',name),join(directory,'lib',name));
  writeFileSync(join(directory,'.env.install'),existing);
  writeFileSync(join(directory,'supabase/migrations/001_first.sql'),'select 1;');
  writeFileSync(join(directory,'bin/docker'),dockerShim,{mode:0o755});
  const installer=readFileSync('scripts/install.sh','utf8');
  let command;
  if(mode==='release') {
   // A release install runs from its own folder, whose install.sh names its image by digest.
   const image=`ghcr.io/omarabdo516/gtmworks:1.2.3@sha256:${'a'.repeat(64)}`;
   const sandboxImage=`ghcr.io/omarabdo516/gtmworks-sandbox:1.2.3@sha256:${'b'.repeat(64)}`;
   writeFileSync(join(directory,'install.sh'),installer.replace('release_image=','release_image='+image).replace('sandbox_image=','sandbox_image='+sandboxImage));
   writeFileSync(join(directory,'docker-compose.install.yml'),`name: gtmworks-install\nservices:\n  db:\n    image: ${image}\n`);
   command=['install.sh','update'];
  } else {
   mkdirSync(join(directory,'scripts'));
   for(const file of ['install.sh','install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
   command=mode==='install'?['scripts/install.sh']:['scripts/install.sh','update','main'];
  }
  const commands=join(directory,'commands');
  const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,MIGRATION_SQL:join(directory,'migration.sql'),GH_TOKEN:''};
  return {directory,run:extra=>{ writeFileSync(commands,''); const result=spawnSync('sh',command,{cwd:directory,env:{...env,...extra},encoding:'utf8'}); return {...result,commands:readFileSync(commands,'utf8'),file:()=>readFileSync(join(directory,'.env.install'),'utf8'),migrated:()=>existsSync(env.MIGRATION_SQL)}; }};
 };
 // A plain install run on an install the previous release made (its `hermes` container, no Engine folder) moves it as an
 // update does, so two Companies on its one Engine are refused the same way before anything changes (#378); a run with no
 // such container counts nothing.
 {
  const install=fixture('install');
  const refused=install.run({COMPANIES:'2',OLD_HERMES:'old-hermes-id'});
  assert.equal(refused.status,1,refused.stderr);
  assert.match(refused.stderr,/This install has 2 Companies on one Engine\./);
  assert.equal(refused.migrated(),false);
  assert.equal(refused.file(),existing);
  assert.doesNotMatch(refused.commands,/--single-transaction|compose .* up /);
  const fresh=install.run({COMPANIES:'2',OLD_HERMES:''});
  assert.doesNotMatch(fresh.commands,/count\(\*\) from public\.companies/);
 }
 for(const mode of ['source','release']) {
  const install=fixture(mode);
  for(const companies of ['2','7']) {
   const refused=install.run({COMPANIES:companies});
   assert.equal(refused.status,1,`${mode}: ${refused.stderr}`);
   // The message says each Company needs its own Engine and that this release has no path for such an install.
   assert.match(refused.stderr,new RegExp(`This install has ${companies} Companies on one Engine\\. Each Company now needs its own Engine, and this release has no path for an install with more than one Company\\. Nothing was changed: the release you run still serves\\.`),mode);
   // Nothing changed: the Companies were read from the running database and nothing else ran, so no migration, no
   // container and no install file was touched.
   assert.deepEqual(refused.commands.trimEnd().split('\n'),['compose --env-file .env.install -f docker-compose.install.yml exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c select count(*) from public.companies;'],mode);
   assert.equal(refused.migrated(),false,mode);
   assert.equal(refused.file(),existing,mode);
   assert.equal(existsSync(join(install.directory,'.install-lock')),false,mode);
  }
  // A count the install cannot read is no guess: the update stops rather than put two Companies on one Engine.
  const unreadable=install.run({COMPANIES:''});
  assert.equal(unreadable.status,1,mode);
  assert.match(unreadable.stderr,/The update reads this install's Companies from its database:/,mode);
  assert.doesNotMatch(unreadable.commands,/--single-transaction/,mode);
  assert.equal(unreadable.file(),existing,mode);
  // One Company, or none, goes on with the update.
  const one=install.run({COMPANIES:'1'});
  assert.equal(one.status,0,`${mode}: ${one.stderr}`);
  assert.match(one.commands,/count\(\*\) from public\.companies[\s\S]*--single-transaction/,mode);
  // That update wrote the first Engine's folder, so the install is now one this release made: every Company has its own
  // Engine, and several go on with the next update without being counted.
  assert.ok(existsSync(join(install.directory,'.engines/first/.env')),mode);
  const several=install.run({COMPANIES:'2'});
  assert.equal(several.status,0,`${mode}: ${several.stderr}`);
  assert.doesNotMatch(several.commands,/count\(\*\) from public\.companies/,mode);
 }
});

// The update of an install the release before this one made adopts its Engine (#378, S1, S2): the volume and the key
// are the ones it already had, so its Agents' memory and its sign-in stay and its Engine gets a network of its own. The
// previous release is a real install of origin/main's code at this pull request's base, not this release's schema.
// An install with more than one Company on that schema is refused before anything changes.
test('a restore --version asks the target release the same archive check a restore makes (#378, T4)', () => {
 const get=readFileSync('scripts/get.sh','utf8');
 assert.match(get,/install\.sh check-restore/,'get.sh delegates the archive check');
 assert.match(get,/check-restore/);
 const install=readFileSync('scripts/install.sh','utf8');
 assert.match(install,/elif \[ "\$operation" = check-restore \]/);
 assert.match(install,/check_backup "\$2" \|\| exit 1/,'the restore and the check share one function');
 assert.match(install,/check_backup "\$2" \|\| exit 1/);
 assert.match(install,/The backup does not hold an Engine for every Company\./,'the installer holds the archive-layout check');
 // get.sh asks the target release's installer rather than laying out the archive itself (#378, T4).
 assert.ok(get.indexOf("grep -q 'check-restore'")>=0);
 assert.match(get,/check-restore "\$archive"/);
});

test('the install job updates a real previous-release install with one Company, and refuses one with two', () => {
 const step=installJob().steps.find(step=>/release install and update/.test(step.name||''));
 const run=step.run;
 const lines=run.split('\n');
 const at=text=>lines.findIndex(line=>line.includes(text));
 // The release step names no base commit: the previous release is a fixed commit (#378, C1), so the proof still builds a
 // release before the Engines after this one has merged to main.
 assert.equal(step.env.BASE_SHA,undefined,'the release step names no pull request base');
 const pinned=at('previous_release=8f47abe1761548a45de72937fac443a4bdea3eb6');
 assert.ok(pinned>=0,run);
 assert.ok(!run.includes('BASE_SHA'),'the job reads no base commit');
 assert.equal(run.includes('git rev-parse origin/main'),false,'the previous release is not origin/main');
 // The previous release is the pinned commit, installed from its own two files.
 const checkout=at('git worktree add "$RUNNER_TEMP/previous-release" "$previous_release"');
 assert.ok(checkout>pinned,run);
 const built=at('docker build -q -t localhost:5000/gtmworks:0.0.0-main "$RUNNER_TEMP/previous-release"');
 const installed=at("sh \"$dir/install.sh\" || fail 'the previous release install'");
 for(const [index,name] of [[built,'the previous release image'],[installed,'the previous release install']]) assert.ok(index>=0,`${name}: ${run}`);
 assert.ok(built>checkout&&installed>built,'the previous release is built and installed before the update');
 // Its own shape: no .engines/, its Engine key in .env.install, its one `hermes` service.
 for(const text of [
  "[[ $key =~ ^[a-f0-9]{64}$ ]] || fail 'the previous release keeps its Engine key in .env.install'",
  "[[ ! -e .engines ]] || fail 'the previous release has no Engine folders'",
  "[[ -n $(docker ps -q --filter 'name=^gtmworks-install-hermes-1$') ]] || fail 'the previous release runs its Engine'",
 ]) assert.ok(run.includes(text),text);
 assert.equal(run.includes('docker run -d --name gtmworks-install-hermes-1'),false,'the job no longer fakes a previous release');
 // First run on it, then the fact the Agent was told and the sign-in the Company made, both in the Engine's data, and the
 // backup that release's own installer takes of it (#378, C3).
 const memory=at('/memories/MEMORY.md'),signIn=at('.anthropic_oauth.json'),update=at("sh install.sh update || fail 'release update'");
 for(const [index,name] of [[memory,'the memory'],[signIn,'the sign-in']]) assert.ok(index>=0,`the job writes ${name}`);
 assert.ok(memory<update&&signIn<update,'both are written before the update');
 const backup=at('sh install.sh backup "$RUNNER_TEMP/previous-release-backup"');
 assert.ok(backup>signIn&&backup<update,'the previous release backs up its one Company before the update');
 for(const text of [
  "grep -Eq '^opt/data(/|$)' \"$RUNNER_TEMP/previous-release.list\"",
  "if grep -Eq '^\\.?engines' \"$RUNNER_TEMP/previous-release.list\"; then fail 'the previous release backup holds no Engine folders'; fi",
 ]) assert.ok(run.includes(text),text);
 // After it: the adopted Engine (its key, its volume, its own network and container), the memory and the sign-in.
 const adopted=[
  "[[ $(engine_key) == \"$key\" ]] || fail 'the update adopted the Engine key'",
  "if grep -q '^HERMES_API_KEY=' .env.install; then fail 'the update left no Engine key in .env.install'; fi",
  "== gtmworks-install_hermes ]] || fail 'the Engine keeps the volume the previous release used'",
  "== gtmworks-engine-first ]] || fail \"the Engine joins its own network only\"",
  'node /check/check-install-engine-network.mjs',
  "fail 'the container the previous release ran the Engine in is retired'",
  "|| fail \"the updated install's Company answers from its Engine record with the adopted key\"",
  'check-install-update.mjs',
  "|| fail \"the Agent remembers what it was told and the Company's sign-in still serves\"",
  "sh install.sh || fail 'the install command again'",
  "fail 'the install command again keeps the adopted Engine key'",
  "fail 'the install command again leaves the adopted Engine running'",
 ];
 for(const text of adopted) assert.ok(run.includes(text),text);
 for(const text of adopted) assert.ok(run.indexOf(text)>update,text);
 // The archive the previous release made is restored onto a fresh install of this release after all of that (#378, C3):
 // its one Company reaches its own Engine, and its Agent remembers what it was told.
 const previousArchive=at('sh install.sh restore "$previous_backup"');
 assert.ok(previousArchive>update,run);
 for(const text of [
  "fail 'the previous release archive restores its one Engine'",
  "fail 'the previous release archive restores its one Company'",
  "fail 'the previous release archive keeps the key it held in .env.install'",
  "fail 'the restored install keeps no Engine key in .env.install'",
  // The key left the app's and the worker's environment before they were recreated (X3): the archive's key never
  // reaches either container's environment, the restored Engine runs, and a Conversation answers on it.
  "fail \"the $service starts with no Engine key in its environment\"",
  "|| fail 'the restored install runs its one Engine'",
  "|| fail 'the Company the previous release archive restored names its own Engine'",
  "|| fail 'the Company the previous release archive restored answers on its own Engine'",
  "|| fail 'the Company the previous release archive restored answers on its own Engine and its Agent remembers'",
 ]) assert.ok(run.includes(text),text);
 // The security check sits after the archive was restored, not only in the install part (#378, X3).
 assert.ok(run.indexOf('the $service starts with no Engine key in its environment')>previousArchive);
 assert.ok(run.indexOf('check-install-conversation.mjs')>previousArchive);
 // #384: the command reaches that Company's Engine and prints the provider's address, without finishing the sign-in.
 assert.ok(run.includes('--command --dir "$dir" sign-in claude --company "$company"'),run);
 assert.ok(run.includes("grep -Eq 'https://(claude\\.ai|console\\.anthropic\\.com)'"),run);
 // Two Companies on the previous release's schema: refused, with the reason, and nothing migrated, replaced or
 // restarted. The probe Company is made on main's own companies table, before the update.
 const two=at("insert into public.companies (id,slug,name) values ('00000000-0000-4000-8000-000000000239','release-probe','Release probe');");
 assert.ok(two>=0&&two<update,run);
 for(const text of [
  "if sh install.sh update > \"$RUNNER_TEMP/several-companies.log\" 2>&1; then",
  "fail 'an update of a previous release install with two Companies must be refused'",
  "grep -F 'This install has 2 Companies on one Engine.'",
  "grep -F 'Each Company now needs its own Engine'",
  "grep -F 'this release has no path for an install with more than one Company'",
  "fail 'the refused update replaced the previous release web container'",
  "fail 'the refused update left the release it runs'",
  "[[ $(db -c \"select to_regclass('public.company_engines') is null\") == t ]] || fail 'the refused update applied no migration'",
  "fail \"$path returned HTTP $status after the refused update (expected 200)\"",
  "delete from public.companies where id='00000000-0000-4000-8000-000000000239'",
 ]) assert.ok(run.includes(text),text);
 assert.ok(run.indexOf("delete from public.companies")>two,'the probe Company is removed after the refusal');
});

// The every-Engine check runs inside the installed web container after every Engine was restored and after an update
// moved every Engine to another image (#386): it reads each Company's Engine from its record, runs its main Agent, and
// proves the memory each Engine kept is its own. It prints no key.
test('the every-Engine check runs each Company\'s Agent on its own Engine and prints no key', () => {
 const script=readFileSync('scripts/check-install-engines.mjs','utf8');
 assert.match(script,/sendMessage\(/);
 assert.match(script,/engineOf\(/);
 assert.match(script,/install-proof\.mjs/);
 assert.match(script,/'proxy-owner@example\.com'/,'the Owner of every Company signs in');
 assert.doesNotMatch(script,/\bconsole\.(log|error|warn|info)\(/,'no console call prints a value the proof did not name');
 assert.doesNotMatch(script,/process\.stdout\.write\(/,'no direct write bypasses the proof');
 assert.doesNotMatch(script,/writeProof\([^)]*key/);
});

// #386: one backup holds every Company's Engine and one restore brings them all back. The install job proves it on two
// Companies after `company add`, refuses an archive naming an Engine without its data, and names the Engines the archive
// holds in engines.list. An archive in the previous release's shape is made by that release's own installer in the
// release step (#378, C3), never repacked from this install's database.
test('the install job backs up and restores every Company Engine, refuses an incomplete archive and keeps no repacked archive', () => {
 const run=installJob().steps.find(step=>step.env?.INSTALL_REF).run;
 const lines=run.split('\n');
 const at=text=>lines.findIndex(line=>line.includes(text));
 // The one-Engine proof is the release step's own (#378, C3): this part holds no repacked archive and no Engine key.
 for(const text of [
  'tar -czf /install/before-engines.tgz',
  'before-engines.tgz',
  'HERMES_API_KEY=%s',
 ]) assert.equal(run.includes(text),false,`the install part holds no repacked archive: ${text}`);
 assert.equal(run.includes("before_engines_key"),false,'the install part keeps no repacked archive key');
 // The two-Company proof starts from the profiles the job has just proven on two Engines, writes a code word into each
 // Company's own Engine, and backs up once.
 const verify=at('- verify "$marker" < scripts/check-install-profiles.mjs');
 const memory=at('code="backup-${company//-/}"');
 const everyBackup=at("sh scripts/install.sh backup || fail 'backup of every Engine'");
 const restore=at("sh scripts/install.sh restore \"$every_engine\"");
 const runs=at('check-install-engines.mjs');
 for(const [index,name] of [[verify,'the two-Engine profiles'],[memory,'a code word in each Engine'],[everyBackup,'the every-Engine backup'],[restore,'the every-Engine restore'],[runs,'a Run on each Engine']]) assert.ok(index>=0,`the job runs ${name}`);
 assert.ok(verify<memory&&memory<everyBackup&&everyBackup<restore&&restore<runs,lines.join('\n'));
 // Both Engines' data and keys are in the archive, the manifest names them (#378, C4), and the install it restores into
 // is empty.
 for(const text of [
  "grep -qx 'engines.list' \"$RUNNER_TEMP/every-engine.list\"",
  "grep -q \"^engines/$name/\" \"$RUNNER_TEMP/every-engine.list\"",
  "grep -qx \"\\.engines/$name/\\.env\" \"$RUNNER_TEMP/every-engine.list\"",
  "if grep -qx 'opt/data/' \"$RUNNER_TEMP/every-engine.list\"; then fail 'the every-Engine backup holds no opt/data'; fi",
  "remove_install || fail 'remove the install before the every-Engine restore'",
  "sh scripts/install.sh || fail 'fresh install before the every-Engine restore'",
 ]) assert.ok(run.includes(text),text);
 // Each Engine comes back as its own container, on its own volume and network, named by its Company's record.
 for(const text of [
  "[[ -n $engine ]] || fail \"the restored install runs the Engine $name\"",
  "-ge 1 ]] || fail \"a Company's record names the Engine $name\"",
  "|| fail \"the $service joins the network of the Engine $name\"",
  "[[ $(ls -d .engines/*/ | wc -l) == \"$engines_before\" ]] || fail 'the every-Engine restore brings every Engine back'",
 ]) assert.ok(run.includes(text),text);
 // An archive naming an Engine without its data is refused before anything stops or changes. It keeps its engines.list,
 // so the manifest is what catches it (#378, C4).
 const incomplete=at('rm -rf "$incomplete/engines/$second_name"');
 assert.ok(incomplete>runs,run);
 assert.ok(run.includes('engines engines.list var/lib/postgresql/data'),'the incomplete archive keeps its manifest');
 for(const text of [
  "if sh scripts/install.sh restore \"$RUNNER_TEMP/incomplete-engines.tgz\" > incomplete-engines.log 2>&1; then",
  "fail 'an archive naming an Engine without its data must be refused'",
  "grep -Fq 'The backup does not hold an Engine for every Company.'",
  "fail 'the refused restore replaced the web container'",
  "fail 'the refused restore stopped no Engine'",
  "fail 'the refused restore changed no setting'",
  "fail 'the refused restore changed no data'",
 ]) assert.ok(run.includes(text),text);
});

// #386: a release that pins another Engine image recreates every Company's Engine, and a Run on each answers.
test('the install job updates two Companies to a release pinning another Engine image and proves a Run on each', () => {
 const run=installJob().steps.find(step=>/release install and update/.test(step.name||'')).run;
 const lines=run.split('\n');
 const add=lines.findIndex(line=>line.includes("sh install.sh company add --name 'Second Company' --owner proxy-owner@example.com || fail 'company add before the update'"));
 const update=lines.findIndex(line=>line.includes("sh install.sh update || fail 'update every Company Engine'"));
 assert.ok(add>=0,run);
 assert.ok(update>add,'the update runs on an install made with two Companies');
 // The fourth release pins another Engine image: the pinned image under another tag, so no new pull is needed.
 const tagged=lines.findIndex(line=>line.includes('docker tag "$hermes_image" gtmworks-engine-check:0.0.2'));
 const build=lines.findIndex(line=>line.includes('build the release that pins another Engine image'));
 for(const [index,name] of [[tagged,'the other Engine image tag'],[build,'the release that pins it']]) assert.ok(index>=0,`the job makes ${name}`);
 assert.ok(tagged<build&&build<update,run);
 assert.ok(run.includes("RUN sed -i 's#^\\( *image:\\).*#\\1 gtmworks-engine-check:0.0.2#' /app/install/scripts/engine-template.yml"),run);
 assert.ok(run.includes("node scripts/release-assets.mjs \"$fourth\" release-engines"),run);
 // Every Engine was recreated with the new image, on its own volume and network, and a Run on each answers.
 for(const text of [
  "[[ -n $engine && $(docker inspect -f '{{.Id}}' \"$engine\") != \"$before\" ]] || fail \"the update recreated the Engine $name\"",
  "== gtmworks-engine-check:0.0.2 ]] || fail \"the Engine $name runs the image the release pins\"",
  "|| fail \"the Engine $name keeps its own volume through the update\"",
  "|| fail \"the Engine $name joins its own network only after the update\"",
  "check-install-engines.mjs\" || fail 'a Run on each Company answers after the update'",
 ]) assert.ok(run.includes(text),text);
 // The code word was written into each Company's own Engine before the update, and each container's id and image were
 // read before it, so a recreation is proven rather than assumed.
 assert.ok(lines.findIndex(line=>line.includes('The company code word is $2.'))<update,run);
 assert.ok(lines.findIndex(line=>line.includes(': > engines-before'))<update,run);
});

// The update check runs in the installed web container after the update (#385): it reads the Company's sign-in through
// the product's own reader and runs a Conversation on the adopted Engine. It prints only the proof's named fields.
test('the update check reads the sign-in and the Agent memory through the product, and prints no key', () => {
 const script=readFileSync('scripts/check-install-update.mjs','utf8');
 assert.match(script,/readCompanySignIns\(/);
 assert.match(script,/sendMessage\(/);
 assert.match(script,/install-proof\.mjs/);
 assert.doesNotMatch(script,/\bconsole\.(log|error|warn|info)\(/,'no console call prints a value the proof did not name');
 assert.doesNotMatch(script,/process\.stdout\.write\(/,'no direct write bypasses the proof');
 // It names the Engine's management listener, never the key, on its own line.
 assert.match(script,/HERMES_MANAGEMENT_ADDRESS/);
 assert.doesNotMatch(script,/writeProof\([^)]*key/);
});

// A successful update on the real install belongs to issue #52; the install job keeps only the failed-update check, and
// that check still proves the rollback: the migration is named, the old web container serves, and nothing is applied.
test('the install job leaves the successful update to issue 52 and keeps the failed-update rollback check', () => {
 const run=installJob().steps.find(step=>step.env?.INSTALL_REF).run;
 assert.doesNotMatch(run,/update-gateway\.log|old_gateway|sed -i '\/X-Real-IP\/d'/);
 assert.equal([...run.matchAll(/sh scripts\/install\.sh update /g)].length,1,'only the failed update runs');
 for(const text of ["if sh scripts/install.sh update \"$INSTALL_REF\" > update.log 2>&1; then fail_update 'update must fail'; fi",
  "grep -Fq 'Applying migration: 99999999999999_failure.sql' update.log","[[ $(compose ps -q web) == \"$old_web\" ]] || fail_update 'old web container still serving'",
  "to_regclass('public.update_should_rollback') is null","fail_update 'old version healthy after failed update'"]) assert.ok(run.includes(text),text);
});

// The Agents' profiles, rules, knowledge, skills, memory and history live only in the bundled Engine's volume (#349), so
// the install job writes a rule and the Company knowledge through the engine contract before the backup and reads both
// back after the restore: a backup that left the volume out fails there.
test('the install job writes an Agent rule and the Company knowledge before the backup and reads both back after the restore', () => {
 const run=installJob().steps.find(step=>step.env?.INSTALL_REF).run;
 const lines=run.split('\n');
 const at=pattern=>lines.findIndex(line=>pattern.test(line));
 const seed=at(/^lifecycle seed/),backup=at(/^sh scripts\/install\.sh backup \|\| fail 'backup'$/);
 const restore=at(/sh scripts\/install\.sh restore "\$backup" \|\|/),verify=at(/^lifecycle verify/);
 for(const [index,name] of [[seed,'seed'],[backup,'backup'],[restore,'restore'],[verify,'verify']]) assert.ok(index>=0,`the job runs ${name}`);
 assert.ok(seed<backup&&backup<restore&&restore<verify,lines.join('\n'));
 const script=readFileSync('scripts/check-install.mjs','utf8');
 for(const call of ['writeSoulRules','writeSharedSkill','readSharedSkill']) assert.match(script,new RegExp(`${call}\\(`),`check-install.mjs ${call}`);
 assert.match(script,/knowledgeSkill\(/);
});

// A Company with no Owner yet is held behind a first-Owner link (#383, ADR 0019): the install job proves the link is
// printed with its secret after `#`, only its hash is kept, the Company exists nowhere, `company list` shows it waiting,
// a fresh link ends the earlier one, and sending it makes the Company with its sender as Owner on that link's Engine.
test('the install job proves a first-Owner link holds a Company, a fresh link ends it, and sending it makes the Company', () => {
 const run=installJob().steps.find(step=>step.env?.INSTALL_REF).run;
 const lines=run.split('\n');
 const at=text=>lines.findIndex(line=>line.includes(text));
 const add=at("company add --name 'Linked Company'"),fresh=at("company link 'Linked Company'"),claimed=at('company list after the link is used');
 for(const [index,name] of [[add,'the link-held add'],[fresh,'a fresh link'],[claimed,'the list after the claim']]) assert.ok(index>=0,`the job runs ${name}`);
 assert.ok(add<fresh&&fresh<claimed,lines.join('\n'));
 for(const text of [
  "grep -o 'http://[^[:space:]]*/first-owner#code=[a-f0-9]*'",
  'the link secret itself is stored nowhere',
  'the Company exists nowhere until its link is used',
  'company list shows the Company waiting for its Owner',
  'a fresh link ends the earlier one',
  'check-install-owner-link.mjs',
  'the link makes the Company on its own Engine record',
  "the link's sender is the Company Owner",
  'the link is used once',
 ]) assert.ok(run.includes(text),text);
 const script=readFileSync('scripts/check-install-owner-link.mjs','utf8');
 assert.match(script,/first-owner\/submit/);
 assert.match(script,/linked-company-\[a-f0-9\]\{8\}.+home/);
 assert.doesNotMatch(script,/console\.(log|error)\([^)]*process\.env\.LINK_SECRET/,'the proof never prints the secret');
});

test('failed backup resumes the install and leaves no archive or secrets behind', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-backup-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'private-key');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in *'.State.Health.Status'*) echo healthy;; *'tar -czf'*) echo 'partial-private-archive'; exit 9;; esac
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

// Every Company's Engine is in one archive (#386): each Engine's data volume, under the Engine's own folder name, and
// its key folder. A restore puts each Engine's data back into its own volume, starts every Engine and joins the app and
// the worker to each Engine's network; a failed extraction stays offline.
test('backup and restore round-trip every Engine\'s volume and key; failed extraction stays offline', t => {
 const compose=load(readFileSync('docker-compose.install.yml','utf8'));
 const engine=load(readFileSync('scripts/engine-template.yml','utf8'));
 const paths=['var/lib/postgresql/data','etc/postgresql-custom','var/lib/storage'];
 // The Agents' profiles, rules, knowledge, skills, memory and history live only in their own Company's Engine volume
 // (#349, ADR 0018), one volume per Engine.
 const firstVolume='gtmworks-install_hermes', secondVolume='gtmworks-engine-second-company';
 assert.ok(compose.services.db.volumes.includes(`database:/${paths[0]}`));
 assert.ok(compose.services.db.volumes.includes(`database-config:/${paths[1]}`));
 assert.ok(compose.services.storage.volumes.includes(`files:/${paths[2]}`));
 assert.equal(compose.services.storage.environment.FILE_STORAGE_BACKEND_PATH,`/${paths[2]}`);
 assert.ok(engine.services.engine.volumes.includes('data:/opt/data'));
 assert.equal(engine.volumes.data.name,'${ENGINE_VOLUME:?Run scripts/install.sh}');
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-roundtrip-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','.engines/first','.engines/second-company',
  ...paths.map(path=>`volumes/${path}`),`volumes/${firstVolume}/agents`,`volumes/${secondVolume}/profiles/co-second/memories`]) {
  mkdirSync(join(directory,folder),{recursive:true});
 }
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o600});
 // Each Engine's key lives in its own file, and travels in the archive (#385).
 const engineEnv=(name,volume,network,key)=>
  `ENGINE_NAME=${name}\nENGINE_KEY=${key}\nENGINE_VOLUME=${volume}\nENGINE_NETWORK=${network}\n`;
 const firstEnv=engineEnv('gtmworks-engine-first',firstVolume,'gtmworks-engine-first','a1'.repeat(32));
 const secondEnv=engineEnv('gtmworks-engine-second-company',secondVolume,'gtmworks-engine-second-company','b2'.repeat(32));
 writeFileSync(join(directory,'.engines/first/.env'),firstEnv,{mode:0o600});
 writeFileSync(join(directory,'.engines/second-company/.env'),secondEnv,{mode:0o600});
 for(const path of paths) writeFileSync(join(directory,'volumes',path,'saved'),'original',{mode:0o640});
 writeFileSync(join(directory,'volumes',firstVolume,'agents','SOUL.md'),'the team says this',{mode:0o600});
 writeFileSync(join(directory,'volumes',secondVolume,'profiles','co-second','memories','MEMORY.md'),'the second team says this',{mode:0o600});
 writeFileSync(join(directory,'bin/docker'),`#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2),cwd=process.cwd(),root=cwd+'/volumes';
appendFileSync(cwd+'/commands',JSON.stringify(args)+'\\n');
if(args.includes('{{.State.Health.Status}}')) { console.log('healthy'); process.exit(0); }
// Each named volume mounted at /engines/<folder> is the folder of that name in ./volumes (Docker would mount it there);
// the volume's own folder is a link to it, so a mount is a real directory to tar.
mkdirSync(root+'/engines',{recursive:true});
for(let index=0;index<args.length;index++) {
 if(args[index]!=='-v') continue;
 const [source,target]=args[index+1].split(':');
 if(!target||!target.startsWith('/engines/')) continue;
 const name=target.slice('/engines/'.length),from=root+'/'+source,to=root+'/engines/'+name;
 if(existsSync(from)&&lstatSync(from).isSymbolicLink()) continue;
 rmSync(to,{recursive:true,force:true});
 if(existsSync(from)) renameSync(from,to); else mkdirSync(to,{recursive:true});
 symlinkSync(to,from);
}
if(args[0]==='compose') {
 if(args.includes('stop')) writeFileSync(cwd+'/stopped','yes');
 if(args.includes('up')) writeFileSync(cwd+'/stopped','no');
 if(args.includes('ps')) {
  if(!args.includes('-aq')) console.log(args.at(-1)+'-id');
  else {
   assert.equal(readFileSync(cwd+'/stopped','utf8'),'yes');
   console.log(args.at(-1)+'-stopped');
  }
 }
 if(args.includes('psql')) console.log(args.some(argument=>String(argument).includes('from public.company_engines'))
  ?'http://gtmworks-engine-first:8642\\nhttp://gtmworks-engine-second-company:8642':'t');
} else if(args.includes('alpine:3.21')) {
 const command=args.slice(args.indexOf('alpine:3.21')+1);
 if(args.includes('--volumes-from')) {
  assert.equal(readFileSync(cwd+'/stopped','utf8'),'yes');
  assert.equal(args[args.indexOf('--volumes-from')+1],'db-stopped');
  assert.ok(args.includes('storage-stopped'),'the files volume is archived too');
 }
 if(command[0]==='tar' && command[1]==='-czf') {
  // BusyBox has one global -C, unlike GNU tar's positional -C options.
  assert.equal(command.filter(arg=>arg==='-C').length,1);
  assert.ok(args.includes(cwd+'/.env.install:/.env.install:ro'));
  assert.ok(args.includes(cwd+'/.engines:/.engines:ro'),'the Engine keys are archived too');
  assert.ok(args.includes(cwd+'/.install-lock/engines.list:/engines.list:ro'),'the Engines the Companies name are archived too');
  assert.ok(args.includes('gtmworks-install_hermes:/engines/first:ro'),'the first Engine volume is archived');
  assert.ok(args.includes('gtmworks-engine-second-company:/engines/second-company:ro'),'the second Engine volume is archived');
  copyFileSync(cwd+'/.env.install',root+'/.env.install');
  cpSync(cwd+'/.engines',root+'/.engines',{recursive:true});
  copyFileSync(cwd+'/.install-lock/engines.list',root+'/engines.list');
 }
 // The Engines' key files come back into the install folder, not into a volume.
 if(command[0]==='tar' && command[1]==='-xzpf' && command.includes('.engines')) {
  const child=spawnSync(command[0],[...command.slice(1,command.indexOf('-C')).map(arg=>arg.replaceAll('/backup/',cwd+'/.install-lock/')),'-C',cwd,'.engines'],{stdio:'inherit'});
  process.exit(child.status ?? 1);
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
  .replaceAll('/opt/data',root+'/opt/data')
  .replaceAll('/engines',root+'/engines')
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
 // Every Engine was stopped before its volume was copied.
 const commands=readFileSync(join(directory,'commands'),'utf8');
 const copied=commands.indexOf('"-czf"');
 for(const name of ['gtmworks-engine-first','gtmworks-engine-second-company']) {
  const stopped=commands.indexOf(JSON.stringify(['stop',name]));
  assert.ok(stopped>=0&&stopped<copied,`${name} is stopped before the copy: ${commands}`);
 }
 // Both Engine volumes are in the archive, each under its own folder, their files under their own names and modes.
 const listed=spawnSync('tar',['-tzf',join(directory,archive)],{encoding:'utf8'});
 assert.equal(listed.status,0,listed.stderr);
 const entries=listed.stdout.trimEnd().split('\n');
 for(const entry of ['engines/first/','engines/first/agents/','engines/first/agents/SOUL.md',
  'engines/second-company/','engines/second-company/profiles/co-second/memories/MEMORY.md']) {
  assert.ok(entries.includes(entry),entry);
 }
 assert.ok(entries.includes('var/lib/storage/'));
 assert.ok(!entries.some(entry=>entry==='opt/data/'||entry.startsWith('opt/data/')),'the new layout holds no opt/data');
 // The archive names the Engines its Companies name, so a restore knows every one it must hold (#378, C4).
 assert.ok(entries.includes('engines.list'),'the archive holds the Engines manifest');
 const manifest=spawnSync('tar',['-xzOf',join(directory,archive),'engines.list'],{encoding:'utf8'});
 assert.equal(manifest.status,0,manifest.stderr);
 assert.equal(manifest.stdout,'first\nsecond-company\n');
 for(const path of paths) {
  rmSync(join(directory,'volumes',path,'saved'));
  writeFileSync(join(directory,'volumes',path,'fresh'),'discard');
 }
 for(const volume of [firstVolume,secondVolume]) {
  rmSync(join(directory,'volumes',volume),{recursive:true});
  mkdirSync(join(directory,'volumes',volume));
  writeFileSync(join(directory,'volumes',volume,'fresh'),'discard');
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
 // Each Engine's volume is cleared and put back as it was, its own owners and modes kept, and each Engine's folder and
 // key are back as the archive kept them.
 assert.deepEqual(readdirSync(join(directory,'volumes',firstVolume)).sort(),['agents']);
 assert.equal(readFileSync(join(directory,'volumes',firstVolume,'agents','SOUL.md'),'utf8'),'the team says this');
 assert.equal(statSync(join(directory,'volumes',firstVolume,'agents','SOUL.md')).mode & 0o777,0o600);
 assert.deepEqual(readdirSync(join(directory,'volumes',secondVolume)).sort(),['profiles']);
 assert.equal(readFileSync(join(directory,'volumes',secondVolume,'profiles','co-second','memories','MEMORY.md'),'utf8'),'the second team says this');
 assert.equal(readFileSync(join(directory,'.engines/first/.env'),'utf8'),firstEnv);
 assert.equal(readFileSync(join(directory,'.engines/second-company/.env'),'utf8'),secondEnv);
 assert.doesNotMatch(restore.stdout,/Hermes data was not in this backup/);
 assert.match(readFileSync(join(directory,'commands'),'utf8'),/--force-recreate/);
 // Every Engine starts from its own folder again, and the app and the worker join each Engine's network.
 const after=readFileSync(join(directory,'commands'),'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
 for(const [name,folder] of [['gtmworks-engine-first','first'],['gtmworks-engine-second-company','second-company']]) {
  assert.ok(after.some(command=>command.join(' ')===
   `compose --project-name ${name} --env-file .engines/${folder}/.env -f scripts/engine-template.yml up -d --wait --wait-timeout 300`),`${name} starts from its own folder`);
  assert.ok(after.some(command=>command.join(' ')===`network connect --alias web ${name} web-id`),after.map(command=>command.join(' ')).join('\n'));
  assert.ok(after.some(command=>command.join(' ')===`network connect ${name} worker-id`),after.map(command=>command.join(' ')).join('\n'));
 }
 writeFileSync(join(directory,'commands'),'');
 const failed=spawnSync('sh',['scripts/install.sh','restore',archive],{cwd:directory,env:{...env,FAIL_EXTRACTION:'1'},encoding:'utf8'});
 assert.equal(failed.status,9,failed.stderr);
 assert.doesNotMatch(readFileSync(join(directory,'commands'),'utf8'),/"up"/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

test('restore refuses an archive it cannot fully restore before it changes anything', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-incomplete-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'original-private-key');
 writeFileSync(join(directory,'backup.tgz'),'backup');
 // The archive's own entries; every case is checked before the installer stops, clears or extracts anything.
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *'tar -tzf'*) printf '%s\\n' "$ARCHIVE_ENTRIES";;
 *'tar -tvzf'*) printf '%s\\n' "\${ARCHIVE_LISTING:-drwxr-xr-x root/root 0 var/lib/storage/}";;
 *'tar -xOzf'*'.engines/'*) printf 'ENGINE_KEY=%s\\n' "\${ARCHIVE_ENGINE_KEY:-${'a'.repeat(64)}}";;
 *'tar -xOzf'*'engines.list'*) printf '%s\\n' "\${ARCHIVE_MANIFEST:-}";;
 *'exec -T db psql'*) echo t;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(entries,{key,manifest,listing}={})=>{
  writeFileSync(commands,'');
  return {...spawnSync('sh',['scripts/install.sh','restore','backup.tgz'],{cwd:directory,
   env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,ARCHIVE_ENTRIES:entries,...(key?{ARCHIVE_ENGINE_KEY:key}:{}),...(manifest!==undefined?{ARCHIVE_MANIFEST:manifest}:{}),...(listing?{ARCHIVE_LISTING:listing}:{})},encoding:'utf8'}),
   commands:readFileSync(commands,'utf8'),file:readFileSync(join(directory,'.env.install'),'utf8')};
 };
 const base='var/lib/postgresql/data/\netc/postgresql-custom/\nvar/lib/storage/\n.env.install';
 const read=['run --rm -v '+join(directory,'.install-lock')+':/backup:ro alpine:3.21 tar -tzf /backup/backup.tgz',
  'run --rm -v '+join(directory,'.install-lock')+':/backup:ro alpine:3.21 tar -tvzf /backup/backup.tgz'];
 // Nothing changed: the archive was read and refused, and no volume, container or setting was touched.
 const refusedBefore=(refused,label,extra=[])=>{
  assert.deepEqual(refused.commands.trimEnd().split('\n'),['ps -aq --filter label=com.docker.compose.project=gtmworks-install --filter label=com.docker.compose.service=hermes',...read,...extra],label);
  assert.equal(refused.file,'original-private-key',label);
 };
 for(const [label,entries] of [
  // A key folder whose Engine's data is missing.
  ['an Engine without its data',`${base}\n.engines/first/.env\n.engines/second-company/.env\nengines/first/`],
  // Engine data whose key folder is missing: the restore would not know where to put it.
  ['data without its Engine',`${base}\n.engines/first/.env\nengines/first/\nengines/second-company/`],
  // The one Engine layout and the every Engine layout at once: no release made one.
  ['two layouts',`${base}\nopt/data/\nengines/first/\n.engines/first/.env`],
  // One Engine before this release, with another Engine's key and no data for it.
  ['a second Engine before this release',`${base}\nopt/data/\n.engines/first/.env\n.engines/second-company/.env`],
  // Every Engine layout without the first Engine, which every install has.
  ['no first Engine',`${base}\nengines/second-company/\n.engines/second-company/.env`],
  // The every Engine layout without engines.list, which this release always writes with it (#378, C4): an archive that
  // lost its list and a second Engine's data and key looks complete otherwise.
  ['the every Engine layout without its list',`${base}\nengines/first/\n.engines/first/.env`],
 ]) {
  const refused=run(entries);
  assert.equal(refused.status,1,`${label}: ${refused.stderr}`);
  assert.match(refused.stderr,/The backup does not hold an Engine for every Company\.|Unrecognised backup\.|Incomplete backup\./,label);
  refusedBefore(refused,label);
 }
 // A backup of this release names every Engine its Companies name in engines.list (#378, C4): one it lists without its
 // data, or without its key, is refused before anything stops, even when the folders it does hold agree with each other.
 for(const [label,entries,manifest] of [
  ['a manifest Engine without its data',`${base}\nengines/first/\n.engines/first/.env`,'first\nsecond-company'],
  ['a manifest Engine without its key',`${base}\nengines/first/\n.engines/first/.env\n.engines/second-company/.env`,'first\nsecond-company'],
 ]) {
  const refused=run(`${entries}\nengines.list`,{manifest});
  assert.equal(refused.status,1,`${label}: ${refused.stderr}`);
  assert.match(refused.stderr,/The backup does not hold an Engine for every Company\./,label);
  refusedBefore(refused,label,['run --rm -v '+join(directory,'.install-lock')+':/backup:ro alpine:3.21 tar -xOzf /backup/backup.tgz engines.list']);
 }
 // A symbolic or hard link member is refused with the unsafe-path check before anything stops or changes (#378, C15).
 for(const [label,listing] of [
  ['a symbolic link','lrwxrwxrwx root/root 0 var/lib/storage/link -> /etc/passwd'],
  ['a hard link','hrw-r--r-- root/root 0 var/lib/storage/link link to var/lib/storage/saved'],
  // BusyBox tar in Alpine 3.21, which the restore lists with, shows a hard link as a regular member with ` -> target`
  // (seen with `tar -tvzf` on a real archive).
  ['a hard link as BusyBox lists it','-rw-rw-r-- root/root 0 2026-11-20 05:15:50 var/lib/storage/link -> var/lib/storage/saved'],
 ]) {
  const refused=run(`${base}\nvar/lib/storage/link`,{listing});
  assert.equal(refused.status,1,`${label}: ${refused.stderr}`);
  assert.match(refused.stderr,/Unsafe backup path\./,label);
  refusedBefore(refused,label);
 }
 // A key folder or key the installer will not trust is refused the same way, before anything stops or changes (#378,
 // X2): a name that is not an Engine folder, and a key that is not 64 hex characters.
 for(const [label,extra,key,message,manifest] of [
  ['an Engine folder name that is not usable','.engines/first/.env\nengines/first/\nengines/first/data\n.engines/Second_Engine/.env\nengines/Second_Engine/\nengines/Second_Engine/data',undefined,/not usable/,'first\nSecond_Engine'],
  ['an Engine key that is not usable','.engines/first/.env\nengines/first/\nengines/first/data','not-a-key',/has no usable key/,'first'],
 ]) {
  // An archive of this release carries its engines.list, so these reach the checks of each folder's name and key.
  const refused=run(`${base}\n${extra}\nengines.list`,{key,manifest});
  assert.equal(refused.status,1,`${label}: ${refused.stderr}`);
  assert.match(refused.stderr,message,label);
  assert.doesNotMatch(refused.commands,/stop|force-recreate|--volumes-from/,label);
  assert.equal(refused.file,'original-private-key',label);
 }
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});
// An archive the release before this one made holds one Engine: its data at opt/data and its key in .engines/first/.env
// (#385). It restores as one Company on the first Engine, the volume the previous release used.
test('an archive from before every Company had its own Engine restores as one Engine at opt/data', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-before-engines-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const paths=['var/lib/postgresql/data','etc/postgresql-custom','var/lib/storage'];
 const tree=join(directory,'tree');
 for(const folder of ['scripts','bin','volumes/opt/data/agents',...paths.map(path=>`volumes/${path}`),
  ...paths.map(path=>`tree/${path}`),'tree/opt/data/agents','tree/.engines/first']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),'fresh keys',{mode:0o600});
 writeFileSync(join(tree,'.env.install'),secrets);
 const engineEnv=`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`;
 // The archived Engine file names the install's own database volume and network: only its key is taken, and the file is
 // written again with this release's standard names (#378, X2).
 writeFileSync(join(tree,'.engines/first/.env'),`ENGINE_NAME=gtmworks-engine-evil\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-install_database\nENGINE_NETWORK=gtmworks-install_default\n`,{mode:0o600});
 for(const path of paths) writeFileSync(join(tree,path,'saved'),'original',{mode:0o640});
 writeFileSync(join(tree,'opt/data/agents/SOUL.md'),'the team says this',{mode:0o600});
 const archive=join(directory,'before-engines.tgz');
 const made=spawnSync('tar',['-czf',archive,'-C',tree,'.env.install','.engines',...paths,'opt/data'],{encoding:'utf8'});
 assert.equal(made.status,0,made.stderr);
 writeFileSync(join(directory,'volumes/opt/data/fresh'),'discard');
 writeFileSync(join(directory,'bin/docker'),`#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2),cwd=process.cwd(),root=cwd+'/volumes';
appendFileSync(cwd+'/commands',JSON.stringify(args)+'\\n');
if(args.includes('{{.State.Health.Status}}')) { console.log('healthy'); process.exit(0); }
if(args[0]==='compose') {
 if(args.includes('ps')) console.log(args.at(-1)+'-id');
 if(args.includes('psql')) console.log(args.some(arg=>arg.includes('select e.address'))?'http://gtmworks-engine-first:8642':'t');
} else if(args.includes('alpine:3.21')) {
 const command=args.slice(args.indexOf('alpine:3.21')+1);
 // The first Engine's data goes into the volume its own folder names, mounted at opt/data as before #386.
 if(command[0]==='sh') assert.ok(args.includes('gtmworks-install_hermes:/opt/data'),args.join(' '));
 if(command[0]==='tar' && command[1]==='-xzpf' && command.includes('.engines')) {
  const child=spawnSync(command[0],[...command.slice(1,command.indexOf('-C')).map(arg=>arg.replaceAll('/backup/',cwd+'/.install-lock/')),'-C',cwd,'.engines'],{stdio:'inherit'});
  process.exit(child.status ?? 1);
 }
 const mapped=command.map(arg=>arg==='/' ? root : arg
  .replaceAll('/backup/',cwd+'/.install-lock/')
  .replaceAll('/var/lib/',root+'/var/lib/')
  .replaceAll('/etc/postgresql-custom',root+'/etc/postgresql-custom')
  .replaceAll('/opt/data',root+'/opt/data')
  .replaceAll('/engines',root+'/engines')
  .replaceAll('-C / ','-C '+root+' '));
 const child=spawnSync(mapped[0],mapped.slice(1),{stdio:'inherit'});
 process.exit(child.status ?? 1);
}
`,{mode:0o755});
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`};
 const restored=spawnSync('sh',['scripts/install.sh','restore',archive],{cwd:directory,env,encoding:'utf8'});
 assert.equal(restored.status,0,restored.stderr);
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
 // The one Engine's data went back into the first Engine's volume, cleared first.
 assert.deepEqual(readdirSync(join(directory,'volumes/opt/data')).sort(),['agents']);
 assert.equal(readFileSync(join(directory,'volumes/opt/data/agents/SOUL.md'),'utf8'),'the team says this');
 assert.equal(readFileSync(join(directory,'.engines/first/.env'),'utf8'),engineEnv);
 for(const path of paths) assert.equal(readFileSync(join(directory,'volumes',path,'saved'),'utf8'),'original');
 assert.doesNotMatch(restored.stdout,/Hermes data was not in this backup/);
 const commands=readFileSync(join(directory,'commands'),'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
 assert.ok(commands.some(command=>command.join(' ')==='compose --project-name gtmworks-engine-first --env-file .engines/first/.env -f scripts/engine-template.yml up -d --wait --wait-timeout 300'),'the first Engine starts from its own folder');
});

// An archive made before the Agents' data was included still restores, says what it lacks, and refuses an unknown entry.
test('an archive made before Hermes data was included restores, says what it lacks, and still refuses an unknown entry', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-old-backup-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const paths=['var/lib/postgresql/data','etc/postgresql-custom','var/lib/storage'];
 const tree=join(directory,'tree');
 for(const folder of ['scripts','bin','volumes/opt/data',...paths.map(path=>`volumes/${path}`),...paths.map(path=>`tree/${path}`)]) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=Object.entries({...generateInstallEnv(),HERMES_API_KEY:'a1'.repeat(32)}).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),'fresh keys',{mode:0o600});
 for(const path of paths) writeFileSync(join(tree,path,'saved'),'original',{mode:0o640});
 writeFileSync(join(tree,'.env.install'),secrets);
 // The archive the installer made before #349: the four paths, and no opt/data.
 const archive=join(directory,'old.tgz');
 const made=spawnSync('tar',['-czf',archive,'-C',tree,'.env.install',...paths],{encoding:'utf8'});
 assert.equal(made.status,0,made.stderr);
 writeFileSync(join(directory,'volumes/opt/data/running'),'kept');
 writeFileSync(join(directory,'bin/docker'),`#!/usr/bin/env node
 import assert from 'node:assert/strict';
 import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
 import { spawnSync } from 'node:child_process';
 const args=process.argv.slice(2),cwd=process.cwd(),root=cwd+'/volumes';
 appendFileSync(cwd+'/commands',JSON.stringify(args)+'\\n');
if(args.includes('{{.State.Health.Status}}')) { console.log('healthy'); process.exit(0); }
 if(args[0]==='compose') {
  if(args.includes('stop')) writeFileSync(cwd+'/stopped','yes');
  if(args.includes('up')) { writeFileSync(cwd+'/stopped','no'); if(args.includes('--force-recreate')) writeFileSync(cwd+'/env-at-up',readFileSync(cwd+'/.env.install')); }
  if(args.includes('ps')) console.log(args.at(-1)+'-stopped');
  if(args.includes('psql')) console.log(args.some(arg=>arg.includes('select e.address'))?'http://gtmworks-engine-first:8642':'t');
 } else if(args.includes('alpine:3.21')) {
  const command=args.slice(args.indexOf('alpine:3.21')+1);
  if(args.includes('--volumes-from')) assert.ok(args.includes('gtmworks-install_hermes:/opt/data'),'the Engine volume is restored too');
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
 const restored=run('restore',archive);
 assert.equal(restored.status,0,restored.stderr);
 const lines=restored.stdout.split('\n').filter(line=>/Hermes data/.test(line));
 assert.equal(lines.length,1,restored.stdout);
 assert.match(lines[0],/The Agents' Hermes data was not in this backup/);
 // Nothing replaced the Engine's running data, and the rest of the archive went in.
 assert.equal(readFileSync(join(directory,'volumes/opt/data/running'),'utf8'),'kept');
 // This archive holds no .engines/: its Engine key comes back in .env.install and the installer moves it into the
 // Engine's own file, as an update does (#385).
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),`${secrets.replace(`\nHERMES_API_KEY=${'a1'.repeat(32)}`,'')}\n`);
 assert.equal(readFileSync(join(directory,'.engines/first/.env'),'utf8'),`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`);
 // The key had left .env.install before web and the worker were recreated (#378, X3): a pre-#385 archive's key is
 // never in their environment for even one start.
 assert.doesNotMatch(readFileSync(join(directory,'env-at-up'),'utf8'),/HERMES_API_KEY=/, 'the containers start with no Engine key in their environment');
 for(const path of paths) assert.equal(readFileSync(join(directory,'volumes',path,'saved'),'utf8'),'original');
 // An entry outside the backup is still refused before anything is replaced.
 writeFileSync(join(directory,'.env.install'),'fresh keys');
 mkdirSync(join(tree,'home'));
 writeFileSync(join(tree,'home/x'),'x');
 const unknown=join(directory,'unknown.tgz');
 const madeUnknown=spawnSync('tar',['-czf',unknown,'-C',tree,'.env.install',...paths,'home/x'],{encoding:'utf8'});
 assert.equal(madeUnknown.status,0,madeUnknown.stderr);
 const refused=run('restore',unknown);
 assert.notEqual(refused.status,0);
 assert.match(refused.stderr,/Unrecognised backup\./);
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),'fresh keys');
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
  *'.State.Health.Status'*) echo healthy;;
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
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 for(const name of ['002_second.sql','001_first.sql','001_first.verify.sql']) writeFileSync(join(directory,'supabase/migrations',name),'select 1;');
 const secrets=Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n');
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o644});
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *validate*) exit "\${VALIDATION_EXIT:-0}";;
 *engine-key*) printf '%s\n' "$ENGINE_KEY";;
 *'exec -T db psql'*) printf '%s\n' "$*" > "$INSTALL_SQL.args"; cat > "$INSTALL_SQL";;
esac
`,{mode:0o755});
 const engineKey='a1'.repeat(32);
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,INSTALL_SQL:join(directory,'migration.sql'),ENGINE_KEY:engineKey};
 for(const attempt of [1,2]) {
  const result=spawnSync('sh',['scripts/install.sh'],{cwd:directory,env,encoding:'utf8'});
  assert.equal(result.status,0,`${attempt}: ${result.stderr}`);
  assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
  assert.equal(statSync(join(directory,'.env.install')).mode & 0o777,0o600);
  // The install's own secrets stay in .env.install; the Engine's key is in the Engine's own file, and stays.
  assert.match(readFileSync(join(directory,'.engines/first/.env'),'utf8'),new RegExp(`^ENGINE_KEY=${engineKey}$`,'m'));
  assert.equal(statSync(join(directory,'.engines/first/.env')).mode & 0o777,0o600);
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

// The lock is a file descriptor's flock, held by the kernel: a lock file an install that was killed left behind is held
// by no one and never blocks the next run, and an install that is still running keeps it, so it is never taken over.
test('install.sh holds its lock through flock: a killed run leaves no holder, and a live run is never taken over', async t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-lock-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'scripts'));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 // An operation install.sh does not know: past the lock it stops with its usage, and its own scratch folder is removed.
 const run=()=>spawnSync('sh',['scripts/install.sh','frobnicate'],{cwd:directory,encoding:'utf8'});
 const lockFile=join(directory,'.install.lock');
 const passes=label=>{
  const result=run();
  assert.equal(result.status,1,label);
  assert.match(result.stderr,/Usage: sh scripts\/install\.sh/,label);
  assert.doesNotMatch(result.stderr,/Another install is running/,label);
  assert.equal(existsSync(join(directory,'.install-lock')),false,`${label}: the run's own scratch folder is removed`);
  assert.equal(existsSync(lockFile),true,`${label}: the lock file stays, so every run opens the same one`);
 };
 // A lock file a killed run left, with no process holding it: it never blocks the next run.
 writeFileSync(lockFile,'left by an install that was killed\n');
 passes('a lock file nobody holds');
 // A live run holds it: a second run stops before its own work, and the holder's lock file is left alone.
 const live=spawn('sh',['-c','exec 9>.install.lock; flock -n 9 || exit 1; echo held; exec sleep 60'],{cwd:directory});
 t.after(()=>live.kill('SIGKILL'));
 await new Promise(resolve=>live.stdout.once('data',resolve));
 for(const label of ['a second run','a third run']) {
  const refused=run();
  assert.equal(refused.status,1,label);
  assert.match(refused.stderr,/^Another install is running: wait for it to finish, then run this again\.$/m,label);
  assert.doesNotMatch(refused.stderr,/Usage:/,label);
  assert.equal(existsSync(join(directory,'.install-lock')),false,`${label}: its own scratch folder was never made`);
  assert.equal(existsSync(lockFile),true,`${label}: the live run's lock file is left alone`);
 }
 // The live run is killed: the kernel drops its lock, so the lock file it left is held by no one.
 live.kill('SIGKILL');
 await new Promise(resolve=>live.once('exit',resolve));
 passes('the lock file a killed run left');
});

test('install.sh leaves alone the scratch folder of a running installer from before flock, and clears one left by a gone one', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-old-lock-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'scripts'));
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const run=()=>spawnSync('sh',['scripts/install.sh','frobnicate'],{cwd:directory,encoding:'utf8'});
 // The old installer named its owner as "<boot id> <process> <start time>" in .install-lock/owner.
 const oldLock=pid=>{ mkdirSync(join(directory,'.install-lock'),{recursive:true}); writeFileSync(join(directory,'.install-lock/owner'),`boot ${pid} 1\n`); writeFileSync(join(directory,'.install-lock/backup.tgz'),'in use'); };
 oldLock(process.pid);
 const refused=run();
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/Another install is running/);
 assert.equal(existsSync(join(directory,'.install-lock/backup.tgz')),true,'a running old installer keeps its scratch files');
 const gone=spawnSync('sh',['-c','echo $$']).stdout.toString().trim();
 oldLock(gone);
 const passed=run();
 assert.match(passed.stderr,/Usage: sh scripts\/install\.sh/);
 assert.equal(existsSync(join(directory,'.install-lock')),false,'a gone old installer\'s folder is cleared');
});

// The installer's last probes, run for real: the docker stand-in runs the script install.sh hands to the web container
// under node, with fetch answering from PROBE_PLAN (the health address's answers in turn, the last one repeated; every
// other address 200) and the one-second pause recorded instead of waited for.
const probeStub=`
import { appendFileSync } from 'node:fs';
const plan=process.env.PROBE_PLAN.split(',');
let asked=0;
globalThis.fetch=async url=>{
 appendFileSync(process.env.PROBE_LOG,url+'\\n');
 if(url!=='http://gateway:8080/api/health') return {status:200};
 const answer=plan[Math.min(asked++,plan.length-1)];
 if(answer==='refused') throw new Error('fetch failed');
 return {status:Number(answer)};
};
globalThis.setTimeout=(resolve,delay)=>{ appendFileSync(process.env.PROBE_LOG,'pause '+delay+'\\n'); setImmediate(resolve); };
`;
const probeShim=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *install-env.mjs*)
  file=; previous=; all="$*"
  for argument do [ "$previous" = --env-file ] && file=$argument; previous=$argument; done
  if [ -z "$file" ]; then exec node "$INSTALL_ENV" \${all##*install-env.mjs }; fi
  exec env -i PATH="$PATH" sh -c 'set -a; case "$1" in /*) . "$1";; *) . "./$1";; esac; set +a; shift; exec node "$@"' sh "$file" "$INSTALL_ENV" \${all##*install-env.mjs };;
 *'exec -T db psql'*) cat > /dev/null;;
 *'exec -T web node'*setup_is_open*) echo closed;;
 *'exec -T web node -e '*api/health*)
  script=; previous=
  for argument do [ "$previous" = -e ] && script=$argument; previous=$argument; done
  exec node --import "$PROBE_STUB" --input-type=module -e "$script";;
esac
`;
test('the installer waits for every address to answer 200, and fails naming the one that never does', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-probe-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','lib','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 writeFileSync(join(directory,'bin/docker'),probeShim,{mode:0o755});
 writeFileSync(join(directory,'probe-stub.mjs'),probeStub);
 const log=join(directory,'probe.log');
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,INSTALL_ENV:join(process.cwd(),'lib/install-env.mjs'),
  COMMANDS:join(directory,'commands'),PROBE_STUB:join(directory,'probe-stub.mjs'),PROBE_LOG:log,GH_TOKEN:''};
 const run=plan=>{ rmSync(log,{force:true}); return spawnSync('sh',['scripts/install.sh'],{cwd:directory,env:{...env,PROBE_PLAN:plan},encoding:'utf8'}); };
 const health='http://gateway:8080/api/health';
 // 503 while PostgREST reloads its schema, then 200: the install goes on, a second between tries.
 const waited=run('503,refused,503,200');
 assert.equal(waited.status,0,waited.stderr);
 assert.deepEqual(readFileSync(log,'utf8').trimEnd().split('\n'),
  [health,'pause 1000',health,'pause 1000',health,'pause 1000',health,'http://gateway:8080/sign-in','http://gtmworks-engine-first:8642/health']);
 assert.match(waited.stdout,/^http:\/\/gateway:8080\/api\/health 200$/m);
 assert.equal(waited.stdout.trimEnd().split('\n').at(-1),'gtmworks is ready: http://localhost:3000/sign-in');
 // Never 200: 60 tries, then the install fails naming the address and its last answer, and prints no ready line.
 const failed=run('503');
 assert.notEqual(failed.status,0);
 assert.match(failed.stderr,/http:\/\/gateway:8080\/api\/health returned 503/);
 const asked=readFileSync(log,'utf8').trimEnd().split('\n');
 assert.equal(asked.filter(line=>line===health).length,60);
 assert.equal(asked.filter(line=>line==='pause 1000').length,59);
 assert.doesNotMatch(failed.stdout,/gtmworks is ready/);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

// An install the previous release made still runs its Engine in a `hermes` container of the install project and has no
// Engine folder (#385): this release's backup would take no Engine data and its restore would take the Engine away, so
// both refuse before anything stops and name the update that moves the Engine first (#378, C6).
test('a backup or a restore on an install the previous release made is refused before it stops anything', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-previous-release-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const previous=`.env.install`,secrets=`KEYS=kept\nHERMES_API_KEY=${'k'.repeat(64)}\n`;
 writeFileSync(join(directory,previous),secrets,{mode:0o600});
 writeFileSync(join(directory,'backup.tgz'),'archive');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'label=com.docker.compose.service=hermes'*) echo hermes-container;;
 *'exec -T db psql'*) echo t;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(...args)=>{
  rmSync(commands,{force:true});
  return {...spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,
   env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands},encoding:'utf8'}),
   commands:()=>readFileSync(commands,'utf8')};
 };
 for(const args of [['backup'],['restore','backup.tgz']]) {
  const refused=run(...args);
  assert.notEqual(refused.status,0,args.join(' '));
  assert.match(refused.stderr,/This install still runs the Engine the previous release made\. Run sh install\.sh update first, then run this again\./,args.join(' '));
  // Nothing stopped, nothing archived or replaced: the install's own container was the only thing asked about.
  assert.deepEqual(refused.commands().trimEnd().split('\n'),['ps -aq --filter label=com.docker.compose.project=gtmworks-install --filter label=com.docker.compose.service=hermes'],args.join(' '));
  assert.equal(readFileSync(join(directory,previous),'utf8'),secrets,args.join(' '));
  assert.equal(existsSync(join(directory,'.engines')),false,args.join(' '));
  assert.equal(existsSync(join(directory,'backups')),false,args.join(' '));
 }
});

// A backup never writes an Engine's own file: an install without .engines/first that fails while it copies is left with
// exactly the file it had, and the Engine the previous release made is never adopted by a backup's cleanup (#378, C13).
test('a failed backup leaves no Engine folder and no adopted key behind', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-no-adoption-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=`KEYS=kept\nHERMES_API_KEY=${'k'.repeat(64)}\n`;
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o600});
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *'exec -T db psql'*) echo t;;
 *'alpine:3.21'*)
  case "$*" in *'tar -czf'*) echo 'partial-archive' >&2; exit 9;; esac;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const result=spawnSync('sh',['scripts/install.sh','backup'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands},encoding:'utf8'});
 assert.notEqual(result.status,0,result.stdout);
 // The stack was started again, and nothing wrote .engines/ or moved the key out of the install's file.
 assert.match(readFileSync(commands,'utf8'),/compose --env-file \.env\.install -f docker-compose\.install\.yml up -d/);
 assert.equal(existsSync(join(directory,'.engines/first/.env')),false,'the cleanup adopted no Engine');
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
 assert.deepEqual(readdirSync(join(directory,'backups')),[]);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

// An update moves the Engine key a previous release left in .env.install into the Engine's own file only once that file
// is complete and in place (#378, C7): a failed write leaves the key where it was and fails the run.
test('the Engine key file is written atomically, and the install keeps its key when that write fails', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-engine-key-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','lib','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 for(const file of ['install-nginx.conf','install-gateway-real-ip.sh','engine-template.yml']) copyFileSync(join('scripts',file),join(directory,'scripts',file));
 const key='a1'.repeat(32),secrets=`KEYS=kept\nHERMES_API_KEY=${key}\n`;
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o600});
 writeFileSync(join(directory,'supabase/migrations/001_first.sql'),'select 1;');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *'count(*) from public.companies'*) echo 1;;
 *alpine:3.21*) exit 0;;
 *'exec -T db psql'*) cat > /dev/null;;
esac
`,{mode:0o755});
 // `mv` refuses the one move that installs the Engine's own file, as a full disk or a permission would.
 writeFileSync(join(directory,'bin/mv'),`#!/bin/sh
case "$*" in *'.engines/first/.env.tmp .engines/first/.env'*) echo 'mv: cannot move' >&2; exit 1;; esac
exec "$REAL_MV" "$@"
`,{mode:0o755});
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:join(directory,'commands'),REAL_MV:'/bin/mv',GH_TOKEN:''};
 const failed=spawnSync('sh',['scripts/install.sh','update','main'],{cwd:directory,env,encoding:'utf8'});
 assert.notEqual(failed.status,0,failed.stderr);
 // The install's own file still holds the key, and no Engine file claims it.
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
 assert.equal(existsSync(join(directory,'.engines/first/.env')),false);
 // With the move in place the same run writes the Engine's file before the line leaves .env.install, owner-only.
 rmSync(join(directory,'bin/mv'));
 const passed=spawnSync('sh',['scripts/install.sh','update','main'],{cwd:directory,env,encoding:'utf8'});
 assert.equal(passed.status,0,passed.stderr);
 assert.match(readFileSync(join(directory,'.engines/first/.env'),'utf8'),new RegExp(`^ENGINE_KEY=${key}$`,'m'));
 assert.equal(statSync(join(directory,'.engines/first/.env')).mode&0o777,0o600);
 assert.doesNotMatch(readFileSync(join(directory,'.env.install'),'utf8'),/HERMES_API_KEY=/);
});

// Every Engine is tried, and the run fails if any did not start (#378, C8): one broken Engine does not hide the others,
// and each Engine that started gets the app and the worker on its network.
test('every Engine is started even when one fails, and the run fails naming the one that did not', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-engines-up-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const slug of ['first','second-company']) {
  mkdirSync(join(directory,'.engines',slug),{recursive:true});
  writeFileSync(join(directory,`.engines/${slug}/.env`),`ENGINE_NAME=gtmworks-engine-${slug}\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-engine-${slug}\nENGINE_NETWORK=gtmworks-engine-${slug}\n`,{mode:0o600});
 }
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 copyFileSync('scripts/install-gateway-real-ip.sh',join(directory,'scripts/install-gateway-real-ip.sh'));
 copyFileSync('scripts/install-nginx.conf',join(directory,'scripts/install-nginx.conf'));
 writeFileSync(join(directory,'.env.install'),`KEYS=kept\n`);
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *'engine-template.yml up -d --wait'*)
  case "$*" in *"$FAIL_ENGINE"*) exit 1;; esac;;
 *' ps -q web'*) echo web-id;;
 *' ps -q worker'*) echo worker-id;;
 *'network inspect '*)
  # The app is not on the network yet: the first connection is made, and reported afterwards.
  case "$*" in *"$FAIL_ENGINE"*) exit 1;; esac
  grep -qx "$*" "$JOINED" 2> /dev/null;;
 *'network connect '*) echo "$*" >> "$JOINED";;
 *'exec -T db psql'*) echo t;;
esac
`,{mode:0o755});
 const env={...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:join(directory,'commands'),JOINED:join(directory,'joined'),GH_TOKEN:''};
 const run=fail=>{ rmSync(join(directory,'commands'),{force:true}); rmSync(join(directory,'joined'),{force:true}); return spawnSync('sh',['scripts/install.sh'],{cwd:directory,env:{...env,FAIL_ENGINE:fail},encoding:'utf8'}); };
 const second=Fail=>run(Fail);
 assert.equal(second('gtmworks-engine-second-company').status,1);
 let commands=readFileSync(join(directory,'commands'),'utf8');
 assert.match(commands,/gtmworks-engine-first --env-file \.engines\/first\/\.env -f scripts\/engine-template\.yml up/);
 assert.match(commands,/gtmworks-engine-second-company --env-file \.engines\/second-company\/\.env -f scripts\/engine-template\.yml up/);
 let joined=readFileSync(join(directory,'joined'),'utf8');
 assert.match(joined,/network connect --alias web gtmworks-engine-first web-id/,'the Engine that started is joined');
 assert.doesNotMatch(joined,/network connect .*gtmworks-engine-second-company/);
 // The first Engine failing does not stop the second, which is the one joined.
 const first=run('gtmworks-engine-first');
 assert.equal(first.status,1);
 assert.match(first.stderr,/The Engine gtmworks-engine-first did not start\./);
 commands=readFileSync(join(directory,'commands'),'utf8');
 assert.match(commands,/gtmworks-engine-second-company --env-file \.engines\/second-company\/\.env -f scripts\/engine-template\.yml up/);
 joined=readFileSync(join(directory,'joined'),'utf8');
 assert.match(joined,/network connect --alias web gtmworks-engine-second-company web-id/);
});

// A backup reads each Engine's volume only once its container is stopped (#378, C9): one Docker reports still running is
// named, no archive is written, and what was stopped starts again.
test('a backup stops before an Engine that did not stop and writes no archive', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-engine-running-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','.engines/first']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'KEYS=kept\n',{mode:0o600});
 writeFileSync(join(directory,'.engines/first/.env'),`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`,{mode:0o600});
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
 *'ps -aq --filter name=^gtmworks-engine-'*) [ -z "\${PS_FAILS:-}" ] || exit 1; echo engine-id;;
 *'inspect -f {{.State.Running}}'*) [ -z "\${INSPECT_FAILS:-}" ] || exit 1; echo true;;
 *' ps -q web'*) echo web-id;;
 *' ps -q worker'*) echo worker-id;;
 *'network inspect '*) exit 1;;
 *'alpine:3.21'*'tar -czf'*) echo 'archive' >&2;;
 *'exec -T db psql'*) echo t;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const backup=extra=>spawnSync('sh',['scripts/install.sh','backup'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,...extra},encoding:'utf8'});
 // An Engine whose state Docker cannot report, or that Docker cannot even list, is not known to be stopped: the backup
 // stops the same way (#378, C9).
 for(const failure of [{INSPECT_FAILS:'1'},{PS_FAILS:'1'}]) {
  const unknown=backup(failure);
  assert.notEqual(unknown.status,0,unknown.stdout);
  assert.match(unknown.stderr,/This Engine did not stop: gtmworks-engine-first\./,Object.keys(failure)[0]);
  assert.doesNotMatch(readFileSync(commands,'utf8'),/tar -czf/,'the volume was never read');
  writeFileSync(commands,'');
 }
 const result=backup({});
 assert.notEqual(result.status,0,result.stdout);
 assert.match(result.stderr,/This Engine did not stop: gtmworks-engine-first\. Nothing was archived, and what was stopped starts again\./);
 assert.doesNotMatch(readFileSync(commands,'utf8'),/tar -czf/,'the volume was never read');
 assert.deepEqual(readdirSync(join(directory,'backups')),[]);
 // What was stopped starts again: the exit handler brings the stack and the Engine back.
 assert.match(readFileSync(commands,'utf8'),/compose --env-file \.env\.install -f docker-compose\.install\.yml up -d/);
 assert.match(readFileSync(commands,'utf8'),/network connect --alias web gtmworks-engine-first web-id/);
});

// A copy or a listing that fails is refused as an archive that cannot be read (#378, C12): the check runs left of `||`,
// where errexit is off, so it may never read a failure as an empty or a half archive.
test('an archive that cannot be copied or listed is refused as unreadable', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-unreadable-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'original-private-key');
 writeFileSync(join(directory,'backup.tgz'),'backup');
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'tar -tzf'*) keep=; for argument do [ "$previous" = -tzf ] && keep=$argument; previous=$argument; done; [ -z "\${LIST_FAIL:-}" ] || exit 7; printf '%s\\n' "$ARCHIVE_ENTRIES";;
 *'exec -T db psql'*) echo t;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(extra={})=>{
  rmSync(commands,{force:true});
  return {...spawnSync('sh',['scripts/install.sh','restore','backup.tgz'],{cwd:directory,
   env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,ARCHIVE_ENTRIES:'var/lib/postgresql/data/\netc/postgresql-custom/\nvar/lib/storage/\n.env.install',...extra},encoding:'utf8'}),
   commands:readFileSync(commands,'utf8'),file:readFileSync(join(directory,'.env.install'),'utf8')};
 };
 const unlisted=run({LIST_FAIL:'1'});
 assert.equal(unlisted.status,1,unlisted.stdout);
 assert.match(unlisted.stderr,/^Could not read the backup\.$/m);
 assert.doesNotMatch(unlisted.stderr,/Incomplete backup\./);
 assert.equal(unlisted.file,'original-private-key');
 assert.doesNotMatch(unlisted.commands,/stop|--volumes-from|force-recreate/);
 // A copy that fails is the same: the check stops there, before the stale copy could be listed.
 writeFileSync(join(directory,'bin/cp'),`#!/bin/sh
echo 'cp: cannot copy' >&2; exit 8
`,{mode:0o755});
 const uncopied=run({});
 assert.equal(uncopied.status,1,uncopied.stdout);
 assert.match(uncopied.stderr,/^Could not read the backup\.$/m);
 assert.equal(uncopied.file,'original-private-key');
 assert.doesNotMatch(uncopied.commands,/tar -tzf|stop|--volumes-from/);
});

// The Engines a backup names come from the install's own records, so a read that fails must stop the backup before it
// stops anything (#378, C4): an empty list would quietly leave a restore's manifest check with nothing to require.
test('a backup that cannot read the Engine records stops before it stops anything', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-engine-records-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','.engines/first']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 const secrets=`KEYS=kept\nHERMES_API_KEY=${'k'.repeat(64)}\n`;
 writeFileSync(join(directory,'.env.install'),secrets,{mode:0o600});
 writeFileSync(join(directory,'.engines/first/.env'),`ENGINE_NAME=gtmworks-engine-first\nENGINE_KEY=${'a1'.repeat(32)}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`,{mode:0o600});
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'from public.company_engines'*) echo 'ERROR: relation "public.company_engines" does not exist' >&2; exit 3;;
esac
`,{mode:0o755});
 const commands=join(directory,'commands');
 const result=spawnSync('sh',['scripts/install.sh','backup'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands},encoding:'utf8'});
 assert.equal(result.status,1,result.stdout);
 assert.match(result.stderr,/^Could not read this install's Engine records: start gtmworks \(sh scripts\/install\.sh\), then run this again\. Nothing was archived\.$/m);
 const run=readFileSync(commands,'utf8');
 assert.match(run,/from public\.company_engines/,'the records were asked for');
 // Nothing stopped, nothing started again and nothing was archived.
 assert.doesNotMatch(run,/ stop|stop |tar -czf|up -d/);
 assert.deepEqual(readdirSync(join(directory,'backups')),[]);
 assert.equal(readFileSync(join(directory,'.env.install'),'utf8'),secrets);
 assert.equal(existsSync(join(directory,'.install-lock')),false);
});

// An archive may hold an earlier release's database (a go-back, or one made before the Engines): a restore applies this
// release's migrations to it while only the database is up, before web and the worker are recreated, then settles each
// Company's Engine record (#378, C3). It is the same block an update applies to a previous release's database.
test('a restore applies the migrations before it recreates web and the worker, then settles the Engine records', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-restore-migrations-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin','supabase/migrations']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'supabase/migrations/001_first.sql'),'select 1;');
 writeFileSync(join(directory,'.env.install'),'fresh keys',{mode:0o600});
 writeFileSync(join(directory,'backup.tgz'),'archive');
 // An archive of this release's own shape: one Company, one Engine with its key and data.
 const secrets=`KEYS=kept\nHERMES_API_KEY=${'k'.repeat(64)}\n`;
 writeFileSync(join(directory,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'tar -tzf'*) printf '%s\\n' var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install engines/first/ engines/first/data .engines/first/.env engines.list;;
 *'tar -tvzf'*) printf 'drwxr-xr-x root/root 0 var/lib/storage/\\n';;
 *'tar -xOzf'*'.env.install'*) printf '%s\\n' "$ARCHIVE_ENV";;
 *'tar -xOzf'*'engines.list'*) printf '%s\\n' first;;
 *'tar -xOzf'*'.engines/'*) printf 'ENGINE_KEY=%s\\n' "${'a1'.repeat(32)}";;
 *'select e.address from public.company_engines'*) printf '%s\\n' \${RESTORED_ENGINES:-http://gtmworks-engine-first:8642};;
 *'exec -T db psql'*) cat > /dev/null; echo t;;
  *'.State.Health.Status'*) echo healthy;;
 *' ps -q web'*) echo web-id;;
 *' ps -q worker'*) echo worker-id;;
 *'network inspect '*) exit 1;;
 *alpine:3.21*) exit 0;;
esac
exit 0
`,{mode:0o755});
 const commands=join(directory,'commands');
 const result=spawnSync('sh',['scripts/install.sh','restore','backup.tgz'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,ARCHIVE_ENV:secrets},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const run=readFileSync(commands,'utf8').split('\n').filter(Boolean);
 const at=pattern=>run.findIndex(line=>pattern.test(line));
 const databaseUp=at(/^compose --env-file \.env\.install -f docker-compose\.install\.yml up -d --wait --wait-timeout 300 db$/);
 const migrations=at(/--single-transaction$/);
 const recreate=at(/^compose --env-file \.env\.install -f docker-compose\.install\.yml up -d --force-recreate/);
 const settled=at(/exec -T -e ENGINE_ADDRESS -e ENGINE_KEY web node scripts\/install-engine\.mjs$/);
 for(const [index,name] of [[databaseUp,'the database is started alone'],[migrations,'the migrations run'],[recreate,'everything is recreated'],[settled,'the Engine records are settled']]) assert.ok(index>=0,`${name}: ${run.join('\n')}`);
 assert.ok(databaseUp<migrations&&migrations<recreate,'the migrations run on the restored database, before web and the worker are recreated');
 assert.ok(settled>recreate,'the Engine records are settled once the app is up');
 // The migration block is the one an update runs: every file once, recorded, in one transaction.
 const sql=readFileSync(join(directory,'supabase/migrations/001_first.sql'),'utf8');
 assert.match(sql,/select 1/);
 const migrationRun=run[migrations];
 assert.match(migrationRun,/exec -T db psql .*--single-transaction/);
 // The restored database decides which Engines came back (#378, C4): one it names that the archive did not hold (lost
 // with its list and key) fails the restore with a plain line.
 const missing=spawnSync('sh',['scripts/install.sh','restore','backup.tgz'],{cwd:directory,
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,ARCHIVE_ENV:secrets,
   RESTORED_ENGINES:'http://gtmworks-engine-first:8642 http://gtmworks-engine-second-company:8642'},encoding:'utf8'});
 assert.notEqual(missing.status,0,missing.stdout);
 assert.match(missing.stderr,/The restored database names an Engine the backup did not hold \(http:\/\/gtmworks-engine-second-company:8642\): this archive is not complete\./);
});
