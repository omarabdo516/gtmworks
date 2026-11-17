import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

// Secondary text in the light theme: each quiet label keeps 4.5:1 on what is behind it and stays weaker than the body
// text there, and a selector that finds nothing fails. Contrast checks never go away (#218, #257).
export type QuietCheck = [kind: string, selector: string, pseudo?: string];
export async function expectQuietContrast(page: Page, checks: QuietCheck[]) {
  for (const [kind, selector, pseudo] of checks) {
    const found = await textContrast(page, selector, pseudo);
    expect(found.length, `${kind}: nothing to measure`).toBeGreaterThan(0);
    for (const item of found) {
      expect(item.secondary, `${kind} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      expect(item.secondary, `${kind} "${item.text}" must stay weaker than body text`).toBeLessThan(item.body);
    }
  }
}

// Contrast is computed from what the browser draws: the text color (with its own opacity and its parents' opacity) laid over
// the background colors stacked behind it, so a faded copy of a darker color is measured as faded.
async function textContrast(page: Page, selector: string, pseudo?: string) {
  return page.evaluate(({ selector, pseudo }) => {
    const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = css; context.fillRect(0, 0, 1, 1); const d = context.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
    const light = (color: number[]) => { const [r, g, b] = color.slice(0, 3).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const bodyColor = rgba(getComputedStyle(document.body).color);
    return Array.from(document.querySelectorAll(selector)).filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'; }).map(element => {
      let background = [255, 255, 255];
      const chain: Element[] = []; let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) { chain.unshift(node); opacity *= Number(getComputedStyle(node).opacity); }
      for (const node of chain) background = over(rgba(getComputedStyle(node).backgroundColor), background);
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      const body = over([bodyColor[0], bodyColor[1], bodyColor[2], bodyColor[3]], background);
      return { text: (element.textContent || (element as HTMLTextAreaElement).placeholder || '').trim(), secondary: ratio(shown, background), body: ratio(body, background) };
    });
  }, { selector, pseudo });
}

// Every visible text run in the dark theme keeps 4.5:1 on what is behind it.
export async function expectDarkContrast(page: Page) {
  const result = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); const bytes = canvas.getImageData(0, 0, 1, 1).data; return [bytes[0], bytes[1], bytes[2], bytes[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(index => top[index] * top[3] + below[index] * (1 - top[3]));
    const luminance = (color: number[]) => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const targets: { element: Element, text: string, pseudo?: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) targets.push({ element: walker.currentNode.parentElement!, text });
    }
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]),textarea')) {
      const text = element.value || element.placeholder;
      if (text) targets.push({ element, text, pseudo: element.value ? undefined : '::placeholder' });
    }
    for (const element of document.querySelectorAll<HTMLSelectElement>('select')) targets.push({ element, text: element.selectedOptions[0]?.text || '' });
    let checked = 0;
    const failures = [];
    for (const { element, text, pseudo } of targets) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[aria-hidden=true],.sr-only')) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let background = [255, 255, 255], opacity = 1;
      const chain: Element[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) chain.unshift(ancestor);
      for (const ancestor of chain) { const style = getComputedStyle(ancestor); background = over(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      const values = [luminance(shown), luminance(background)].sort((first, second) => second - first);
      const ratio = (values[0] + 0.05) / (values[1] + 0.05);
      checked++;
      if (ratio < 4.5) failures.push({ text, ratio });
    }
    return { checked, failures };
  });
  expect(result.checked, 'visible dark text was measured').toBeGreaterThan(0);
  await test.info().attach('dark-contrast', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.failures, `${result.checked} dark text runs checked at 4.5:1`).toEqual([]);
}
