import { test as base, type TestInfo } from './offline-browser';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbContainerOf, seedSnapshotOf } from './lane.mjs';
import { noSlowReads } from './slow-reads';

export * from './offline-browser';

// Every functional spec file starts from the database exactly as the seed builds it (#69): before its first test, or in
// its own beforeAll when it prepares data there, the lane's data is put back from the snapshot scripts/local-db.sh took.
// A file then proves its promise on its own, whichever files ran before it in its lane. The tests inside one file still
// share what they change, in order, and each repeat of a file (--repeat-each) starts from the seed again.
//
// A beforeAll runs again in every worker that takes the file up, and Playwright starts a new worker after any failed
// test: for a retry (a serial file's from its first test), and, with no retries, for the tests after the failed one.
// So a beforeAll that prepares data always finds the seed, even on the lane its earlier worker left full: inserting the
// same rows again there failed with a duplicate key, and turned one failed attempt into a failed file (#746). Without a
// beforeAll, a test that runs again on the lane that ran the file keeps that file's data, as it did.
const snapshot = seedSnapshotOf();
const marker = join(dirname(snapshot), 'seeded-for');
const ownerOf = (info: TestInfo) => `${process.env.GTMWORKS_TEST_RUN} ${info.file} repeat ${info.repeatEachIndex}`;
const seededFor = () => { try { return readFileSync(marker, 'utf8').split('\n'); } catch { return []; } };

function restore(owner: string, worker: number) {
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
  writeFileSync(marker, `${owner}\n${worker}`);
}

// A file's beforeAll calls this before it prepares its data. `again` restores even in the worker that already did: a
// test that inserts its own rows and runs again in the same file.
export function freshSeed(info: TestInfo, again = false) {
  const owner = ownerOf(info);
  const [file, worker] = seededFor();
  if (!again && file === owner && worker === String(info.workerIndex)) return;
  restore(owner, info.workerIndex);
}

export const test = base.extend<{ seededFile: void }>({
  seededFile: [async ({}, use, testInfo) => {
    if (['functional', 'alone', 'measured'].includes(testInfo.project.name)) {
      const owner = ownerOf(testInfo);
      if (seededFor()[0] !== owner) restore(owner, testInfo.workerIndex);
    }
    await use();
  }, { auto: true }],
});
