import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync, existsSync, statSync } from 'node:fs';
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
 *' cp -R /app/install/. /install/'*) umask 022; cp -R "$IMAGE_ROOT/." .;;
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
 return {directory,run:(...args)=>runWith({},...args),runWith,clear:()=>rmSync(env.COMMANDS,{force:true}),
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
 assert.match(commands[extract],new RegExp(`^run --rm --user \\d+:\\d+ -v ${release.directory}:/install ${app.replace(/[.]/g,'\\.')} cp -R \\/app\\/install\\/\\. \\/install\\/$`));
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
 assert.match(release.commands(),/up -d --no-deps --wait --wait-timeout 300 hermes web worker/);
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
 // A failed update leaves the release it runs recorded; a finished one records the new release.
 release.use(next);
 const failed=release.runWith({MIGRATION_EXIT:'3'},'update');
 assert.equal(failed.status,3,failed.stderr);
 assert.equal(release.installed(),`${app}\n`);
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

test('a vX.Y.Z tag and a main push whose CI passed start the release workflow', () => {
 assert.deepEqual(workflow.on.push.tags,['v[0-9]+.[0-9]+.[0-9]+']);
 assert.deepEqual(workflow.on.workflow_run,{workflows:['CI'],types:['completed'],branches:['main']});
 assert.match(workflow.jobs.image.if,/workflow_run\.conclusion == 'success'/);
 assert.match(workflow.jobs.image.if,/workflow_run\.event == 'push'/);
 const build=workflow.jobs.image.steps.find(step=>step.uses?.startsWith('docker/build-push-action@'));
 assert.equal(build.with.platforms,'linux/amd64,linux/arm64');
 assert.equal(build.with.push,true);
 assert.match(runs('image'),/docker manifest inspect "\$IMAGE:\$TAG"/);
 for(const arch of ['amd64','arm64']) assert.match(runs('image'),new RegExp(arch));
});

test('the install test pulls with no login and stable moves only afterwards, to the same digest', () => {
 const install=workflow.jobs['install-test'];
 assert.equal(install.needs,'image');
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
 const publish=workflow.jobs.publish;
 assert.deepEqual(publish.needs,['image','install-test']);
 assert.deepEqual(publish.permissions,{contents:'write',packages:'write'});
 const stable=publish.steps.find(step=>/stable/.test(step.name||''));
 assert.match(stable.name,/needs\.image\.outputs\.digest/);
 assert.match(stable.run,/imagetools create -t "\$IMAGE:stable" -t "\$IMAGE:latest" "\$IMAGE@\$DIGEST"/);
 // The digest read-back is proven on the release digest itself before anything moves.
 assert.match(stable.run,/digest\(\) \{ docker buildx imagetools inspect "\$1"/);
 const probe=stable.run.indexOf('$(digest "$IMAGE@$DIGEST") == "$DIGEST"');
 assert.ok(probe>=0&&probe<stable.run.indexOf('imagetools create'));
 const release=publish.steps.findIndex(step=>/gh release create/.test(step.run||''));
 assert.ok(release>publish.steps.indexOf(stable));
 assert.match(publish.steps[release].run,/docker-compose\.install\.yml/);
 assert.match(publish.steps[release].run,/install\.sh/);
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
