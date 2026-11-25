import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// #479: an update whose work sandboxes do not all start goes back to the previous release (ADR 0023), and removes what it
// made for the sandboxes: each volume and network the install did not have when the update began, and the sandbox key in
// the Engine's volume of a Company whose work folder it made. What the install had before stays. The installer's own
// functions run here against a stand-in for Docker that keeps its volumes and networks in two files.

const install = readFileSync('scripts/install.sh', 'utf8');
const fn = name => {
  const start = install.indexOf(`\n${name}() {`);
  assert.ok(start >= 0, name);
  if (install.slice(start + 1).match(/^[a-z_]+\(\) \{ [^\n]*\}\n/)) return install.slice(start + 1, install.indexOf('\n', start + 1) + 1);
  return install.slice(start + 1, install.indexOf('\n}\n', start) + 3);
};
const helpers = ['engine_folder', 'sandbox_container', 'exit_container', 'exit_network', 'work_volume', 'work_network', 'host_key_volume',
  'engine_names', 'work_sandbox_ref', 'keep_previous_engine', 'keep_previous_release', 'keep_sandbox_parts', 'previous_engine_files_back', 'previous_engine_files_kept_back', 'new_engine_files_removed', 'remove_new_sandbox_parts'].map(fn).join('');

// The stand-in: `volume ls`, `network ls`, `inspect`, `rm` over two files, every call written to a log on one line, and a failing
// listing when LIST_FAILS is set, a refused removal when RM_FAILS is. `run` is only the key removal, logged with its volume.
const fakeDocker = `
docker() {
  { printf '%s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$state/log"
  case "$1 $2" in 'volume rm'|'network rm') [ -z "\${RM_FAILS:-}" ] || return 1;; esac
  case "$1 $2" in
    'volume ls') [ -z "\${LIST_FAILS:-}" ] || return 1; cat "$state/volumes";;
    'network ls') cat "$state/networks";;
    'volume inspect') grep -qxF "$3" "$state/volumes";;
    'network inspect') grep -qxF "$3" "$state/networks";;
    'volume rm') grep -vxF "$3" "$state/volumes" > "$state/next" || true; mv "$state/next" "$state/volumes";;
    'network rm') grep -vxF "$3" "$state/networks" > "$state/next" || true; mv "$state/next" "$state/networks";;
    *) return 0;;
  esac
}
`;

