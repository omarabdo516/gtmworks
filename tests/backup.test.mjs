import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backupIncludes, backupExcludes, backupCommands } from '../lib/backup.mjs';

// #33: the Backup section in Settings lists what the install's backup archives. The list is the contract: it must be
// exactly the paths scripts/install.sh puts in its archive, so the section can never promise more or less than backup does.
const install = readFileSync('scripts/install.sh', 'utf8');

function archivedPaths() {
  const start = install.indexOf('tar -czf');
  assert.notEqual(start, -1, 'scripts/install.sh has the backup tar command');
  assert.notEqual(install.indexOf('> .install-lock/backup.tgz', start), -1, 'the backup tar writes .install-lock/backup.tgz');
  // The command runs in a shell inside the helper container since #399 (it finds the work folders' caches first), so
  // it ends at its own line's end.
  const end = install.indexOf('\n', start);
  // A continued command is one command: drop the backslashes that break it across lines.
  const args = install.slice(start, end).replace(/\\\s*\n/g, ' ').split(/\s+/).filter(Boolean);
  const root = args.indexOf('-C');
  assert.notEqual(root, -1, 'the archive is made from one root');
  return args.slice(root + 2).sort();
}

test('the Backup section holds exactly what scripts/install.sh archives', () => {
  // #349 added the Agents' Hermes data to the archive; #386 holds every Company's Engine data, one folder per Engine.
  assert.deepEqual(archivedPaths(), backupIncludes.flatMap(item => item.paths).sort());
});

test('every archive path belongs to one item the section names, and every item names a message in both catalogues', () => {
  const en = JSON.parse(readFileSync('lib/messages/en.json', 'utf8'));
  const ar = JSON.parse(readFileSync('lib/messages/ar.json', 'utf8'));
  const paths = backupIncludes.flatMap(item => item.paths);
  assert.equal(new Set(paths).size, paths.length, 'no path is listed twice');
  for (const item of [...backupIncludes, ...backupExcludes]) {
    assert.ok(en[item.title], `en: ${item.title}`);
    assert.ok(ar[item.title], `ar: ${item.title}`);
    if (item.detail) {
      assert.ok(en[item.detail], `en: ${item.detail}`);
      assert.ok(ar[item.detail], `ar: ${item.detail}`);
    }
  }
  for (const { title } of backupCommands.install) {
    assert.ok(en[title] && ar[title], `both catalogues: ${title}`);
  }
  for (const command of backupCommands.source) {
    assert.ok(en[command] === undefined && ar[command] === undefined, `${command} is a command, not a message key`);
  }
});

test('no backup or restore route exists: both stay on the host (#33)', () => {
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  assert.deepEqual(walk('app/api').filter(file => /backup|restore/i.test(file)), []);
});

// #386: every Company's Engine is in the backup, the restore brings them all back, and the update moves them all.
test('the README says every Company Engine is in the backup, the restore and the update', () => {
  const readme = readFileSync('README.md', 'utf8');
  const section = name => readme.split(new RegExp(`^## ${name}$`, 'm'))[1].split(/^## /m)[0];
  for (const name of ['Update', 'Backup', 'Restore']) {
    assert.match(section(name), /every Company's Engine included/, name);
  }
  assert.match(section('Backup'), /each Company's Engine data volume/, 'the backup names every Engine volume');
  assert.match(section('Restore'), /refuses\s+an archive it cannot fully restore/, 'restore refuses an incomplete archive');
});

// Spec #667 story 30: an archived Card, Conversation and team channel are still archived after a backup and a restore.
// Archived is a time and a person on each, kept in the database the archive holds whole; the backup area archives one of
// each in every Company before the backup and finds each still archived after the restore (`./ci.sh install backup`).
// An archived Conversation's Engine session flag is in that Engine's own data, which the archive holds too.
test('a backup and a restore keep archived Cards, Conversations and channels archived', () => {
  const area = readFileSync('scripts/ci-install-check.sh', 'utf8');
  const backup = area.slice(area.indexOf('\nbackup() {'), area.indexOf('\n}\n', area.indexOf('\nbackup() {')));
  for (const table of ['work_cards', 'conversations', 'channels']) {
    assert.match(backup, new RegExp(`(insert into|update) public\\.${table}\\b[^\\n]*archived_at`), `the backup area archives a row of ${table} before the backup`);
  }
  const read = backup.indexOf('archived_rows > archived.before'); const backedUp = backup.indexOf('sh scripts/install.sh backup');
  assert.ok(read >= 0 && backedUp >= 0 && read < backedUp, 'and reads them before the backup');
  assert.match(backup, /diff -u archived\.before archived\.after \|\| fail 'the restore keeps archived Cards, Conversations and channels archived'/, 'and finds them archived after the restore');
  const archived = archivedPaths();
  assert.ok(archived.includes('var/lib/postgresql/data'), 'the database is in the archive');
  assert.ok(archived.includes('engines'), 'every Engine\'s data, which holds its sessions and their flags, is in the archive');
});
