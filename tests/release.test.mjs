import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { releaseCompose, releaseInstaller, writeReleaseAssets } from '../scripts/release-assets.mjs';

// Every release publishes one tested image and a GitHub Release whose compose file and install script are all an
// install needs (#49). The source install keeps building from a checkout until a later ticket switches it.
const app='ghcr.io/omarabdo516/gtmworks:1.2.3@sha256:'+'a'.repeat(64);
const sourceCompose=readFileSync('docker-compose.install.yml','utf8');
const sourceInstaller=readFileSync('scripts/install.sh','utf8');
const pinnedImages=load(sourceCompose).services;
const digests=Object.fromEntries(Object.values(pinnedImages).map(service=>service.image)
 .filter(image=>!image.includes('@')&&!image.startsWith('gtmworks-local:')).map((image,index)=>[image,'sha256:'+String(index).repeat(64)]));

test('the release compose file pins every image by digest and runs the released app image', () => {
 const text=releaseCompose(sourceCompose,app,digests);
 const images=text.split('\n').filter(line=>/^\s*image:/.test(line));
 assert.equal(images.length,Object.keys(pinnedImages).length);
 for(const line of images) assert.match(line,/@sha256:[a-f0-9]{64}$/,line);
 const yaml=load(text);
 assert.equal(yaml.services.web.image,app);
 assert.equal(yaml.services.worker.image,app);
 assert.equal(yaml.services.web.build,undefined);
 for(const [image,digest] of Object.entries(digests)) assert.ok(text.includes(`image: ${image}@${digest}\n`),image);
 assert.equal(yaml.services.hermes.image,pinnedImages.hermes.image);
 // Everything else is the source install exactly: the same volumes, mounts, ports and settings.
 const withoutImage=service=>Object.fromEntries(Object.entries(service).filter(([key])=>key!=='image'&&key!=='build'));
 for(const [name,service] of Object.entries(load(sourceCompose).services)) assert.deepEqual(withoutImage(yaml.services[name]),withoutImage(service),name);
 assert.deepEqual(yaml.volumes,load(sourceCompose).volumes);
});

test('the release compose file refuses an image it cannot pin or an app reference without a digest', () => {
 const [first]=Object.keys(digests);
 assert.throws(()=>releaseCompose(sourceCompose,app,{...digests,[first]:undefined}),new RegExp(first.replace(/[.]/g,'\\.')));
 assert.throws(()=>releaseCompose(sourceCompose,app,{...digests,[first]:'sha256:short'}),/digest/);
 for(const reference of ['ghcr.io/omarabdo516/gtmworks:1.2.3','ghcr.io/omarabdo516/gtmworks@sha256:abc','x y@sha256:'+'a'.repeat(64)])
  assert.throws(()=>releaseCompose(sourceCompose,reference,digests),/digest/);
 assert.throws(()=>releaseCompose(sourceCompose.replace('build: .','build: ./other'),app,digests),/build/);
});

test('the release files are written together, resolving a digest once for each image the compose file pins by tag only', t => {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-assets-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const asked=[];
 writeReleaseAssets(app,directory,image=>{ asked.push(image); return digests[image]; });
 assert.deepEqual(asked.sort(),Object.keys(digests).sort());
 assert.deepEqual(readdirSync(directory).sort(),['docker-compose.install.yml','install.sh']);
 assert.equal(readFileSync(join(directory,'docker-compose.install.yml'),'utf8'),releaseCompose(sourceCompose,app,digests));
 assert.equal(readFileSync(join(directory,'install.sh'),'utf8'),releaseInstaller(sourceInstaller,app));
});

test('the release install script is the source installer with the released image set, and nothing else', () => {
 const script=releaseInstaller(sourceInstaller,app);
 const changed=script.split('\n').filter((line,index)=>line!==sourceInstaller.split('\n')[index]);
 assert.deepEqual(changed,[`release_image=${app}`]);
 assert.match(sourceInstaller,/^release_image=$/m);
 assert.throws(()=>releaseInstaller(sourceInstaller.replace(/^release_image=$/m,''),app),/release_image/);
 assert.throws(()=>releaseInstaller(sourceInstaller,'ghcr.io/omarabdo516/gtmworks:latest'),/digest/);
});