function installFolder(t, { volumes, networks, engines }) {
  const dir = mkdtempSync(join(tmpdir(), 'gtmworks-rollback-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'state'));
  mkdirSync(join(dir, '.install-lock'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts/engine-template.yml'), 'services: {}\n');
  writeFileSync(join(dir, 'state/volumes'), volumes.map(line => `${line}\n`).join(''));
  writeFileSync(join(dir, 'state/networks'), networks.map(line => `${line}\n`).join(''));
  writeFileSync(join(dir, 'state/log'), '');
  for (const [slug, volume] of Object.entries(engines)) {
    mkdirSync(join(dir, '.engines', slug), { recursive: true });
    writeFileSync(join(dir, '.engines', slug, '.env'), `ENGINE_VOLUME=${volume}\n`);
  }
  const run = (body, env = {}) => spawnSync('sh', ['-c', `state="$PWD/state"\nnode_image=node:test\n${fakeDocker}${helpers}${body}`],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  const read = file => readFileSync(join(dir, 'state', file), 'utf8').split('\n').filter(Boolean);
  const make = (volumesMade, networksMade) => {
    writeFileSync(join(dir, 'state/volumes'), [...read('volumes'), ...volumesMade].map(line => `${line}\n`).join(''));
    writeFileSync(join(dir, 'state/networks'), [...read('networks'), ...networksMade].map(line => `${line}\n`).join(''));
  };
  // sandbox_keys names each Engine whose key this run made.
  const keysMade = slugs => writeFileSync(join(dir, '.install-lock/sandbox-keys-made'), slugs.map(slug => `${slug}\n`).join(''));
  return { dir, run, read, make, keysMade };
}

const madeFor = slug => [[`gtmworks-work-${slug}`, `gtmworks-sandbox-hostkey-${slug}`], [`gtmworks-work-${slug}`, `gtmworks-exit-${slug}`]];

test('an update from a release before the work sandbox removes every sandbox volume, network and key it made', t => {
  const install = installFolder(t, {
    volumes: ['gtmworks-install_hermes', 'gtmworks-engine-acme'],
    networks: ['gtmworks-engine-first', 'gtmworks-engine-acme', 'gtmworks-install_default'],
    engines: { first: 'gtmworks-install_hermes', acme: 'gtmworks-engine-acme' },
  });
  const kept = install.run('keep_previous_engine');
  assert.equal(kept.status, 0, kept.stderr);
  // The update made the first Company's sandbox whole and began the second's before its sandbox did not start.
  install.make([...madeFor('first')[0], ...madeFor('acme')[0]], [...madeFor('first')[1], ...madeFor('acme')[1]]);
  install.keysMade(['first', 'acme']);
  const removed = install.run('remove_new_sandbox_parts');
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(removed.stderr, '');
  assert.deepEqual(install.read('volumes'), ['gtmworks-install_hermes', 'gtmworks-engine-acme']);
  assert.deepEqual(install.read('networks'), ['gtmworks-engine-first', 'gtmworks-engine-acme', 'gtmworks-install_default']);
  const log = install.read('log');
  // Each Company's sandbox and exit go, and the key each Engine's volume got is taken out of it.
  assert.ok(log.includes('rm -f gtmworks-sandbox-first gtmworks-exit-first'), log.join('\n'));
  assert.ok(log.includes('rm -f gtmworks-sandbox-acme gtmworks-exit-acme'), log.join('\n'));
  for (const volume of ['gtmworks-install_hermes', 'gtmworks-engine-acme']) {
    const wipe = log.find(line => line.startsWith('run ') && line.includes(`-v ${volume}:/data `));
    assert.ok(wipe, `the key in ${volume}`);
    assert.match(wipe, /rm -rf \/data\/ssh/);
    assert.match(wipe, /\[sandbox\\\]:2222/);
  }
});

test('what the install had before the update stays, and a key this update made goes even beside an old work folder', t => {
  // An earlier failed update left the first Company's work folder and networks; this update made the second's, and a key
  // in each Engine's volume.
  const install = installFolder(t, {
    volumes: ['gtmworks-install_hermes', 'gtmworks-engine-acme', ...madeFor('first')[0]],
    networks: ['gtmworks-engine-first', 'gtmworks-engine-acme', ...madeFor('first')[1]],
    engines: { first: 'gtmworks-install_hermes', acme: 'gtmworks-engine-acme' },
  });
  assert.equal(install.run('keep_previous_engine').status, 0);
  install.make(madeFor('acme')[0], madeFor('acme')[1]);
  install.keysMade(['first', 'acme']);
  const removed = install.run('remove_new_sandbox_parts');
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(install.read('volumes'), ['gtmworks-install_hermes', 'gtmworks-engine-acme', ...madeFor('first')[0]]);
  assert.deepEqual(install.read('networks'), ['gtmworks-engine-first', 'gtmworks-engine-acme', ...madeFor('first')[1]]);
  const log = install.read('log');
  for (const volume of ['gtmworks-install_hermes', 'gtmworks-engine-acme']) {
    assert.ok(log.some(line => line.startsWith('run ') && line.includes(`-v ${volume}:/data node:test `)), `the key this update made in ${volume} goes, with the node image`);
  }
});

test('a key the Engine had before the update stays', t => {
  const install = installFolder(t, { volumes: ['gtmworks-install_hermes'], networks: [], engines: { first: 'gtmworks-install_hermes' } });
  assert.equal(install.run('keep_previous_engine').status, 0);
  install.make(madeFor('first')[0], madeFor('first')[1]);
  install.keysMade([]);
  assert.equal(install.run('remove_new_sandbox_parts').status, 0);
  assert.deepEqual(install.read('volumes'), ['gtmworks-install_hermes']);
  assert.ok(!install.read('log').some(line => line.startsWith('run ')), 'no key is taken out');
});

test('a previous release that runs sandboxes keeps every part it has just started its own from', t => {
  const install = installFolder(t, { volumes: ['gtmworks-install_hermes'], networks: [], engines: { first: 'gtmworks-install_hermes' } });
  writeFileSync(join(install.dir, '.work-sandbox-image'), 'gtmworks-work-sandbox:local\n');
  assert.equal(install.run('keep_previous_engine').status, 0);
  install.make(madeFor('first')[0], madeFor('first')[1]);
  install.keysMade(['first']);
  assert.equal(install.run('remove_new_sandbox_parts').status, 0);
  assert.deepEqual(install.read('volumes'), ['gtmworks-install_hermes', ...madeFor('first')[0]]);
  assert.deepEqual(install.read('networks'), madeFor('first')[1]);
  assert.ok(!install.read('log').some(line => /^(rm|run|volume rm|network rm) /.test(line)), install.read('log').join('\n'));
});

test('what Docker will not remove is named, with how to remove it', t => {
  const install = installFolder(t, { volumes: ['gtmworks-install_hermes'], networks: [], engines: { first: 'gtmworks-install_hermes' } });
  assert.equal(install.run('keep_previous_engine').status, 0);
  install.make(madeFor('first')[0], madeFor('first')[1]);
  const removed = install.run('remove_new_sandbox_parts', { RM_FAILS: '1' });
  assert.equal(removed.status, 0);
  assert.match(removed.stderr, /could not all be removed, and an update run again keeps it as it is: remove the volume gtmworks-work-first \(docker volume rm gtmworks-work-first\),/);
  assert.match(removed.stderr, /the network gtmworks-exit-first \(docker network rm gtmworks-exit-first\); then run the update again\./);
});

test('a work folder and its work network share a name, and each is told apart', t => {
  // The install had the work network of a Company but not its work folder.
  const install = installFolder(t, {
    volumes: ['gtmworks-install_hermes'],
    networks: ['gtmworks-work-first'],
    engines: { first: 'gtmworks-install_hermes' },
  });
  assert.equal(install.run('keep_previous_engine').status, 0);
  install.make(['gtmworks-work-first'], []);
  assert.equal(install.run('remove_new_sandbox_parts').status, 0);
  assert.deepEqual(install.read('volumes'), ['gtmworks-install_hermes']);
  assert.deepEqual(install.read('networks'), ['gtmworks-work-first']);
});

test('nothing is removed without a list, and a list Docker cannot give stops the update', t => {
  const install = installFolder(t, { volumes: [...madeFor('first')[0]], networks: [...madeFor('first')[1]], engines: { first: 'gtmworks-install_hermes' } });
  const unlisted = install.run('remove_new_sandbox_parts');
  assert.equal(unlisted.status, 0, unlisted.stderr);
  assert.deepEqual(install.read('volumes'), madeFor('first')[0]);
  assert.deepEqual(install.read('networks'), madeFor('first')[1]);
  const failed = install.run('keep_previous_engine', { LIST_FAILS: '1' });
  assert.notEqual(failed.status, 0, 'an update whose sandbox parts cannot be listed does not begin');
});

test('the rollback removes the new sandbox parts after the previous Engines start again', () => {
  const restore = fn('restore_previous_engine');
  const start = restore.indexOf('engine "$name" up -d --remove-orphans');
  const cleanup = restore.indexOf('remove_new_sandbox_parts');
  assert.ok(start >= 0 && cleanup >= 0, 'the rollback starts the Engines and removes the new parts');
  assert.ok(start < cleanup);
});

test('a key made before a later step of its preparation failed is still named, so the rollback takes it out', t => {
  const dir = mkdtempSync(join(tmpdir(), 'gtmworks-keys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.install-lock'));
  mkdirSync(join(dir, '.engines/acme'), { recursive: true });
  writeFileSync(join(dir, '.engines/acme/.env'), 'ENGINE_VOLUME=gtmworks-engine-acme\n');
  writeFileSync(join(dir, '.work-sandbox-image'), 'gtmworks-work-sandbox:local\n');
  // The key is made, then the host key cannot be written: the container prints `made` and fails.
  const docker = `docker() { case "$1" in run) echo made; return 1;; *) return 0;; esac; }\n`;
  const result = spawnSync('sh', ['-c', `${docker}${fn('engine_folder')}${fn('work_volume')}${fn('host_key_volume')}${fn('work_sandbox_ref')}${fn('sandbox_keys')}sandbox_keys acme`], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the preparation still fails');
  assert.equal(readFileSync(join(dir, '.install-lock/sandbox-keys-made'), 'utf8'), 'acme\n');
});
