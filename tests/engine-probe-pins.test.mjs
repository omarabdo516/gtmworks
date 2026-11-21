import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { workSandboxBase } from '../lib/work-sandbox-image.mjs';

// docs/engine-probes/work-sandbox-ssh.md is the live proof the work sandbox rests on (#390): the pinned Engine running an
// Agent's terminal, files and code in a second container over the `ssh` backend. It is worth nothing if it was made on
// another Engine or another sandbox image, so the probe's two images are tied here to the ones the install ships. A bump
// of either pin without re-running the probe fails this test, which is the moment the boundary has to be re-read.

const probe = readFileSync('docs/engine-probes/work-sandbox-ssh/run.sh', 'utf8');
// The Engine pin lives in the Company's Engine template since #378; the install's compose file no longer names it.
const template = readFileSync('scripts/engine-template.yml', 'utf8');
const compose = readFileSync('docker-compose.install.yml', 'utf8');
const pinnedIn = name => new RegExp(`^${name}=(\\S+)$`, 'm').exec(probe)?.[1] ?? null;

test('the probe runs on the Engine the install pins', () => {
  const engine = pinnedIn('ENGINE');
  assert.match(engine ?? '', /^nousresearch\/hermes-agent:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/);
  // The Engine template's one image line for it: a bump there without the probe leaves this red.
  assert.equal(template.split(`image: ${engine}`).length, 2, 'scripts/engine-template.yml pins the probe\'s Engine once');
  assert.equal((template + compose).split(engine).length, 2, 'the probe\'s Engine pin appears once in the install');
});

test('the probe\'s second container is the install\'s own work sandbox image', () => {
  // The sandbox's build file names the Engine's sandbox image by tag and digest; the probe names the same reference, so
  // the container it measures is the image every Company's sandbox runs.
  assert.equal(pinnedIn('SANDBOX'), workSandboxBase());
});

test('the install pins the same backend the probe measured, in the file the Engine template mounts', () => {
  // scripts/engine-managed.yml is what an install mounts read-only at the managed scope. It must say what the probe
  // proved works: the `ssh` backend, the network alias, the user and the port the image's sshd listens on. Only the key's
  // path is the install's own (/opt/data/ssh), not the probe's throwaway folder.
  const probe = Object.fromEntries([...readFileSync('docs/engine-probes/work-sandbox-ssh/managed-config.yaml', 'utf8')
    .matchAll(/^\s{2}(\w+):\s*(\S+)$/gm)].map(([, key, value]) => [key, value]));
  const install = load(readFileSync('scripts/engine-managed.yml', 'utf8')).terminal;
  for (const key of ['backend', 'ssh_host', 'ssh_user', 'ssh_port']) assert.equal(String(install[key]), probe[key], key);
  assert.equal(install.ssh_key, '/opt/data/ssh/id_ed25519', 'the Engine\'s own key, in its data volume');
  // The template mounts it where the managed scope is read from, read-only.
  assert.match(readFileSync('scripts/engine-template.yml', 'utf8'), /\.\/engine-managed\.yml:\/etc\/hermes\/config\.yaml:ro/);
});

test('the probe starts the Engine with its backend pinned in the managed configuration', () => {
  const managed = readFileSync('docs/engine-probes/work-sandbox-ssh/managed-config.yaml', 'utf8');
  const pinned = Object.fromEntries([...managed.matchAll(/^\s{2}(\w+):\s*(\S+)$/gm)].map(([, key, value]) => [key, value]));
  assert.equal(pinned.backend, 'ssh');
  assert.equal(pinned.ssh_user, 'pn');
  assert.equal(pinned.ssh_port, '2222', 'the port sandbox/Dockerfile\'s sshd listens on');
  for (const key of ['ssh_host', 'ssh_key']) assert.ok(pinned[key], `the managed configuration pins ${key}`);
  // The managed file is the one the probe mounts read-only at the Engine's managed-scope directory, the only place a
  // managed pin is read from (hermes_cli/managed_scope.py).
  assert.match(probe, /managed-config\.yaml:\/etc\/hermes\/config\.yaml:ro/);
});
