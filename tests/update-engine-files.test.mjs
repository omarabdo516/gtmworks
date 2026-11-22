import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// #554: an update copies the target release's files, its Engine files (scripts/engine-*) among them, before it applies
// its migrations. One that fails before its Engines start leaves the previous release serving, and its own Engine files
// back on disk: that release's `company add` and restore, and the next update's keep_previous_engine, read them. The
// whole installer runs here, as a source update and as a release update, against a stand-in for Docker.

const previous = { 'engine-template.yml': 'services: {} # previous\n', 'engine-managed.yml': 'previous managed\n' };
// The release the update brings: its template changed, one file the previous release had is gone, one is new.
const next = { 'engine-template.yml': 'services: {} # next\n', 'engine-listener-address.sh': 'next listener\n' };

const engineFiles = directory => Object.fromEntries(readdirSync(join(directory, 'scripts')).filter(name => name.startsWith('engine-'))
  .map(name => [name, readFileSync(join(directory, 'scripts', name), 'utf8')]));

// Each failure is one stand-in step that exits non-zero; every other Docker call answers as a healthy install does.
const docker = `#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
  *'/data/ssh/id_ed25519'*) printf 'client ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIclient\\nhost ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhost\\n';;
  *'cp -R /app/install/.'*) sh "$BRING_NEXT";;
  *alpine:3.21*'Extracting update source'*) sh "$BRING_NEXT"; exit "\${EXTRACTION_EXIT:-0}";;
  *alpine:3.21*) exit 0;;
  *'pull '*sandbox*) exit "\${SANDBOX_PULL_EXIT:-0}";;
  *'build --tag gtmworks-work-sandbox:local sandbox'*) exit "\${SANDBOX_BUILD_EXIT:-0}";;
  *'nginx -t'*) exit "\${GATEWAY_CONFIG_EXIT:-0}";;
  *'count(*) from public.companies'*) echo 1;;
  *'exec -T db psql'*) cat > /dev/null; exit "\${MIGRATION_EXIT:-0}";;
  *'label=com.docker.compose.service=hermes'*) echo "\${OLD_HERMES:-}";;
  *'engine-first'*' up '*) exit "\${ENGINE_EXIT:-0}";;
esac
`;