// Every path the source installer and its compose file read from the checkout (relative mounts, the lib folder the
// install-env helper runs from, and the migrations it streams) must be inside the image, under /app/install.
function checkoutPaths() {
 const paths=new Set();
 for(const service of Object.values(load(sourceCompose).services)) for(const volume of service.volumes||[]) {
  const source=volume.split(':')[0];
  if(source.startsWith('./')) paths.add(source.slice(2));
 }
 for(const match of sourceInstaller.matchAll(/\$PWD\/([\w./-]+):/g)) if(!match[1].startsWith('.')) paths.add(match[1]);
 for(const match of sourceInstaller.matchAll(/for file in ([\w/]+)\/\*\.sql/g)) paths.add(match[1]);
 return [...paths].sort();
}

test('the image carries every file an install reads from a source checkout', () => {
 const paths=checkoutPaths();
 for(const expected of ['lib','scripts/install-db.sql','scripts/local-default-privileges.sql','scripts/install-key.sh','scripts/install-nginx.conf','supabase/migrations'])
  assert.ok(paths.includes(expected),`the scan finds ${expected}`);
 const dockerfile=readFileSync('Dockerfile','utf8');
 const copied=[...dockerfile.matchAll(/^COPY --from=build --chown=node:node (.+) (\.\/install\/[\w./-]*)$/gm)]
  .flatMap(([,sources,target])=>sources.split(' ').map(source=>{
   const relative=source.replace(/^\/app\//,'');
   return target.endsWith('/')&&!target.endsWith(`${relative}/`)?`${target.slice('./install/'.length)}${relative.split('/').at(-1)}`:target.slice('./install/'.length).replace(/\/$/,'');
  }));
 for(const path of paths) assert.ok(copied.includes(path),`${path} is copied to /app/install/${path}: ${copied.join(', ')}`);
});

// A Docker stand-in for a directory that holds only the two release files. The image is a folder built from the
// Dockerfile's /app/install copies; extraction copies it into the install directory, as the container would.
function imageFolder(t) {
 const root=mkdtempSync(join(tmpdir(),'gtmworks-image-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const path of checkoutPaths()) cpSync(path,join(root,path),{recursive:true});
 return root;
}
const dockerShim=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 pull*) echo "Digest: \${2#*@}";;
 *' sh -ec '*/app/install/*)
  # Runs the installer's own extraction script, with the image's /app/install and the mounted /install mapped here.
  eval "script=\\\${$#}"
  umask 022; sh -ec "$(printf '%s' "$script" | sed -e "s#/app/install/#$IMAGE_ROOT/#g" -e 's#/install/#./#g')";;
 *install-env.mjs\\ generate*) printf 'GENERATED=1\\n';;
 *'exec -T db psql'*) cat > "$MIGRATION_SQL"; exit "\${MIGRATION_EXIT:-0}";;
esac
`;
function releaseDirectory(t,{compose=releaseCompose(sourceCompose,app,digests)}={}) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-release-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'docker-compose.install.yml'),compose);
 writeFileSync(join(directory,'install.sh'),releaseInstaller(sourceInstaller,app));
 const bin=mkdtempSync(join(tmpdir(),'gtmworks-release-bin-'));
 t.after(()=>rmSync(bin,{recursive:true,force:true}));
 writeFileSync(join(bin,'docker'),dockerShim,{mode:0o755});
 const env={...process.env,PATH:`${bin}:${process.env.PATH}`,COMMANDS:join(bin,'commands'),MIGRATION_SQL:join(bin,'migration.sql'),IMAGE_ROOT:imageFolder(t)};
 const runWith=(extra,...args)=>spawnSync('sh',['install.sh',...args],{cwd:directory,env:{...env,...extra},encoding:'utf8'});
 return {directory,imageRoot:env.IMAGE_ROOT,run:(...args)=>runWith({},...args),runWith,clear:()=>rmSync(env.COMMANDS,{force:true}),
  commands:()=>existsSync(env.COMMANDS)?readFileSync(env.COMMANDS,'utf8'):'',sql:()=>readFileSync(env.MIGRATION_SQL,'utf8'),
  installed:()=>existsSync(join(directory,'.install-release'))?readFileSync(join(directory,'.install-release'),'utf8'):null,
  use:image=>{
   writeFileSync(join(directory,'docker-compose.install.yml'),releaseCompose(sourceCompose,image,digests));
   writeFileSync(join(directory,'install.sh'),releaseInstaller(sourceInstaller,image));
  }};
}

test('a release install pulls the image by digest, takes its install files from it and builds nothing', t => {
 const release=releaseDirectory(t);
 assert.deepEqual(readdirSync(release.directory).sort(),['docker-compose.install.yml','install.sh']);
 const result=release.run();
 assert.equal(result.status,0,result.stderr);
 const commands=release.commands().split('\n');
 const index=pattern=>commands.findIndex(line=>pattern.test(line));
 assert.equal(commands[0],`pull ${app}`);
 assert.match(result.stdout,/Digest: sha256:a{64}/);
 const extract=index(/cp -R \/app\/install\/\. \/install\//);
 assert.ok(extract>0);
 assert.ok(commands[extract].startsWith(`run --rm --user ${process.getuid()}:${process.getgid()} -v ${release.directory}:/install ${app} sh -ec `),commands[extract]);
 assert.ok(extract<index(/install-env\.mjs generate/));
 assert.ok(index(/install-env\.mjs generate/)<index(/exec -T db psql/));
 assert.equal(index(/\bbuild\b/),-1);
 assert.equal(index(/\blogin\b/),-1);
 assert.match(commands.at(-3),/up -d --wait --wait-timeout 300$/);
 // The files the compose file mounts are in place before anything starts, and the migrations come from the image.
 for(const path of checkoutPaths()) assert.ok(existsSync(join(release.directory,path)),path);
 assert.equal(statSync(join(release.directory,'scripts/install-key.sh')).mode & 0o111,0o111);
 const first=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&!name.endsWith('.verify.sql')).sort()[0];
 assert.match(release.sql(),new RegExp(`\\\\ir /migrations/${first.replace(/[.]/g,'\\.')}`));
 assert.equal(existsSync(join(release.directory,'.install-lock')),false);
});

test('a release install refuses a compose file from another release and an update that names a source version', t => {
 const other=releaseCompose(sourceCompose,app.replace(/a{64}$/,'b'.repeat(64)),digests);
 const mismatched=releaseDirectory(t,{compose:other});
 const refused=mismatched.run();
 assert.notEqual(refused.status,0);
 assert.match(refused.stderr,/docker-compose\.install\.yml/);
 assert.equal(mismatched.commands(),'');
 const release=releaseDirectory(t);
 writeFileSync(join(release.directory,'.env.install'),'GENERATED=1\n');
 const update=release.run('update','main');
 assert.notEqual(update.status,0);
 assert.match(update.stderr,/next release/);
 assert.equal(release.commands(),'');
 const updated=release.run('update');
 assert.equal(updated.status,0,updated.stderr);
 assert.match(release.commands(),/^pull /);
 // A release pins every service by digest: update lets compose recreate whatever the new release changed (a database,
 // gateway or mail digest, not only the app), and the gateway reloads the configuration the extraction replaced.
 const commands=release.commands().split('\n');
 const up=commands.findIndex(line=>/ up -d /.test(line));
 assert.match(commands[up],/ up -d --wait --wait-timeout 300$/);
 assert.doesNotMatch(release.commands(),/--no-deps/);
 assert.ok(commands.findIndex(line=>/exec -T gateway nginx -s reload$/.test(line))>up);
});

test('a source checkout is never treated as a release install directory', t => {
 const release=releaseDirectory(t);
 mkdirSync(join(release.directory,'scripts'));
 writeFileSync(join(release.directory,'scripts/install.sh'),sourceInstaller);
 const refused=release.run();
 assert.equal(refused.status,1);
 assert.match(refused.stderr,/source checkout/);
 assert.equal(release.commands(),'');
});

test('a failed release update records no release, and rolling back takes only the previous release files', t => {
 const release=releaseDirectory(t);
 assert.equal(release.run().status,0);
 const next=app.replace(/a{64}$/,'c'.repeat(64));
 // The next image adds a migration that fails.
 const nextRoot=mkdtempSync(join(tmpdir(),'gtmworks-next-image-'));
 t.after(()=>rmSync(nextRoot,{recursive:true,force:true}));
 cpSync(release.imageRoot,nextRoot,{recursive:true});
 writeFileSync(join(nextRoot,'supabase/migrations/99999999999999_next.sql'),'select 1/0;');
 release.use(next);
 const failed=release.runWith({MIGRATION_EXIT:'3',IMAGE_ROOT:nextRoot},'update');
 assert.equal(failed.status,3,failed.stderr);
 assert.match(release.sql(),/99999999999999_next\.sql/);
 // The files on disk are the next release's while the old app serves: no release is recorded, so neither the next
 // release's files nor the previous ones may back up or restore (both restart the stack on mismatched files).
 assert.equal(release.installed(),null);
 for(const image of [next,app]) {
  release.use(image);
  release.clear();
  assert.equal(release.run('backup').status,1,image);
  assert.equal(release.commands(),'',image);
 }
 // Rolling back is an update with the previous release's files: its migrations replace the next ones, none stale.
 release.use(app);
 const rolledBack=release.run('update');
 assert.equal(rolledBack.status,0,rolledBack.stderr);
 assert.equal(existsSync(join(release.directory,'supabase/migrations/99999999999999_next.sql')),false);
 assert.doesNotMatch(release.sql(),/99999999999999_next/);
 assert.equal(release.installed(),`${app}\n`);
 assert.equal(release.run('backup').status,0);
});

test('a release install backs up and restores only with the files of the release it runs', t => {
 const release=releaseDirectory(t);
 assert.equal(release.run('backup').status,1);
 const installed=release.run();
 assert.equal(installed.status,0,installed.stderr);
 assert.equal(release.installed(),`${app}\n`);
 const backup=release.run('backup');
 assert.equal(backup.status,0,backup.stderr);
 const archive=join('backups',readdirSync(join(release.directory,'backups'))[0]);
 // The next release's files are in place but its update has not run: backup and restore restart the stack, which would
 // start the new app on the old schema, so both stop before touching Docker.
 const next=app.replace(/a{64}$/,'c'.repeat(64));
 release.use(next);
 for(const args of [['backup'],['restore',archive]]) {
  release.clear();
  const refused=release.run(...args);
  assert.equal(refused.status,1,args[0]);
  assert.match(refused.stderr,/sh install\.sh update/,args[0]);
  assert.equal(release.commands(),'',args[0]);
 }
 assert.equal(readdirSync(join(release.directory,'backups')).length,1);
 // Only the compose file replaced: the install script still matches what runs, the compose file does not.
 writeFileSync(join(release.directory,'install.sh'),releaseInstaller(sourceInstaller,app));
 release.clear();
 assert.equal(release.run('backup').status,1);
 assert.equal(release.commands(),'');
 // A finished update records the new release.
 release.use(next);
 const updated=release.run('update');
 assert.equal(updated.status,0,updated.stderr);
 assert.equal(release.installed(),`${next}\n`);
 assert.equal(release.run('backup').status,0);
});

test('the source installer still builds from its checkout', () => {
 assert.match(sourceInstaller,/^release_image=$/m);
 assert.match(sourceInstaller,/compose build web/);
 assert.equal(load(sourceCompose).services.web.build,'.');
});

// The release workflow: build both platforms, test an install from the two release files, then move stable.
const workflow=load(readFileSync('.github/workflows/release.yml','utf8'));
const workflowText=readFileSync('.github/workflows/release.yml','utf8');
const runs=job=>workflow.jobs[job].steps.map(step=>step.run||'').join('\n');

// A tag push runs the workflow file of the tagged commit, which an unreviewed commit could rewrite. So a tag only starts
// a workflow with no permissions, and publishing runs on workflow_run, which always runs main's reviewed release.yml.
const tagWorkflow=load(readFileSync('.github/workflows/release-tag.yml','utf8'));

test('a vX.Y.Z tag only requests a release; the publishing workflow runs from main on workflow_run', () => {
 assert.equal(tagWorkflow.name,'Release tag');
 assert.deepEqual(tagWorkflow.on,{push:{tags:['v[0-9]+.[0-9]+.[0-9]+']}});
 assert.deepEqual(tagWorkflow.permissions,{});
 for(const job of Object.values(tagWorkflow.jobs)) {
  assert.equal(job.permissions,undefined);
  assert.equal(job.steps.some(step=>step.uses),false);
 }
 assert.deepEqual(Object.keys(workflow.on),['workflow_run']);
 assert.deepEqual(workflow.on.workflow_run,{workflows:['CI','Release tag'],types:['completed']});
 // github.ref and github.sha name main on workflow_run; the commit and tag come only from the checked provenance.
 assert.doesNotMatch(workflowText,/github\.(sha|ref|ref_name)\b/);
 const provenance=workflow.jobs.provenance;
 assert.deepEqual(provenance.permissions,{contents:'read',actions:'read'});
 assert.match(provenance.if,/workflow_run\.conclusion == 'success'/);
 assert.match(provenance.if,/workflow_run\.event == 'push'/);
 // Every job that writes waits on it, and every checkout takes the exact commit it proved.
 const needs=job=>[workflow.jobs[job].needs??[]].flat();
 const upstream=job=>needs(job).flatMap(name=>[name,...upstream(name)]);
 for(const [name,job] of Object.entries(workflow.jobs)) {
  if(name==='provenance') continue;
  assert.ok(upstream(name).includes('provenance'),name);
  for(const step of job.steps.filter(step=>step.uses?.startsWith('actions/checkout@'))) assert.equal(step.with?.ref,'${{ needs.provenance.outputs.sha }}',name);
 }
 assert.equal(workflow.jobs.image.if,"${{ needs.provenance.outputs.tag != '' }}");
 assert.equal(workflow.jobs['install-test'].if,"${{ needs.provenance.outputs.release != '' }}");
 const build=workflow.jobs.image.steps.find(step=>step.uses?.startsWith('docker/build-push-action@'));
 assert.equal(build.with.tags,'${{ env.IMAGE }}:${{ needs.provenance.outputs.tag }}');
 assert.equal(build.with.platforms,'linux/amd64,linux/arm64');
 assert.equal(build.with.push,true);
 assert.match(runs('image'),/docker manifest inspect "\$IMAGE:\$TAG"/);
 for(const arch of ['amd64','arm64']) assert.match(runs('image'),new RegExp(arch));
});

test('the install test pulls with no login and stable moves only afterwards, to the same digest', () => {
 const install=workflow.jobs['install-test'];
 assert.deepEqual(install.needs,['provenance','image']);
 assert.deepEqual(install.permissions,{contents:'read'});
 assert.equal(install.steps.some(step=>/login/.test(step.uses||'')||/docker login/.test(step.run||'')),false);
 assert.match(runs('install-test'),/sh install\.sh/);
 assert.match(runs('install-test'),/ls -A/);
 // The first push creates the package private; an anonymous read names the one-time fix before the install fails on it.
 const anonymous=install.steps.findIndex(step=>/docker manifest inspect "\$IMAGE@\$DIGEST"/.test(step.run||''));
 const installing=install.steps.findIndex(step=>/sh install\.sh/.test(step.run||''));
 assert.ok(anonymous>=0&&anonymous<installing);
 assert.match(install.steps[anonymous].run,/::error::/);
 assert.match(install.steps[anonymous].run,/packages\/container\/.*\/settings/);
 assert.match(install.steps[anonymous].run,/Public/);
 assert.doesNotMatch(workflowText,/the package is public/i);
 // The GitHub Release exists only once the install test passed; a re-run of the tag replaces its files.
 const release=workflow.jobs.release;
 assert.deepEqual(release.needs,['provenance','image','install-test']);
 assert.equal(release.steps.find(step=>/gh release create/.test(step.run||'')).env.TAG_NAME,'${{ needs.provenance.outputs.release }}');
 assert.deepEqual(release.permissions,{contents:'write'});
 const files=release.steps.find(step=>/gh release create/.test(step.run||''))?.run;
 assert.match(files,/gh release create "\$TAG_NAME" release\/docker-compose\.install\.yml release\/install\.sh/);
 assert.match(files,/gh release upload "\$TAG_NAME" release\/docker-compose\.install\.yml release\/install\.sh .*--clobber/);
 // Promotion comes after the Release, one at a time across every tag.
 const promote=workflow.jobs.promote;
 assert.deepEqual(promote.needs,['provenance','image','release']);
 assert.deepEqual(promote.permissions,{contents:'read',packages:'write'});
 assert.deepEqual(promote.concurrency,{group:'release-promote','cancel-in-progress':false});
});

// Runs the promote step with gh and docker replaced: releases, their compose assets and the registry's tags.
function promote(t,{releases,tag}) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-promote-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const step=workflow.jobs.promote.steps.find(step=>/stable/.test(step.name||''));
 const image='ghcr.io/omarabdo516/gtmworks';
 const digestOf=version=>`sha256:${version.replace(/\D/g,'').padStart(64,'0')}`;
 const script=`set -eo pipefail
digest_of() { printf 'sha256:%064d' "$(printf '%s' "$1" | tr -dc 0-9)"; }
gh() {
 case "$1 $2" in
  'release list') printf '%s\\n' $RELEASES;;
  'release download') printf 'services:\\n  web:\\n    image: %s:%s@%s\\n  worker:\\n    image: %s:%s@%s\\n' "$IMAGE" "\${3#v}" "$(digest_of "$3")" "$IMAGE" "\${3#v}" "$(digest_of "$3")";;
  *) return 1;;
 esac
}
docker() {
 local d targets name
 printf '%s\\n' "$*" >> "$STATE/log"
 case "$1 $2 $3" in
  'buildx imagetools inspect') if [[ $4 == *@* ]]; then d=\${4#*@}; else d=$(cat "$STATE/\${4##*:}"); fi; printf '{"digest":"%s"}\\n' "$d";;
  'buildx imagetools create') shift 3; targets=(); while [[ $1 == -t ]]; do targets+=("$2"); shift 2; done
   for name in "\${targets[@]}"; do printf '%s' "\${1#*@}" > "$STATE/\${name##*:}"; done;;
 esac
}
${step.run}`;
 const result=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,IMAGE:image,GITHUB_REPOSITORY:'omarabdo516/gtmworks',
  RELEASES:releases.join(' '),TAG_NAME:tag,DIGEST:digestOf(tag),GH_TOKEN:'',STATE:directory}});
 const moved=name=>existsSync(join(directory,name))?readFileSync(join(directory,name),'utf8'):null;
 return {result,stable:moved('stable'),latest:moved('latest'),digestOf};
}

test('stable and latest always end on the highest published release, whichever tag finishes last', t => {
 const releases=['v1.2.1','v1.10.0','v1.9.3','v2.0.0-rc1','nightly'];
 // An older version whose run finishes after a newer one, and a hotfix of an older line: neither moves stable back.
 for(const tag of ['v1.9.3','v1.2.1','v1.10.0']) {
  const run=promote(t,{releases,tag});
  assert.equal(run.result.status,0,run.result.stderr);
  assert.equal(run.stable,run.digestOf('v1.10.0'),tag);
  assert.equal(run.latest,run.digestOf('v1.10.0'),tag);
  assert.match(run.result.stdout,new RegExp(`highest release: v1\\.10\\.0 .*@${run.digestOf('v1.10.0')}`));
 }
 const none=promote(t,{releases:['nightly'],tag:'v1.0.0'});
 assert.notEqual(none.result.status,0);
 assert.equal(none.stable,null);
});

// Runs the provenance step with gh replaced by GitHub's API answers from files; a list answer is a stream of pages.
const repo='omarabdo516/gtmworks',sha='1'.repeat(40),other='2'.repeat(40);
const ghShim=`gh() {
 [[ $1 == api ]] || return 1; shift
 printf '%s\\n' "$*" >> "$STUB/calls"
 [[ $1 == --paginate ]] && shift
 local url=$1 file; shift
 case "$url" in
  */commits/main) file=main;;
  */git/ref/tags/*) file=ref;;
  */git/tags/*) file=annotated;;
  */compare/*) file=compare;;
  */actions/workflows/ci.yml/runs'?'*) file=runs;;
  */actions/runs/*/jobs'?'*) file=\${url#*/actions/runs/}; file=jobs-\${file%%/*};;
  *) echo "unexpected gh api $url" >&2; return 1;;
 esac
 [[ -f $STUB/$file ]] || { echo "gh: HTTP 404 $url" >&2; return 1; }
 if [[ \${1:-} == --jq ]]; then jq -r "$2" "$STUB/$file"; else cat "$STUB/$file"; fi
}`;
const ciRun=(id,changes={})=>({id,head_sha:sha,event:'push',head_branch:'main',head_repository:{full_name:repo},conclusion:'success',...changes});
const pages=(...list)=>list.map(page=>JSON.stringify(page)).join('\n');
function reviewedTag() {
 return {
  ref:{object:{type:'commit',sha}},
  compare:{status:'ahead'},
  // Decoys first; the proving run is on the second page.
  runs:pages({workflow_runs:[ciRun(5,{event:'pull_request'}),ciRun(6,{conclusion:'failure'}),ciRun(8,{head_repository:{full_name:'someone/gtmworks'}})]},
   {workflow_runs:[ciRun(7)]}),
  'jobs-5':{jobs:[{name:'check',conclusion:'success'}]},
  'jobs-6':{jobs:[{name:'check',conclusion:'success'}]},
  'jobs-8':{jobs:[{name:'check',conclusion:'success'}]},
  'jobs-7':pages({jobs:[{name:'static',conclusion:'success'}]},{jobs:[{name:'check',conclusion:'success'}]}),
 };
}
function provenance(t,{path='.github/workflows/release-tag.yml',branch='v1.2.3',head=sha,files=reviewedTag()}={}) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-provenance-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const [name,content] of Object.entries(files)) if(content!==undefined) writeFileSync(join(directory,name),typeof content==='string'?content:JSON.stringify(content));
 const output=join(directory,'output');
 writeFileSync(output,'');
 const step=workflow.jobs.provenance.steps.find(step=>step.id==='provenance');
 const result=spawnSync('bash',['-c',`set -eo pipefail\n${ghShim}\n${step.run}`],{encoding:'utf8',env:{...process.env,STUB:directory,
  GITHUB_OUTPUT:output,GITHUB_REPOSITORY:repo,GH_TOKEN:'',WORKFLOW_PATH:path,EVENT:'push',HEAD_BRANCH:branch,HEAD_SHA:head}});
 const outputs=Object.fromEntries(readFileSync(output,'utf8').split('\n').filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
 const calls=existsSync(join(directory,'calls'))?readFileSync(join(directory,'calls'),'utf8'):'';
 return {result,outputs,calls};
}

test('a tag publishes only its exact commit, reviewed onto main and passed by the required CI check on a main push', t => {
 const step=workflow.jobs.provenance.steps.find(step=>step.id==='provenance');
 assert.equal(step.env.HEAD_SHA,'${{ github.event.workflow_run.head_sha }}');
 assert.equal(step.env.HEAD_BRANCH,'${{ github.event.workflow_run.head_branch }}');
 assert.equal(step.env.WORKFLOW_PATH,'${{ github.event.workflow_run.path }}');
 for(const [name,output] of [['sha','sha'],['tag','tag'],['release','release']]) assert.equal(workflow.jobs.provenance.outputs[name],`\${{ steps.provenance.outputs.${output} }}`);
 const proven=provenance(t);
 assert.equal(proven.result.status,0,proven.result.stderr);
 assert.deepEqual(proven.outputs,{sha,tag:'1.2.3',release:'v1.2.3'});
 assert.match(proven.result.stdout,/CI run 7/);
 // Every list is read page by page for this exact commit, and the jobs of the run's latest attempt only.
 assert.match(proven.calls,new RegExp(`--paginate repos/${repo}/actions/workflows/ci\\.yml/runs\\?event=push&branch=main&head_sha=${sha}&per_page=100`));
 assert.match(proven.calls,/--paginate repos\/omarabdo516\/gtmworks\/actions\/runs\/7\/jobs\?filter=latest&per_page=100/);
 assert.match(proven.calls,new RegExp(`compare/${sha}\\.\\.\\.main`));
 // An annotated tag is followed to its commit.
 const annotated=provenance(t,{files:{...reviewedTag(),ref:{object:{type:'tag',sha:other}},annotated:{object:{type:'commit',sha}}}});
 assert.equal(annotated.result.status,0,annotated.result.stderr);
 assert.equal(annotated.outputs.sha,sha);
});

test('an unreviewed, moved, unchecked or malformed tag publishes nothing', t => {
 const refused=(name,options)=>{
  const run=provenance(t,options);
  assert.notEqual(run.result.status,0,name);
  assert.deepEqual(run.outputs,{},name);
  assert.match(run.result.stderr,/::error::/,name);
  return run;
 };
 const files=changes=>({...reviewedTag(),...changes});
 // A commit that never reached main: a side branch, or main moved on without it.
 refused('diverged',{files:files({compare:{status:'diverged'}})});
 refused('behind',{files:files({compare:{status:'behind'}})});
 // The tag was moved to another commit, or a re-run of a run whose tag has moved since.
 refused('moved',{files:files({ref:{object:{type:'commit',sha:other}}})});
 refused('tag gone',{files:files({ref:undefined})});
 // CI never passed for it as a push to main: only decoys, the check job failed on the latest attempt, or no check job.
 refused('decoys only',{files:files({runs:reviewedTag().runs.split('\n')[0]})});
 refused('check failed',{files:files({'jobs-7':pages({jobs:[{name:'check',conclusion:'failure'}]})})});
 refused('no check job',{files:files({'jobs-7':pages({jobs:[{name:'static',conclusion:'success'}]})})});
 refused('check skipped',{files:files({'jobs-7':pages({jobs:[{name:'check',conclusion:'skipped'}]})})});
 refused('another commit',{files:files({runs:pages({workflow_runs:[ciRun(7,{head_sha:other})]})})});
 refused('no tag name',{branch:'v1.2'});
 refused('a branch',{branch:'release'});
 refused('another workflow',{path:'.github/workflows/other.yml'});
 refused('short sha',{head:'abc123'});
});

test('main publishes only the reviewed head of main whose required CI check passed', t => {
 const mainFiles=head=>({...reviewedTag(),main:{sha:head}});
 const proven=provenance(t,{path:'.github/workflows/ci.yml',branch:'main',files:mainFiles(sha)});
 assert.equal(proven.result.status,0,proven.result.stderr);
 assert.deepEqual(proven.outputs,{sha,tag:'main',release:''});
 // A re-run of an old main run, or an older commit whose CI finished late: nothing is published, without failing.
 const stale=provenance(t,{path:'.github/workflows/ci.yml',branch:'main',files:mainFiles(other)});
 assert.equal(stale.result.status,0,stale.result.stderr);
 assert.deepEqual(stale.outputs,{sha:'',tag:'',release:''});
 assert.match(stale.result.stdout,/::notice::/);
 const failed=provenance(t,{path:'.github/workflows/ci.yml',branch:'main',files:{...mainFiles(sha),'jobs-7':pages({jobs:[{name:'check',conclusion:'failure'}]})}});
 assert.notEqual(failed.result.status,0);
 assert.deepEqual(failed.outputs,{});
 const branch=provenance(t,{path:'.github/workflows/ci.yml',branch:'feature',files:mainFiles(sha)});
 assert.notEqual(branch.result.status,0);
});

test('the README names the one-time step that makes the private package public, and backing up before an update', () => {
 const releases=readFileSync('README.md','utf8').split(/^## Releases$/m)[1]?.split(/^## /m)[0];
 assert.ok(releases,'README has a Releases section');
 assert.match(releases,/private/);
 assert.match(releases,/Change visibility/);
 assert.match(releases,/re-run/i);
 assert.match(releases,/[Bb]ack up before/);
});

test('the release workflow writes packages with the job token only and runs on standard runners', () => {
 assert.deepEqual(workflow.jobs.image.permissions,{contents:'read',packages:'write'});
 const secrets=workflowText.split('\n').filter(line=>/\bsecrets\./.test(line)&&!/\bsecrets\.GITHUB_TOKEN\b/.test(line));
 assert.deepEqual(secrets,[]);
 for(const [name,job] of Object.entries(workflow.jobs)) assert.equal(job['runs-on'],'ubuntu-latest',name);
});
