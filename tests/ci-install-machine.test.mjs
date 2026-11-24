import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The install machine's images (#608): every image the install proof runs from a registry is listed once, in
// scripts/ci-install-machine.sh. The ones on Docker Hub go through the run's pull-through mirror, whose storage the
// Actions cache keeps under a key made of that list, so an area pulls them from the runner instead of from the registry.
const run = (...args) => spawnSync('bash', ['scripts/ci-install-machine.sh', ...args], { encoding: 'utf8' });
const lines = out => out.stdout.trim().split('\n');

test('the mirrored images are the install\'s pinned Docker Hub images and the checks\' helpers, never a local or another registry\'s', () => {
  const out = run('mirrored');
  assert.equal(out.status, 0, out.stderr);
  const images = lines(out);
  for (const image of [
    'supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
    'nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284',
    'nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002',
    'alpine:3.21', 'node:22.14.0-alpine3.21', 'curlimages/curl:8.12.1',
  ]) assert.ok(images.includes(image), `${image} is mirrored`);
  for (const image of images) {
    assert.doesNotMatch(image, /^gtmworks/, 'the run builds its own images');
    assert.doesNotMatch(image, /\$/, 'a variable is no image');
    assert.doesNotMatch(image, /^[^/]*[.:][^/]*\//, `${image} is on Docker Hub, the one registry the mirror serves`);
  }
  assert.deepEqual(images, [...new Set(images)].sort(), 'each once, in order');
  // Every image `./ci.sh install` loads from the host is listed here too, the other registries' among them.
  assert.ok(lines(run('images')).includes('mcr.microsoft.com/playwright:v1.64.1-noble'));
});

test('the mirror\'s cache key names the mirrored list, so a new pin is a new key', () => {
  const key = run('key');
  assert.equal(key.status, 0, key.stderr);
  assert.match(key.stdout.trim(), /^install-images-[0-9a-f]{16}$/);
  assert.equal(run('key').stdout, key.stdout, 'the same list is the same key');
});

// A stand-in `docker` that writes each call on a line of its own and answers `info` once the machine has been started.
function withDocker(body) {
  const dir = mkdtempSync(join(tmpdir(), 'install-machine-'));
  try {
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/calls"
case "$*" in
  *' info') grep -q -- '--name install-docker' "${dir}/calls";;
  "$FAIL"*) exit 1;;
esac
`);
    chmodSync(join(dir, 'docker'), 0o755);
    // FAIL names the start of a call the stand-in fails.
    const call = (args, fail = 'never') => spawnSync('bash', ['scripts/ci-install-machine.sh', ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAIL: fail },
    });
    const calls = () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : []);
    return body({ dir, call, calls });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('start runs the mirror on the kept storage, then the machine with that mirror as its registry mirror', () => withDocker(({ dir, call, calls }) => {
  const storage = join(dir, 'install-mirror');
  const out = call(['start', storage]);
  assert.equal(out.status, 0, out.stderr);
  assert.ok(existsSync(storage), 'an empty storage is made on a cache miss');
  const leftovers = ['stop install-mirror', 'rm -fv install-docker install-mirror', 'network rm install-net'];
  assert.deepEqual(calls().slice(0, 3), leftovers, 'what a reused runner kept from an earlier run goes first');
  const [network, mirror, machine, info] = calls().slice(3);
  const answers = calls().find(line => line.startsWith('exec '));
  assert.equal(network, 'network create install-net');
  assert.match(mirror, /^run -d --name install-mirror --network install-net /);
  assert.ok(mirror.includes(`-v ${storage}:/var/lib/registry`), 'the mirror stores into the kept folder');
  assert.match(mirror, /-e REGISTRY_PROXY_REMOTEURL=https:\/\/registry-1\.docker\.io /, 'it mirrors Docker Hub');
  assert.match(mirror, /-e REGISTRY_PROXY_TTL=0 /, 'what it keeps never expires: a digest is the same bytes forever');
  assert.match(mirror, / registry:3\.1\.2@sha256:[0-9a-f]{64}$/, 'the mirror\'s own image is pinned');
  assert.match(machine, /^run -d --privileged --name install-docker --network install-net .*-p 127\.0\.0\.1:2375:2375 /);
  assert.match(machine, / docker:28\.5\.1-dind --registry-mirror=http:\/\/install-mirror:5000 --insecure-registry=install-mirror:5000$/);
  assert.equal(info, '--host tcp://127.0.0.1:2375 info', 'it waits for the machine');
  assert.equal(answers, 'exec install-docker wget -q -O /dev/null http://install-mirror:5000/v2/', 'and for the mirror, as the machine sees it');
}));

test('a mirror that does not start leaves the machine to start alone and pull from the registry', () => withDocker(({ dir, call, calls }) => {
  const out = call(['start', join(dir, 'install-mirror')], 'run -d --name install-mirror');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /the mirror did not start; the machine pulls from the registry/);
  const machine = calls().find(line => line.startsWith('run -d --privileged --name install-docker'));
  assert.doesNotMatch(machine, /install-net|registry-mirror/, 'no mirror and no network of its');
  assert.ok(calls().lastIndexOf('network rm install-net') > calls().findIndex(line => line.startsWith('run -d --name install-mirror')), 'the network it made goes');
}));

test('warm saves nothing when the mirror does not answer', () => withDocker(({ dir, call, calls }) => {
  const out = call(['warm', join(dir, 'install-mirror')], 'exec install-docker wget');
  assert.notEqual(out.status, 0);
  assert.equal(calls().some(line => / pull /.test(line)), false, 'no pull would reach the storage');
}));

test('warm pulls every mirrored image through the machine, then removes the machine and the mirror', () => withDocker(({ dir, call, calls }) => {
  const out = call(['warm', join(dir, 'install-mirror')]);
  assert.equal(out.status, 0, out.stderr);
  const pulls = calls().filter(line => line.startsWith('--host tcp://127.0.0.1:2375 pull -q '));
  const names = pulls.map(line => line.split(' ').at(-1));
  assert.equal(names.length, lines(run('mirrored')).length, 'each mirrored image once');
  // By its name on the mirror, so a pull the mirror cannot serve fails instead of coming from Docker Hub.
  assert.ok(names.includes('install-mirror:5000/library/nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284'), names.join(' '));
  assert.ok(names.includes('install-mirror:5000/supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'));
  assert.ok(names.includes('install-mirror:5000/library/alpine:3.21'));
  for (const name of names) assert.match(name, /^install-mirror:5000\//);
  assert.deepEqual(calls().slice(-3), ['stop install-mirror', 'rm -fv install-docker install-mirror', 'network rm install-net'], 'the mirror stops, so the storage is whole before it is saved');
}));
