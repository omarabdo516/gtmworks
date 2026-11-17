import { execFileSync } from 'node:child_process';
import type { Page, Route } from '@playwright/test';
import { dbContainerOf } from './lane.mjs';

// The lane's database as its own administrator with triggers off, the way tests/fresh-seed.ts puts the seed back, so
// append-only rows (a Conversation's messages) written for a test can be taken away again.
export const asAdmin = (sql: string) => execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction'],
  { input: `set session_replication_role = replica;\n${sql}`, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });

// Every read of `table` by a signed-in person waits `seconds` first (#172): a restrictive policy only a test adds. The
// page's other reads stay as fast as ever, so only the part of a page that reads this table is slow. Signed-in reads
// end at the role's statement timeout (8s on Supabase), so `seconds` stays under it.
export const slowReads = (table: string, seconds: number) => ({
  set: `create policy test_slow_read on public.${table} as restrictive for select to authenticated using ((select pg_sleep(${seconds})) is not null);`,
  unset: `drop policy if exists test_slow_read on public.${table};`,
});

export async function whileSlow(table: string, seconds: number, run: () => Promise<void>) {
  const { set, unset } = slowReads(table, seconds);
  asAdmin(`${unset}\n${set}`);
  try { await run(); } finally { asAdmin(unset); }
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
    const response = await route.fetch().catch(() => null);
    await (response ? route.fulfill({ response }) : route.abort()).catch(() => {});
  };
  await page.route(matches, whole);
  return () => page.unroute(matches, whole);
}

// Records the label of every loading placeholder still on the page and visible once its 400ms hold has ended
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
      ended.then(() => element.isConnected && element.checkVisibility({ checkVisibilityCSS: true }) ? watched.placeholderSeen(element.getAttribute('aria-label') ?? '') : undefined, () => {})
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

// Takes away every slowing policy a test added (slowReads), as the seed is put back: a run stopped inside whileSlow
// leaves its policy behind, and the restored data does not hold policies.
export const noSlowReads = `do $$ declare found record; begin
  for found in select tablename from pg_policies where schemaname = 'public' and policyname = 'test_slow_read' loop
    execute format('drop policy test_slow_read on public.%I', found.tablename);
  end loop;
end $$;`;
