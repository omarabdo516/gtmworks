import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

// The one line (#51) and the gtmworks command it leaves (#52), run with docker and curl replaced: GitHub Releases is a
// fixture folder, and each release's install.sh is a stand-in that records what it was asked to do. install.sh itself is
// tested in tests/release.test.mjs and tests/install.test.mjs; the real install runs in CI's install job.
const getScript=resolve('scripts/get.sh');
const getText=readFileSync(getScript,'utf8');
const repo='omarabdo516/gtmworks';
const hex=letter=>letter.repeat(64);
const releases={
 'v1.2.3':{hex:hex('a'),migrations:['001.sql']},
 'v1.3.0':{hex:hex('b'),migrations:['001.sql','002.sql']},
 'v1.3.1':{hex:hex('d'),migrations:['001.sql','002.sql']},
 'v1.10.0':{hex:hex('c'),migrations:['001.sql','002.sql','003.sql']},
};
const mainHex=hex('e');
const ref=tag=>`ghcr.io/${repo}:${tag.slice(1)}@sha256:${releases[tag].hex}`;
const mainRef=`ghcr.io/${repo}:main@sha256:${mainHex}`;

// Every system tool but docker and curl, so a test can take Docker away without taking sh, sed or node with it.
const tools=mkdtempSync(join(tmpdir(),'gtmworks-get-tools-'));
process.on('exit',()=>rmSync(tools,{recursive:true,force:true}));
for(const folder of ['/usr/local/bin','/usr/bin','/bin']) {
 if(!existsSync(folder)) continue;
 for(const name of readdirSync(folder)) {
  if(/^(docker|docker-compose|curl)$/.test(name)||existsSync(join(tools,name))) continue;
  try { symlinkSync(join(folder,name),join(tools,name)); } catch { /* a name another folder already gave */ }
 }
}

// The stand-in takes install.sh's own lock, as install.sh does, so a run cut off leaves the lock a real one leaves.
const installText=readFileSync('scripts/install.sh','utf8');
const lockStart=installText.indexOf('lock_owner() {'), lockEnd='lock_owner "$$" > .install-lock/owner\n';
assert.ok(lockStart>0&&installText.indexOf(lockEnd)>lockStart,'install.sh takes its lock with lock_owner');
const lockBlock=installText.slice(lockStart,installText.indexOf(lockEnd)+lockEnd.length);
const installerTemplate=`#!/bin/sh
release_image=@REF@
op=\${1:-install}
${lockBlock}trap 'rm -rf .install-lock' EXIT
printf '%s %s\\n' "\${release_image##*:}" "$*" >> "$INSTALLER_LOG"
case "$op" in
 backup) mkdir -p "$2"; : > "$2/gtmworks-test.tgz"; echo 'Stopping...'; echo "Backup: $2/gtmworks-test.tgz"; exit 0;;
 restore) exit 0;;
esac
[ -f .env.install ] || echo "SECRET=$$" > .env.install
rm -f .install-release
if [ "$release_image" = "\${DIE_REF:-}" ]; then cp "$FIXTURE/migrations/\${release_image##*:}" "$DB_FILE"; kill -9 "$PPID"; kill -9 $$; fi
if [ "$op" = update ] && [ "$release_image" = "\${PUT_BACK_FAIL_REF:-}" ]; then echo 'Error: http://gateway:8080/api/health returned 503' >&2; exit 4; fi
if [ "$release_image" = "\${FAIL_REF:-}" ]; then
 [ -z "\${FAIL_AFTER_MIGRATE:-}" ] || cp "$FIXTURE/migrations/\${release_image##*:}" "$DB_FILE"
 echo 'Applying migration: 999_failure.sql'; exit 3
fi
cp "$FIXTURE/migrations/\${release_image##*:}" "$DB_FILE"
printf '%s\\n' "$release_image" > .install-release
echo 'gtmworks is ready: http://localhost:3000/sign-in'
`;
const composeTemplate=`services:\n  db:\n    image: supabase/postgres:17@sha256:${'f'.repeat(64)}\n  web:\n    image: @REF@\n  worker:\n    image: @REF@\n`;

const fakeDocker=`#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
 'compose version --short') [ -z "\${COMPOSE_MISSING:-}" ] || exit 1; echo "\${COMPOSE_VERSION:-2.29.1}"; exit 0;;
 info) exit "\${INFO_EXIT:-0}";;
 'ps -a --filter label=com.docker.compose.project=gtmworks-install '*) [ -z "\${PROJECT_DIRS:-}" ] || printf '%s\\n' "$PROJECT_DIRS"; exit 0;;
 'volume inspect gtmworks-install_database') [ -f "$DB_FILE" ]; exit $?;;
 'volume inspect -f {{.CreatedAt}} gtmworks-install_database')
  # A volume made anew (its data removed, then made again) has a new creation time.
  [ -f "$DB_FILE" ] || { rm -f "$DB_FILE.created"; exit 1; }
  [ -f "$DB_FILE.created" ] || date +%s%N > "$DB_FILE.created"
  cat "$DB_FILE.created"; exit 0;;
 'run --rm -i alpine:3.21 tar -xzOf - .env.install') cat > /dev/null; printf '%s\\n' "\${ARCHIVE_ENV:-SECRET=archived}"; exit 0;;
 *'install-env.mjs missing') exit 0;;
 *'install-env.mjs validate complete')
  [ -z "\${ENV_INVALID:-}" ] || { echo 'SUPABASE_PUBLIC_URL must equal APP_ORIGIN' >&2; exit 1; }; exit 0;;
 'run --rm -i alpine:3.21 tar -tzf -')
  cat > /dev/null
  if [ -n "\${ARCHIVE_ENTRIES:-}" ]; then printf '%s\\n' "$ARCHIVE_ENTRIES"
  else printf '%s\\n' var/lib/postgresql/data/ var/lib/postgresql/data/PG_VERSION etc/postgresql-custom/ var/lib/storage/ .env.install; fi; exit 0;;
 *'postgres --single'*)
  [ "$8" = supabase/postgres:17@sha256:${'f'.repeat(64)} ] || exit 8
  cat > /dev/null; [ -z "\${ARCHIVE_UNREADABLE:-}" ] || { echo 'ERROR:  relation "gtmworks_install.schema_migrations" does not exist'; exit 0; }
  printf '\\t 1: migrations = "%s"\\t(typeid = 25, len = -1, typmod = -1, byval = f)\\n' "\${ARCHIVE_MIGRATIONS-001.sql}"; exit 0;;
 pull\\ *) echo "Digest: \${2##*@}"; exit 0;;
 'image inspect'*) printf 'mirror.example/gtmworks@sha256:%s\\nghcr.io/${repo}@sha256:%s\\n' "$MAIN_HEX" "$MAIN_HEX"; exit 0;;
 *release-assets.mjs*)
  out= wd= ref= prev=
  for arg; do
   case "$prev" in -v) out=\${arg%:/out};; -w) wd=$arg;; scripts/release-assets.mjs) ref=$arg;; esac
   prev=$arg
  done
  [ "$wd" = /app/release-source ] || exit 9
  sed "s#@REF@#$ref#g" "$FIXTURE/template-install.sh" > "$out/install.sh"
  sed "s#@REF@#$ref#g" "$FIXTURE/template-compose.yml" > "$out/docker-compose.install.yml"; exit 0;;
 *' ls /app/install/supabase/migrations') cat "$FIXTURE/migrations/\${3##*:}";;
 *'exec -T db psql'*) [ ! -f "$DB_FILE" ] || cat "$DB_FILE";;
 *'config --services') printf 'db\\nweb\\nworker\\n';;
 *' ps -aq '*) eval "service=\\\${$#}"; echo "id-$service";;
 inspect\\ *) eval "id=\\\${$#}"; case "$id" in "id-\${UNHEALTHY:-none}") echo exited;; id-worker) echo running;; *) echo 'running healthy';; esac;;
 *'exec -T web node'*) echo 'http://gateway:8080/api/health 200';;
esac
exit 0
`;
const fakeMv=`#!/bin/sh
case "$#:\${CUT_BEFORE:-}:$1" in
 "2:$2:"*/.gtmworks-download.*/"$2") kill -9 "$PPID"; exit 9;;
esac
exec "$REAL_MV" "$@"
`;
const fakeCurl=`#!/bin/sh
out= url=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; --retry) shift;; -*) ;; *) url=$1;; esac; shift; done
printf '%s\\n' "$url" >> "$CURL_LOG"
case "$url" in
 'https://api.github.com/repos/${repo}/releases?per_page=100&page=1'|'https://api.github.com/repos/${repo}/releases?per_page=100') src=$FIXTURE/releases.json;;
 'https://api.github.com/repos/${repo}/releases?per_page=100&page='*) src=$FIXTURE/releases-\${url##*page=}.json; [ -f "$src" ] || { echo '[]'; exit 0; };;
 https://github.com/${repo}/releases/download/*) src=$FIXTURE/\${url#https://github.com/${repo}/releases/download/};;
 https://raw.githubusercontent.com/${repo}/main/scripts/get.sh) src=$GET_SOURCE;;
 file://*) src=\${url#file://};;
 *) exit 6;;
esac
[ -f "$src" ] || exit 22
if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi
`;

