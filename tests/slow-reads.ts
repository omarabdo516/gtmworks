import { execFileSync, spawn } from 'node:child_process';
import type { Page, Route } from '@playwright/test';
import { dbContainerOf } from './lane.mjs';

// The lane's database as its own administrator with triggers off, the way tests/fresh-seed.ts puts the seed back, so
// append-only rows (a Conversation's messages) written for a test can be taken away again.
export const asAdmin = (sql: string) => execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction'],
  { input: `set session_replication_role = replica;\n${sql}`, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });

// Every read of `table` by a signed-in person waits on `waits` first (#172): a restrictive policy only a test adds. The
// page's other reads stay as fast as ever, so only the part of a page that reads this table waits. Signed-in reads end
// at the role's statement timeout (8s on Supabase), so a slow read's seconds stay under it.
export const slowReads = (table: string, waits: string) => ({
  set: `create policy test_slow_read on public.${table} as restrictive for select to authenticated using ((select ${waits}) is not null);`,
  unset: `drop policy if exists test_slow_read on public.${table};`,
});

export async function whileSlow(table: string, seconds: number, run: () => Promise<void>) {
  const { set, unset } = slowReads(table, `pg_sleep(${seconds})`);
  asAdmin(`${unset}\n${set}`);
  try { await run(); } finally { asAdmin(unset); }
}

// Holds every read of `table` by a signed-in person until `letGo` (#305): the same policy as slowReads, waiting instead
// on an advisory lock the test takes in a session of its own. So the part of a page that reads the table waits for the
// test, which lets it go when its assertions are done, and no clock decides when it arrives. `hold` takes the lock
// again for a later part of the same journey, and `stop` lets the reads run and takes the policy away.
export async function holdReads(table: string) {
  const key = 305; // the test's own lock: no part of the app takes one
  const { set, unset } = slowReads(table, `pg_advisory_xact_lock(${key})`);
  asAdmin(`${unset}\n${set}`);
  const session = spawn('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  let closed = false;
  let gone: Error | null = null;
  const waiting: { marker: string, held: () => void, failed: (error: Error) => void }[] = [];
  const ended = new Promise<void>(resolve => session.once('exit', () => { closed = true; resolve(); }));
  // A session that has gone takes none of the locks, and its pipes are closed.
  const failed = (error: Error) => { gone = error; for (const waiter of waiting.splice(0)) waiter.failed(error); };
  session.stdin.on('error', () => {});
  session.stdout.setEncoding('utf8');
  session.stdout.on('data', (chunk: string) => {
    said += chunk;
    for (const waiter of waiting.filter(waiter => said.includes(waiter.marker))) {
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.held();
    }
  });
  session.on('error', failed);
  session.on('exit', (code, signal) => failed(new Error(`the hold on ${table} ended (${code ?? signal}): ${said.trim()}`)));
  // psql's answer names the marker once the lock is granted, so the test knows the read will wait.
  let taken = 0;
  const hold = () => new Promise<void>((held, fails) => {
    const marker = `held-${++taken}`;
    if (gone) return fails(gone);
    if (said.includes(marker)) return held();
    waiting.push({ marker, held, failed: fails });
    session.stdin.write(`select pg_advisory_lock(${key}), '${marker}';\n`);
  });
  const letGo = () => { if (!closed) session.stdin.write(`select pg_advisory_unlock(${key});\n`); };
  try { await hold(); } catch (error) { session.kill(); asAdmin(unset); throw error; }
  return {
    hold,
    letGo,
    stop: async () => {
      letGo();
      session.stdin.end();
      await ended;
      asAdmin(unset);
    },
  };
}

// A page that reports no link as seen, so no link prefetches: Next prefetches a link it sees whole, and a click then
// waits for that prefetch and draws the page whole, never its placeholder (#305). A link the person activates still
// opens, so the page's frame streams while its own reads wait. `hydrated` waits for the shell's fetch tracking
// (lib/link.tsx, app/layout.tsx), so the activation is the router's and not the browser's own document load.
export async function unprefetched(page: Page) {
  await page.addInitScript(() => {
    const native = window as unknown as { nativeFetch: typeof fetch };
    native.nativeFetch = window.fetch;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  });
  return { hydrated: () => page.waitForFunction(() => window.fetch !== (window as unknown as { nativeFetch?: typeof fetch }).nativeFetch) };
}

// Holds the page's own requests for the pages `matches` names until `letGo`. Every link prefetches its page whole and
// keeps it for five minutes (lib/link.tsx, next.config.mjs), so a page opened from a link the browser has already
// seen shows what was read then. Held, the prefetch reaches the server only when the test lets it go.
export async function holdPages(page: Page, matches: (url: URL) => boolean) {
  let letGo = () => {};
  const held = new Promise<void>(resolve => { letGo = resolve; });
  const hold = async (route: Route) => {
    if (route.request().headers().rsc === '1') await held;
    await route.continue();
  };
  await page.route(matches, hold);
  return { letGo: () => letGo(), stop: () => page.unroute(matches, hold) };
}

// Delivers the pages `matches` names only once the server has sent the whole of each, so the browser draws a page from
// its complete response: no part of it is still on its way, whatever the server took to read it.
export async function wholePages(page: Page, matches: (url: URL) => boolean) {
  const whole = async (route: Route) => {
    // A request the page gave up on (a prefetch it no longer needs) has no response to deliver.
    // A redirect (to sign-in) goes to the browser as it is, so the browser follows it.
    const response = await route.fetch({ maxRedirects: 0 }).catch(() => null);
    await (response ? route.fulfill({ response }) : route.abort()).catch(() => {});
  };
  await page.route(matches, whole);
  return () => page.unroute(matches, whole);
}

// Records the text of every loading placeholder still on the page and visible once its 400ms hold has ended
// (app/shell.css, .sk-hold): one a person saw, on every document the page opens, the first one after sign-in
// included. `waiting` counts the open document's placeholders whose hold has not ended yet; one whose document went
// away before then was never seen.
export async function watchPlaceholders(page: Page) {
  const seen: string[] = [];
  await page.exposeFunction('placeholderSeen', (label: string) => { seen.push(label); });
  await page.addInitScript(() => {
    const watched = window as unknown as { placeholderSeen: (label: string) => Promise<void>, placeholdersWaiting: number };
    watched.placeholdersWaiting = 0;
    const watch = (element: Element) => {
      watched.placeholdersWaiting++;
      const hold = element.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'gw-sk-hold');
      // A placeholder taken away before its hold ends cancels the hold, which rejects `finished`.
      const ended: Promise<unknown> = hold ? hold.finished : new Promise(resolve => setTimeout(resolve, 400));
      ended.then(() => element.isConnected && element.checkVisibility({ checkVisibilityCSS: true }) ? watched.placeholderSeen(element.textContent ?? '') : undefined, () => {})
        .finally(() => { watched.placeholdersWaiting--; });
    };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const element of [node, ...node.querySelectorAll('*')]) if (element.matches('.sk-hold[aria-busy="true"]')) watch(element);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return {
    seen: () => [...seen],
    waiting: () => page.evaluate(() => (window as unknown as { placeholdersWaiting: number }).placeholdersWaiting),
  };
}

// Takes away every slowing policy a test added (slowReads, holdReads), as the seed is put back: a run stopped inside
// whileSlow or holdReads leaves its policy behind, and the restored data does not hold policies.
export const noSlowReads = `do $$ declare found record; begin
  for found in select tablename from pg_policies where schemaname = 'public' and policyname = 'test_slow_read' loop
    execute format('drop policy test_slow_read on public.%I', found.tablename);
  end loop;
end $$;`;
