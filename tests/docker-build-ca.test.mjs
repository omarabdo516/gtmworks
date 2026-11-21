import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

// #562: a cloud session's network re-signs every TLS connection with the session's own CA, which the host's Node trusts
// through NODE_EXTRA_CA_CERTS and an image build does not. The app image's builds go through scripts/docker-build.sh,
// which hands that CA to the build as a BuildKit secret when the file is there; the Dockerfile's npm steps trust it only
// while they run, so nothing of it is in the image, and a build without it (CI, a release) is the build it always was.
const root=process.cwd();
const read=path=>readFileSync(join(root,path),'utf8');

// The helper with a stand-in docker that writes its arguments, one per line.
function build(env) {
 const dir=mkdtempSync(join(tmpdir(),'docker-build-ca-'));
 try {
  mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'bin/docker'),`#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${dir}/args"\n`);
  chmodSync(join(dir,'bin/docker'),0o755);
  const ca=join(dir,'ca.crt');
  writeFileSync(ca,'-----BEGIN CERTIFICATE-----\n');
  const result=spawnSync('bash',[join(root,'scripts/docker-build.sh'),'-q','-t','gtmworks:ci','.'],{encoding:'utf8',
   env:{PATH:`${join(dir,'bin')}:/usr/bin:/bin`,...env(ca,dir)}});
  assert.equal(result.status,0,result.stderr);
  return readFileSync(join(dir,'args'),'utf8').trim().split('\n').map(arg=>arg.replaceAll(dir,'<dir>'));
 } finally { rmSync(dir,{recursive:true,force:true}); }
}

test('the helper hands the CA the host trusts to the build as a secret, and only when that file is there',()=>{
 assert.deepEqual(build(ca=>({NODE_EXTRA_CA_CERTS:ca})),['build','--secret','id=build-ca,src=<dir>/ca.crt','-q','-t','gtmworks:ci','.']);
 // No CA, an empty name or a missing file: the plain build CI and a release run.
 for(const env of [()=>({}),()=>({NODE_EXTRA_CA_CERTS:''}),(_,dir)=>({NODE_EXTRA_CA_CERTS:join(dir,'missing.crt')})])
  assert.deepEqual(build(env),['build','-q','-t','gtmworks:ci','.']);
});

test('every npm step of the Dockerfile trusts the build CA only while it runs, and the image keeps nothing of it',()=>{
 const dockerfile=read('Dockerfile');
 const runs=dockerfile.replace(/\\\n/g,' ').split('\n').filter(line=>/^RUN\b/.test(line));
 const npm=runs.filter(line=>/\bnpm (ci|run build)\b/.test(line));
 // Both dependency installs and the build, which also fetches the Google fonts.
 assert.equal(npm.length,3,npm.join('\n'));
 for(const line of npm) {
  assert.match(line,/^RUN --mount=type=secret,id=build-ca\s/,line);
  // A build given no secret has no file there and sets nothing.
  assert.match(line,/if \[ -f \/run\/secrets\/build-ca \]; then export NODE_EXTRA_CA_CERTS=\/run\/secrets\/build-ca; fi;/,line);
 }
 // No image setting names the CA or a proxy: the secret is mounted for one step and never written to a layer.
 for(const line of dockerfile.split('\n').filter(line=>/^(ENV|ARG|COPY|ADD)\b/.test(line)))
  assert.doesNotMatch(line,/build-ca|NODE_EXTRA_CA_CERTS|proxy/i,line);
});

test('the app image is built through the helper wherever a script builds it from a checkout',()=>{
 const scripts=['ci.sh','scripts/ci-image.sh','scripts/proxy-stack.sh','scripts/ci-install-lib.sh','scripts/ci-install-check.sh'];
 const builds=scripts.flatMap(path=>read(path).split('\n').filter(line=>/docker(-build\.sh| build)\b/.test(line)).map(line=>({path,line})));
 // The app image's builds: a context of the checkout itself or another commit's checkout.
 // The checkout here, another commit's checkout (release_image) or the install lane's throwaway checkout of HEAD.
 const checkoutContext=/ (\.|"\$source"|"\$work\/src")( |$)/;
 const app=builds.filter(({line})=>checkoutContext.test(line));
 assert.ok(app.length>=5,JSON.stringify(app));
 for(const {path,line} of app) assert.match(line,/bash scripts\/docker-build\.sh /,`${path}: ${line}`);
});

test('the local install lane builds the app image on this host and hands it to the proof as prebuilt, as CI does',()=>{
 const lane=read('ci.sh').split('\n install)')[1].split('\n  ;;')[0];
 const build=lane.indexOf('bash scripts/docker-build.sh -q -t "$web_tag" "$work/src"');
 assert.ok(build>0,'the app image is built through the helper');
 assert.ok(build<lane.indexOf('docker save $images'),'before the images are loaded into the machine');
 assert.match(lane,/images="\$images \$sandbox_tag \$web_tag"/);
 assert.match(lane,/export GTMWORKS_IMAGE_PREBUILT=true/);
 // Under the tag the compose file's web service names, which the installer runs instead of building (#411).
 assert.match(lane,/web_tag=\$\(sed -n '\/\^  web:\$\/,\/\^  \[a-z\]\/s\/\^    image: \/\/p' "\$work\/src\/docker-compose.install.yml"/);
});

test('CI builds the image as before: the workflows hand no secret to the image builds',()=>{
 for(const path of ['.github/workflows/ci.yml','.github/workflows/release.yml']) {
  const steps=Object.values(load(read(path)).jobs).flatMap(job=>job.steps??[]);
  const builds=steps.filter(step=>(step.uses??'').startsWith('docker/build-push-action@'));
  assert.ok(builds.length>0,path);
  for(const step of builds) for(const key of ['secrets','secret-files','secret-envs']) assert.equal(step.with?.[key],undefined,`${path}: ${step.name} ${key}`);
 }
});

test('the cloud session doc says how the image and integration jobs run in a cloud session',()=>{
 const doc=read('docs/agents/cloud-verify.md');
 assert.match(doc,/scripts\/docker-build\.sh/);
 assert.match(doc,/\.\/ci\.sh integration/);
});

test('the proxy suite reaches its own local proxy directly, never through the machine HTTPS_PROXY',()=>{
 // A cloud session's proxy cannot reach the made-up host app.gtmworks.test and answers 502 (#562).
 const curls=read('scripts/proxy-stack.sh').split('\n').filter(line=>/^\s*curl\b/.test(line));
 assert.ok(curls.length>=2,curls.join('\n'));
 for(const line of curls) assert.match(line,/ --noproxy '\*' /,line);
});

test('the install lane machine trusts the machine extra CA beside its own roots, and only when there is one',()=>{
 const start=read('scripts/install-lane-machine.sh').split('\n start)')[1].split('\n  ;;')[0];
 assert.match(start,/if \[\[ -n \$\{NODE_EXTRA_CA_CERTS:-\} && -f \$NODE_EXTRA_CA_CERTS \]\]; then/);
 // SSL_CERT_DIR adds a folder to the default one, so the machine's own roots stay.
 assert.match(start,/-v "\$NODE_EXTRA_CA_CERTS:\/etc\/gtmworks-extra-ca\/extra\.crt:ro" -e SSL_CERT_DIR=\/etc\/ssl\/certs:\/etc\/gtmworks-extra-ca/);
 assert.match(start,/docker run -d --privileged [^\n]*\\\n\s+\$\{ca\[@\]\+"\$\{ca\[@\]\}"\} -v "\$work\/src:\$work\/src" docker:/);
});
