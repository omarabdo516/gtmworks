import { test as base } from './offline-browser';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbContainerOf, seedSnapshotOf } from './lane.mjs';
import { noSlowReads } from './slow-reads';

export * from './offline-browser';

// Every functional spec file starts from the database exactly as the seed builds it (#69): before its first test, or in
// its own beforeAll when it prepares data there, the lane's data is put back from the snapshot scripts/local-db.sh took.
// A file then proves its promise on its own, whichever files ran before it in its lane. The tests inside one file still
// share what they change, in order. A retry on the lane that ran the file keeps that file's data; a retry that lands on
// another lane starts that lane from the seed, as the file itself did.
const snapshot = seedSnapshotOf();
const marker = join(dirname(snapshot), 'seeded-for');
// `again` restores it even for the file that ran last: a serial file's retry, or its next repeat, starts from the beginning.
export function freshSeed(file: string, again = false) {
  const owner = `${process.env.GTMWORKS_TEST_RUN} ${file}`;
  try { if (!again && readFileSync(marker, 'utf8') === owner) return; } catch { /* no file has used this lane yet */ }
  // One transaction: the lane's app or worker may still be finishing a query of the previous file, and a restore that
  // meets it in a deadlock is rolled back whole and tried again; any other error fails the test at once.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction'],
        { input: `${noSlowReads}\n${readFileSync(snapshot, 'utf8')}`, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });
      break;
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      if (attempt >= 5 || !stderr.includes('deadlock detected')) throw new Error(`Restoring the seed failed: ${stderr}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
  writeFileSync(marker, owner);
}

export const test = base.extend<{ seededFile: void }>({
  seededFile: [async ({}, use, testInfo) => {
    if (['functional', 'alone', 'measured'].includes(testInfo.project.name)) freshSeed(testInfo.file);
    await use();
  }, { auto: true }],
});
