import type { BrowserContext, Page } from '@playwright/test';

// What keeps a visual lane picture the same on every run (#257). A context gets a fixed clock and no way off the machine;
// before each comparison expectDeterministic says why the page could not be drawn the same way again, if it could not.
export const FIXED = new Date('2026-06-15T12:00:00Z');

const outside = new WeakMap<BrowserContext, string[]>();
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

const offMachine = (href: string) => {
  const url = new URL(href);
  return url.protocol !== 'data:' && url.protocol !== 'blob:' && url.protocol !== 'about:' && !loopback.has(url.hostname);
};

/** Aborts every request whose host is not this machine, and keeps its address for expectDeterministic. */
export async function blockOutsideRequests(context: BrowserContext) {
  const blocked: string[] = [];
  outside.set(context, blocked);
  // A redirect hop never reaches the route below, so every request is also recorded as it is sent.
  context.on('request', request => { if (offMachine(request.url())) blocked.push(request.url()); });
  await context.route('**/*', route => (offMachine(route.request().url()) ? route.abort('blockedbyclient') : route.fallback()));
  // Only sockets off the machine are routed: the app's own realtime socket on loopback goes straight to the stack.
  await context.routeWebSocket(url => offMachine(url.href), socket => { blocked.push(socket.url()); return socket.close(); });
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
    // The generic families are the pinned image's own faces; any other family must be one the page declares.
    const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
    const ranges = (face: FontFace) => face.unicodeRange.split(',').map(part => {
      const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
      return from.includes('?') ? [parseInt(from.replace(/\?/g, '0'), 16), parseInt(from.replace(/\?/g, 'F'), 16)] : [parseInt(from, 16), parseInt(to, 16)];
    });
    const covers = (face: FontFace, text: string) => [...text].some(char => !/\s/.test(char) && ranges(face).some(([from, to]) => char.codePointAt(0)! >= from && char.codePointAt(0)! <= to));
    for (const element of document.body.querySelectorAll('*')) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      if (!text || !element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      const family = unquote(style.fontFamily.split(',')[0]);
      if (generic.has(family)) continue;
      if (!declared.has(family)) found.add(`font "${family}" is not declared, so the text falls back to another face`);
      // check() also passes when every face of the family leaves the text out by its unicode-range.
      else if (!faces.some(face => unquote(face.family) === family && covers(face, text))) found.add(`font "${family}" covers none of "${text.slice(0, 40)}"`);
      else if (!document.fonts.check(`${style.fontStyle} ${style.fontWeight} 16px "${family}"`, text)) found.add(`font "${family}" ${style.fontWeight} fell back`);
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
