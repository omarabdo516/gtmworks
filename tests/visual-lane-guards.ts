import type { BrowserContext, Page } from '@playwright/test';

// What keeps a visual lane picture the same on every run (#257). A context gets a fixed clock and no way off the machine;
// before each comparison expectDeterministic says why the page could not be drawn the same way again, if it could not.
export const FIXED = new Date('2026-06-15T12:00:00Z');

const outside = new WeakMap<BrowserContext, string[]>();
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Aborts every request whose host is not this machine, and keeps its address for expectDeterministic. */
export async function blockOutsideRequests(context: BrowserContext) {
  const blocked: string[] = [];
  outside.set(context, blocked);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || loopback.has(url.hostname)) return route.fallback();
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
}

/** Date.now() and new Date() read FIXED in every page; timers still run. */
export async function fixClock(context: BrowserContext) {
  await context.clock.setFixedTime(FIXED);
}

export async function expectDeterministic(page: Page) {
  const problems: string[] = [];
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const unquote = (family: string) => family.trim().replace(/^(["'])(.*)\1$/, '$2');
    const faces = [...document.fonts];
    const declared = new Set(faces.map(face => unquote(face.family)));
    const found = new Set(faces.filter(face => face.status === 'error').map(face => `font "${unquote(face.family)}" ${face.weight} did not load`));
    // A face that never loaded leaves the browser drawing the text in the next family of the list.
    for (const element of document.body.querySelectorAll('*')) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      if (!text || !element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      const family = unquote(style.fontFamily.split(',')[0]);
      if (declared.has(family) && !document.fonts.check(`${style.fontStyle} ${style.fontWeight} 16px "${family}"`, text)) found.add(`font "${family}" ${style.fontWeight} fell back`);
    }
    return [...found];
  });
  problems.push(...fonts);
  const now = await page.evaluate(() => Date.now());
  if (now !== FIXED.getTime()) problems.push(`the page's clock reads ${new Date(now).toISOString()}, not ${FIXED.toISOString()}`);
  const blocked = outside.get(page.context());
  if (!blocked) problems.push('the page\'s context does not block outside requests (blockOutsideRequests)');
  else if (blocked.length) problems.push(`requests off the machine were blocked: ${[...new Set(blocked)].join(', ')}`);
  if (problems.length) throw new Error(`this picture would not be the same on the next run: ${problems.join('; ')}`);
}
