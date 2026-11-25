import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// #502: an update from the release that ran its one Engine in the install project's `hermes` service (before #378) stops
// that container, never removes it, until the first Company's Engine from the template answers. When that Engine or its
// work sandbox does not start, the old `hermes` container starts again, on the networks it had, with its key back in
// .env.install and no Engine folder, so the previous release's app and worker keep their Engine. The installer's own
// functions run here against a stand-in for Docker that keeps its containers in a file.

const install = readFileSync('scripts/install.sh', 'utf8');
const fn = name => {
  const start = install.indexOf(`\n${name}() {`);
  assert.ok(start >= 0, name);
  if (install.slice(start + 1).match(/^[a-z_]+\(\) \{ [^\n]*\}\n/)) return install.slice(start + 1, install.indexOf('\n', start + 1) + 1);
  return install.slice(start + 1, install.indexOf('\n}\n', start) + 3);
};
const helpers = ['engine_project', 'engine_folder', 'sandbox_container', 'exit_container', 'screen_driver_container', 'exit_network', 'work_volume', 'work_network',
  'host_key_volume', 'engine_names', 'engine_network_of', 'healthy_within', 'work_sandbox_ref', 'engine_key', 'adopt_engine_key', 'drop_install_env_key', 'write_engine_env',
  'keep_previous_engine', 'keep_previous_release', 'keep_sandbox_parts', 'previous_engine_files_back', 'previous_engine_files_kept_back', 'new_engine_files_removed', 'remove_new_sandbox_parts', 'stop_old_engine', 'remove_old_engine', 'restore_old_engine',
  'restore_previous_engine', 'first_engine_up'].map(fn).join('');

// The stand-in. Containers are lines `<id> <name> <state>` in state/containers; the old `hermes` container is the one whose
// name ends -hermes-1. Every call is logged on one line. `engine` (the template's Compose project) and `engine_start` are
// stand-ins too: a start that succeeds makes gtmworks-engine-first running, one that fails (ENGINE_FAILS) leaves it made
// and unhealthy, as a real failed start does.
const fakeDocker = `
docker() {
  { printf '%s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$state/log"
  case "$1" in
    ps)
      case "$*" in
        *-aq*com.docker.compose.service=hermes*) sed -n 's/^\\([^ ]*\\) [^ ]*-hermes-1 .*/\\1/p' "$state/containers";;
        *com.docker.compose.service=hermes*) sed -n 's/^\\([^ ]*\\) [^ ]*-hermes-1 running$/\\1/p' "$state/containers";;
        *name=*) [ -z "\${PS_FAILS:-}" ] || return 1; name=$(printf '%s' "$*" | sed -n 's/.*name=^\\([^$]*\\)\\$.*/\\1/p'); sed -n "s/^\\([^ ]*\\) $name .*/\\1/p" "$state/containers";;
      esac;;
    stop) shift; for id in "$@"; do sed -i "s/^$id \\([^ ]*\\) .*/$id \\1 exited/" "$state/containers"; done;;
    start) shift; for id in "$@"; do sed -i "s/^$id \\([^ ]*\\) .*/$id \\1 running/" "$state/containers"; done;;
    rm) [ -z "\${RM_FAILS:-}" ] || return 1; shift; [ "$1" != -f ] || shift; for id in "$@"; do sed -i -e "/^$id /d" -e "/^[^ ]* $id /d" "$state/containers"; done;;
    inspect)
      id=$(eval "printf '%s' \\"\\\${$#}\\""); line=$(grep -E "^$id |^[^ ]+ $id " "$state/containers") || return 1
      case "$line" in *' running') echo healthy;; *) echo unhealthy;; esac;;
    'volume'|'network')
      case "$2" in ls) ;; inspect) return 1;; esac;;
    *) return 0;;
  esac
}
engine() {
  { printf 'engine %s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$state/log"
  case "$*" in *down*) [ -n "\${RM_FAILS:-}" ] || sed -i '/ gtmworks-engine-first /d; / gtmworks-sandbox-first /d; / gtmworks-exit-first /d' "$state/containers";; esac
}
compose() { { printf 'compose %s\\n' "$*"; } >> "$state/log"; }
engine_start() {
  printf 'engine_start %s\\n' "$1" >> "$state/log"
  if [ -n "\${ENGINE_FAILS:-}" ]; then echo "new-1 gtmworks-engine-first starting" >> "$state/containers"; return 1; fi
  echo "new-1 gtmworks-engine-first running" >> "$state/containers"
}
join_engine_network() { printf 'join %s\\n' "$1" >> "$state/log"; }
`;

