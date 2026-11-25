import { expect, test, type Page } from '@playwright/test';

// Text contrast, measured from the styles the browser draws with, never from a picture (#218, #257, #805). It moved here from
// the visual lane's guards when the lane went: contrast checks never go away.

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
