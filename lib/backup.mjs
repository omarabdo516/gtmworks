// What the install's backup holds and leaves out (#33), and the commands that run it from the host.
//
// The paths are exactly the ones scripts/install.sh puts in its archive: the database and its custom configuration,
// the stored files, the install's keys, the Agents' Hermes data (#349) and every Company's work folder (#399). tests/backup.test.mjs reads the tar
// command and fails when this list and the archive disagree, so the section never promises more or less than backup does.
export const backupIncludes = [
  { title: 'settingsBackupDatabase', detail: 'settingsBackupDatabaseD', paths: ['var/lib/postgresql/data', 'etc/postgresql-custom'] },
  { title: 'settingsBackupFiles', detail: 'settingsBackupFilesD', paths: ['var/lib/storage'] },
  { title: 'settingsBackupKeys', detail: 'settingsBackupKeysD', file: '.env.install', paths: ['.env.install', '.engines'] },
  { title: 'settingsBackupAgents', detail: 'settingsBackupAgentsD', paths: ['engines', 'engines.list'] },
  // Every Company's work folder (#399): the files its Agents made in its work sandbox, without their tool caches.
  { title: 'settingsBackupWork', detail: 'settingsBackupWorkD', paths: ['work'] },
];

// What stays outside the archive: its owner keeps it, or the next update fetches it again.
export const backupExcludes = [
  { title: 'settingsBackupExcludeModel' },
  { title: 'settingsBackupExcludeApps' },
  { title: 'settingsBackupExcludeImages', detail: 'settingsBackupExcludeImagesD' },
  { title: 'settingsBackupExcludeCaches', detail: 'settingsBackupExcludeCachesD' },
];

// The commands the section shows. Restore stays on the host and accepts an empty install only.
export const backupCommands = {
  install: [
    { title: 'settingsBackupCommandBackup', command: 'gtmworks backup' },
    { title: 'settingsBackupCommandRestore', command: 'gtmworks restore <archive>' },
  ],
  source: ['sh scripts/install.sh backup', 'sh scripts/install.sh restore <archive>'],
};
