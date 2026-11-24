import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// `./ci.sh install` starts a Docker machine of its own, `gtmworks-install-lane`, with a throwaway checkout of HEAD (#388).
// It is gone however the run ends (#416): after a pass, a failure, SIGTERM, Ctrl-C, a signal while the machine starts or
// the images load, and a SIGKILL of the whole run. The real lane runs here, from this repo's ci.sh and
// scripts/install-lane-machine.sh, in a throwaway clone whose install proof is a stand-in, against a stand-in `docker`
// that keeps each daemon's containers apart by DOCKER_HOST: a removal asked of the machine's own daemon removes nothing
// on this host, as with the real CLI.
const fakeDocker = String.raw`#!/usr/bin/env bash
state=$FAKE_DOCKER_STATE
host=$state/$(printf %s "${'${DOCKER_HOST:-local}'}" | tr -c 'A-Za-z0-9' _); mkdir -p "$host"
case $1 in
 run) shift; name= label=
  while (($#)); do case $1 in --name) name=$2; shift;; --label) label=$2; shift;; esac; shift; done
  for f in "$host"/*; do [ -e "$f" ] || continue; read -r n _ < "$f"; [ "$n" != "$name" ] || { echo "Conflict: $name is in use" >&2; exit 125; }; done
  if [ -n "${'${FAKE_DOCKER_RUN_WAIT:-}'}" ]; then touch "$state/starting"; sleep "$FAKE_DOCKER_RUN_WAIT"; fi
  id=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n'); echo "$name $label" > "$host/$id"; echo "$id"; touch "$state/started";;
 rm) shift; status=0
  if [ -e "$state/area-pid" ]; then ps -o stat= -p "$(cat "$state/area-pid")" 2> /dev/null | grep -q '^[^Z]' && echo running > "$state/area-at-removal"; fi
  for arg; do case $arg in -*) continue;; esac; found=
   for f in "$host"/*; do [ -e "$f" ] || continue; read -r n _ < "$f"
    if [ "$(basename "$f")" = "$arg" ] || [ "$n" = "$arg" ]; then rm -f "$f"; found=1; fi; done
   [ -n "$found" ] || { echo "No such container: $arg" >&2; status=1; }; done; exit $status;;
 ps) [ ! -e "$state/refused" ] || { echo 'Cannot connect to the Docker daemon' >&2; exit 1; }
  label=; while (($#)); do [ "$1" != --filter ] || label=${'${2#label=}'}; shift; done
  for f in "$host"/*; do [ -e "$f" ] || continue; read -r _ l < "$f"; [ -z "$label" ] || [ "$l" = "$label" ] && basename "$f"; done;;
 load) cat > /dev/null; if [ -n "${'${FAKE_DOCKER_LOAD_WAIT:-}'}" ]; then touch "$state/loading"; sleep "$FAKE_DOCKER_LOAD_WAIT"; fi;;
esac
exit 0
`;

// The proof the lane runs, standing in for scripts/ci-install-check.sh: it says which Docker it was given, then passes,
// fails, or waits to be stopped in an area of its own subshell, as the real proof runs its areas; the area ignores
// SIGTERM, as a command can.
const proof = `#!/usr/bin/env bash
printf %s "\${DOCKER_HOST:-}" > "$FAKE_DOCKER_STATE/proof-docker-host"; echo $$ > "$FAKE_DOCKER_STATE/proof-pid"
case $LANE_PROOF in pass) exit 0;; fail) exit 1;; wait) (trap '' TERM; echo $BASHPID > "$FAKE_DOCKER_STATE/area-pid"; touch "$FAKE_DOCKER_STATE/proving"; while :; do sleep 1; done);; esac
`;

let root, repo, bin;
before(() => {
  // The folder's name holds characters a pattern reads as its own, as a repo path can (#416).
  root = mkdtempSync(join(tmpdir(), 'install-lane-c++-'));
  repo = join(root, 'repo');
  bin = join(root, 'bin');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', '--shared', resolve('.'), repo]);
  // The lane runs this checkout's ci.sh, its machine scripts and the image list (#608), committed in the clone as the
  // lane runs HEAD.
  const files = ['ci.sh', 'scripts/install-lane-machine.sh', 'scripts/ci-install-machine.sh'];
  for (const file of files) copyFileSync(resolve(file), join(repo, file));
  writeFileSync(join(repo, 'scripts/ci-install-check.sh'), proof);
  git('add', ...files);
  git('-c', 'user.name=lane', '-c', 'user.email=lane@example.invalid', 'commit', '-q', '-am', 'lane test');
  // The lane fetches HEAD from origin first; here origin is the clone itself.
  git('remote', 'set-url', 'origin', repo);
  mkdirSync(join(repo, 'node_modules'));
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), fakeDocker);
  chmodSync(join(bin, 'docker'), 0o755);
});
after(() => rmSync(root, { recursive: true, force: true }));

