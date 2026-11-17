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

type Watched = { placeholders: { seen: string[], waiting: number } };
// Records the label of every loading placeholder still on the page and visible once its 400ms hold has ended
// (app/shell.css, .sk-hold): one a person saw. `waiting` counts those whose hold has not ended yet.
export async function watchPlaceholders(page: Page) {
  await page.addInitScript(() => {
    const placeholders: Watched['placeholders'] = { seen: [], waiting: 0 };
    Object.assign(window, { placeholders });
    const watch = (element: Element) => {
      placeholders.waiting++;
      const hold = element.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'gw-sk-hold');
      // A placeholder taken away before its hold ends cancels the hold, which rejects `finished`.
      const ended: Promise<unknown> = hold ? hold.finished : new Promise(resolve => setTimeout(resolve, 400));
      ended.then(() => { if (element.isConnected && element.checkVisibility({ checkVisibilityCSS: true })) placeholders.seen.push(element.getAttribute('aria-label') ?? ''); }, () => {})
        .finally(() => { placeholders.waiting--; });
    };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const element of [node, ...node.querySelectorAll('*')]) if (element.matches('.sk-hold[aria-busy="true"]')) watch(element);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return {
    seen: () => page.evaluate(() => (window as unknown as Watched).placeholders.seen),
    waiting: () => page.evaluate(() => (window as unknown as Watched).placeholders.waiting),
  };
}
