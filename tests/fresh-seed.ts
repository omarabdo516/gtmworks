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
// `again` restores it even for the file that ran last: a serial file's retry starts from the beginning.
export function freshSeed(file: string, again = false) {
  const owner = `${process.env.GTMWORKS_TEST_RUN} ${file}`;
  try { if (!again && readFileSync(marker, 'utf8') === owner) return; } catch { /* no file has used this lane yet */ }
  // One transaction: the lane's app or worker may still be finishing a query of the previous file, and a restore that
  // meets it in a deadlock is rolled back whole and tried again; any other error fails the test at once.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction'],
        { input: readFileSync(snapshot), stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });
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
    if (['functional', 'measured'].includes(testInfo.project.name)) freshSeed(testInfo.file);
    await use();
  }, { auto: true }],
});

// TEMPORARY (#172): where each copy of a doubled element sits when a test fails, to find what leaves the second copy.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const report = await page.evaluate(() => {
    const chain = (node: Element | null) => { const parts: string[] = []; for (let at = node; at && at !== document.documentElement; at = at.parentElement) parts.push(`${at.tagName.toLowerCase()}${at.id ? '#' + at.id : ''}${at.hasAttribute('hidden') ? '[hidden]' : ''}${at.getAttribute('style') ? `[style=${at.getAttribute('style')}]` : ''}${at.className && typeof at.className === 'string' ? '.' + at.className.split(' ').slice(0, 2).join('.') : ''}`); return parts.join(' < '); };
    const comments = [...document.body.childNodes].filter(node => node.nodeType === 8).map(node => node.textContent);
    return { copies: ['.turns', '.priv-line', '.panel--wait', '.corner-pill', '.dash__inner'].flatMap(selector => [...document.querySelectorAll(selector)].map(element => `${selector}: ${chain(element)}`)), bodyComments: comments, hiddenDivs: [...document.querySelectorAll('div[hidden]')].map(element => `${element.id}:${element.childElementCount}`), react: document.documentElement.outerHTML.match(/\$R[A-Z]/g)?.slice(0, 20) };
  }).catch(error => ({ error: String(error) }));
  console.log(`[172-diagnosis] ${testInfo.title}: ${JSON.stringify(report)}`);
});