const machines = state => {
  const host = join(state, 'local');
  return existsSync(host) ? readdirSync(host).map(id => readFileSync(join(host, id), 'utf8').trim()) : [];
};
const worktrees = () => execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).match(/^worktree /gm).length;
const workFolders = () => readdirSync(join(repo, '.git')).filter(name => name.startsWith('install-lane.'));

// Runs `./ci.sh install` in its own process group, as a terminal or an agent's tool would, and resolves with how it ended.
function lane(t, { proof: mode = 'pass', env = {}, leftover = false, setup = () => {} } = {}) {
  const state = mkdtempSync(join(root, 'state-'));
  setup(state);
  if (leftover) { mkdirSync(join(state, 'local')); writeFileSync(join(state, 'local', 'f00d'), 'gtmworks-install-lane gtmworks.install-lane=/an/earlier/run\n'); }
  const { DOCKER_HOST, ...inherited } = process.env;
  const child = spawn('bash', ['ci.sh', 'install'], {
    cwd: repo, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...inherited, PATH: `${bin}:${process.env.PATH}`, FAKE_DOCKER_STATE: state, LANE_PROOF: mode, ...env },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ended = new Promise(done => child.on('exit', (code, signal) => done({ code, signal, stderr })));
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const reached = async marker => {
    for (let i = 0; i < 200 && !existsSync(join(state, marker)); i++) await sleep(50);
    assert.ok(existsSync(join(state, marker)), `the lane reached ${marker}: ${stderr}`);
  };
  return { child, state, ended, reached };
}

const cleanedUp = state => {
  assert.deepEqual(machines(state), [], 'no machine is left on this host');
  assert.equal(worktrees(), 1, 'the throwaway checkout is removed');
  assert.deepEqual(workFolders(), [], 'the work folder is removed');
};

test('after a pass the machine, the checkout and the work folder are gone, and only the proof talks to the machine', async t => {
  const run = lane(t);
  const { code, stderr } = await run.ended;
  assert.equal(code, 0, stderr);
  cleanedUp(run.state);
  assert.equal(readFileSync(join(run.state, 'proof-docker-host'), 'utf8'), 'tcp://127.0.0.1:2375', 'the proof runs on the machine');
});

test('a machine an earlier run left behind is removed before this run starts its own', async t => {
  const run = lane(t, { leftover: true });
  assert.equal((await run.ended).code, 0);
  cleanedUp(run.state);
});

test('what an earlier run left after its guard gave up, a work folder and its labelled machine, goes when the next run starts', async t => {
  const earlier = mkdtempSync(join(repo, '.git', 'install-lane.'));
  const run = lane(t, { setup: state => {
    mkdirSync(join(state, 'local'), { recursive: true });
    writeFileSync(join(state, 'local', 'beef'), `gtmworks-install-lane-old gtmworks.install-lane=${earlier}\n`);
  } });
  assert.equal((await run.ended).code, 0);
  assert.equal(existsSync(earlier), false, "the earlier run's work folder is removed");
  cleanedUp(run.state);
});

test('without pgrep, which the cleanup needs, the lane starts no machine and says so in one line', async t => {
  // A PATH of this machine's system tools with pgrep left out (a folder of wrappers that run the next tool of their name
  // on PATH, as a sandbox can put first, is left out too: moved, a wrapper finds no next tool).
  const tools = join(root, 'no-pgrep');
  if (!existsSync(tools)) {
    mkdirSync(tools);
    // The first of each name on PATH, as a shell finds it; a name is counted once it is linked, broken links included.
    const linked = new Set(['pgrep']);
    for (const dir of process.env.PATH.split(':')) {
      if (!existsSync(dir) || !/^\/(usr\/)?(local\/)?s?bin$/.test(dir)) continue;
      for (const name of readdirSync(dir)) if (!linked.has(name)) { linked.add(name); symlinkSync(join(dir, name), join(tools, name)); }
    }
  }
  const run = lane(t, { env: { PATH: `${bin}:${tools}` } });
  const { code, stderr } = await run.ended;
  assert.equal(code, 1);
  assert.match(stderr, /the install lane needs pgrep \(procps\) to remove its Docker machine/);
  cleanedUp(run.state);
});

test('after a failed proof the run fails and everything is gone', async t => {
  const run = lane(t, { proof: 'fail' });
  assert.equal((await run.ended).code, 1);
  cleanedUp(run.state);
});

// A process that has ended but is not yet reaped (a zombie, until its new parent waits for it) is not running.
const alive = pid => {
  try { return /^[^Z]/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()); } catch { return false; }
};

