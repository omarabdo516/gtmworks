import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

// #711, vault decision 0068: the pinned Engine offers computer_use only when it finds cua-driver on its own disk
// (tools/computer_use/cua_backend_driver.py resolve_cua_driver_cmd, through HERMES_CUA_DRIVER_CMD), although with the
// Screen in the Company's sandbox the driver it runs is the sandbox's. Each Engine's start first copies the work sandbox
// image's own pinned driver into the Engine's data volume, where the Engine's setting names it. The install job proves
// on the pinned Engine that a Run is then offered computer_use and opens a page on the Screen.

const template = load(readFileSync('scripts/engine-template.yml', 'utf8'));
const { engine, sandbox } = template.services;
const driver = template.services['screen-driver'];

test("an Engine names a driver in its own data volume and starts only once the sandbox image's driver is copied there", () => {
  assert.equal(engine.environment.HERMES_CUA_DRIVER_CMD, '/opt/data/screen-driver/cua-driver');
  assert.ok(engine.volumes.includes('data:/opt/data'));
  assert.deepEqual(engine.depends_on, { 'screen-driver': { condition: 'service_completed_successfully' } });
  // The driver is the work sandbox's own, from the same pinned image the Company's sandbox runs.
  assert.ok(driver, 'the template has the screen-driver step');
  assert.equal(driver.image, sandbox.image);
  assert.deepEqual(driver.volumes, ['data:/opt/data']);
  // A one-off step that reaches nothing: no network, no restart, only the right to write into the Engine's folder.
  assert.equal(driver.network_mode, 'none');
  assert.equal(driver.restart, 'no');
  assert.deepEqual(driver.cap_drop, ['ALL']);
  assert.deepEqual(driver.cap_add, ['DAC_OVERRIDE']);
  assert.ok(driver.security_opt.includes('no-new-privileges:true'));
  assert.equal(driver.ports, undefined);
  assert.equal(driver.environment, undefined);
});

// The step's container stays after it exits, as Compose keeps a finished one. It is named from the Engine's folder as
// the sandbox and the exit are, and never `gtmworks-engine-…`, which counts Engines; whatever takes a Company's Engine
// away (a failed `company add`, a rolled-back update) removes it with them.
test("the step's container is named for its Company and goes with its Engine, its sandbox and its exit", () => {
  assert.equal(driver.container_name, '${SCREEN_DRIVER_NAME:-gtmworks-screen-driver}');
  const install = readFileSync('scripts/install.sh', 'utf8');
  assert.match(install, /^screen_driver_container\(\) \{ printf 'gtmworks-screen-driver-%s' "\$1"; \}$/m);
  assert.match(install, /^  SCREEN_DRIVER_NAME=\$\(screen_driver_container "\$slug"\) \\$/m);
  const removals = install.split('\n').filter(line => /docker rm -f .*\$\(exit_container /.test(line));
  assert.ok(removals.length >= 3, 'every removal of a sandbox and its exit');
  for (const line of removals) assert.match(line, /\$\(screen_driver_container "?\$?\w+"?\)/, line.trim());
});

// The step's own script, run here against a folder standing in for the Engine's volume and a sandbox image whose
// cua-driver is a link to the real file, as in the base image (/usr/local/bin/cua-driver -> /opt/cua-driver/cua-driver).
function step(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gtmworks-screen-driver-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'opt-cua'));
  mkdirSync(join(dir, 'data'));
  const real = join(dir, 'opt-cua', 'cua-driver');
  symlinkSync(real, join(dir, 'bin', 'cua-driver'));
  const [shell, flags, script] = driver.entrypoint;
  assert.equal(shell, 'sh');
  const body = script.replaceAll('$$', '$').replaceAll('/opt/data', join(dir, 'data'));
  const run = () => spawnSync(shell, [flags, body], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
  const copied = join(dir, 'data', 'screen-driver', 'cua-driver');
  return { real, copied, run };
}

test("the step copies the sandbox image's driver into the Engine's volume, runnable, and copies it again only when it changed", t => {
  const { real, copied, run } = step(t);
  writeFileSync(real, '#!/bin/sh\necho driver 0.28.2\n', { mode: 0o755 });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(copied, 'utf8'), '#!/bin/sh\necho driver 0.28.2\n');
  assert.equal(statSync(copied).mode & 0o777, 0o755);
  assert.equal(spawnSync(copied, { encoding: 'utf8' }).stdout, 'driver 0.28.2\n');
  // The same image again: the copy the Engine holds is left as it is.
  const kept = statSync(copied).ino;
  assert.equal(run().status, 0);
  assert.equal(statSync(copied).ino, kept);
  // An updated sandbox image brings its driver: the next start replaces the copy whole.
  writeFileSync(real, '#!/bin/sh\necho driver 0.29.0\n', { mode: 0o755 });
  assert.equal(run().status, 0);
  assert.equal(spawnSync(copied, { encoding: 'utf8' }).stdout, 'driver 0.29.0\n');
});

test('a sandbox image with no driver stops the step, so the Engine does not start without one', t => {
  const { run, copied } = step(t);
  const failed = run();
  assert.notEqual(failed.status, 0);
  assert.throws(() => statSync(copied));
});