// A machine with fake docker and curl, an empty home, and GitHub Releases served from a fixture folder.
function machine(t,{list=['v1.2.3','nightly','v1.10.0','v2.0.0-rc1','v1.3.0','v1.3.1'],docker=true}={}) {
 const root=mkdtempSync(join(tmpdir(),'gtmworks-get-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const [home,fixture,bin,work]=['home','fixture','bin','work'].map(name=>join(root,name));
 for(const folder of [home,join(fixture,'migrations'),bin,work]) mkdirSync(folder,{recursive:true});
 writeFileSync(join(fixture,'template-install.sh'),installerTemplate);
 writeFileSync(join(fixture,'template-compose.yml'),composeTemplate);
 // The API answers pretty-printed objects with many fields; only tag_name names a release.
 writeFileSync(join(fixture,'releases.json'),JSON.stringify(list.map(tag=>({url:'x',name:`Release ${tag}`,tag_name:tag,body:'notes, "tag_name": "v9.9.9"'})),null,2));
 for(const [tag,release] of Object.entries(releases)) {
  mkdirSync(join(fixture,tag));
  writeFileSync(join(fixture,tag,'install.sh'),installerTemplate.replaceAll('@REF@',ref(tag)));
  writeFileSync(join(fixture,tag,'docker-compose.install.yml'),composeTemplate.replaceAll('@REF@',ref(tag)));
  writeFileSync(join(fixture,'migrations',release.hex),release.migrations.join('\n')+'\n');
 }
 writeFileSync(join(fixture,'migrations',mainHex),'001.sql\n002.sql\n003.sql\n004.sql\n');
 if(docker) writeFileSync(join(bin,'docker'),fakeDocker,{mode:0o755});
 writeFileSync(join(bin,'curl'),fakeCurl,{mode:0o755});
 writeFileSync(join(bin,'mv'),fakeMv,{mode:0o755});
 const logs={DOCKER_LOG:join(root,'docker.log'),CURL_LOG:join(root,'curl.log'),INSTALLER_LOG:join(root,'installer.log'),DB_FILE:join(root,'database')};
 const env={HOME:home,PATH:`${bin}:${tools}`,REAL_MV:join(tools,'mv'),FIXTURE:fixture,GET_SOURCE:getScript,MAIN_HEX:mainHex,...logs};
 const spawn=(args,{extra={},input,cwd=work}={})=>spawnSync('/bin/sh',args,{cwd,env:{...env,...extra},encoding:'utf8',input});
 const read=path=>existsSync(path)?readFileSync(path,'utf8'):'';
 const dir=join(home,'gtmworks');
 return {root,home,work,dir,env,
  line:(args=[],options)=>spawn([getScript,...args],options),
  piped:(args=[],options)=>spawn(['-s','--',...args],{...options,input:getText}),
  gtmworks:(args=[],options)=>spawn([join(home,'.local/bin/gtmworks'),...args],options),
  spawnIn:(args,options)=>spawn(args.slice(1),options),
  docker:()=>read(logs.DOCKER_LOG),curl:()=>read(logs.CURL_LOG),installer:()=>read(logs.INSTALLER_LOG).split('\n').filter(Boolean),
  file:name=>read(join(dir,name)),
  clear:()=>{ for(const path of [logs.DOCKER_LOG,logs.CURL_LOG,logs.INSTALLER_LOG]) rmSync(path,{force:true}); }};
}
const ok=(result,label='')=>assert.equal(result.status,0,`${label}\n${result.stdout}\n${result.stderr}`);

test('options: each wrong one stops with usage before Docker, curl or any folder is touched', t => {
 const m=machine(t);
 for(const args of [['--version','1.2.3'],['--version','v1.2'],['--version=v1.2.3-rc1'],['--channel','beta'],['--version','v1.2.3','--channel','main'],
  ['--no-backup'],['status','--version','v1.2.3'],['backup','--channel','main'],['restore'],['frobnicate'],['--dir'],['--bogus'],['update','extra'],['status','--no-backup'],['update','--yes'],['--version',`main@sha256:${mainHex}`],['backup','--version',`main@sha256:${mainHex}`],['update','--version','main@sha256:abc']]) {
  const result=m.line(args);
  assert.equal(result.status,2,`${args.join(' ')}: ${result.stderr}`);
  assert.match(result.stderr,/Usage:/,args.join(' '));
  assert.equal(m.docker()+m.curl(),'',args.join(' '));
  assert.deepEqual(readdirSync(m.home),[],args.join(' '));
 }
 // The gtmworks command told nothing does nothing; help is not an error.
 assert.equal(m.line(['--command']).status,2);
 assert.equal(m.line(['--help']).status,0);
 assert.equal(m.docker(),'');
});

test('the line installs the highest published vX.Y.Z by default, --version that release, --dir that folder', t => {
 const m=machine(t);
 const latest=m.line();
 ok(latest);
 const urls=m.curl().split('\n');
 assert.equal(urls[0],`https://api.github.com/repos/${repo}/releases?per_page=100&page=1`);
 for(const file of ['docker-compose.install.yml','install.sh']) assert.ok(urls.includes(`https://github.com/${repo}/releases/download/v1.10.0/${file}`),file);
 assert.match(latest.stdout,new RegExp(`^Installing gtmworks v1\\.10\\.0 into ${m.dir}\\.$`,'m'));
 assert.match(latest.stdout,new RegExp(`^gtmworks v1\\.10\\.0: ${ref('v1.10.0').replace(/[.]/g,'\\.')}$`,'m'));
 assert.equal(m.file('.gtmworks-version'),'v1.10.0\n');
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.10.0/install.sh'),'utf8'));
 assert.deepEqual(m.installer(),[`${hex('c')} `]);
 // The install script's own last line (the setup link or address) stays the last line.
 assert.equal(latest.stdout.trim().split('\n').at(-1),'gtmworks is ready: http://localhost:3000/sign-in');
 // Nothing is left of the download.
 assert.deepEqual(readdirSync(m.dir).filter(name=>name.startsWith('.gtmworks-download')),[]);

 for(const [args,folder] of [[['--version','v1.2.3','--dir','elsewhere'],join(m.work,'elsewhere')],[['--version=v1.3.0',`--dir=${join(m.root,'abs')}`],join(m.root,'abs')]]) {
  m.clear();
  // The install before was removed with its data (compose down -v): one machine runs one install.
  rmSync(m.env.DB_FILE,{force:true});
  ok(m.line(args),args.join(' '));
  const tag=args[0].includes('=')?args[0].split('=')[1]:args[1];
  assert.doesNotMatch(m.curl(),/api\.github\.com/,'a named version reads no list');
  assert.match(m.curl(),new RegExp(`/releases/download/${tag.replace(/[.]/g,'\\.')}/install\\.sh`));
  assert.equal(readFileSync(join(folder,'.gtmworks-version'),'utf8'),`${tag}\n`);
  // The command runs the copy in the folder it was installed into.
  assert.match(readFileSync(join(m.home,'.local/bin/gtmworks'),'utf8'),new RegExp(`exec sh '${folder}'/gtmworks\\.sh --command --dir '${folder}' "\\$@"`));
 }
 // No published release: a plain message, not a guess.
 const none=machine(t,{list:['nightly']});
 const refused=none.line();
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/No gtmworks release is published yet/);
});

test('--channel main installs the main image by its digest, with the two files written from inside that image', t => {
 const m=machine(t);
 ok(m.line(['--channel','main']));
 const docker=m.docker();
 assert.match(docker,new RegExp(`^pull ghcr\\.io/${repo}:main$`,'m'));
 assert.match(docker,new RegExp(`^run --rm --user \\d+:\\d+ -v ${m.dir}/\\.gtmworks-download\\.\\w+:/out -w /app/release-source ${mainRef.replace(/[.]/g,'\\.')} node scripts/release-assets\\.mjs ${mainRef.replace(/[.]/g,'\\.')} /out$`,'m'));
 assert.equal(m.curl().includes('releases'),false);
 assert.match(m.file('install.sh'),new RegExp(`^release_image=${mainRef.replace(/[.]/g,'\\.')}$`,'m'));
 assert.equal(m.file('.gtmworks-version'),'main\n');
 // A repair keeps the main build it runs: moving to a newer one is an update, which backs up first.
 m.clear();
 ok(m.line());
 assert.doesNotMatch(m.docker(),/^pull /m);
});

test('the main image holds what --channel main runs, and release-assets.mjs writes the two files from it', t => {
 const dockerfile=readFileSync('Dockerfile','utf8');
 assert.match(dockerfile,/^COPY --from=build --chown=node:node \/app\/docker-compose\.install\.yml \.\/release-source\/$/m);
 assert.match(dockerfile,/^COPY --from=build --chown=node:node \/app\/scripts\/install\.sh \/app\/scripts\/release-assets\.mjs \.\/release-source\/scripts\/$/m);
 // /app/release-source laid out as the image holds it, run as get.sh runs it there.
 const source=mkdtempSync(join(tmpdir(),'gtmworks-release-source-'));
 t.after(()=>rmSync(source,{recursive:true,force:true}));
 mkdirSync(join(source,'scripts'));
 cpSync('docker-compose.install.yml',join(source,'docker-compose.install.yml'));
 for(const file of ['install.sh','release-assets.mjs']) cpSync(join('scripts',file),join(source,'scripts',file));
 const result=spawnSync(process.execPath,['scripts/release-assets.mjs',mainRef,join(source,'out')],{cwd:source,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(readFileSync(join(source,'out/install.sh'),'utf8'),new RegExp(`^release_image=${mainRef.replace(/[.]/g,'\\.')}$`,'m'));
 assert.match(readFileSync(join(source,'out/docker-compose.install.yml'),'utf8'),new RegExp(`image: ${mainRef.replace(/[.]/g,'\\.')}`));
});

test('missing Docker, or Docker Compose older than v2.20: a plain message naming what to install, nothing changed', t => {
 const missing=machine(t,{docker:false});
 const noDocker=missing.line();
 assert.equal(noDocker.status,1);
 assert.match(noDocker.stderr,/needs Docker, which is not installed/);
 assert.match(noDocker.stderr,/Install Docker Engine \(https:\/\/docs\.docker\.com\/engine\/install\/\)/);
 assert.match(noDocker.stderr,/Nothing was changed\./);
 assert.deepEqual(readdirSync(missing.home),[]);
 assert.equal(missing.curl(),'');
 const m=machine(t);
 for(const [extra,found] of [[{COMPOSE_VERSION:'2.19.1'},'2\\.19\\.1'],[{COMPOSE_VERSION:'v1.29.2'},'1\\.29\\.2'],[{COMPOSE_MISSING:'1'},'none']]) {
  m.clear();
  const old=m.line([],{extra});
  assert.equal(old.status,1,JSON.stringify(extra));
  assert.match(old.stderr,new RegExp(`needs Docker Compose v2\\.20 or newer \\(the docker compose plugin\\); this machine has ${found}\\.`));
  assert.match(old.stderr,/docs\.docker\.com\/compose\/install/);
  assert.match(old.stderr,/Nothing was changed\./);
  assert.deepEqual(readdirSync(m.home),[]);
  assert.equal(m.curl(),'');
 }
 const unreachable=m.line([],{extra:{INFO_EXIT:'1'}});
 assert.equal(unreachable.status,1);
 assert.match(unreachable.stderr,/cannot reach it/);
 assert.deepEqual(readdirSync(m.home),[]);
 // Versions that pass reach the next check: there is no install to report on yet.
 for(const version of ['2.20.0','v2.20.0','2.29.1-desktop.1','3.0.0']) {
  const passed=m.line(['status'],{extra:{COMPOSE_VERSION:version}});
  assert.equal(passed.status,1,version);
  assert.match(passed.stderr,/There is no gtmworks install in/,version);
 }
});

test('the line adds ~/.local/bin to a shell profile only when no profile names it', t => {
 const m=machine(t);
 writeFileSync(join(m.home,'.bashrc'),'# my bashrc\n');
 ok(m.line());
 const pathLine='export PATH="$HOME/.local/bin:$PATH"';
 for(const profile of ['.profile','.bashrc']) assert.equal(readFileSync(join(m.home,profile),'utf8').split('\n').filter(line=>line===pathLine).length,1,profile);
 assert.equal(existsSync(join(m.home,'.zshrc')),false);
 // Again: nothing more is added.
 const again=m.line();
 ok(again);
 for(const profile of ['.profile','.bashrc']) assert.equal(readFileSync(join(m.home,profile),'utf8').split('\n').filter(line=>line===pathLine).length,1,profile);
 assert.match(again.stdout,/already puts ~\/\.local\/bin on the PATH/);
 // Ubuntu's own ~/.profile names it already; and a PATH that has it touches no profile at all.
 const ubuntu=machine(t);
 const stock='if [ -d "$HOME/.local/bin" ] ; then\n    PATH="$HOME/.local/bin:$PATH"\nfi\n';
 writeFileSync(join(ubuntu.home,'.profile'),stock);
 ok(ubuntu.line());
 assert.equal(readFileSync(join(ubuntu.home,'.profile'),'utf8'),stock);
 const onPath=machine(t);
 ok(onPath.line([],{extra:{PATH:`${join(onPath.home,'.local/bin')}:${onPath.env.PATH}`}}));
 assert.equal(existsSync(join(onPath.home,'.profile')),false);
 // The command it put there runs the copy kept in the install folder, which is this script.
 assert.equal(readFileSync(join(m.dir,'gtmworks.sh'),'utf8'),getText);
 ok(m.gtmworks(['status']));
});

test('the line run from a pipe copies the command from its address, and run again repairs the same release', t => {
 const m=machine(t);
 ok(m.piped(['--version','v1.2.3']));
 assert.match(m.curl(),new RegExp(`^https://raw\\.githubusercontent\\.com/${repo}/main/scripts/get\\.sh$`,'m'));
 assert.equal(m.file('gtmworks.sh'),getText);
 const secrets=m.file('.env.install');
 m.clear();
 const repaired=m.piped();
 ok(repaired);
 assert.match(repaired.stdout,new RegExp(`^Repairing gtmworks v1\\.2\\.3 in ${m.dir}; its keys and data are kept\\.$`,'m'));
 assert.equal(m.file('.env.install'),secrets);
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.deepEqual(m.installer(),[`${hex('a')} `]);
 // Naming another release on an existing install changes nothing and names the update instead.
 m.clear();
 const other=m.piped(['--version','v1.3.0']);
 assert.equal(other.status,1);
 assert.match(other.stderr,/already runs gtmworks v1\.2\.3\. To move it to v1\.3\.0, run: gtmworks update --version v1\.3\.0\. Nothing was changed\./);
 assert.equal(m.curl()+m.installer().join(''),'');
});

test('gtmworks update backs up first, then prints the backup path and the exact command to go back', t => {
 const m=machine(t);
 ok(m.line(['--version','v1.2.3']));
 m.clear();
 const updated=m.gtmworks(['update']);
 ok(updated);
 const archive=join(m.dir,'backups/gtmworks-test.tgz');
 // The previous release's installer backs up; the new release's installer updates.
 assert.deepEqual(m.installer(),[`${hex('a')} backup ${join(m.dir,'backups')}`,`${hex('c')} update`]);
 assert.match(m.docker(),new RegExp(`^pull ${ref('v1.10.0').replace(/[.]/g,'\\.')}$`,'m'));
 const lines=updated.stdout.trim().split('\n');
 assert.ok(lines.includes(`Digest: sha256:${hex('c')}`));
 assert.ok(lines.includes(`gtmworks v1.10.0 is running: ${ref('v1.10.0')}`));
 assert.equal(lines.at(-2),`Backup: ${archive}`);
 assert.equal(lines.at(-1),`To go back to v1.2.3: gtmworks restore '${archive}' --version v1.2.3`);
 assert.equal(m.file('.gtmworks-version'),'v1.10.0\n');
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.10.0/install.sh'),'utf8'));
 // No source archive: only the two release files are downloaded.
 assert.deepEqual(m.curl().split('\n').filter(url=>/download/.test(url)).map(url=>url.split('/').slice(-2).join('/')),['v1.10.0/docker-compose.install.yml','v1.10.0/install.sh']);
 // Already on it: nothing to update, nothing backed up.
 m.clear();
 const same=m.gtmworks(['update']);
 ok(same);
 assert.match(same.stdout,/already runs/);
 assert.deepEqual(m.installer(),[]);
});

test('gtmworks update --no-backup with no new migration goes back with an update, and takes no backup', t => {
 const m=machine(t);
 ok(m.line(['--version','v1.3.0']));
 m.clear();
 const updated=m.gtmworks(['update','--version','v1.3.1','--no-backup']);
 ok(updated);
 assert.deepEqual(m.installer(),[`${hex('d')} update`]);
 assert.doesNotMatch(updated.stdout,/^Backup:/m);
 assert.equal(updated.stdout.trim().split('\n').at(-1),'To go back to v1.3.0: gtmworks update --version v1.3.0');
});

test('gtmworks update refuses a release older than the data and changes nothing', t => {
 const m=machine(t);
 ok(m.line());
 const before=['install.sh','docker-compose.install.yml','.install-release','.gtmworks-version','.env.install'].map(name=>m.file(name));
 m.clear();
 const refused=m.gtmworks(['update','--version','v1.3.0']);
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/gtmworks v1\.3\.0 is older than the data in .*: a later release applied migrations that v1\.3\.0 does not carry \(003\.sql\)\. Nothing was changed\./);
 assert.match(refused.stderr,/gtmworks restore <archive> --version v1\.3\.0/);
 assert.deepEqual(m.installer(),[],'no backup and no update ran');
 assert.deepEqual(['install.sh','docker-compose.install.yml','.install-release','.gtmworks-version','.env.install'].map(name=>m.file(name)),before);
 assert.deepEqual(readdirSync(m.dir).filter(name=>name.startsWith('.gtmworks-download')||name==='backups'),[]);
});

test('a failed update puts the previous release back when its migrations rolled back, and exits non-zero', t => {
 const m=machine(t);
 ok(m.line(['--version','v1.2.3']));
 m.clear();
 const failed=m.gtmworks(['update','--version','v1.3.0'],{extra:{FAIL_REF:ref('v1.3.0')}});
 assert.equal(failed.status,3,failed.stderr);
 assert.match(failed.stdout,/Applying migration: 999_failure\.sql/);
 assert.deepEqual(m.installer(),[`${hex('a')} backup ${join(m.dir,'backups')}`,`${hex('b')} update`,`${hex('a')} update`]);
 assert.match(failed.stderr,/gtmworks v1\.2\.3 keeps serving, on its own files again\./);
 assert.match(failed.stderr,/^Backup: .*gtmworks-test\.tgz$/m);
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.2.3/install.sh'),'utf8'));
 assert.equal(m.file('.install-release'),`${ref('v1.2.3')}\n`);
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.equal(existsSync(join(m.dir,'.gtmworks-pending')),false,'a confirmed rollback leaves no update to finish');
 // Migrations that were applied before the failure stay with the files they belong to.
 m.clear();
 const applied=m.gtmworks(['update','--version','v1.3.0','--no-backup'],{extra:{FAIL_REF:ref('v1.3.0'),FAIL_AFTER_MIGRATE:'1'}});
 assert.equal(applied.status,3);
 assert.deepEqual(m.installer(),[`${hex('b')} update`]);
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.3.0/install.sh'),'utf8'));
 // The data may now be v1.3.0's: the install is recorded as v1.3.0, so the advised command finishes v1.3.0 and never
 // puts v1.2.3 back on it.
 assert.equal(m.file('.gtmworks-version'),'v1.3.0\n');
 const advised=applied.stderr.match(/run (gtmworks [^\n]*?) to finish it\./);
 assert.ok(advised,applied.stderr);
 m.clear();
 const finished=m.gtmworks(advised[1].split(' ').slice(1));
 ok(finished,advised[1]);
 assert.match(finished.stdout,/^Repairing gtmworks v1\.3\.0 in /m);
 assert.deepEqual(m.installer(),[`${hex('b')} `]);
 assert.equal(m.file('.install-release'),`${ref('v1.3.0')}\n`);
 assert.equal(m.file('.gtmworks-version'),'v1.3.0\n');
 // Files that are not the running release's are repaired before any update.
 m.clear();
 rmSync(join(m.dir,'.install-release'));
 const unfinished=m.gtmworks(['update']);
 assert.equal(unfinished.status,1);
 assert.match(unfinished.stderr,/an install or update did not finish\. Repair it first with: gtmworks install/);
 assert.deepEqual(m.installer(),[]);
});

test('when putting the previous release back does not finish, gtmworks install restores it on its own files', t => {
 const m=machine(t);
 ok(m.line(['--version','v1.2.3']));
 m.clear();
 const failed=m.gtmworks(['update','--version','v1.3.0'],{extra:{FAIL_REF:ref('v1.3.0'),PUT_BACK_FAIL_REF:ref('v1.2.3')}});
 assert.equal(failed.status,3);
 assert.match(failed.stderr,/api\/health returned 503\n[^]*Putting the previous release's files back did not finish: run gtmworks install\./);
 // The record still names v1.2.3, no update is pending, and the files are v1.2.3's; only .install-release is gone.
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.equal(existsSync(join(m.dir,'.gtmworks-pending'))||existsSync(join(m.dir,'.gtmworks-pending.d')),false);
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.2.3/install.sh'),'utf8'));
 assert.equal(m.file('.install-release'),'');
 m.clear();
 const repaired=m.gtmworks(['install']);
 ok(repaired);
 assert.match(repaired.stdout,/^Repairing gtmworks v1\.2\.3 in /m);
 assert.deepEqual(m.installer(),[`${hex('a')} `]);
 assert.equal(m.file('.install-release'),`${ref('v1.2.3')}\n`);
});

test('an update the machine stopped right after its migrations is finished by gtmworks install', t => {
 const m=machine(t);
 ok(m.line(['--version','v1.2.3']));
 m.clear();
 const stopped=m.gtmworks(['update'],{extra:{DIE_REF:ref('v1.10.0')}});
 assert.equal(stopped.signal,'SIGKILL',stopped.stderr);
 // The record still names v1.2.3; the data is v1.10.0's; .install-release is gone.
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.equal(m.file('.install-release'),'');
 // The installer was cut off too: its lock stays, naming a process that is gone.
 assert.match(m.file('.install-lock/owner'),/^\S+ \d+ \d+\n$/);
 const update=m.gtmworks(['update']);
 assert.equal(update.status,1);
 assert.match(update.stderr,/Repair it first with: gtmworks install/);
 const status=m.gtmworks(['status']);
 assert.match(status.stdout,/An update to gtmworks v1\.10\.0 did not finish: run gtmworks install to finish it\./);
 m.clear();
 const finished=m.gtmworks(['install']);
 ok(finished);
 assert.match(finished.stdout,/^Finishing the update of .* to gtmworks v1\.10\.0, which did not finish; its keys and data are kept\.$/m);
 assert.match(finished.stderr,/Taking over \.install-lock from an install that stopped \(process \d+ is gone\)\./);
 assert.equal(existsSync(join(m.dir,'.install-lock')),false);
 assert.deepEqual(m.installer(),[`${hex('c')} `]);
 assert.equal(m.file('.install-release'),`${ref('v1.10.0')}\n`);
 assert.equal(m.file('.gtmworks-version'),'v1.10.0\n');
 assert.equal(existsSync(join(m.dir,'.gtmworks-pending')),false);
});

test('an update to a main build cut off before or between the swap of its two files is finished with that build', t => {
 for(const cut of ['docker-compose.install.yml','install.sh']) {
  const m=machine(t);
  ok(m.line(['--channel','main']));
  const newer=hex('9'), newest=hex('6');
  for(const build of [newer,newest]) writeFileSync(join(m.env.FIXTURE,'migrations',build),'001.sql\n002.sql\n003.sql\n004.sql\n');
  const newerRef=`ghcr.io/${repo}:main@sha256:${newer}`;
  m.clear();
  const stopped=m.gtmworks(['update'],{extra:{MAIN_HEX:newer,CUT_BEFORE:cut}});
  assert.equal(stopped.signal,'SIGKILL',`${cut}: ${stopped.stderr}`);
  assert.equal(m.file('.gtmworks-pending'),`main@sha256:${newer}\n`,cut);
  // Main has moved on again by the time the install is finished: it finishes the build the update was moving to.
  m.clear();
  const finished=m.gtmworks(['install'],{extra:{MAIN_HEX:newest}});
  ok(finished,cut);
  assert.deepEqual(m.installer(),[`${newer} `],cut);
  assert.equal(m.file('.install-release'),`${newerRef}\n`,cut);
  for(const file of ['install.sh','docker-compose.install.yml']) assert.match(m.file(file),new RegExp(newer),`${cut}: ${file}`);
  assert.equal(m.file('.gtmworks-version'),'main\n',cut);
  assert.equal(existsSync(join(m.dir,'.gtmworks-pending'))||existsSync(join(m.dir,'.gtmworks-pending.d')),false,cut);
 }
});

test('an old folder whose data was removed is refused once another folder made the data anew, keys or not', t => {
 const m=machine(t);
 ok(m.line());
 const other=join(m.root,'other');
 // The first install removed with its data (down -v); another made in its own folder, then stopped with its data kept.
 rmSync(m.env.DB_FILE);
 ok(m.line(['--dir',other]));
 const before=['.env.install','install.sh','.install-release','.gtmworks-version'].map(name=>m.file(name));
 m.clear();
 const back=m.line();
 assert.equal(back.status,1);
 assert.match(back.stderr,new RegExp(`already holds gtmworks data \\(the volume gtmworks-install_database\\), made by the install in ${other}, and its keys are in that install's \\.env\\.install, not in ${m.dir}\\. .*--dir ${other}\\..*Nothing was changed\\.`));
 assert.equal(m.curl()+m.installer().join(''),'');
 assert.deepEqual(['.env.install','install.sh','.install-release','.gtmworks-version'].map(name=>m.file(name)),before);
 const update=m.spawnIn(['sh',join(m.dir,'gtmworks.sh'),'--command','--dir',m.dir,'update']);
 assert.equal(update.status,1);
 assert.match(update.stderr,/already holds gtmworks data/);
 // With its mark gone too it is still not the recorded maker.
 rmSync(join(m.dir,'.gtmworks-data'));
 assert.match(m.line().stderr,/made by the install in /);
 // The folder that made the data repairs, with its mark or, from before the mark, as the recorded maker.
 ok(m.line(['--dir',other]));
 rmSync(join(other,'.gtmworks-data'));
 ok(m.line(['--dir',other]));
 assert.ok(existsSync(join(other,'.gtmworks-data')),'a repair marks the data again');
});

test('a folder without the keys of the gtmworks data on this machine is refused, naming the folder that has them', t => {
 const m=machine(t);
 ok(m.line());
 const other=join(m.root,'other');
 m.clear();
 // The first install's containers are gone (compose down), its data volume is not.
 const refused=m.line(['--dir',other]);
 assert.equal(refused.status,1);
 assert.match(refused.stderr,new RegExp(`already holds gtmworks data \\(the volume gtmworks-install_database\\), made by the install in ${m.dir}, .*run the line again with --dir ${m.dir}\\..*Nothing was changed\\.`));
 assert.equal(existsSync(other),false);
 assert.equal(m.curl()+m.installer().join(''),'');
 // Its own folder, keys gone, is refused too; once the data is removed, a new folder installs.
 rmSync(join(m.dir,'.env.install'));
 assert.match(m.line().stderr,/already holds gtmworks data .*not in /);
 rmSync(m.env.DB_FILE);
 ok(m.line(['--dir',other]));
 assert.equal(readFileSync(join(m.home,'.local/state/gtmworks/install-dir'),'utf8'),`${other}\n`);
});

test('a main install goes back to the exact main build it ran, by its digest and its kept files', t => {
 const m=machine(t);
 ok(m.line(['--channel','main']));
 const newer=hex('9'), migrating=hex('8');
 writeFileSync(join(m.env.FIXTURE,'migrations',newer),'001.sql\n002.sql\n003.sql\n004.sql\n');
 writeFileSync(join(m.env.FIXTURE,'migrations',migrating),'001.sql\n002.sql\n003.sql\n004.sql\n005.sql\n');
 // A newer main build with no new migration: the go-back is an update to the build before, by digest.
 m.clear();
 const updated=m.gtmworks(['update'],{extra:{MAIN_HEX:newer}});
 ok(updated);
 assert.equal(updated.stdout.trim().split('\n').at(-1),`To go back to main@sha256:${mainHex}: gtmworks update --version main@sha256:${mainHex}`);
 assert.equal(m.file(`.gtmworks-main/${mainHex}/install.sh`),readFileSync(join(m.env.FIXTURE,'template-install.sh'),'utf8').replaceAll('@REF@',mainRef));
 m.clear();
 // main has moved on (MAIN_HEX is still the newer build): the command goes back to the exact one before.
 ok(m.gtmworks(updated.stdout.trim().split('\n').at(-1).split(': gtmworks ')[1].split(' '),{extra:{MAIN_HEX:newer}}));
 assert.deepEqual(m.installer(),[`${newer} backup ${join(m.dir,'backups')}`,`${mainHex} update`]);
 assert.equal(m.file('.install-release'),`${mainRef}\n`);
 assert.equal(m.file('.gtmworks-version'),'main\n');
 // A newer main build that migrates: the go-back restores the backup with the build before, named by digest.
 m.clear();
 const migrated=m.gtmworks(['update'],{extra:{MAIN_HEX:migrating}});
 ok(migrated);
 const archive=join(m.dir,'backups/gtmworks-test.tgz');
 assert.equal(migrated.stdout.trim().split('\n').at(-1),`To go back to main@sha256:${mainHex}: gtmworks restore '${archive}' --version main@sha256:${mainHex}`);
 assert.doesNotMatch(migrated.stdout,/vX\.Y\.Z/);
 m.clear();
 ok(m.gtmworks(['restore',archive,'--version',`main@sha256:${mainHex}`,'--yes'],{extra:{MAIN_HEX:migrating}}));
 assert.deepEqual(m.installer().slice(1),[`${mainHex} `,`${mainHex} restore ${archive}`,`${mainHex} update`]);
 assert.equal(m.file('.install-release'),`${mainRef}\n`);
 // A build whose files were not kept cannot be named.
 const unknown=m.gtmworks(['update','--version',`main@sha256:${hex('7')}`]);
 assert.equal(unknown.status,1);
 assert.match(unknown.stderr,/are not kept in .*Nothing was changed\./);
});

test('for a zsh user the PATH line goes in ~/.zshenv, made when missing, which every zsh reads', t => {
 const m=machine(t);
 ok(m.line([],{extra:{SHELL:'/usr/bin/zsh'}}));
 const pathLine='export PATH="$HOME/.local/bin:$PATH"';
 const count=name=>readFileSync(join(m.home,name),'utf8').split('\n').filter(line=>line===pathLine).length;
 assert.equal(count('.zshenv'),1);
 assert.equal(count('.profile'),1);
 ok(m.line([],{extra:{SHELL:'/usr/bin/zsh'}}));
 assert.equal(count('.zshenv'),1,'not added twice');
 // ZDOTDIR moves zsh's files; a bash user gets no zsh file.
 const dot=machine(t);
 mkdirSync(join(dot.home,'zdot'));
 ok(dot.line([],{extra:{SHELL:'/bin/zsh',ZDOTDIR:join(dot.home,'zdot')}}));
 assert.equal(readFileSync(join(dot.home,'zdot/.zshenv'),'utf8').includes(pathLine),true);
 const bash=machine(t);
 ok(bash.line([],{extra:{SHELL:'/bin/bash'}}));
 assert.equal(existsSync(join(bash.home,'.zshenv')),false);
});

test('a repair refuses a recorded release older than the data, and changes nothing', t => {
 const m=machine(t);
 ok(m.line());
 // The state a failed update left before: the data is v1.10.0's, the record names v1.2.3.
 writeFileSync(join(m.dir,'.gtmworks-version'),'v1.2.3\n');
 const before=['install.sh','docker-compose.install.yml','.install-release','.env.install'].map(name=>m.file(name));
 m.clear();
 const refused=m.gtmworks(['install']);
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/gtmworks v1\.2\.3 is older than the data in .*\(002\.sql 003\.sql\)\. Nothing was changed\./);
 assert.deepEqual(m.installer(),[]);
 assert.deepEqual(['install.sh','docker-compose.install.yml','.install-release','.env.install'].map(name=>m.file(name)),before);
});

test('an install with data and no recorded release: older is refused, another release is an update that backs up', t => {
 const m=machine(t);
 // A release installed by hand (#49): its files, its data, no .gtmworks-version.
 ok(m.line());
 rmSync(join(m.dir,'.gtmworks-version'));
 const before=['install.sh','docker-compose.install.yml','.install-release','.env.install'].map(name=>m.file(name));
 m.clear();
 const older=m.line(['--version','v1.2.3']);
 assert.equal(older.status,1);
 assert.match(older.stderr,/gtmworks v1\.2\.3 is older than the data in .*\(002\.sql 003\.sql\)\. Nothing was changed\./);
 assert.deepEqual(m.installer(),[]);
 assert.deepEqual(['install.sh','docker-compose.install.yml','.install-release','.env.install'].map(name=>m.file(name)),before);
 assert.equal(m.file('.gtmworks-version'),'');
 // A first install that did not finish (no .install-release): older is refused there too.
 rmSync(join(m.dir,'.install-release'));
 const unfinished=m.line(['--version','v1.2.3']);
 assert.equal(unfinished.status,1);
 assert.match(unfinished.stderr,/is older than the data/);
 assert.deepEqual(m.installer(),[]);

 const old=machine(t);
 ok(old.line(['--version','v1.2.3']));
 rmSync(join(old.dir,'.gtmworks-version'));
 old.clear();
 // The latest release is an update: the running release's installer backs up, the new one updates.
 const moved=old.line();
 ok(moved);
 assert.deepEqual(old.installer(),[`${hex('a')} backup ${join(old.dir,'backups')}`,`${hex('c')} update`]);
 assert.match(moved.stdout,/^Backup: .*gtmworks-test\.tgz$/m);
 assert.equal(old.file('.gtmworks-version'),'v1.10.0\n');
 assert.equal(old.file('.install-release'),`${ref('v1.10.0')}\n`);
 // The release it runs, named, is a repair that records it.
 rmSync(join(old.dir,'.gtmworks-version'));
 old.clear();
 ok(old.line(['--version','v1.10.0']));
 assert.deepEqual(old.installer(),[`${hex('c')} `]);
 assert.equal(old.file('.gtmworks-version'),'v1.10.0\n');
});

test('a second install folder is refused while another folder runs gtmworks on this machine', t => {
 const m=machine(t);
 const other=join(m.root,'first-install');
 const refused=m.line(['--dir',join(m.root,'second')],{extra:{PROJECT_DIRS:other}});
 assert.equal(refused.status,1);
 assert.match(refused.stderr,new RegExp(`gtmworks already runs from ${other} on this machine.*Nothing was changed\\.`));
 assert.equal(existsSync(join(m.root,'second')),false);
 assert.equal(m.curl(),'');
 assert.deepEqual(readdirSync(m.home),[]);
 // Its own folder, and no other: a repair goes on.
 ok(m.line());
 m.clear();
 ok(m.line([],{extra:{PROJECT_DIRS:m.dir}}));
 for(const args of [['update'],['backup'],['restore','x.tgz','--version','v1.2.3','--yes']]) {
  writeFileSync(join(m.work,'x.tgz'),'archive');
  m.clear();
  const taken=m.gtmworks(args,{extra:{PROJECT_DIRS:`${m.dir}\n${other}`}});
  assert.equal(taken.status,1,args.join(' '));
  assert.match(taken.stderr,/already runs from/,args.join(' '));
  assert.deepEqual(m.installer(),[],args.join(' '));
 }
});

test('--channel stable on a main install is a request to move, refused with the update that does it', t => {
 const m=machine(t);
 ok(m.line(['--channel','main']));
 m.clear();
 const refused=m.line(['--channel','stable']);
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/runs gtmworks main\. To move it to the latest stable release, run: gtmworks update --channel stable\. Nothing was changed\./);
 assert.deepEqual(m.installer(),[]);
 assert.equal(m.file('.gtmworks-version'),'main\n');
 // On a stable install it names the channel it is on: a repair.
 const stable=machine(t);
 ok(stable.line(['--version','v1.3.0']));
 stable.clear();
 ok(stable.line(['--channel','stable']));
 assert.deepEqual(stable.installer(),[`${hex('b')} `]);
});

test('the latest release is read from every page of GitHub Releases, not only the first 100', t => {
 const m=machine(t,{list:Array.from({length:100},(_,index)=>`v0.0.${index}`)});
 writeFileSync(join(m.env.FIXTURE,'releases-2.json'),JSON.stringify([{tag_name:'v1.10.0'},{tag_name:'v1.2.3'}]));
 const latest=m.line();
 ok(latest);
 assert.match(latest.stdout,/^Installing gtmworks v1\.10\.0 into /m);
 assert.deepEqual(m.curl().split('\n').filter(url=>/api\.github\.com/.test(url)),[1,2].map(page=>`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`));
});

test('gtmworks restore --version goes back: backs up the current data, makes the install anew and restores the archive', t => {
 const m=machine(t);
 ok(m.line());
 const archive=join(m.root,'old.tgz');
 writeFileSync(archive,'archive');
 m.clear();
 ok(m.gtmworks(['restore',archive]));
 assert.deepEqual(m.installer(),[`${hex('c')} restore ${archive}`]);
 m.clear();
 const back=m.gtmworks(['restore',archive,'--version','v1.2.3','--yes']);
 ok(back);
 // After the restore, v1.2.3's update applies its migrations the archive predates.
 assert.deepEqual(m.installer(),[`${hex('c')} backup ${join(m.dir,'backups')}`,`${hex('a')} `,`${hex('a')} restore ${archive}`,`${hex('a')} update`]);
 const docker=m.docker().split('\n');
 // The archive is read before anything stops: its entries, then the migrations its database applied.
 const firstChange=docker.findIndex(line=>/ (down|stop)$/.test(line)||/^volume rm /.test(line));
 assert.ok(docker.indexOf('run --rm -i alpine:3.21 tar -tzf -')>=0&&docker.indexOf('run --rm -i alpine:3.21 tar -tzf -')<firstChange);
 assert.ok(docker.findIndex(line=>/postgres --single/.test(line))<firstChange);
 // The archive's settings, completed and validated by v1.2.3's own tool, also before anything stops.
 const validated=docker.findIndex(line=>new RegExp(`^run --rm --env-file ${m.dir}/\\.gtmworks-download\\.\\w+/archive\\.complete ${ref('v1.2.3').replace(/[.]/g,'\\.')} node /app/install/lib/install-env\\.mjs validate complete$`).test(line));
 assert.ok(validated>=0&&validated<firstChange,'settings validated by the target release before anything stops');
 assert.ok(docker.some(line=>/ down$/.test(line)),'the stack goes down, its volumes kept by compose');
 assert.equal(docker.filter(line=>/ down /.test(line)||/-v$/.test(line)).length,0);
 assert.ok(docker.includes('volume rm gtmworks-install_database gtmworks-install_database-config gtmworks-install_files'),'the agent engine volume is kept');
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.match(back.stdout,/The data from before is in .*gtmworks-test\.tgz\./);
});

test('gtmworks restore --version checks the archive and asks before it replaces anything', t => {
 const m=machine(t);
 ok(m.line());
 const archive=join(m.root,'old.tgz');
 writeFileSync(archive,'archive');
 const nothingChanged=(result,label)=>{
  assert.equal(result.status,1,label);
  assert.match(result.stderr,/Nothing was changed\./,label);
  assert.deepEqual(m.installer(),[],label);
  assert.doesNotMatch(m.docker(),/ down$|^volume rm |^compose .* stop/m,label);
 };
 const cases=[
  [{},[],/This replaces the data of the gtmworks install in .* with the data in .*old\.tgz, and runs gtmworks v1\.2\.3 on it\..* Run it again with --yes to go on\./],
  [{ARCHIVE_ENTRIES:'var/lib/postgresql/data/\n../etc/passwd'},['--yes'],/is not a gtmworks backup: it holds an unsafe path: \.\.\/etc\/passwd\./],
  [{ARCHIVE_ENTRIES:'var/lib/postgresql/data/\nhome/x'},['--yes'],/it holds an entry no backup holds: home\/x\./],
  [{ARCHIVE_ENTRIES:'var/lib/postgresql/data/\netc/postgresql-custom/\n.env.install'},['--yes'],/not a complete gtmworks backup: it has no var\/lib\/storage\/\./],
  [{ENV_INVALID:'1'},['--yes'],/SUPABASE_PUBLIC_URL must equal APP_ORIGIN\n.*The settings in .*old\.tgz \(its \.env\.install\) are not valid for gtmworks v1\.2\.3, for the reason above\. Nothing was changed\./],
  [{ARCHIVE_MIGRATIONS:'001.sql 002.sql 003.sql'},['--yes'],/old\.tgz holds migrations that gtmworks v1\.2\.3 does not carry \(002\.sql 003\.sql\): a later release made it\./],
 ];
 for(const [extra,flags,message] of cases) {
  m.clear();
  const refused=m.gtmworks(['restore',archive,'--version','v1.2.3',...flags],{extra});
  assert.match(refused.stderr,message,JSON.stringify(extra));
  nothingChanged(refused,JSON.stringify(extra));
 }
 // An archive whose migrations cannot be read is not taken for one with none.
 m.clear();
 const unread=m.gtmworks(['restore',archive,'--version','v1.2.3','--yes'],{extra:{ARCHIVE_UNREADABLE:'1'}});
 assert.match(unread.stderr,/Could not read the migrations in .*old\.tgz\./);
 nothingChanged(unread,'unreadable');
});

test('gtmworks restore finds backups/<name> in the install folder when the current folder has none', t => {
 const m=machine(t);
 ok(m.line());
 mkdirSync(join(m.dir,'backups'));
 writeFileSync(join(m.dir,'backups/gtmworks-1.tgz'),'archive');
 m.clear();
 ok(m.gtmworks(['restore','backups/gtmworks-1.tgz']));
 assert.deepEqual(m.installer(),[`${hex('c')} restore ${join(m.dir,'backups/gtmworks-1.tgz')}`]);
 // One in the current folder is the one meant.
 mkdirSync(join(m.work,'backups'));
 writeFileSync(join(m.work,'backups/gtmworks-1.tgz'),'mine');
 m.clear();
 ok(m.gtmworks(['restore','backups/gtmworks-1.tgz']));
 assert.deepEqual(m.installer(),[`${hex('c')} restore ${join(m.work,'backups/gtmworks-1.tgz')}`]);
});

test('gtmworks status reports every service and fails when one is not healthy', t => {
 const m=machine(t);
 ok(m.line());
 const healthy=m.gtmworks(['status']);
 ok(healthy);
 assert.match(healthy.stdout,/^db +healthy$/m);
 assert.match(healthy.stdout,/^web +healthy$/m);
 assert.match(healthy.stdout,/^worker +healthy \(running; it has no health check of its own\)$/m);
 assert.match(healthy.stdout,/http:\/\/gateway:8080\/api\/health 200/);
 assert.equal(healthy.stdout.trim().split('\n').at(-1),'All 3 services are healthy.');
 const sick=m.gtmworks(['status'],{extra:{UNHEALTHY:'web'}});
 assert.equal(sick.status,1);
 assert.match(sick.stdout,/^web +NOT HEALTHY: exited$/m);
 assert.match(sick.stderr,/Not healthy: web\./);
});

test('CI runs the one line twice, gtmworks status from a new shell, an update, a refusal, a failed update and going back', () => {
 const steps=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps;
 const at=pattern=>steps.findIndex(step=>pattern.test(step.name||''));
 const index=at(/one-line install/);
 assert.ok(index>at(/release install and update/)&&index<steps.length-1,'after the release step, before the Docker machine is removed');
 const step=steps[index];
 assert.equal(step.env.DOCKER_HOST,'tcp://127.0.0.1:2375');
 const run=step.run;
 for(const pattern of [
  /line\(\) \{ curl -fsSL "\$GTMWORKS_GET" \| sh -s -- "\$@"; \}/,
  /GTMWORKS_RELEASES="file:\/\/\$releases"/,
  /grep -E 'Digest: sha256:\[a-f0-9\]\{64\}' one-line\.log/,
  /if grep -Ei 'compose build\|\\\[\\\+\\\] Building' one-line\.log; then fail/,
  /http:\/\/gateway:8080\/api\/health 200/,
  /for run in again version; do/,
  /args=\(--version v0\.0\.0\)/,
  /\[\[ \$\(sha256sum < \.env\.install\) == "\$checksum" \]\]/,
  /one-line-probe/,
  /env -i HOME="\$HOME" [^\n]*\\\n\s+sh -lc 'command -v gtmworks && gtmworks status'/,
  /All \[0-9\]\+ services are healthy/,
  /gtmworks update \|\| fail 'gtmworks update'/,
  /\^Backup: /,
  /To go back to v0\.0\.0: gtmworks restore '\$archive' --version v0\.0\.0/,
  /gtmworks v0\.0\.1 is running: \$next/,
  /if gtmworks update --version v0\.0\.0 > /,
  /owners=\$\(find "\$dir" ! -user "\$\(id -u\)"\)/,
  /gtmworks update --version v0\.0\.2 --no-backup/,
  /Applying migration: 99999999999999_failure\.sql/,
  /\[\[ \$\(compose ps -q web\) == "\$old_web" \]\]/,
  /to_regclass\('public\.update_should_rollback'\) is null/,
  /eval "\$back"/,
  /services=\$\(compose config --services\) \|\| fail [^\n]*\n\s*\[\[ -n \$services \]\] \|\| fail [^\n]*\n\s*for service in \$services; do/,
  /if eval "\$back" < \/dev\/null > [^\n]*; then [^\n]*fail 'going back without --yes must ask first'/,
  /eval "\$back --yes" \|\| fail/,
  /if line --dir "\$fresh" > [^\n]*; then [^\n]*fail 'a second install folder must be refused'/,
  /\[\[ ! -e \$fresh \]\]/,
  /line --version v0\.0\.0 --dir "\$fresh" \|\| fail/,
  /grep -Fx "Installing gtmworks v0\.0\.0 into \$fresh\."/,
  /\[\[ \$\(web_image\) == \$\(docker image inspect -f '\{\{\.Id\}\}' "\$first"\) \]\]/,
 ]) assert.match(run,pattern);
 // The per-service loop reads a list it checked is not empty.
 assert.doesNotMatch(run,/for service in \$\(compose config --services\)/);
 // The --version run names a release that is not the latest, in a folder of its own, after the first install is gone.
 const versionRun=run.indexOf('line --version v0.0.0 --dir "$fresh"');
 assert.ok(versionRun>run.lastIndexOf('compose down -v'));
 assert.ok(run.lastIndexOf(`'[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"}]'`,versionRun)>run.indexOf('eval "$back --yes"'));
 // The failing update runs after the successful one, and the refusal reads back the running image and migrations.
 assert.ok(run.indexOf('--version v0.0.2')>run.indexOf("gtmworks update || fail"));
 assert.match(run,/\[\[ \$\(web_image\) == "\$image" && \$\(cat \.install-release\) == "\$next"/);
 assert.match(run,/migrations \| diff -u "\$RUNNER_TEMP\/updated-migrations" -/);
});

test('the README installs with the one line, keeps the source route under From source, and updates with gtmworks update', () => {
 const readme=readFileSync('README.md','utf8');
 const install=readme.split(/^## Install$/m)[1].split(/^## /m)[0];
 const firstBlock=install.match(/```sh\n([^`]*)```/)[1].trim();
 assert.equal(firstBlock,`curl -fsSL https://raw.githubusercontent.com/${repo}/main/scripts/get.sh | sh`);
 assert.ok(install.trim().startsWith('On a Linux server with Docker, run:'));
 const source=install.split(/^### From source$/m)[1];
 assert.ok(source,'Install has a From source subsection');
 assert.match(source,/sh scripts\/install\.sh/);
 assert.doesNotMatch(install.split(/^### From source$/m)[0],/sh scripts\/install\.sh/);
 const update=readme.split(/^## Update$/m)[1].split(/^## /m)[0];
 assert.match(update,/```sh\ngtmworks update /);
 assert.doesNotMatch(update,/scripts\/install\.sh/);
 // The line on the README is the one get.sh documents and prints.
 assert.ok(getText.includes(`curl -fsSL https://raw.githubusercontent.com/${repo}/main/scripts/get.sh | sh`));
 assert.match(getText,/GTMWORKS_RELEASES/);
});
