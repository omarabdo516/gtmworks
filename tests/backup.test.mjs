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
  const end = install.indexOf('> .install-lock/backup.tgz', start);
  assert.notEqual(end, -1, 'the backup tar writes .install-lock/backup.tgz');
  // A continued command is one command: drop the backslashes that break it across lines.
  const args = install.slice(start, end).replace(/\\\s*\n/g, ' ').split(/\s+/).filter(Boolean);
  const root = args.indexOf('-C');
  assert.notEqual(root, -1, 'the archive is made from one root');
  return args.slice(root + 2).sort();
}

test('the Backup section holds exactly what scripts/install.sh archives', () => {
  // #349 adds the Agents' Hermes data (opt/data) to the archive. Until it lands this is red for opt/data alone.
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
