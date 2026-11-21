import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { chromiumFolders, dockerfile, pinnedBase, workSandboxBase } from '../lib/work-sandbox-image.mjs';
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

test('a FROM with flags counts, so a second unpinned base behind --platform is refused', () => {
  const pin = `nousresearch/hermes-sandbox:desktop@sha256:${'a'.repeat(64)}`;
  assert.equal(pinnedBase(`FROM --platform=linux/amd64 ${pin} AS base\nFROM base\n`), pin);
  assert.throws(() => pinnedBase(`FROM ${pin}\nFROM --platform=linux/amd64 alpine:latest\n`), /names one base image; this one names 2/);
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
  assert.match(run, /node scripts\/check-work-sandbox\.mjs --image "\$\(cat \.work-sandbox-image\)"/);
  assert.match(run, /grep -qx 'work sandbox: ok'/);
  // The check runs in the install proof's own script, after the install that fetched the image.
  assert.ok(run.indexOf('check-work-sandbox.mjs') > run.indexOf("install_source first-install.log || fail 'first install'"));
});

test('the README states the image size on disk and that every Company\'s sandbox runs it', () => {
  const readme = readFileSync('README.md', 'utf8').replace(/\s+/g, ' ');
  const install = readme.split(/^### From source$/m)[0];
  assert.match(install, /3\.81 GB/);
  assert.match(install, /every Company's (work )?sandbox runs it/i);
});

// Every release file the install proof writes for this release pins the work sandbox image (#392): a call that names
// none makes release files the installer refuses. Only the releases before it, each built from its own older script, name
// none: the previous release before the Engines and the release before the work sandbox (#397); and one release names an
// image that cannot be pulled on purpose, the update that must stop before its migrations (#397).
test('every release file the install proof writes for this release names the work sandbox image', () => {
  const run = installJob().steps.map(step => step.run || '').join('\n');
  const calls = [...run.matchAll(/node scripts\/release-assets\.mjs ([^|]*)\)? \|\|/g)].map(([, args]) => args);
  assert.ok(calls.length >= 5, 'the proof writes release files');
  // The release that pins another work sandbox image (#399) names that one.
  for (const args of calls.filter(args => !args.startsWith('"$previous"') && !args.startsWith('"$before"') && !args.includes('"$unpulled"'))) assert.match(args, /"\$(other_|broken_)?sandbox"/, args);
});

// Playwright puts the base image's Chromium in a folder named for the platform: chrome-linux64 on amd64 and
// chrome-linux-arm64 on arm64 (#572: the arm64 release build found no chrome-linux64 and stopped). The build file names
// the folder for each platform it knows and refuses any other, so a platform the release builds and the build file does
// not know fails here, before a release run does.
test('the build file names the Chromium folder of every platform the release builds the sandbox for, and refuses others', () => {
  const release = load(readFileSync('.github/workflows/release.yml', 'utf8'));
  const sandbox = release.jobs.image.steps.find(step => step.id === 'sandbox');
  const architectures = sandbox.with.platforms.split(',').map(platform => platform.trim().replace(/^linux\//, ''));
  assert.deepEqual(architectures, ['amd64', 'arm64']);
  const folders = chromiumFolders(readFileSync(dockerfile, 'utf8'));
  for (const architecture of architectures) assert.ok(folders[architecture], `the build file names a Chromium folder for ${architecture}`);
  assert.equal(folders.amd64, 'chrome-linux64');
  assert.equal(folders.arm64, 'chrome-linux-arm64');
});

test('a build file whose browser step knows no folder for a platform, or takes any platform, is refused', () => {
  assert.throws(() => chromiumFolders('RUN chrome=$(find /opt/playwright -path "*/chrome-linux64/chrome")\n'), /names the Chromium folder of each platform/);
  assert.throws(() => chromiumFolders('RUN case "$arch" in amd64) folder=chrome-linux64 ;; esac\n'), /refuses a platform it does not know/);
});

// Pull requests build the work sandbox for amd64 alone, so CI also builds its browser stage for every platform the
// release builds (#572): a platform whose Chromium is not where the step looks fails a pull request, not a release.
test('CI builds the work sandbox\'s browser stage for every platform the release builds it for', () => {
  const release = load(readFileSync('.github/workflows/release.yml', 'utf8')).jobs.image.steps.find(step => step.id === 'sandbox');
  const steps = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.image.steps;
  const browser = steps.find(step => step.uses?.startsWith('docker/build-push-action@') && step.with?.target === 'browser');
  assert.ok(browser, 'the image job builds the browser stage');
  assert.equal(browser.with.context, 'sandbox');
  assert.equal(browser.with.platforms, release.with.platforms);
  assert.match(readFileSync(dockerfile, 'utf8'), /^FROM \S+ AS browser$/m);
  // The emulator is set up before the build that needs it.
  const qemu = steps.findIndex(step => step.uses?.startsWith('docker/setup-qemu-action@'));
  assert.ok(qemu >= 0 && qemu < steps.indexOf(browser), 'arm64 is emulated before the browser stage builds');
});