test('SIGTERM to the lane alone while the proof runs stops the proof and its area, and removes everything as it ends', async t => {
  const run = lane(t, { proof: 'wait' });
  await run.reached('proving');
  assert.equal(machines(run.state).length, 1, 'the machine is running');
  process.kill(run.child.pid, 'SIGTERM');
  assert.equal((await run.ended).signal, 'SIGTERM');
  cleanedUp(run.state);
  for (const file of ['proof-pid', 'area-pid']) {
    const pid = Number(readFileSync(join(run.state, file), 'utf8'));
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(50);
    assert.equal(alive(pid), false, `${file}: the proof is not left running against a machine that is gone`);
  }
  assert.equal(existsSync(join(run.state, 'area-at-removal')), false, 'the area had ended before the machine was removed');
});

const settled = async state => {
  for (let i = 0; i < 300 && (machines(state).length || workFolders().length || worktrees() > 1); i++) await sleep(100);
};

test('a host Docker that refuses its listing as the run ends keeps the work folder, and the guard removes everything once Docker answers', async t => {
  const run = lane(t, { proof: 'wait' });
  await run.reached('proving');
  writeFileSync(join(run.state, 'refused'), '');
  process.kill(run.child.pid, 'SIGTERM');
  const { stderr } = await run.ended;
  assert.match(stderr, /not removed yet: a guard goes on removing it/);
  assert.equal(machines(run.state).length, 1, 'Docker refused, so the machine is still there');
  assert.equal(workFolders().length, 1, 'the work folder stays while the machine may be there');
  rmSync(join(run.state, 'refused'));
  await settled(run.state);
  cleanedUp(run.state);
});

test('a machine that starts after the trap has stopped waiting for it is removed by the guard, with no other run', async t => {
  const run = lane(t, { env: { FAKE_DOCKER_RUN_WAIT: '5', INSTALL_LANE_START_WAIT: '1' } });
  await run.reached('starting');
  process.kill(run.child.pid, 'SIGTERM');
  assert.equal((await run.ended).signal, 'SIGTERM');
  await run.reached('started');
  await settled(run.state);
  cleanedUp(run.state);
});

test('Ctrl-C (SIGINT to the whole run) while the proof runs removes everything as it ends', async t => {
  const run = lane(t, { proof: 'wait' });
  await run.reached('proving');
  process.kill(-run.child.pid, 'SIGINT');
  assert.equal((await run.ended).signal, 'SIGINT');
  cleanedUp(run.state);
});

test('SIGTERM while the images load into the machine removes everything', async t => {
  const run = lane(t, { env: { FAKE_DOCKER_LOAD_WAIT: '30' } });
  await run.reached('loading');
  process.kill(run.child.pid, 'SIGTERM');
  assert.equal((await run.ended).signal, 'SIGTERM');
  cleanedUp(run.state);
});

test('SIGTERM while the machine is still starting waits for it, then removes it', async t => {
  // Only the lane is signalled, so `docker run` goes on and makes the machine after the lane has begun to end.
  const run = lane(t, { env: { FAKE_DOCKER_RUN_WAIT: '1' } });
  await run.reached('starting');
  process.kill(run.child.pid, 'SIGTERM');
  assert.equal((await run.ended).signal, 'SIGTERM');
  await run.reached('started');
  cleanedUp(run.state);
});

test('SIGKILL of the lane alone, which runs no trap, stops its proof and area before the guard removes everything', async t => {
  const run = lane(t, { proof: 'wait' });
  await run.reached('proving');
  process.kill(run.child.pid, 'SIGKILL');
  assert.equal((await run.ended).signal, 'SIGKILL');
  await settled(run.state);
  cleanedUp(run.state);
  const area = Number(readFileSync(join(run.state, 'area-pid'), 'utf8'));
  assert.equal(alive(area), false, 'the area is not left running against a machine that is gone');
  assert.equal(existsSync(join(run.state, 'area-at-removal')), false, 'the area had ended before the machine was removed');
});

test('SIGKILL of the whole run, which runs no trap, still removes everything within seconds', async t => {
  const run = lane(t, { proof: 'wait' });
  await run.reached('proving');
  process.kill(-run.child.pid, 'SIGKILL');
  assert.equal((await run.ended).signal, 'SIGKILL');
  await settled(run.state);
  cleanedUp(run.state);
});
