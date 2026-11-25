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
// psql in the lane's own database container, as its owner: the seed's restore, and the tests' quick reads.
const psql = (args: string[], input: string) => execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args],
  { input, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });

/** The rows a query reads on this lane's database, at once. The Supabase CLI (`npx supabase db query`) answers the same
 * but took up to 8 s on a loaded runner: a read inside a toast's time, such as before its Undo, uses this (#746). */
export function laneRows(sql: string): Record<string, unknown>[] {
  return JSON.parse(psql(['-q', '-At'], `select coalesce(json_agg(row_to_json(r)), '[]') from (${sql}) r;`));
}

// The lane's seed is restored for this run's file and repeat, and, for a beforeAll (`worker`), in this worker. `again`
// restores even when it already was.
function seed(info: TestInfo, { worker, again = false }: { worker: boolean, again?: boolean }) {
  const owner = `${process.env.GTMWORKS_TEST_RUN} ${info.file} repeat ${info.repeatEachIndex}`;
  let seeded: string[] = [];
  try { seeded = readFileSync(marker, 'utf8').split('\n'); } catch { /* no file has used this lane yet */ }
  if (!again && seeded[0] === owner && (!worker || seeded[1] === String(info.workerIndex))) return;
  // One transaction: the lane's app or worker may still be finishing a query of the previous file, and a restore that
  // meets it in a deadlock is rolled back whole and tried again; any other error fails the test at once.
  for (let attempt = 1; ; attempt++) {
    try {
      psql(['-q', '--single-transaction'], `${noSlowReads}\n${readFileSync(snapshot, 'utf8')}`);
      break;
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      if (attempt >= 5 || !stderr.includes('deadlock detected')) throw new Error(`Restoring the seed failed: ${stderr}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
  writeFileSync(marker, `${owner}\n${info.workerIndex}`);
}

// A file's beforeAll calls this before it prepares its data. `again` restores even in the worker that already did: a
// test that inserts its own rows and runs again in the same file.
export function freshSeed(info: TestInfo, again = false) { seed(info, { worker: true, again }); }

export const test = base.extend<{ seededFile: void }>({
  seededFile: [async ({}, use, testInfo) => {
    if (['functional', 'alone', 'measured'].includes(testInfo.project.name)) seed(testInfo, { worker: false });
    await use();
  }, { auto: true }],
});
