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

/** Each picture is judged by its own requests: the list a context keeps is emptied before the next one. */
export function forgetBlocked(context: BrowserContext) {
  outside.get(context)?.splice(0);
}

/** Date.now() and new Date() read FIXED in every page; timers still run. */
export async function fixClock(context: BrowserContext) {
  await context.clock.setFixedTime(FIXED);
}

// Text that follows the real calendar is replaced by fixed text, so the picture keeps its layout, font and colour but not
// the day it was drawn: the log's day-group header (LogDays / useDayName, outside any <time>), the times, and the 14 day
// chart labels. The pinned clock dates the client half of every page; the server half is drawn when it is asked, so the
// header's text is fixed here rather than left to whichever day the run is on.
export async function fixClockText(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur(); // no focus ring or open picker in the picture
    const months = 'January|February|March|April|May|June|July|August|September|October|November|December|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر';
    const monthName = new RegExp(months);
    const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (element.children.length || skipped.has(element.tagName)) continue;
      // A Routine's times are fixed hours of a fixed day before and after the server's own (visual-lane.spec.ts, #31).
      if (element.closest('.rt-row')) continue;
      // Good morning's time is the fixture's own 9:00 in its own zone (visual-lane.spec.ts, #182), never today's clock.
      if (element.closest('.ck-time')) continue;
      const text = (element.textContent ?? '').trim();
      if (element.matches('.lg-day__h')) element.textContent = 'Day';
      else if (element.closest('.chart-bars') && /\d/.test(text) && monthName.test(text)) element.textContent = 'Month 00';
      else if (element.tagName === 'TIME' || /\d{1,2}:\d{2}/.test(text)) element.textContent = 'Date, 00:00';
    }
  });
}

