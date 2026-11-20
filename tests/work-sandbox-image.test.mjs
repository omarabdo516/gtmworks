import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dockerfile, pinnedBase, workSandboxBase } from '../lib/work-sandbox-image.mjs';
import { installJob } from './install-job.mjs';

// The work sandbox is built on the Engine's own sandbox image, the one the pinned Engine uses for its sandboxed terminal
// and screen. A tag alone can be pushed again upstream, so the build file pins the release's tag and the reviewed bytes'
// digest, in one place (#392). The image's own behaviour is proven against a built image by scripts/check-work-sandbox.mjs.

const base = 'nousresearch/hermes-sandbox:desktop@sha256:' + 'a'.repeat(64);

test('the work sandbox is built on the Engine\'s own sandbox image', () => {
  assert.match(workSandboxBase(), /^nousresearch\/hermes-sandbox:[\w.-]+@sha256:[a-f0-9]{64}$/);
});

test('a base pinned by tag alone is refused', () => {
  assert.throws(() => pinnedBase(`FROM nousresearch/hermes-sandbox:desktop\n`), /pinned by tag and digest/);
});

test('a base pinned by digest alone is refused', () => {
  assert.throws(() => pinnedBase(`FROM nousresearch/hermes-sandbox@sha256:${'a'.repeat(64)}\n`), /pinned by tag and digest/);
});

test('a base pinned by tag and a digest that is not sha256 is refused', () => {
  assert.throws(() => pinnedBase('FROM nousresearch/hermes-sandbox:desktop@sha256:short\n'), /pinned by tag and digest/);
});

test('the pin is written once, and a later stage builds on the stage before it', () => {
  const text = readFileSync(dockerfile, 'utf8');
  const digest = workSandboxBase().split('@')[1];
  assert.equal(text.split(digest).length - 1, 1, 'the base digest appears once in the build file');
  assert.equal(pinnedBase(`FROM ${base} AS build\nFROM build\n`), base);
});

test('a build file with no base image, or with two, is refused', () => {
  assert.throws(() => pinnedBase('RUN true\n'), /names one base image/);
  assert.throws(() => pinnedBase(`FROM ${base}\nFROM ${base}\n`), /names one base image/);
});

// The install job is where the image's behavior is proven (#392): it runs the check against the image the install got,
// after the install has fetched or built it, and fails unless the check ends on its one ok line.
test('the install job checks the work sandbox image the install got and requires its ok line', () => {
  const install = installJob();
  const run = install.steps.map(step => step.run || '').join('\n');
  assert.match(run, /cat \.work-sandbox-image/);
  assert.match(run, /node scripts\/check-work-sandbox\.mjs --image "\$sandbox_image"/);
  assert.match(run, /grep -qx 'work sandbox: ok'/);
  // The check runs in the install proof's own script, after the install that fetched the image.
  assert.ok(run.indexOf('check-work-sandbox.mjs') > run.indexOf('sh scripts/install.sh'));
});

test('the README states the image size on disk and that every Company\'s sandbox runs it', () => {
  const readme = readFileSync('README.md', 'utf8').replace(/\s+/g, ' ');
  const install = readme.split(/^### From source$/m)[0];
  assert.match(install, /3\.26 GB/);
  assert.match(install, /every Company's (work )?sandbox runs it/i);
});