function installFolder(t, mode, { before = 'engines' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `gtmworks-engine-files-${mode}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const folder of ['scripts', 'bin', 'lib', 'supabase/migrations', '.engines/first']) mkdirSync(join(directory, folder), { recursive: true });
  for (const file of ['install-nginx.conf', 'install-gateway-real-ip.sh']) copyFileSync(join('scripts', file), join(directory, 'scripts', file));
  for (const name of ['install-env.mjs', 'setup-code.mjs', 'setup-link.mjs', 'settings.mjs', 'supabase-settings.mjs']) copyFileSync(join('lib', name), join(directory, 'lib', name));
  // An install this release's shape already made: its first Company's Engine runs from its own folder.
  if (before === 'hermes') {
    // An install the release before one Engine per Company made: its key in .env.install, its one `hermes` Engine, and
    // no Engine files or Engine folder.
    writeFileSync(join(directory, '.env.install'), `existing secrets\nHERMES_API_KEY=${'k'.repeat(64)}\n`);
    rmSync(join(directory, '.engines'), { recursive: true });
  } else {
    writeFileSync(join(directory, '.env.install'), 'existing secrets\n');
    writeFileSync(join(directory, '.engines/first/.env'), `ENGINE_KEY=${'k'.repeat(64)}\nENGINE_VOLUME=gtmworks-install_hermes\n`);
    writeFileSync(join(directory, '.work-sandbox-image'), 'gtmworks-work-sandbox:local\n');
  }
  const kept = before === 'hermes' ? {} : previous;
  writeFileSync(join(directory, 'supabase/migrations/001_first.sql'), 'select 1;');
  writeFileSync(join(directory, 'bin/docker'), docker, { mode: 0o755 });
  // What the update copies in: the target release's Engine files over the previous release's.
  const bring = join(directory, 'bring-next.sh');
  writeFileSync(bring, Object.entries(next).map(([name, text]) => `printf '%s' '${text}' > scripts/${name}\n`).join(''));
  const installer = readFileSync('scripts/install.sh', 'utf8');
  let command;
  if (mode === 'release') {
    const image = `ghcr.io/omarabdo516/gtmworks:1.2.3@sha256:${'a'.repeat(64)}`;
    const sandboxImage = `ghcr.io/omarabdo516/gtmworks-sandbox:1.2.3@sha256:${'b'.repeat(64)}`;
    writeFileSync(join(directory, 'install.sh'), installer.replace('release_image=', 'release_image=' + image).replace('sandbox_image=', 'sandbox_image=' + sandboxImage));
    writeFileSync(join(directory, 'docker-compose.install.yml'), `name: gtmworks-install\nservices:\n  db:\n    image: ${image}\n`);
    command = ['install.sh', 'update'];
  } else {
    writeFileSync(join(directory, 'scripts/install.sh'), installer);
    command = ['scripts/install.sh', 'update', 'main'];
  }
  const commands = join(directory, 'commands');
  const env = { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, COMMANDS: commands, BRING_NEXT: bring, GH_TOKEN: '' };
  const run = (extra = {}) => {
    writeFileSync(commands, '');
    for (const name of Object.keys(engineFiles(directory))) rmSync(join(directory, 'scripts', name));
    for (const [name, text] of Object.entries(kept)) writeFileSync(join(directory, 'scripts', name), text);
    const result = spawnSync('sh', command, { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8' });
    return { ...result, commands: readFileSync(commands, 'utf8').split('\n'), files: engineFiles(directory) };
  };
  return { directory, run };
}

const failures = {
  source: [['its migration', { MIGRATION_EXIT: '3' }, 3], ['its gateway check', { GATEWAY_CONFIG_EXIT: '5' }, 5],
    ['its sandbox image build', { SANDBOX_BUILD_EXIT: '6' }, 1], ['its unpacking', { EXTRACTION_EXIT: '9' }, 9]],
  release: [['its migration', { MIGRATION_EXIT: '3' }, 3], ['its gateway check', { GATEWAY_CONFIG_EXIT: '5' }, 5],
    ['its sandbox image pull', { SANDBOX_PULL_EXIT: '6' }, 1]],
};

for (const mode of ['source', 'release']) {
  for (const [step, failure, status] of failures[mode]) {
    test(`a ${mode} update that fails at ${step} leaves the previous release's own Engine files on disk`, t => {
      const install = installFolder(t, mode);
      const failed = install.run(failure);
      assert.equal(failed.status, status, failed.stderr);
      assert.deepEqual(failed.files, previous, 'each kept file is back and no file the update brought stays');
      assert.match(failed.stderr, /This update stopped before its Engines started: the previous release's own Engine files are back\./);
      assert.ok(!failed.commands.some(line => / up /.test(line) && /engine-first/.test(line)), 'no Engine was started');
      assert.equal(existsSync(join(install.directory, '.install-lock')), false);
      assert.equal(readFileSync(join(install.directory, '.work-sandbox-image'), 'utf8'), 'gtmworks-work-sandbox:local\n');
      const tagBack = failed.commands.filter(line => line === 'tag gtmworks-work-sandbox:local-previous gtmworks-work-sandbox:local');
      // Before the build a -previous image is an earlier run's, older than the one serving: its tag stays where it is.
      if (mode === 'release' || failure.GATEWAY_CONFIG_EXIT || failure.EXTRACTION_EXIT) assert.deepEqual(tagBack, [], failed.commands.join('\n'));
      if (mode === 'source' && failure.MIGRATION_EXIT) {
        // The source build rebuilt the sandbox tag before the migrations; the image the previous release's sandboxes run gets it back.
        const build = failed.commands.indexOf('build --tag gtmworks-work-sandbox:local sandbox');
        const back = failed.commands.lastIndexOf('tag gtmworks-work-sandbox:local-previous gtmworks-work-sandbox:local');
        assert.ok(build >= 0 && back > build, failed.commands.join('\n'));
      }
    });
  }

  test(`a ${mode} update whose Engines started keeps this release's Engine files`, t => {
    const install = installFolder(t, mode);
    const updated = install.run();
    assert.equal(updated.status, 0, updated.stderr);
    assert.deepEqual(updated.files, { ...previous, ...next }, 'the update brought its own files over the previous ones');
    assert.doesNotMatch(updated.stderr, /Engine files are back/);
  });

  test(`a ${mode} update whose Engine does not start puts the previous release's own Engine files back`, t => {
    const install = installFolder(t, mode);
    const failed = install.run({ ENGINE_EXIT: '1', GTMWORKS_ENGINE_WAIT: '1' });
    assert.notEqual(failed.status, 0);
    assert.deepEqual(failed.files, previous);
    // The rollback put them back before it started the Engines from them, so the exit handler has nothing to do.
    assert.doesNotMatch(failed.stderr, /stopped before its Engines started/);
  });

  test(`a ${mode} update of the release before one Engine per Company whose Engine does not start leaves it no Engine files`, t => {
    const install = installFolder(t, mode, { before: 'hermes' });
    const failed = install.run({ ENGINE_EXIT: '1', GTMWORKS_ENGINE_WAIT: '1', OLD_HERMES: 'old-hermes-1' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /the previous release keeps serving, with its own Engines again/);
    assert.ok(failed.commands.includes('start old-hermes-1'), failed.commands.join('\n'));
    // That release shipped no Engine template, so none of this release's stays on its disk.
    assert.deepEqual(failed.files, {});
    assert.match(readFileSync(join(install.directory, '.env.install'), 'utf8'), /^HERMES_API_KEY=k{64}$/m);
  });
}