export async function expectDeterministic(page: Page) {
  const problems: string[] = [];
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const unquote = (family: string) => family.trim().replace(/^(["'])(.*)\1$/, '$2');
    const faces = [...document.fonts];
    const declared = new Set(faces.map(face => unquote(face.family)));
    // A face whose every source is local() names a font the pinned image either has or lacks, the same on every run:
    // next/font's metric-matched "<family> Fallback" faces point at Arial, which the image lacks.
    // A family is exempt only when every face it declares is local(): one url() face keeps the whole family checked.
    const localOnly = new Set<string>();
    const fetched = new Set<string>();
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const src = rule.style.getPropertyValue('src');
        const family = unquote(rule.style.getPropertyValue('font-family'));
        // Only next/font's metric-matched "<family> Fallback" faces: any other local() face is checked like the rest.
        (src && !/url\(/.test(src) && /fallback/i.test(family) ? localOnly : fetched).add(family);
      }
    }
    for (const family of fetched) localOnly.delete(family);
    const found = new Set(faces.filter(face => face.status === 'error' && !localOnly.has(unquote(face.family))).map(face => `font "${unquote(face.family)}" ${face.weight} did not load`));
    // The generic families are the pinned image's own faces; any other family must be one the page declares.
    const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
    const ranges = (face: FontFace) => face.unicodeRange.split(',').map(part => {
      const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
      return from.includes('?') ? [parseInt(from.replace(/\?/g, '0'), 16), parseInt(from.replace(/\?/g, 'F'), 16)] : [parseInt(from, 16), parseInt(to, 16)];
    });
    const covers = (face: FontFace, text: string) => [...text].some(char => !/\s/.test(char) && ranges(face).some(([from, to]) => char.codePointAt(0)! >= from && char.codePointAt(0)! <= to));
    // A run of symbols alone (a close mark, an arrow) may sit outside every face of its family and is then drawn by the
    // pinned image's own symbol face, the same every run; a face of the family that is still loading is still named.
    const wordless = (text: string) => !/[\p{L}\p{N}]/u.test(text);
    for (const element of document.body.querySelectorAll('*')) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      if (!text || !element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      const family = unquote(style.fontFamily.split(',')[0]);
      if (generic.has(family)) continue;
      if (!declared.has(family)) found.add(`font "${family}" is not declared, so the text falls back to another face`);
      else if (wordless(text)) { if (!localOnly.has(family) && !document.fonts.check(`${style.fontStyle} ${style.fontWeight} 16px "${family}"`, text)) found.add(`font "${family}" ${style.fontWeight} fell back`); }
      // check() also passes when every face of the family leaves the text out by its unicode-range.
      else if (!faces.some(face => unquote(face.family) === family && covers(face, text))) found.add(`font "${family}" covers none of "${text.slice(0, 40)}"`);
      else if (!localOnly.has(family) && !document.fonts.check(`${style.fontStyle} ${style.fontWeight} 16px "${family}"`, text)) found.add(`font "${family}" ${style.fontWeight} fell back`);
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
    const found = await measureContrast(page, selector, pseudo);
    expect(found.length, `${kind}: nothing to measure`).toBeGreaterThan(0);
    for (const item of found) {
      expect(item.secondary, `${kind} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      expect(item.secondary, `${kind} "${item.text}" must stay weaker than body text`).toBeLessThan(item.body);
    }
  }
}

// Contrast is computed from what the browser draws: the text color (with its own opacity and its parents' opacity) laid over
// the background colors stacked behind it, so a faded copy of a darker color is measured as faded. One measure serves the
// quiet labels (a selector) and the dark theme (every visible text run, input and select).
type Measured = { text: string, secondary: number, body: number };
function measureContrast(page: Page, selector: string | null, pseudo?: string): Promise<Measured[]> {
  return page.evaluate(({ selector, pseudo }) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    // fillStyle keeps its last value when given a colour it cannot read, so it is reset first.
    const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); const d = canvas.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
    const light = (color: number[]) => { const [r, g, b] = color.slice(0, 3).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const bodyColor = rgba(getComputedStyle(document.body).color);
    // Behind every element is the page's canvas, white or the dark scheme's own, read from a probe painted with it.
    const probe = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'background: Canvas; position: absolute; width: 0; height: 0' }));
    const canvasColor = rgba(getComputedStyle(probe).backgroundColor).slice(0, 3);
    probe.remove();
    const targets: { element: Element, text: string, pseudo?: string }[] = [];
    if (selector) {
      for (const element of document.querySelectorAll(selector)) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden') targets.push({ element, text: (element.textContent || (element as HTMLTextAreaElement).placeholder || '').trim(), pseudo });
      }
    } else {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const text = walker.currentNode.textContent?.trim(); if (text) targets.push({ element: walker.currentNode.parentElement!, text }); }
      for (const element of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]),textarea')) {
        const text = element.value || element.placeholder;
        if (text) targets.push({ element, text, pseudo: element.value ? undefined : '::placeholder' });
      }
      for (const element of document.querySelectorAll<HTMLSelectElement>('select')) targets.push({ element, text: element.selectedOptions[0]?.text || '' });
    }
    const measured = [];
    for (const { element, text, pseudo } of targets) {
      if (!selector) {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[aria-hidden=true],.sr-only')) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
      }
      let background = canvasColor, opacity = 1;
      const chain: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
      for (const node of chain) { const style = getComputedStyle(node); background = over(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      measured.push({ text, secondary: ratio(shown, background), body: ratio(over(bodyColor, background), background) });
    }
    return measured;
  }, { selector, pseudo });
}

// Every visible text run in the dark theme keeps 4.5:1 on what is behind it.
export async function expectDarkContrast(page: Page) {
  const measured = await measureContrast(page, null);
  const failures = measured.filter(item => item.secondary < 4.5).map(({ text, secondary: ratio }) => ({ text, ratio }));
  expect(measured.length, 'visible dark text was measured').toBeGreaterThan(0);
  await test.info().attach('dark-contrast', { body: JSON.stringify({ checked: measured.length, failures }), contentType: 'application/json' });
  expect(failures, `${measured.length} dark text runs checked at 4.5:1`).toEqual([]);
}
