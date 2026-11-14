import { test as base } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbContainerOf, seedSnapshotOf } from './lane.mjs';

export * from '@playwright/test';

// Every functional spec file starts from the database exactly as the seed builds it (#69): before its first test, or in
// its own beforeAll when it prepares data there, the lane's data is put back from the snapshot scripts/local-db.sh took.
// A file then proves its promise on its own, whichever files ran before it in its lane. The tests inside one file still
// share what they change, in order. A retry on the lane that ran the file keeps that file's data; a retry that lands on
// another lane starts that lane from the seed, as the file itself did.
const snapshot = seedSnapshotOf();
const marker = join(dirname(snapshot), 'seeded-for');
export function freshSeed(file: string) {
  const owner = `${process.env.GTMWORKS_TEST_RUN} ${file}`;
  try { if (readFileSync(marker, 'utf8') === owner) return; } catch { /* no file has used this lane yet */ }
  execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: readFileSync(snapshot), stdio: ['pipe', 'ignore', 'inherit'] });
  writeFileSync(marker, owner);
}

export const test = base.extend<{ seededFile: void }>({
  seededFile: [async ({}, use, testInfo) => {
    if (['functional', 'measured'].includes(testInfo.project.name)) freshSeed(testInfo.file);
    await use();
  }, { auto: true }],
});