const key = 'a'.repeat(64);

function singleEngineInstall(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gtmworks-single-engine-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'state'));
  mkdirSync(join(dir, '.install-lock'));
  mkdirSync(join(dir, 'scripts'));
  // The release before #378 ships no Engine template, and keeps the Engine key in .env.install.
  writeFileSync(join(dir, '.env.install'), `POSTGRES_PASSWORD=p\nHERMES_API_KEY=${key}\nSETUP_CODE=s\n`);
  writeFileSync(join(dir, 'state/containers'), 'old-1 gtmworks-install-hermes-1 running\nweb-1 gtmworks-install-web-1 running\n');
  writeFileSync(join(dir, 'state/log'), '');
  const run = (body, env = {}) => spawnSync('sh', ['-c',
    `set -u\nstate="$PWD/state"\nnode_image=node:test\nengine_volume=gtmworks-install_hermes\nwork_sandbox_tag=gtmworks-work-sandbox:local\n${fakeDocker}${helpers}${body}`],
  { cwd: dir, encoding: 'utf8', env: { ...process.env, GTMWORKS_ENGINE_WAIT: '3', ...env } });
  const containers = () => readFileSync(join(dir, 'state/containers'), 'utf8').split('\n').filter(Boolean);
  const log = () => readFileSync(join(dir, 'state/log'), 'utf8').split('\n').filter(Boolean);
  return { dir, run, containers, log };
}

test('the old hermes Engine is stopped, never removed, until the first Company\'s Engine answers; then it goes', t => {
  const install = singleEngineInstall(t);
  assert.equal(install.run('keep_previous_engine').status, 0);
  const up = install.run('first_engine_up');
  assert.equal(up.status, 0, up.stderr);
  const log = install.log();
  const stop = log.indexOf('stop old-1');
  const start = log.indexOf('engine_start first');
  const remove = log.findIndex(line => line.startsWith('rm -f old-1'));
  assert.ok(stop >= 0 && start > stop && remove > start, log.join('\n'));
  assert.deepEqual(install.containers(), ['web-1 gtmworks-install-web-1 running', 'new-1 gtmworks-engine-first running']);
  assert.ok(!existsSync(join(install.dir, '.install-lock/old-engine')));
});

test('a listing Docker cannot give leaves the old Engine stopped', t => {
  const install = singleEngineInstall(t);
  assert.equal(install.run('keep_previous_engine').status, 0);
  assert.notEqual(install.run('first_engine_up', { ENGINE_FAILS: '1' }).status, 0);
  const restored = install.run('restore_previous_engine', { PS_FAILS: '1' });
  assert.notEqual(restored.status, 0);
  assert.match(restored.stderr, /could not say whether the Engine gtmworks-engine-first is gone/);
  assert.ok(install.containers().includes('old-1 gtmworks-install-hermes-1 exited'), install.containers().join('\n'));
});

test('an old container Docker will not remove fails nothing once the new Engine serves', t => {
  const install = singleEngineInstall(t);
  assert.equal(install.run('keep_previous_engine').status, 0);
  const up = install.run('first_engine_up', { RM_FAILS: '1' });
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stderr, /could not be removed; the next install run removes it/);
  assert.ok(install.containers().includes('new-1 gtmworks-engine-first running'));
});

