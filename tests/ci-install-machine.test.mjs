import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The install machine (#608): every image the install proof runs from a registry is listed once in
// scripts/ci-install-machine.sh, which `./ci.sh install` loads from the host, and the script starts and removes CI's
// isolated Docker machine wherever a job does.
const run = (...args) => spawnSync('bash', ['scripts/ci-install-machine.sh', ...args], { encoding: 'utf8' });

test('the images are the install\'s pinned images and the checks\' helpers, each once, never one the run builds', () => {
  const out = run('images');
  assert.equal(out.status, 0, out.stderr);
  const images = out.stdout.trim().split('\n');
  for (const image of [
    'supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
    'nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284',
    'nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002',
    'alpine:3.21', 'node:22.14.0-alpine3.21', 'curlimages/curl:8.12.1', 'registry:2.8.3',
    'mcr.microsoft.com/playwright:v1.64.1-noble',
  ]) assert.ok(images.includes(image), `${image} is listed`);
  for (const image of images) {
    assert.doesNotMatch(image, /^gtmworks/, 'the run builds its own images');
    assert.doesNotMatch(image, /\$/, 'a variable is no image');
  }
  assert.deepEqual(images, [...new Set(images)].sort(), 'each once, in order');
});

// A stand-in `docker` that writes each call on a line of its own and answers `info` once the machine has been started.
function withDocker(body) {
  const dir = mkdtempSync(join(tmpdir(), 'install-machine-'));
  try {
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/calls"
case "$*" in *' info') grep -q -- '--name install-docker' "${dir}/calls";; esac
`);
    chmodSync(join(dir, 'docker'), 0o755);
    const call = (...args) => spawnSync('bash', ['scripts/ci-install-machine.sh', ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    const calls = () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : []);
    return body({ call, calls });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('start removes what a reused runner kept, starts the machine on 127.0.0.1:2375 and waits for it', () => withDocker(({ call, calls }) => {
  const out = call('start');
  assert.equal(out.status, 0, out.stderr);
  const [leftover, machine, ...waits] = calls();
  assert.equal(leftover, 'rm -fv install-docker', 'an earlier run\'s machine goes first');
  assert.match(machine, /^run -d --privileged --name install-docker -e DOCKER_TLS_CERTDIR= -p 127\.0\.0\.1:2375:2375 -v \S+ docker:28\.5\.1-dind$/);
  assert.ok(waits.length > 0 && waits.every(line => line === '--host tcp://127.0.0.1:2375 info'), 'it waits for the machine');
}));

test('stop removes the machine and is no failure when there is none', () => withDocker(({ call, calls }) => {
  const out = call('stop');
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(calls(), ['rm -fv install-docker']);
}));
