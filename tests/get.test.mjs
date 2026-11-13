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

const installerTemplate=`#!/bin/sh
release_image=@REF@
op=\${1:-install}
printf '%s %s\\n' "\${release_image##*:}" "$*" >> "$INSTALLER_LOG"
case "$op" in
 backup) mkdir -p "$2"; : > "$2/gtmworks-test.tgz"; echo 'Stopping...'; echo "Backup: $2/gtmworks-test.tgz"; exit 0;;
 restore) exit 0;;
esac
[ -f .env.install ] || echo "SECRET=$$" > .env.install
rm -f .install-release
if [ "$release_image" = "\${FAIL_REF:-}" ]; then
 [ -z "\${FAIL_AFTER_MIGRATE:-}" ] || cp "$FIXTURE/migrations/\${release_image##*:}" "$DB_FILE"
 echo 'Applying migration: 999_failure.sql'; exit 3
fi
cp "$FIXTURE/migrations/\${release_image##*:}" "$DB_FILE"
printf '%s\\n' "$release_image" > .install-release
echo 'gtmworks is ready: http://localhost:3000/sign-in'
`;
const composeTemplate='services:\n  web:\n    image: @REF@\n  worker:\n    image: @REF@\n';

const fakeDocker=`#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
 'compose version --short') [ -z "\${COMPOSE_MISSING:-}" ] || exit 1; echo "\${COMPOSE_VERSION:-2.29.1}"; exit 0;;
 info) exit "\${INFO_EXIT:-0}";;
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
const fakeCurl=`#!/bin/sh
out= url=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; --retry) shift;; -*) ;; *) url=$1;; esac; shift; done
printf '%s\\n' "$url" >> "$CURL_LOG"
case "$url" in
 'https://api.github.com/repos/${repo}/releases?per_page=100') src=$FIXTURE/releases.json;;
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
 const logs={DOCKER_LOG:join(root,'docker.log'),CURL_LOG:join(root,'curl.log'),INSTALLER_LOG:join(root,'installer.log'),DB_FILE:join(root,'database')};
 const env={HOME:home,PATH:`${bin}:${tools}`,FIXTURE:fixture,GET_SOURCE:getScript,MAIN_HEX:mainHex,...logs};
 const spawn=(args,{extra={},input,cwd=work}={})=>spawnSync('/bin/sh',args,{cwd,env:{...env,...extra},encoding:'utf8',input});
 const read=path=>existsSync(path)?readFileSync(path,'utf8'):'';
 const dir=join(home,'gtmworks');
 return {root,home,work,dir,env,
  line:(args=[],options)=>spawn([getScript,...args],options),
  piped:(args=[],options)=>spawn(['-s','--',...args],{...options,input:getText}),
  gtmworks:(args=[],options)=>spawn([join(home,'.local/bin/gtmworks'),...args],options),
  docker:()=>read(logs.DOCKER_LOG),curl:()=>read(logs.CURL_LOG),installer:()=>read(logs.INSTALLER_LOG).split('\n').filter(Boolean),
  file:name=>read(join(dir,name)),
  clear:()=>{ for(const path of [logs.DOCKER_LOG,logs.CURL_LOG,logs.INSTALLER_LOG]) rmSync(path,{force:true}); }};
}
const ok=(result,label='')=>assert.equal(result.status,0,`${label}\n${result.stdout}\n${result.stderr}`);

test('options: each wrong one stops with usage before Docker, curl or any folder is touched', t => {
 const m=machine(t);
 for(const args of [['--version','1.2.3'],['--version','v1.2'],['--version=v1.2.3-rc1'],['--channel','beta'],['--version','v1.2.3','--channel','main'],
  ['--no-backup'],['status','--version','v1.2.3'],['backup','--channel','main'],['restore'],['frobnicate'],['--dir'],['--bogus'],['update','extra'],['status','--no-backup']]) {
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
 assert.equal(urls[0],`https://api.github.com/repos/${repo}/releases?per_page=100`);
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
 // Migrations that were applied before the failure stay with the files they belong to.
 m.clear();
 const applied=m.gtmworks(['update','--version','v1.3.0','--no-backup'],{extra:{FAIL_REF:ref('v1.3.0'),FAIL_AFTER_MIGRATE:'1'}});
 assert.equal(applied.status,3);
 assert.deepEqual(m.installer(),[`${hex('b')} update`]);
 assert.match(applied.stderr,/gtmworks update --version v1\.3\.0 --no-backup to finish it/);
 assert.equal(m.file('install.sh'),readFileSync(join(m.env.FIXTURE,'v1.3.0/install.sh'),'utf8'));
 // Files that are not the running release's are repaired before any update.
 m.clear();
 const unfinished=m.gtmworks(['update']);
 assert.equal(unfinished.status,1);
 assert.match(unfinished.stderr,/an install or update did not finish\. Repair it first with: gtmworks install/);
 assert.deepEqual(m.installer(),[]);
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
 const back=m.gtmworks(['restore',archive,'--version','v1.2.3']);
 ok(back);
 assert.deepEqual(m.installer(),[`${hex('c')} backup ${join(m.dir,'backups')}`,`${hex('a')} `,`${hex('a')} restore ${archive}`]);
 const docker=m.docker().split('\n');
 assert.ok(docker.some(line=>/ down$/.test(line)),'the stack goes down, its volumes kept by compose');
 assert.equal(docker.filter(line=>/ down /.test(line)||/-v$/.test(line)).length,0);
 assert.ok(docker.includes('volume rm gtmworks-install_database gtmworks-install_database-config gtmworks-install_files'),'the agent engine volume is kept');
 assert.equal(m.file('.gtmworks-version'),'v1.2.3\n');
 assert.match(back.stdout,/The data from before is in .*gtmworks-test\.tgz\./);
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
 ]) assert.match(run,pattern);
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