test('an update whose first Engine does not start brings the old hermes Engine back, with its key, and no Engine folder', t => {
  const install = singleEngineInstall(t);
  assert.equal(install.run('keep_previous_engine').status, 0);
  const up = install.run('first_engine_up', { ENGINE_FAILS: '1' });
  assert.notEqual(up.status, 0);
  // While the new Engine was tried the old container was only stopped, and its data volume is the new Engine's.
  assert.ok(install.containers().includes('old-1 gtmworks-install-hermes-1 exited'), install.containers().join('\n'));
  assert.ok(!readFileSync(join(install.dir, '.env.install'), 'utf8').includes('HERMES_API_KEY='));
  const restored = install.run('restore_previous_engine');
  assert.equal(restored.status, 0, restored.stderr);
  // The template's Engine goes first, without its volumes (the data volume is the old Engine's), then the old one starts.
  assert.deepEqual(install.containers(), ['old-1 gtmworks-install-hermes-1 running', 'web-1 gtmworks-install-web-1 running']);
  const log = install.log();
  const down = log.findIndex(line => line.startsWith('engine first down'));
  const started = log.indexOf('start old-1');
  assert.ok(down >= 0 && started > down, log.join('\n'));
  assert.ok(!log.some(line => /down .*-v|volume rm gtmworks-install_hermes/.test(line)), 'the Engine data volume stays');
  // The install is the previous release's own shape again: its key in .env.install, no Engine folder.
  assert.equal(readFileSync(join(install.dir, '.env.install'), 'utf8'), `POSTGRES_PASSWORD=p\nSETUP_CODE=s\nHERMES_API_KEY=${key}\n`);
  assert.ok(!existsSync(join(install.dir, '.engines/first')));
  assert.ok(!existsSync(join(install.dir, '.install-lock/old-engine')));
});

test('the old Engine does not start while a new one still runs on its data volume', t => {
  const install = singleEngineInstall(t);
  assert.equal(install.run('keep_previous_engine').status, 0);
  assert.notEqual(install.run('first_engine_up', { ENGINE_FAILS: '1' }).status, 0);
  // A new Engine that Compose and Docker both fail to remove keeps the volume: the old one is not started beside it.
  const restored = install.run('restore_previous_engine', { RM_FAILS: '1' });
  assert.notEqual(restored.status, 0);
  assert.ok(install.containers().includes('old-1 gtmworks-install-hermes-1 exited'), install.containers().join('\n'));
});

test('a stopped container an earlier update moved past is removed, and never brought back', t => {
  // An update moved the Engine into its folder and could not remove the stopped old container.
  const install = singleEngineInstall(t);
  writeFileSync(join(install.dir, 'state/containers'), 'old-1 gtmworks-install-hermes-1 exited\nweb-1 gtmworks-install-web-1 running\n');
  mkdirSync(join(install.dir, '.engines/first'), { recursive: true });
  writeFileSync(join(install.dir, '.engines/first/.env'), `ENGINE_KEY=${key}\nENGINE_VOLUME=gtmworks-install_hermes\nENGINE_NETWORK=gtmworks-engine-first\n`);
  writeFileSync(join(install.dir, '.env.install'), 'POSTGRES_PASSWORD=p\n');
  assert.notEqual(install.run('first_engine_up', { ENGINE_FAILS: '1' }).status, 0);
  assert.ok(!install.containers().some(line => line.startsWith('old-1 ')), install.containers().join('\n'));
  assert.ok(!existsSync(join(install.dir, '.install-lock/old-engine')));
  // Nothing marks it as the Engine to bring back: the Engine folder stays as it was.
  install.run('restore_previous_engine');
  assert.ok(existsSync(join(install.dir, '.engines/first/.env')));
  assert.ok(!readFileSync(join(install.dir, '.env.install'), 'utf8').includes('HERMES_API_KEY='));
});

test('an install on the per-Company layout keeps no old Engine and restores from its kept template as before', t => {
  const install = singleEngineInstall(t);
  writeFileSync(join(install.dir, 'state/containers'), 'web-1 gtmworks-install-web-1 running\n');
  const up = install.run('first_engine_up');
  assert.equal(up.status, 0, up.stderr);
  assert.ok(!install.log().some(line => /^(stop|rm) /.test(line)), install.log().join('\n'));
  assert.ok(!existsSync(join(install.dir, '.install-lock/old-engine')));
  // No kept template and no old Engine: there is nothing to put back.
  assert.notEqual(install.run('restore_previous_engine').status, 0);
});

test('the installer puts the old Engine back on any run that moved it, update or plain install', () => {
  const engines = install.indexOf('if ! engines_up; then');
  const failed = install.slice(engines, install.indexOf('\n  exit 1\nfi\n', engines));
  assert.match(failed, /if \[ "\$operation" = update \] \|\| \[ -f \.install-lock\/old-engine \]; then/);
  assert.match(failed, /restore_previous_engine/);
  const restore = fn('restore_previous_engine');
  assert.ok(restore.indexOf('restore_old_engine') < restore.indexOf('engine-template.yml'), 'the old Engine comes first');
});
